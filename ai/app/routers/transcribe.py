from fastapi import APIRouter, HTTPException, UploadFile
from google.genai import types

from ..llm_client import generate_content
from ..settings import settings

router = APIRouter()

_EXT_TO_MIME = {
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".mp3": "audio/mp3",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
    ".aac": "audio/aac",
    ".flac": "audio/flac",
}


def _guess_mime(filename: str) -> str:
    lower = filename.lower()
    for ext, mime in _EXT_TO_MIME.items():
        if lower.endswith(ext):
            return mime
    return "audio/ogg"


@router.post("/transcribe")
async def transcribe(audio: UploadFile) -> dict[str, str]:
    if not audio.filename:
        raise HTTPException(status_code=400, detail="audio file required")

    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty audio file")

    mime = _guess_mime(audio.filename)

    response = await generate_content(
        model=settings.gemini_chat_model,
        contents=[
            "Transcribe el siguiente audio palabra por palabra al texto original "
            "(en el idioma hablado). Devuelve SOLO la transcripción, sin comentarios, "
            "sin marcas de tiempo, sin etiquetas.",
            types.Part.from_bytes(data=data, mime_type=mime),
        ],
        config=types.GenerateContentConfig(temperature=0.0),
    )
    text = (response.text or "").strip()
    if not text:
        raise HTTPException(status_code=502, detail="empty transcription")
    return {"text": text}
