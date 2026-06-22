from ..db import conn
from ..rag.owner import OWNER_CHAT_ID
from ..rag.retrieval import RetrievedMessage

DEFAULT_LABEL = "default"


async def get_label_config(label: str | None) -> tuple[str, float, float, str | None]:
    """Return (prompt_template, temperature, max_distance, examples) for a label, falling back to default."""
    target = label or DEFAULT_LABEL
    async with conn() as c:
        row = await (
            await c.execute(
                "SELECT prompt_template, temperature, max_distance, examples FROM labels_config WHERE label = %s",
                (target,),
            )
        ).fetchone()
        if row is None and target != DEFAULT_LABEL:
            row = await (
                await c.execute(
                    "SELECT prompt_template, temperature, max_distance, examples FROM labels_config WHERE label = %s",
                    (DEFAULT_LABEL,),
                )
            ).fetchone()
    if row is None:
        return ("Eres {user_name}. Responde de forma natural.", 0.7, 1.3, None)
    return (row[0], float(row[1]), float(row[2]), row[3])


def _relevance_band(distance: float) -> str:
    """Coarse relevance label from cosine distance (L2-normalised: similarity = 1 - d/2)."""
    similarity = 1.0 - distance / 2.0
    if similarity >= 0.7:
        return "alta"
    if similarity >= 0.5:
        return "media"
    return "baja"


async def get_user_name() -> str:
    async with conn() as c:
        row = await (
            await c.execute("SELECT user_name FROM agent_state WHERE id = 1")
        ).fetchone()
    return row[0] if row else "Yo"


async def get_global_prompt() -> str:
    """Owner-wide instruction applied to every reply (on top of the label template)."""
    async with conn() as c:
        row = await (
            await c.execute("SELECT global_prompt FROM agent_state WHERE id = 1")
        ).fetchone()
    return (row[0] or "").strip() if row else ""


