from dataclasses import dataclass

import numpy as np

from ..db import conn
from .owner import OWNER_CHAT_ID


@dataclass
class RetrievedMessage:
    message_id: str
    chat_id: str
    label: str | None
    content: str
    from_me: bool
    ts: str
    distance: float


async def search(
    embedding: list[float],
    chat_id: str,
    label: str | None,
    k_chat: int = 8,
    k_label: int = 4,
    k_owner: int = 4,
    k_contact: int = 6,
    max_distance: float | None = 1.0,
) -> list[RetrievedMessage]:
    """Top-k retrieval scoped to this chat plus top-k from the label cohort.

    The chat-scoped slice captures conversation-specific tone; the label slice
    pulls in stylistic examples from peer chats with the same label; the owner
    slice pulls background facts. The contact slice grabs the contact's most
    RECENT messages (by time, not similarity) so the reply can mirror how this
    person actually writes (slang/register), regardless of the query topic.
    Returned matches include cosine distance from pgvector (0 = identical,
    2 = opposite). With L2-normalised vectors, similarity = 1 - distance/2.

    `max_distance` gates the THREE similarity slices (chat, label, owner): a row
    farther than this is dropped so off-topic matches don't enter the prompt as
    "relevant history/background" — the main cause of context confusion (e.g. an
    arrival-time note bleeding into a "what did you eat?" question). The recency
    slice is exempt (it's ranked by time, for register, not relevance). Pass
    None to disable (the /retrieve inspector does, to show every distance).
    """
    vec = np.asarray(embedding, dtype=np.float32)
    seen: set[str] = set()
    results: list[RetrievedMessage] = []

    async with conn() as c:
        rows = await (
            await c.execute(
                """
                SELECT m.id, m.chat_id, e.label, m.content, m.from_me, m.ts,
                       e.embedding <=> %s AS distance
                FROM message_embeddings e
                JOIN messages m ON m.id = e.message_id
                WHERE e.chat_id = %s
                  AND m.content IS NOT NULL
                ORDER BY e.embedding <=> %s
                LIMIT %s
                """,
                (vec, chat_id, vec, k_chat),
            )
        ).fetchall()
        for r in rows:
            dist = float(r[6])
            if max_distance is not None and dist > max_distance:
                break  # rows are sorted by distance asc; the rest are farther
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
                    distance=dist,
                )
            )

        if label and k_label > 0:
            rows = await (
                await c.execute(
                    """
                    SELECT m.id, m.chat_id, e.label, m.content, m.from_me, m.ts,
                           e.embedding <=> %s AS distance
                    FROM message_embeddings e
                    JOIN messages m ON m.id = e.message_id
                    WHERE e.label = %s
                      AND e.chat_id <> %s
                      AND e.chat_id <> %s
                      AND m.from_me = TRUE
                      AND m.content IS NOT NULL
                    ORDER BY e.embedding <=> %s
                    LIMIT %s
                    """,
                    (vec, label, chat_id, OWNER_CHAT_ID, vec, k_label),
                )
            ).fetchall()
            for r in rows:
                dist = float(r[6])
                if max_distance is not None and dist > max_distance:
                    break  # rows are sorted by distance asc; the rest are farther
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
                        distance=dist,
                    )
                )

        if k_owner > 0 and chat_id != OWNER_CHAT_ID:
            rows = await (
                await c.execute(
                    """
                    SELECT m.id, m.chat_id, e.label, m.content, m.from_me, m.ts,
                           e.embedding <=> %s AS distance
                    FROM message_embeddings e
                    JOIN messages m ON m.id = e.message_id
                    WHERE e.chat_id = %s
                      AND m.content IS NOT NULL
                    ORDER BY e.embedding <=> %s
                    LIMIT %s
                    """,
                    (vec, OWNER_CHAT_ID, vec, k_owner),
                )
            ).fetchall()
            for r in rows:
                dist = float(r[6])
                if max_distance is not None and dist > max_distance:
                    break  # rows are sorted by distance asc; the rest are farther
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
                        distance=dist,
                    )
                )

        # --- Contact recency slice ---
        # The contact's latest messages (from_me = FALSE), by TIME not similarity:
        # captures their current lexicon/slang/register so the reply can mirror
        # "how this person writes" even when the query is unrelated. Queried from
        # `messages` directly (NOT message_embeddings) on purpose: recency is the
        # point, so it must include the just-arrived message and any not-yet-
        # embedded ones (embedding is fire-and-forget, racing this read). Inserted
        # last; `seen` dedup means it only adds what the slices above didn't pull.
        # `distance` is a sentinel here (unused — this slice isn't similarity-ranked).
        if k_contact > 0 and chat_id != OWNER_CHAT_ID:
            rows = await (
                await c.execute(
                    """
                    SELECT m.id, m.chat_id, m.content, m.from_me, m.ts
                    FROM messages m
                    WHERE m.chat_id = %s
                      AND m.from_me = FALSE
                      AND m.content IS NOT NULL
                    ORDER BY m.ts DESC
                    LIMIT %s
                    """,
                    (chat_id, k_contact),
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
                        label=None,
                        content=r[2],
                        from_me=r[3],
                        ts=r[4].isoformat(),
                        distance=0.0,
                    )
                )

    return results


async def recent_messages(chat_id: str, limit: int = 12) -> list[RetrievedMessage]:
    """Last `limit` messages of a chat by TIME (both directions), oldest→newest.

    Used by the proactive generator: there's no incoming message to embed, so
    "latest context" is just the recent back-and-forth, read straight from
    `messages` (not `message_embeddings`) so it includes not-yet-embedded rows.
    `distance` is a sentinel (this slice isn't similarity-ranked).
    """
    async with conn() as c:
        rows = await (
            await c.execute(
                """
                SELECT m.id, m.chat_id, m.content, m.from_me, m.ts
                FROM messages m
                WHERE m.chat_id = %s
                  AND m.content IS NOT NULL
                ORDER BY m.ts DESC
                LIMIT %s
                """,
                (chat_id, limit),
            )
        ).fetchall()
    rows = list(reversed(rows))  # chronological: oldest first, newest last
    return [
        RetrievedMessage(
            message_id=r[0],
            chat_id=r[1],
            label=None,
            content=r[2],
            from_me=r[3],
            ts=r[4].isoformat(),
            distance=0.0,
        )
        for r in rows
    ]


async def recent_owner_notes(limit: int = 4) -> list[RetrievedMessage]:
    """Most recent owner notes (background facts) — by time, not similarity.

    The proactive generator has no query embedding to rank notes by, so it pulls
    a few recent ones as factual background (never as style examples).
    """
    async with conn() as c:
        rows = await (
            await c.execute(
                """
                SELECT m.id, m.chat_id, m.content, m.from_me, m.ts
                FROM messages m
                WHERE m.chat_id = %s
                  AND m.content IS NOT NULL
                ORDER BY m.ts DESC
                LIMIT %s
                """,
                (OWNER_CHAT_ID, limit),
            )
        ).fetchall()
    return [
        RetrievedMessage(
            message_id=r[0],
            chat_id=r[1],
            label=None,
            content=r[2],
            from_me=r[3],
            ts=r[4].isoformat(),
            distance=0.0,
        )
        for r in rows
    ]


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
