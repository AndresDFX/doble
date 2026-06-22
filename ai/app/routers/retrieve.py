from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..db import conn
from ..rag.embeddings import embed
from ..rag.retrieval import search

router = APIRouter()


class RetrieveRequest(BaseModel):
    query: str
    chat_id: str | None = None
    label: str | None = None
    k_chat: int = 8
    k_label: int = 4


class RetrieveMatch(BaseModel):
    message_id: str
    chat_id: str
    label: str | None
    content: str
    from_me: bool
    ts: str
    distance: float
    similarity: float


class RetrieveResponse(BaseModel):
    embedding_dim: int
    chat_label: str | None
    matches: list[RetrieveMatch]


@router.post("/retrieve", response_model=RetrieveResponse)
async def retrieve(req: RetrieveRequest) -> RetrieveResponse:
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="query is empty")

    chat_label: str | None = req.label
    if req.chat_id and chat_label is None:
        async with conn() as c:
            row = await (
                await c.execute(
                    "SELECT label FROM chats WHERE id = %s", (req.chat_id,)
                )
            ).fetchone()
        chat_label = row[0] if row else None

    vec = await embed(req.query)
    matches = (
        await search(
            embedding=vec,
            chat_id=req.chat_id or "",
            label=chat_label,
            k_chat=req.k_chat if req.chat_id else 0,
            k_label=req.k_label,
            k_contact=0,  # inspector shows similarity-ranked retrieval only
            max_distance=None,  # show every match + distance so the owner can calibrate
        )
        if (req.chat_id or chat_label)
        else []
    )

    return RetrieveResponse(
        embedding_dim=len(vec),
        chat_label=chat_label,
        matches=[
            RetrieveMatch(
                message_id=m.message_id,
                chat_id=m.chat_id,
                label=m.label,
                content=m.content,
                from_me=m.from_me,
                ts=m.ts,
                distance=m.distance,
                similarity=max(0.0, 1.0 - m.distance / 2.0),
            )
            for m in matches
        ],
    )
