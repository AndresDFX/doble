import type { FastifyInstance } from "fastify";
import { container } from "../../composition/container.js";
import {
  MIN_INTERVAL_MINUTES,
  MAX_INTERVAL_MINUTES,
} from "../../domain/proactive-policy.js";
import { waStatus } from "../../wa-status.js";

type ChatPatch = {
  label?: string | null;
  agent_enabled?: boolean;
  name?: string | null;
  proactive_enabled?: boolean;
  proactive_min_minutes?: number;
  proactive_max_minutes?: number;
};

const isIntInRange = (n: unknown): n is number =>
  typeof n === "number" &&
  Number.isInteger(n) &&
  n >= MIN_INTERVAL_MINUTES &&
  n <= MAX_INTERVAL_MINUTES;

export async function registerChatRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Querystring: { label?: string; q?: string; limit?: string; offset?: string };
  }>("/api/chats", async (req) => {
    const { label, q, limit, offset } = req.query;
    return container.chats.list({
      label,
      q,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  });

  app.post<{ Body: { q?: string; label?: string; agent_enabled?: boolean } }>(
    "/api/chats/bulk-agent",
    async (req, reply) => {
      const { q, label, agent_enabled } = req.body ?? {};
      if (typeof agent_enabled !== "boolean") {
        reply.status(400);
        return { error: "agent_enabled (boolean) is required" };
      }
      const updated = await container.chats.bulkSetAgent({ q, label }, agent_enabled);
      return { updated };
    }
  );

  // Danger zone: delete chats + their data (owner pseudo-chat/notes survive).
  // scope "all" wipes every chat; "other-account" keeps only the chats synced
  // under the CURRENTLY connected agent number (cleans a previous account's data).
  app.post<{ Body: { scope?: "all" | "other-account" } }>(
    "/api/chats/purge",
    async (req, reply) => {
      const scope = req.body?.scope;
      if (scope !== "all" && scope !== "other-account") {
        reply.status(400);
        return { error: 'scope must be "all" or "other-account"' };
      }
      let keepAccount: string | null = null;
      if (scope === "other-account") {
        const meId = waStatus.get().me.id;
        keepAccount = meId?.split("@")[0]?.split(":")[0] ?? null;
        if (!keepAccount) {
          reply.status(409);
          return { error: "WhatsApp is not connected — cannot tell which account to keep" };
        }
      }
      const deleted = await container.chats.purge({ keepAccount });
      return { deleted, kept_account: keepAccount };
    }
  );

  // Bulk over an explicit selection (checkboxes in the UI).
  app.post<{ Body: { ids?: string[]; agent_enabled?: boolean } }>(
    "/api/chats/bulk-agent-ids",
    async (req, reply) => {
      const { ids, agent_enabled } = req.body ?? {};
      if (!Array.isArray(ids) || ids.length === 0 || typeof agent_enabled !== "boolean") {
        reply.status(400);
        return { error: "ids (string[]) and agent_enabled (boolean) are required" };
      }
      const updated = await container.chats.bulkSetAgentByIds(ids, agent_enabled);
      return { updated };
    }
  );

  app.get<{ Params: { id: string } }>("/api/chats/:id", async (req, reply) => {
    const chat = await container.chats.get(req.params.id);
    if (!chat) {
      reply.status(404);
      return { error: "chat not found" };
    }
    return chat;
  });

  app.patch<{ Params: { id: string }; Body: ChatPatch }>(
    "/api/chats/:id",
    async (req, reply) => {
      const {
        label,
        agent_enabled,
        name,
        proactive_enabled,
        proactive_min_minutes,
        proactive_max_minutes,
      } = req.body ?? {};
      if (
        label === undefined &&
        agent_enabled === undefined &&
        name === undefined &&
        proactive_enabled === undefined &&
        proactive_min_minutes === undefined &&
        proactive_max_minutes === undefined
      ) {
        reply.status(400);
        return { error: "no fields to update" };
      }
      // Normalize name: trim, empty -> null (clears it), reject overly long values.
      let normalizedName: string | null | undefined = name;
      if (name !== undefined) {
        const trimmed = (name ?? "").trim();
        if (trimmed.length > 200) {
          reply.status(400);
          return { error: "name too long (max 200 chars)" };
        }
        normalizedName = trimmed === "" ? null : trimmed;
      }
      // Validate the proactive interval range (minutes, whole, within bounds).
      if (proactive_min_minutes !== undefined && !isIntInRange(proactive_min_minutes)) {
        reply.status(400);
        return {
          error: `proactive_min_minutes must be an integer in [${MIN_INTERVAL_MINUTES}, ${MAX_INTERVAL_MINUTES}]`,
        };
      }
      if (proactive_max_minutes !== undefined && !isIntInRange(proactive_max_minutes)) {
        reply.status(400);
        return {
          error: `proactive_max_minutes must be an integer in [${MIN_INTERVAL_MINUTES}, ${MAX_INTERVAL_MINUTES}]`,
        };
      }
      if (
        proactive_min_minutes !== undefined &&
        proactive_max_minutes !== undefined &&
        proactive_min_minutes > proactive_max_minutes
      ) {
        reply.status(400);
        return { error: "proactive_min_minutes cannot exceed proactive_max_minutes" };
      }
      await container.chats.patch(req.params.id, {
        label,
        agent_enabled,
        name: normalizedName,
        proactive_enabled,
        proactive_min_minutes,
        proactive_max_minutes,
      });
      return { ok: true };
    }
  );

  app.get<{
    Params: { id: string };
    Querystring: { limit?: string; before?: string };
  }>("/api/chats/:id/messages", async (req) =>
    container.chats.listMessages({
      chatId: req.params.id,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      before: req.query.before,
    })
  );
}
