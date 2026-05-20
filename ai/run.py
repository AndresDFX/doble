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
    port = int(os.environ.get("AI_SERVICE_PORT", "8000"))
    reload = "--no-reload" not in sys.argv
    uvicorn.run("app.main:app", host="127.0.0.1", port=port, reload=reload)
