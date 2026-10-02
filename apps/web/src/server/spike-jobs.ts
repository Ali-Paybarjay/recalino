import "server-only";
import type { Tx } from "@recalino/core/db";
import { type JobDefinition, recordAudit } from "@recalino/core/plt";
import { z } from "zod";

// SPIKE-05 only (M4, T3): job kinds for the cloud measurements, on only with RECALINO_SPIKE=1.
// Removed with the spike (T6).

const payload = z.strictObject({ tag: z.string().regex(/^[a-z0-9-]{1,40}$/) });
type Payload = z.infer<typeof payload>;

async function effect(tx: Tx, jobId: string, step: string) {
  await recordAudit(tx, {
    actorKind: "system",
    actorId: "spike-05",
    action: `spike_${step}`,
    subjectType: "job",
    subjectId: jobId,
  });
}

export function spikeJobDefinitions(
  env: Record<string, string | undefined> = process.env,
): JobDefinition<Payload>[] {
  if (env.RECALINO_SPIKE !== "1") return [];
  return [
    {
      kind: "spike.echo",
      version: 1,
      payload,
      options: { leaseSeconds: 60, maxAttempts: 3, retryBaseSeconds: 5 },
      run: async (_payload, ctx) => {
        await ctx.step("only", (tx) => effect(tx, ctx.job.id, "only"));
      },
    },
    {
      // A real crash: the function process dies between two steps on the first attempt.
      kind: "spike.crash",
      version: 1,
      payload,
      options: { leaseSeconds: 30, maxAttempts: 3, retryBaseSeconds: 0 },
      run: async (_payload, ctx) => {
        await ctx.step("first", (tx) => effect(tx, ctx.job.id, "first"));
        if ((await ctx.step("crash_marker", async () => {})) === "ran") process.exit(1);
        await ctx.step("second", (tx) => effect(tx, ctx.job.id, "second"));
      },
    },
  ];
}