def build_gemini_prompt(
    system_template: str,
    user_name: str,
    chat_name: str | None,
    label: str | None,
    context: list[RetrievedMessage],
    sender_name: str | None,
    incoming_text: str,
    examples: str | None = None,
    global_prompt: str = "",
) -> tuple[str, str]:
    """Returns (system_instruction, user_content) tuple for Gemini generate_content."""
    system = system_template.format(user_name=user_name)
    if global_prompt:
        system += (
            "\n\n--- Instrucciones generales del dueño (aplican SIEMPRE) ---\n"
            f"{global_prompt}\n"
            "Respeta estas instrucciones en todos los chats, salvo que choquen con la "
            "regla de no inventar datos."
        )
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

    if examples and examples.strip():
        system += (
            "\n\n--- Ejemplos de tu estilo en este tipo de chat (oro) ---\n"
            "Así respondes TÚ (el dueño) en chats así. Copia el TONO, el registro y el largo, "
            "NUNCA los datos puntuales (horas, lugares, nombres, planes) que aparezcan en ellos:\n"
            f"{examples.strip()}\n"
        )

    owner_notes = [m for m in context if m.chat_id == OWNER_CHAT_ID]
    chat_examples = [m for m in context if m.chat_id != OWNER_CHAT_ID]

    if owner_notes:
        system += (
            "\n\n--- Información personal del dueño (background) ---\n"
            "Notas que el dueño grabó/escribió sobre su vida, cada una con su relevancia "
            "ESTIMADA frente a lo que se preguntó. Úsalas SOLO si responden EXACTAMENTE lo que "
            "se pregunta; las de relevancia BAJA casi nunca aplican (suelen ser de otro tema) — "
            "ante la duda, ignóralas. No rellenes con un dato parecido ni las cites verbatim.\n"
        )
        for n in owner_notes[:10]:
            system += f"- [relevancia: {_relevance_band(n.distance)}] {n.content}\n"

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
            "mantén esta voz mientras acomodas el vocabulario al contacto. Son ejemplos de TU "
            "FORMA de hablar, NO una lista de datos para responder: no reutilices un dato "
            "puntual de aquí (una hora, un lugar, un plan) para responder algo de otro tema:\n"
        )
        for m in owner_examples:
            system += f"{user_name}: {m.content}\n"

    system += (
        "\n\n--- Formato de respuesta (OBLIGATORIO) ---\n"
        'Devuelve SOLO un objeto JSON con esta forma exacta: '
        '{"status": "answer" | "need_info", "reply": string, "missing": string | null}.\n'
        "\n"
        "Regla de fundamento (anti-invención y anti-confusión de contexto):\n"
        "a) Primero identifica QUÉ pide exactamente el mensaje: el TEMA y el dato puntual. "
        "Ej.: 'a qué hora ALMORZASTE ayer' pide la hora de un almuerzo — NO cualquier hora.\n"
        "b) Solo responde con un dato si ese dato responde EXACTAMENTE ese tema. El historial y "
        "las notas pueden traer datos de OTROS temas (otra hora, otra fecha, otro plan); esos NO "
        "sirven como respuesta. NUNCA uses el dato de un tema para responder una pregunta de otro "
        "tema solo porque están cerca en la conversación. Ej.: si preguntan a qué hora almorzaste "
        "y lo único que sabes es a qué hora vas a LLEGAR a un plan, eso NO responde → need_info.\n"
        "c) Si para responder hace falta un DATO CONCRETO (planes, citas, fechas, horas, lugares, "
        "personas, montos o cualquier hecho de la vida del dueño) que NO está en el historial ni "
        "en las notas para ESE tema exacto, NO lo inventes ni lo sustituyas por uno parecido: "
        'status="need_info", reply="" y en "missing" describe en UNA frase el dato que falta.\n'
        "d) No 'asientas' por complacer. Si te hacen una pregunta cerrada o te corrigen ('¿era de "
        "X?', 'eso era de Y, no de Z', '¿sí o no?'), responde según lo que REALMENTE sabes; no "
        "repitas el dato anterior ni digas 'sí' solo para seguir la corriente. Si no tienes el "
        'dato, status="need_info".\n'
        "e) DECISIONES Y COMPROMISOS DEL DUEÑO: si el mensaje te pide aceptar, confirmar o "
        "rechazar algo que ATA al dueño en el mundo real — un plan, una invitación, una cita, una "
        "hora o un lugar de encuentro, asistir a algo, un favor, un préstamo, una compra, una "
        "promesa, o cualquier decisión en su nombre — TÚ NO decides por él, aunque suene casual. "
        "NO respondas 'sí', 'de una', 'va', 'listo', 'confirmado' ni propongas/confirmes una hora. "
        'Usa status="need_info" y en "missing" resume la decisión que el dueño debe tomar (ej. "te '
        'invitan a comer hoy, proponen las 6 — ¿confirmo?"). El compromiso SIEMPRE lo aprueba el '
        "dueño.\n"
        "\n"
        "Para saludos, charla casual, cortesía, opiniones o cosas SIN compromiso que puedas "
        "responder con el tono del dueño y sentido común (sin inventar hechos ni comprometer al "
        'dueño a nada), usa status="answer", "reply" con tu respuesta en una sola intervención '
        "—sin firmas, sin '— Yo', sin meta-explicaciones— y \"missing\": null."
    )

    user_label = sender_name or chat_name or "Otro"
    user_content = f"{user_label}: {incoming_text}"
    return system, user_content


