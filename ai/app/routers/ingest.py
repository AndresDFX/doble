from fastapi import APIRouter
from pydantic import BaseModel

from ..rag.embeddings import embed_batch
from ..rag.retrieval import store_embedding

router = APIRouter()


class IngestItem(BaseModel):
    message_id: str
    chat_id: str
    label: str | None = None
    content: str


class IngestRequest(BaseModel):
    items: list[IngestItem]


class IngestResponse(BaseModel):
    embedded: int


@router.post("/ingest-history", response_model=IngestResponse)
async def ingest_history(req: IngestRequest) -> IngestResponse:
    items = [i for i in req.items if i.content.strip()]
    if not items:
        return IngestResponse(embedded=0)

    BATCH = 64
    total = 0
    for start in range(0, len(items), BATCH):
        chunk = items[start : start + BATCH]
        vectors = await embed_batch([i.content for i in chunk])
        for item, vec in zip(chunk, vectors, strict=True):
            await store_embedding(item.message_id, item.chat_id, item.label, vec)
            total += 1
    return IngestResponse(embedded=total)
