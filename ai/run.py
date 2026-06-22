"""Wrapper to launch uvicorn with a psycopg-compatible event loop on Windows.

On Windows the default asyncio loop is ProactorEventLoop, which psycopg's async
driver does not support. We must install WindowsSelectorEventLoopPolicy BEFORE
uvicorn creates its loop — that's why we wrap rather than calling `uvicorn ...`
directly from the shell.
"""

import asyncio
import os
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import uvicorn

if __name__ == "__main__":
    host = os.environ.get("AI_SERVICE_HOST", "127.0.0.1")
    # PORT is what Render (and most PaaS) inject; AI_SERVICE_PORT wins locally.
    port = int(os.environ.get("AI_SERVICE_PORT") or os.environ.get("PORT") or "8000")
    reload = "--no-reload" not in sys.argv
    uvicorn.run("app.main:app", host=host, port=port, reload=reload)
