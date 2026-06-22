import logging
from typing import Literal

from fastapi import APIRouter, HTTPException
from google.genai import types
from pydantic import BaseModel, ValidationError

from ..db import conn
from ..llm_client import generate_content
from ..prompts.builder import (
    build_gemini_prompt,
    build_proactive_prompt,
    get_global_prompt,
    get_label_config,
    get_user_name,
)
from ..rag.embeddings import embed
from ..rag.retrieval import recent_messages, recent_owner_notes, search, store_embedding
from ..settings import settings

logger = logging.getLogger(__name__)

router = APIRouter()


class RespondRequest(BaseModel):
    chat_id: str
    message_text: str
    sender_name: str | None = None


class RespondResult(BaseModel):
    """Structured output the model must return — the anti-hallucination gate.

    `need_info` means the model lacked grounding to answer; the gateway turns
    that into a "falta contexto" draft instead of sending an invented reply.
    """

    status: Literal["answer", "need_info"] = "answer"
    reply: str = ""
    missing: str | None = None


class RespondResponse(BaseModel):
    status: Literal["answer", "need_info"]
    reply: str
    missing: str | None = None


def _parse_result(response) -> RespondResult:
    """Read Gemini's structured JSON, with a plain-text fallback if the model
    ignored the schema (treats the raw text as a normal answer)."""
    parsed = getattr(response, "parsed", None)
    if isinstance(parsed, RespondResult):
        return parsed
    raw = (response.text or "").strip()
    if raw:
        try:
            return RespondResult.model_validate_json(raw)
        except ValidationError:
            logger.warning("respond: structured output unparsable, falling back to plain text")
            return RespondResult(status="answer", reply=raw, missing=None)
    return RespondResult(status="answer", reply="", missing=None)


# Interrogatives that flag a factual/precise question (accent-insensitive-ish).
_QUESTION_CUES = (
    "que ", "qué ", "cuando", "cuándo", "donde", "dónde", "cuanto", "cuánto",
    "quien", "quién", "como ", "cómo ", "cual", "cuál", "por que", "por qué",
    "a que hora", "a qué hora",
)


def _adapt_temperature(base: float, message_text: str, context) -> float:
    """Adapt the sampling temperature to the message.

    Factual questions get a lower temperature (more deterministic, less prone to
    embellishing/inventing); social/casual messages keep the label's tuned value
    (natural variety). Strong grounding (a close, relevant match exists) tightens
    it further. All signals are computed pre-call — no extra LLM round-trip.
    """
    text = message_text.strip().lower()
    is_question = (
        "?" in message_text
        or text.startswith(_QUESTION_CUES)
        or any(cue in f" {text}" for cue in _QUESTION_CUES)
    )
    if not is_question:
        return base
    real = [m.distance for m in context if m.distance > 0.0]
    strong = bool(real) and min(real) <= 0.6
    return round(min(base, 0.2 if strong else 0.35), 2)


@router.post("/respond", response_model=RespondResponse)
async def respond(req: RespondRequest) -> RespondResponse:
    if not req.message_text.strip():
        raise HTTPException(status_code=400, detail="message_text is empty")

    async with conn() as c:
        row = await (
            await c.execute(
                "SELECT name, label FROM chats WHERE id = %s", (req.chat_id,)
            )
        ).fetchone()
    chat_name = row[0] if row else None
    label = row[1] if row else None

    template, temperature, max_distance, examples = await get_label_config(label)
    user_name = await get_user_name()
    global_prompt = await get_global_prompt()

    embedding = await embed(req.message_text)
    context = await search(
        embedding=embedding,
        chat_id=req.chat_id,
        label=label,
        k_contact=6,
        max_distance=max_distance,
    )

    system_instruction, user_content = build_gemini_prompt(
        system_template=template,
        user_name=user_name,
        chat_name=chat_name,
        label=label,
        context=context,
        sender_name=req.sender_name,
        incoming_text=req.message_text,
        examples=examples,
        global_prompt=global_prompt,
    )

    temperature = _adapt_temperature(temperature, req.message_text, context)

    response = await generate_content(
        model=settings.gemini_chat_model,
        contents=user_content,
        config=types.GenerateContentConfig(
            system_instruction=system_instruction,
            temperature=temperature,
            response_mime_type="application/json",
            response_schema=RespondResult,
        ),
    )

    result = _parse_result(response)
    reply = result.reply.strip()
    if result.status == "answer" and not reply:
        raise HTTPException(status_code=502, detail="empty completion")

    return RespondResponse(
        status=result.status,
        reply=reply,
        missing=(result.missing or None),
    )


class ProactiveRequest(BaseModel):
    chat_id: str


@router.post("/generate-proactive", response_model=RespondResponse)
async def generate_proactive(req: ProactiveRequest) -> RespondResponse:
    """Generate an unprompted message to resume the conversation from the chat's
    latest context. Same `{status, reply, missing}` contract as `/respond`;
    `need_info` (or an empty answer) means "nothing grounded to say now" and the
    gateway then abstains instead of sending anything invented."""
    async with conn() as c:
        row = await (
            await c.execute(
                "SELECT name, label FROM chats WHERE id = %s", (req.chat_id,)
            )
        ).fetchone()
    chat_name = row[0] if row else None
    label = row[1] if row else None

    # Reuse the label's tuned temperature (natural variety for casual messages).
    _, temperature, _, _ = await get_label_config(label)
    user_name = await get_user_name()

    recent = await recent_messages(req.chat_id, limit=12)
    if not recent:
        # No context at all → never invent an opener.
        return RespondResponse(status="need_info", reply="", missing="sin contexto reciente")

    owner_notes = await recent_owner_notes(limit=4)

    system_instruction, user_content = build_proactive_prompt(
        user_name=user_name,
        chat_name=chat_name,
        label=label,
        recent=recent,
        owner_notes=owner_notes,
    )

    response = await generate_content(
        model=settings.gemini_chat_model,
        contents=user_content,
        config=types.GenerateContentConfig(
            system_instruction=system_instruction,
            temperature=temperature,
            response_mime_type="application/json",
            response_schema=RespondResult,
        ),
    )

    result = _parse_result(response)
    reply = result.reply.strip()
    # An empty "answer" is treated as an abstention, not an error (unlike /respond).
    if result.status == "answer" and not reply:
        return RespondResponse(status="need_info", reply="", missing=None)

    return RespondResponse(
        status=result.status,
        reply=reply,
        missing=(result.missing or None),
    )


class EmbedAndStoreRequest(BaseModel):
    message_id: str
    chat_id: str
    label: str | None
    content: str


@router.post("/embed-and-store")
async def embed_and_store(req: EmbedAndStoreRequest) -> dict[str, str]:
    vec = await embed(req.content)
    await store_embedding(req.message_id, req.chat_id, req.label, vec)
    return {"status": "ok"}
