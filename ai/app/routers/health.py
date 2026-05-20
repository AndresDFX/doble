from fastapi import APIRouter

from ..db import conn

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, str]:
    async with conn() as c:
        await c.execute("SELECT 1")
    return {"status": "ok"}
