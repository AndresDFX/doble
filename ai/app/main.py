import asyncio
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from contextlib import asynccontextmanager

from fastapi import FastAPI

from .db import pool
from .routers import health, ingest, respond, retrieve, transcribe


@asynccontextmanager
async def lifespan(app: FastAPI):
    await pool.open()
    try:
        yield
    finally:
        await pool.close()


app = FastAPI(title="Doble AI", lifespan=lifespan)
app.include_router(health.router)
app.include_router(transcribe.router)
app.include_router(respond.router)
app.include_router(retrieve.router)
app.include_router(ingest.router)
