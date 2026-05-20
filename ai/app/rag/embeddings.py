import numpy as np
from google.genai import types

from ..llm_client import embed_content
from ..settings import settings


def _normalize(vec: list[float]) -> list[float]:
    """L2-normalize. Required when reducing gemini-embedding-001 below 3072 dims."""
    arr = np.asarray(vec, dtype=np.float32)
    norm = np.linalg.norm(arr)
    if norm == 0:
        return vec
    return (arr / norm).tolist()


async def embed(text: str) -> list[float]:
    res = await embed_content(
        model=settings.gemini_embed_model,
        contents=text,
        config=types.EmbedContentConfig(output_dimensionality=settings.gemini_embed_dim),
    )
    if not res.embeddings:
        raise RuntimeError("Empty embeddings response")
    values = res.embeddings[0].values or []
    return _normalize(values)


async def embed_batch(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    res = await embed_content(
        model=settings.gemini_embed_model,
        contents=texts,
        config=types.EmbedContentConfig(output_dimensionality=settings.gemini_embed_dim),
    )
    out: list[list[float]] = []
    for e in res.embeddings or []:
        values = e.values or []
        out.append(_normalize(values))
    return out
