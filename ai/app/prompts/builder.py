from ..db import conn
from ..rag.owner import OWNER_CHAT_ID
from ..rag.retrieval import RetrievedMessage

DEFAULT_LABEL = "default"


async def get_label_config(label: str | None) -> tuple[str, float]:
    """Return (prompt_template, temperature) for a label, falling back to default."""
    target = label or DEFAULT_LABEL
    async with conn() as c:
        row = await (
            await c.execute(
                "SELECT prompt_template, temperature FROM labels_config WHERE label = %s",
                (target,),
            )
        ).fetchone()
        if row is None and target != DEFAULT_LABEL:
            row = await (
                await c.execute(
                    "SELECT prompt_template, temperature FROM labels_config WHERE label = %s",
                    (DEFAULT_LABEL,),
                )
            ).fetchone()
    if row is None:
        return ("Eres {user_name}. Responde de forma natural.", 0.7)
    return (row[0], float(row[1]))


async def get_user_name() -> str:
    async with conn() as c:
        row = await (
            await c.execute("SELECT user_name FROM agent_state WHERE id = 1")
        ).fetchone()
    return row[0] if row else "Yo"


def build_gemini_prompt(
    system_template: str,
    user_name: str,
    chat_name: str | None,
    label: str | None,
    context: list[RetrievedMessage],
    sender_name: str | None,
    incoming_text: str,
) -> tuple[str, str]:
    """Returns (system_instruction, user_content) tuple for Gemini generate_content."""
    system = system_template.format(user_name=user_name)
    if chat_name:
        system += f"\n\nEste chat se llama: {chat_name}."
    if label:
        system += f"\nCategoría del chat: {label}."

    system += (
        "\n\nA continuación se muestran ejemplos del historial reciente para que imites el tono, "
        "vocabulario y estilo. NO copies textualmente — solo aprende el estilo.\n"
        "Responde en una sola intervención, sin firmas, sin '— Yo', sin meta-explicaciones."
    )

    owner_notes = [m for m in context if m.chat_id == OWNER_CHAT_ID]
    chat_examples = [m for m in context if m.chat_id != OWNER_CHAT_ID]

    if owner_notes:
        system += (
            "\n\n--- Información personal del dueño (background) ---\n"
            "Estas son notas que el dueño grabó/escribió sobre su vida. "
            "Úsalas como contexto factual cuando sean relevantes — NO las cites verbatim.\n"
        )
        for n in owner_notes[:10]:
            system += f"- {n.content}\n"

    examples = []
    for m in chat_examples[:20]:
        who = user_name if m.from_me else (chat_name or "Otro")
        examples.append(f"{who}: {m.content}")
    if examples:
        system += "\n\n--- Historial relevante del chat ---\n" + "\n".join(examples)

    user_label = sender_name or chat_name or "Otro"
    user_content = f"{user_label}: {incoming_text}"
    return system, user_content
