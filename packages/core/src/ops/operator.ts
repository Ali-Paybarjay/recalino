import { z } from "zod";
import type { Database } from "../db";
import { platformOperationalSummary, recordAudit } from "../plt";
import { processingOperationalSummary } from "../proc";
import {
  adjustAllowance,
  amountsSchema,
  closeEntitlement,
  configureCostPolicy,
  costPolicySchema,
  DIMENSIONS,
  grantEntitlement,
  grantPilotEntitlement,
  pilotPolicySchema,
  providerCostSummary,
} from "../quota";
import { configureInputContract, inputContractSchema } from "../src";

const common = {
  version: z.literal("1"),
  actorId: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(500),
  operationKey: z.string().min(8).max(200),
};
export const operatorRequestSchema = z.discriminatedUnion("command", [
  z.strictObject({
    ...common,
    command: z.literal("pilot.grant"),
    input: z.strictObject({
      userId: z.uuid(),
      policy: pilotPolicySchema,
      startsAt: z.iso.datetime(),
    }),
  }),
  z.strictObject({
    ...common,
    command: z.literal("quota.grant"),
    input: z.strictObject({
      userId: z.uuid(),
      startsAt: z.iso.datetime(),
      endsAt: z.iso.datetime(),
      amounts: amountsSchema,
    }),
  }),
  z.strictObject({
    ...common,
    command: z.literal("quota.adjust"),
    input: z.strictObject({
      userId: z.uuid(),
      entitlementId: z.uuid(),
      dimension: z.enum(DIMENSIONS),
      delta: z.number().int().safe(),
    }),
  }),
  z.strictObject({
    ...common,
    command: z.literal("quota.close"),
    input: z.strictObject({ userId: z.uuid(), entitlementId: z.uuid() }),
  }),
  z.strictObject({ ...common, command: z.literal("cost.configure"), input: costPolicySchema }),
  z.strictObject({ ...common, command: z.literal("source.configure"), input: inputContractSchema }),
  z.strictObject({
    ...common,
    command: z.literal("stats"),
    input: z.strictObject({ since: z.iso.datetime() }),
  }),
]);
export type OperatorRequest = z.infer<typeof operatorRequestSchema>;
/** Trusted database operator tooling, never exported as a learner web handler. No profile is needed. */
export async function executeOperatorRequest(
  db: Database,
  raw: unknown,
  now = new Date(),
): Promise<unknown> {
  const request = operatorRequestSchema.parse(raw);
  const operator = { actorId: request.actorId, reason: request.reason };
  switch (request.command) {
    case "pilot.grant":
      return {
        entitlementId: await grantPilotEntitlement(
          db,
          {
            ...request.input,
            ...operator,
            operationKey: request.operationKey,
            startsAt: new Date(request.input.startsAt),
          },
          now,
        ),
      };
    case "quota.grant":
      return {
        entitlementId: await grantEntitlement(
          db,
          {
            ...request.input,
            ...operator,
            operationKey: request.operationKey,
            startsAt: new Date(request.input.startsAt),
            endsAt: new Date(request.input.endsAt),
          },
          now,
        ),
      };
    case "quota.adjust":
      await adjustAllowance(
        db,
        { ...request.input, ...operator, operationKey: request.operationKey },
        now,
      );
      return { adjusted: true };
    case "quota.close":
      await closeEntitlement(db, { ...request.input, ...operator }, now);
      return { closed: true };
    case "cost.configure":
      await configureCostPolicy(db, request.input, operator, now);
      return {
        configured: true,
        version: request.input.version,
        killSwitch: request.input.killSwitch,
      };
    case "source.configure":
      return {
        configured: true,
        version: (await configureInputContract(db, request.input, operator, now)).version,
      };
    case "stats": {
      const since = new Date(request.input.since);
      const results = await Promise.allSettled([
        platformOperationalSummary(db, since, now),
        processingOperationalSummary(db, since),
        providerCostSummary(db, since),
      ]);
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      await recordAudit(db, {
        actorKind: "operator",
        actorId: request.actorId,
        action: "ops.read_metadata",
        subjectType: "operational_summary",
        subjectId: request.operationKey,
        reason: request.reason,
      });
      return {
        platform: results[0]?.status === "fulfilled" ? results[0].value : null,
        processing: results[1]?.status === "fulfilled" ? results[1].value : null,
        costs: results[2]?.status === "fulfilled" ? results[2].value : null,
      };
    }
  }
}
