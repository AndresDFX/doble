import logging

from google import genai
from google.genai import errors as genai_errors
from tenacity import (
    AsyncRetrying,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)

from .settings import settings

logger = logging.getLogger(__name__)

client = genai.Client(api_key=settings.gemini_api_key)


def _is_retryable(exc: BaseException) -> bool:
    """Retry on 5xx server errors and 408/429 client errors."""
    if isinstance(exc, genai_errors.ServerError):
        return True
    if isinstance(exc, genai_errors.ClientError):
        return getattr(exc, "code", None) in (408, 429)
    return False


def _retrier() -> AsyncRetrying:
    return AsyncRetrying(
        stop=stop_after_attempt(5),
        wait=wait_exponential(multiplier=2, min=2, max=30),
        retry=retry_if_exception(_is_retryable),
        reraise=True,
    )


async def generate_content(**kwargs):
    async for attempt in _retrier():
        with attempt:
            try:
                return await client.aio.models.generate_content(**kwargs)
            except Exception as exc:
                if _is_retryable(exc):
                    logger.warning(
                        "Gemini generate_content retryable error (attempt %d): %s",
                        attempt.retry_state.attempt_number,
                        exc,
                    )
                raise


async def embed_content(**kwargs):
    async for attempt in _retrier():
        with attempt:
            try:
                return await client.aio.models.embed_content(**kwargs)
            except Exception as exc:
                if _is_retryable(exc):
                    logger.warning(
                        "Gemini embed_content retryable error (attempt %d): %s",
                        attempt.retry_state.attempt_number,
                        exc,
                    )
                raise
