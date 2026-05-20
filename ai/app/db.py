from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from pgvector.psycopg import register_vector_async
from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool

from .settings import settings


async def _configure(conn: AsyncConnection) -> None:
    await register_vector_async(conn)


pool = AsyncConnectionPool(
    conninfo=settings.database_url,
    min_size=1,
    max_size=10,
    open=False,
    configure=_configure,
)


@asynccontextmanager
async def conn() -> AsyncIterator[AsyncConnection]:
    async with pool.connection() as c:
        yield c
