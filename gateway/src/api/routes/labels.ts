import type { FastifyInstance } from "fastify";
import { container } from "../../composition/container.js";

type LabelBody = {
  label: string;
  prompt_template: string;
  temperature: number;
  max_distance?: number;
  examples?: string | null;
};
type LabelPatch = {
  prompt_template?: string;
  temperature?: number;
  max_distance?: number;
  examples?: string | null;
};

export async function registerLabelRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/labels", async () => container.labels.list());

  // Canonical base prompts per label type (code-defined; see domain/base-prompts.ts).
  app.get("/api/labels/base", async () => container.labels.listBase());

  // Restore a label to its base config (only labels that have a base).
  app.post<{ Params: { label: string } }>(
    "/api/labels/:label/reset",
    async (req, reply) => {
      const ok = await container.labels.resetToBase(req.params.label);
      if (!ok) {
        reply.status(404);
        return { error: "no base prompt for that label" };
      }
      return { ok: true };
    }
  );

  app.post<{ Body: LabelBody }>("/api/labels", async (req, reply) => {
    const { label, prompt_template, temperature, max_distance, examples } = req.body;
    if (!label || !prompt_template) {
      reply.status(400);
      return { error: "label and prompt_template required" };
    }
    await container.labels.upsert({
      label,
      prompt_template,
      temperature,
      max_distance: max_distance ?? 1.3,
      examples: examples ?? null,
    });
    return { ok: true };
  });

  app.patch<{ Params: { label: string }; Body: LabelPatch }>(
    "/api/labels/:label",
    async (req, reply) => {
      const { prompt_template, temperature, max_distance, examples } = req.body ?? {};
      if (
        prompt_template === undefined &&
        temperature === undefined &&
        max_distance === undefined &&
        examples === undefined
      ) {
        reply.status(400);
        return { error: "no fields to update" };
      }
      await container.labels.patch(req.params.label, {
        prompt_template,
        temperature,
        max_distance,
        examples,
      });
      return { ok: true };
    }
  );

  app.delete<{ Params: { label: string } }>(
    "/api/labels/:label",
    async (req, reply) => {
      const result = await container.labels.remove(req.params.label);
      if (!result.ok) {
        reply.status(result.status);
        return { error: result.error };
      }
      return { ok: true };
    }
  );
}
