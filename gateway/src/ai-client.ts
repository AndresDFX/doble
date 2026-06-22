import { config } from "./config.js";
import { logger } from "./logger.js";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

export type RespondResponse = {
  status: "answer" | "need_info";
  reply: string;
  missing: string | null;
};

export async function aiRespond(input: {
  chat_id: string;
  message_text: string;
  sender_name: string | null;
}): Promise<RespondResponse> {
  const res = await fetch(`${config.aiServiceUrl}/respond`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`AI /respond failed (${res.status}): ${body}`);
  }
  // Defensive: tolerate an older AI service that returns just { reply }.
  const data = (await res.json()) as Partial<RespondResponse>;
  return {
    status: data.status === "need_info" ? "need_info" : "answer",
    reply: data.reply ?? "",
    missing: data.missing ?? null,
  };
}

export async function aiGenerateProactive(input: {
  chat_id: string;
}): Promise<RespondResponse> {
  const res = await fetch(`${config.aiServiceUrl}/generate-proactive`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`AI /generate-proactive failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as Partial<RespondResponse>;
  return {
    status: data.status === "need_info" ? "need_info" : "answer",
    reply: data.reply ?? "",
    missing: data.missing ?? null,
  };
}

export async function aiTranscribe(audioPath: string): Promise<string> {
  const buf = await readFile(audioPath);
  const form = new FormData();
  form.append("audio", new Blob([buf]), basename(audioPath));

  const res = await fetch(`${config.aiServiceUrl}/transcribe`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`AI /transcribe failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { text: string };
  return data.text;
}

export async function aiEmbedAndStore(input: {
  message_id: string;
  chat_id: string;
  label: string | null;
  content: string;
}): Promise<void> {
  const res = await fetch(`${config.aiServiceUrl}/embed-and-store`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`AI /embed-and-store failed (${res.status}): ${body}`);
  }
}

export async function aiHealthcheck(): Promise<boolean> {
  try {
    const res = await fetch(`${config.aiServiceUrl}/health`, { method: "GET" });
    return res.ok;
  } catch (err) {
    logger.warn({ err }, "AI healthcheck failed");
    return false;
  }
}
