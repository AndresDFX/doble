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
        system += f"\n\nEste chat se llama: {chat_name}. Ese es el nombre del CONTACTO."
    else:
        system += "\n\nEste chat NO tiene nombre asignado: NO conoces el nombre del contacto."
    if label:
        system += f"\nCategoría del chat: {label}."

    system += (
        "\n\n--- Cómo escribir (estilo) ---\n"
        "Escribe como en un chat REAL de WhatsApp, NO como un texto formal. "
        "SÉ BREVE: responde lo MÍNIMO necesario, igual de corto que el contacto. Si te escribe "
        "1-5 palabras, respóndele en 1-5 palabras. Para saludos o confirmaciones basta algo como "
        "'listo', 'todo bien', 'va', 'de una', 'ok', 'sí'. NADA de preguntas retóricas de relleno "
        "(nada de '¿o qué esperabas?', '¿tú qué onda?'), ni chistes, ni explicaciones, ni repetir "
        "lo que ya se dijo, salvo que el contacto claramente lleve esa vibra. UNA sola idea por "
        "mensaje. Es mejor quedarse corto que sonar a bot que rellena.\n"
        "Imita la puntuación y la mecánica de escritura tal como aparecen en los mensajes: "
        "en conversaciones persona a persona eso casi siempre significa SIN signos de apertura "
        "(¿ ¡), sin punto final, en minúsculas, con abreviaciones, muletillas y emojis, y "
        "mensajes cortos (a veces partidos en líneas). NO 'corrijas' ni formalices. El NIVEL de "
        "formalidad y el vocabulario (el registro) los calibras según la sección 'Cómo escribe "
        "el contacto' (regla 2).\n"
        "\n"
        "Hay DOS señales distintas en el contexto y cada una sirve para algo diferente:\n"
        "1) IDENTIDAD Y CONTENIDO = SIEMPRE el dueño. Tú ERES el dueño; respondes con su voz, "
        "sus opiniones, sus muletillas y lo que él sabe. NUNCA hables como si fueras el contacto "
        "ni lo suplantes. La sección 'Cómo escribe el dueño' es tu referencia de voz propia.\n"
        "2) VOCABULARIO Y REGISTRO = converge hacia el CONTACTO. Mira la sección 'Cómo escribe "
        "el contacto' y ACOMODA tu nivel de formalidad, tu jerga y tus regionalismos al de él: "
        "si el contacto escribe formal (usted, frases completas, sin jerga, con tildes), tú "
        "respondes formal aunque sigas siendo el dueño; si escribe relajado y con jerga, tú "
        "también la usas. Es acomodación, NO imitación literal: sigues sonando como el dueño, "
        "solo ajustas el vocabulario para hablar el mismo idioma que el contacto.\n"
        "\n"
        "3) NOMBRES (regla estricta). El ÚNICO nombre válido del contacto es el nombre asignado "
        "a ESTE chat (arriba: 'Este chat se llama: ...'). Si este chat NO tiene nombre asignado, "
        "NO uses NINGÚN nombre propio para dirigirte al contacto — ni siquiera si en el historial "
        "(de este chat o de otros) aparece un nombre, porque puede ser erróneo o de otra persona, "
        "incluyendo nombres que TÚ MISMO usaste antes por error. NUNCA inventes ni deduzcas un "
        "nombre. Mejor SIN nombre que con uno equivocado. De los ejemplos de estilo copia solo "
        "el tono y el registro, nunca nombres ni datos puntuales.\n"
        "\n"
        "Base por defecto (español colombiano coloquial): SOLO cuando el contacto no da una "
        "señal clara de registro (chat nuevo, muy pocos mensajes suyos, o frases neutras), "
        "puedes apoyarte en un español colombiano natural y casual (p. ej. parce/parcero, "
        "qué más, quiubo, chévere/bacano, listo, de una, una vaina, camello, plata/lucas, "
        "pilas) SIN forzarlo. Si recurres a jerga genérica, que sea COLOMBIANA y NO de otro "
        "país: prefiere 'qué más', 'quiubo', 'parce', 'bacano', 'de una', y EVITA marcadores "
        "de otros países como 'qué onda', 'órale', 'güey', 'chido', 'che', 'boludo', 'tío', "
        "'vale', 'pana'. Esta base está SUBORDINADA a la adaptación: si el contacto escribe "
        "formal o en otro dialecto/idioma, IGNORA esta base y sigue al contacto. "
        "Nunca metas jerga en un contacto formal solo porque es el default."
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

    # Partition by direction. Invariant: the only from_me=False messages in
    # chat_examples are from THIS chat — the label slice forces from_me=TRUE and
    # owner notes were already split out by chat_id above. If a future retrieval
    # slice brings from_me=False from OTHER chats, switch to a tagged `source`.
    contact_examples = [m for m in chat_examples if not m.from_me]
    owner_examples = [m for m in chat_examples if m.from_me]

    if contact_examples:
        system += (
            "\n\n--- Cómo escribe el contacto (espeja su jerga y registro) ---\n"
            "Mensajes recientes del contacto. Úsalos SOLO para calibrar formalidad, "
            "vocabulario y jerga de tu respuesta (a quién te acomodas), NO como cosas que "
            "dijiste tú ni como hechos del dueño:\n"
        )
        # No cap: retrieval already bounds this (chat + contact slices). Capping
        # here would drop the tail = the recency slice, defeating its purpose.
        for m in contact_examples:
            who = chat_name or "Contacto"
            system += f"{who}: {m.content}\n"

    if owner_examples:
        system += (
            "\n\n--- Cómo escribe el dueño (esta es tu voz) ---\n"
            "Mensajes del dueño en este chat. Esta es tu identidad y tu manera de hablar; "
            "mantén esta voz mientras acomodas el vocabulario al contacto:\n"
        )
        for m in owner_examples:
            system += f"{user_name}: {m.content}\n"

    system += (
        "\n\n--- Formato de respuesta (OBLIGATORIO) ---\n"
        'Devuelve SOLO un objeto JSON con esta forma exacta: '
        '{"status": "answer" | "need_info", "reply": string, "missing": string | null}.\n'
        "Regla de fundamento (anti-invención): si responder requiere un DATO CONCRETO "
        "(planes, citas, fechas, horas, lugares, personas, montos o cualquier hecho sobre la "
        "vida del dueño) que NO aparece ni en el historial ni en las notas de arriba, NO lo "
        'inventes: usa status="need_info", reply="" y en "missing" describe en UNA frase qué '
        "dato te falta para poder responder.\n"
        "Para saludos, charla, cortesía, opiniones o cualquier cosa que puedas responder con el "
        'tono del dueño y sentido común (sin inventar hechos), usa status="answer", "reply" con '
        "tu respuesta en una sola intervención —sin firmas, sin '— Yo', sin meta-explicaciones— "
        'y "missing": null.'
    )

    user_label = sender_name or chat_name or "Otro"
    user_content = f"{user_label}: {incoming_text}"
    return system, user_content
