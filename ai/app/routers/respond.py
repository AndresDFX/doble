from fastapi import APIRouter, HTTPException
from google.genai import types
from pydantic import BaseModel

from ..db import conn
from ..llm_client import generate_content
from ..prompts.builder import build_gemini_prompt, get_label_config, get_user_name
from ..rag.embeddings import embed
from ..rag.retrieval import search, store_embedding
from ..settings import settings

router = APIRouter()


class RespondRequest(BaseModel):
    chat_id: str
    message_text: str
    sender_name: str | None = None


class RespondResponse(BaseModel):
    reply: str


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

    embedding = await embed(req.message_text)
    context = await search(embedding=embedding, chat_id=req.chat_id, label=label)

    template, temperature = await get_label_config(label)
    user_name = await get_user_name()

    system_instruction, user_content = build_gemini_prompt(
        system_template=template,
        user_name=user_name,
        chat_name=chat_name,
        label=label,
        context=context,
        sender_name=req.sender_name,
        incoming_text=req.message_text,
    )

    response = await generate_content(
        model=settings.gemini_chat_model,
        contents=user_content,
        config=types.GenerateContentConfig(
            system_instruction=system_instruction,
            temperature=temperature,
        ),
    )
    reply = (response.text or "").strip()
    if not reply:
        raise HTTPException(status_code=502, detail="empty completion")

    return RespondResponse(reply=reply)


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