def build_proactive_prompt(
    user_name: str,
    chat_name: str | None,
    label: str | None,
    recent: list[RetrievedMessage],
    owner_notes: list[RetrievedMessage],
) -> tuple[str, str]:
    """System + user content for an UNPROMPTED, context-aware message.

    Same anti-invention contract as the reply prompt, but the task is reversed:
    nobody just wrote — the agent decides, on its own initiative, whether there
    is something natural to say now to RESUME/continue the conversation from the
    latest context, and abstains (need_info) when there isn't.
    """
    system = f"Eres {user_name}."
    if chat_name:
        system += f" Le escribes a {chat_name} (el CONTACTO) por WhatsApp."
    else:
        system += " Le escribes a un contacto por WhatsApp; NO conoces su nombre."
    if label:
        system += f" Categoría del chat: {label}."

    system += (
        "\n\n--- Tarea ---\n"
        "Nadie te ha escrito ahora: TÚ decides, por iniciativa propia, retomar la conversación. "
        "Escribe UN mensaje corto, natural y espontáneo para reactivar o continuar el hilo con "
        "base en el ÚLTIMO contexto (abajo): un saludo, retomar el último tema, un seguimiento o "
        "una pregunta breve. Debe sonar a algo que el dueño mandaría sin que se lo pidan. NO "
        "arranques como si respondieras a un mensaje que no existe."
    )

    system += (
        "\n\n--- Cómo escribir (estilo) ---\n"
        "Como en un chat REAL de WhatsApp: BREVE (1-2 líneas), UNA sola idea, minúsculas, sin "
        "signos de apertura (¿ ¡) ni punto final, con abreviaciones y la jerga/registro del "
        "CONTACTO (acomódate a cómo escribe él, sin imitarlo literal). Sin firmas, sin '— Yo', "
        "sin meta-explicaciones, sin sonar a bot. Solo si el contacto no marca un registro claro, "
        "apóyate en español colombiano casual (parce, qué más, bacano, de una), nunca de otro país."
    )

    if owner_notes:
        system += (
            "\n\n--- Información personal del dueño (background) ---\n"
            "Hechos que el dueño grabó sobre su vida. Úsalos solo si hacen el mensaje más natural; "
            "NO inventes ni afirmes nada a partir de ellos que no sepas con certeza:\n"
        )
        for n in owner_notes:
            system += f"- {n.content}\n"

    contact = [m for m in recent if not m.from_me]
    if contact:
        who = chat_name or "Contacto"
        system += (
            "\n\n--- Cómo escribe el contacto (espeja su registro) ---\n"
            "Mensajes recientes del contacto, solo para calibrar tu vocabulario y formalidad:\n"
        )
        for m in contact:
            system += f"{who}: {m.content}\n"

    system += (
        "\n\n--- Regla de fundamento (anti-invención) ---\n"
        "NO inventes hechos, planes, citas, horas, lugares ni datos que no estén en el contexto o "
        "las notas. Puedes saludar, retomar un tema YA mencionado o preguntar cómo va algo, sin "
        "afirmar datos que no sabes. Si NO hay un contexto reciente con el que sea natural escribir "
        "(chat sin historial, o nada que decir sin inventar o sin sonar forzado/repetitivo), NO "
        'mandes nada: devuelve status="need_info".'
    )

    system += (
        "\n\n--- Formato de respuesta (OBLIGATORIO) ---\n"
        'Devuelve SOLO un objeto JSON: {"status": "answer" | "need_info", "reply": string, '
        '"missing": string | null}. Si tienes algo natural y con fundamento que escribir: '
        'status="answer", "reply" con el mensaje (una sola intervención), "missing": null. Si no '
        'hay nada natural que decir sin inventar: status="need_info", "reply": "", y "missing" '
        "describe en una frase por qué."
    )

    lines: list[str] = []
    for m in recent:
        speaker = user_name if m.from_me else (chat_name or "Contacto")
        lines.append(f"{speaker}: {m.content}")
    user_content = (
        "Contexto reciente de la conversación (lo más nuevo al final):\n"
        + ("\n".join(lines) if lines else "(sin mensajes recientes)")
        + "\n\nEscribe ahora tu mensaje proactivo, o need_info si no aplica."
    )
    return system, user_content
