"""Constants and helpers for the owner-notes pseudo-chat.

Owner notes (audio dictation or typed text from the WhatsApp owner) live
in the same `messages` and `message_embeddings` tables as real chats,
under a reserved chat_id so retrieval can always pull a few as background
knowledge regardless of which conversation triggered the response.
"""

OWNER_CHAT_ID = "__owner__"
OWNER_LABEL = "__owner__"
