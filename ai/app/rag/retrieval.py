from dataclasses import dataclass

import numpy as np

from ..db import conn


@dataclass
class RetrievedMessage:
    message_id: str
    chat_id: str
    label: str | None
    content: str
    from_me: bool
    ts: str


async def search(
    embedding: list[float],
    chat_id: str,
    label: str | None,
    k_chat: int = 8,
    k_label: int = 4,
) -> list[RetrievedMessage]:
    """Top-k retrieval scoped to this chat plus top-k from the label cohort.

    The chat-scoped slice captures conversation-specific tone; the label slice
    pulls in stylistic examples from peer chats with the same label.
    """
    vec = np.asarray(embedding, dtype=np.float32)
    seen: set[str] = set()
    results: list[RetrievedMessage] = []

    async with conn() as c:
        rows = await (
            await c.execute(
                """
                SELECT m.id, m.chat_id, e.label, m.content, m.from_me, m.ts
                FROM message_embeddings e
                JOIN messages m ON m.id = e.message_id
                WHERE e.chat_id = %s
                  AND m.content IS NOT NULL
                ORDER BY e.embedding <=> %s
                LIMIT %s
                """,
                (chat_id, vec, k_chat),
            )
        ).fetchall()
        for r in rows:
            if r[0] in seen:
                continue
            seen.add(r[0])
            results.append(
                RetrievedMessage(
                    message_id=r[0],
                    chat_id=r[1],
                    label=r[2],
                    content=r[3],
                    from_me=r[4],
                    ts=r[5].isoformat(),
                )
            )

        if label and k_label > 0:
            rows = await (
                await c.execute(
                    """
                    SELECT m.id, m.chat_id, e.label, m.content, m.from_me, m.ts
                    FROM message_embeddings e
                    JOIN messages m ON m.id = e.message_id
                    WHERE e.label = %s
                      AND e.chat_id <> %s
                      AND m.from_me = TRUE
                      AND m.content IS NOT NULL
                    ORDER BY e.embedding <=> %s
                    LIMIT %s
                    """,
                    (label, chat_id, vec, k_label),
                )
            ).fetchall()
            for r in rows:
                if r[0] in seen:
                    continue
                seen.add(r[0])
                results.append(
                    RetrievedMessage(
                        message_id=r[0],
                        chat_id=r[1],
                        label=r[2],
                        content=r[3],
                        from_me=r[4],
                        ts=r[5].isoformat(),
                    )
                )

    return results


async def store_embedding(
    message_id: str, chat_id: str, label: str | None, embedding: list[float]
) -> None:
    vec = np.asarray(embedding, dtype=np.float32)
    async with conn() as c:
        await c.execute(
            """
            INSERT INTO message_embeddings (message_id, chat_id, label, embedding)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (message_id) DO UPDATE SET
              embedding = EXCLUDED.embedding,
              label = EXCLUDED.label
            """,
            (message_id, chat_id, label, vec),
        )
