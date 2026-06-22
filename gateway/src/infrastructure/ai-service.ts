/**
 * AI service adapter: implements the `AiService` port by calling the Python AI
 * microservice over HTTP. The low-level fetch helpers live in `ai-client.ts`;
 * this class is the port-shaped facade the application depends on.
 */
import {
  aiRespond,
  aiGenerateProactive,
  aiTranscribe,
  aiEmbedAndStore,
  aiHealthcheck,
} from "../ai-client.js";
import { config } from "../config.js";
import type { AiService, RetrieveResult } from "../domain/ports.js";

export class HttpAiService implements AiService {
  respond = aiRespond;
  generateProactive = aiGenerateProactive;
  transcribe = aiTranscribe;
  embedAndStore = aiEmbedAndStore;
  healthcheck = aiHealthcheck;

  async retrieve(body: unknown): Promise<RetrieveResult> {
    const res = await fetch(`${config.aiServiceUrl}/retrieve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return { ok: false, status: res.status, error: await res.text() };
    }
    return { ok: true, data: await res.json() };
  }
}
