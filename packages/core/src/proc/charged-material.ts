import { sql } from "kysely";
import { z } from "zod";
import { lockAccount } from "../acc";
import type { Database, Tx } from "../db";
import type { LearnerContext } from "../plt";
import {
  type Amounts,
  amountsSchema,
  DIMENSIONS,
  emptyAmounts,
  equivalentPages,
  reservationEntitlement,
  returnSettledCharge,
  settleAllowance,
  settledReservations,
} from "../quota";

type Connection = Database | Tx;
/** Half-open spans: milliseconds for audio; page numbers for PDF, where page p is [p, p + 1). */
type Span = [number, number];

/**
 * D59: class material is charged once. A class run reserves and settles only the material that
 * was not already paid for, either in the same class (in any allowance period) or, for the same
 * file content, in another class during the same allowance period. Updates, retries and
 * recoveries therefore reuse what was paid; the AI spending caps still bound their provider work.
 *
 * One `charge:<sourceId>` run step per published source records what that publication used and
 * the part of it this publication paid for.
 */
const CHARGE_STEP = "charge:";
/** SQL LIKE pattern of the charge steps, which a source cleanup keeps for the other files. */
export const CHARGE_STEP_PATTERN = `${CHARGE_STEP}%`;
const spanSchema = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]);
const spansSchema = z.union([z.literal("whole"), z.array(spanSchema)]);
export const chargedMaterialSchema = z.strictObject({
  version: z.literal(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  kind: z.enum(["audio", "image", "pdf", "html", "text"]),
  /** The allowance period of the reservation that settled this publication. */
  entitlementId: z.uuid(),
  /** What the publication used, which the class never pays for again. */
  used: spansSchema,
  /** What this publication paid for, which other classes reuse during the same period. */
  paid: spansSchema,
});
export type ChargedMaterial = z.infer<typeof chargedMaterialSchema>;

interface ContentCoverage {
  whole: boolean;
  spans: Span[];
}
/** Material already paid for, keyed by file content: `<kind>:<sha256>`. */
export type ChargedCoverage = Map<string, ContentCoverage>;
const contentKey = (source: { kind: string; sha256: string }) => `${source.kind}:${source.sha256}`;
/** The fields of a run source that decide its charge; text blocks matter only for HTML and text. */
const chargeSourceSchema = z.object({
  sourceId: z.uuid(),
  kind: z.enum(["audio", "image", "pdf", "html", "text"]),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  ranges: z.array(
    z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }),
  ),
  durationMs: z.number().int().positive().nullable(),
  pageCount: z.number().int().positive().nullable(),
  blocks: z.array(z.object({ text: z.string() })),
});
type ChargeSource = z.infer<typeof chargeSourceSchema>;

function normalize(spans: readonly Span[]): Span[] {
  const merged: Span[] = [];
  const sorted = spans
    .filter(([start, end]) => end > start)
    .map(([start, end]): Span => [start, end])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [start, end] of sorted) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}
/** The parts of `selected` outside `covered`; both are normalized. */
function subtract(selected: readonly Span[], covered: readonly Span[]): Span[] {
  const rest: Span[] = [];
  for (const [start, end] of selected) {
    let cursor = start;
    for (const [coveredStart, coveredEnd] of covered) {
      if (coveredEnd <= cursor) continue;
      if (coveredStart >= end) break;
      if (coveredStart > cursor) rest.push([cursor, coveredStart]);
      cursor = Math.max(cursor, coveredEnd);
      if (cursor >= end) break;
    }
    if (cursor < end) rest.push([cursor, end]);
  }
  return rest;
}
const length = (spans: readonly Span[]) =>
  spans.reduce((total, [start, end]) => total + end - start, 0);
/** The material a selected source stands for. A whole file stays whole if remeasured later. */
function selection(source: ChargeSource): ContentCoverage {
  if (source.kind === "audio") {
    const spans = normalize(
      source.ranges.length
        ? source.ranges.map((range): Span => [range.start, range.end])
        : [[0, source.durationMs ?? 0]],
    );
    return { whole: !source.ranges.length && spans.length > 0, spans };
  }
  if (source.kind === "pdf") {
    const spans = normalize(
      source.ranges.length
        ? source.ranges.map((range): Span => [range.start, range.end + 1])
        : [[1, (source.pageCount ?? 0) + 1]],
    );
    return { whole: !source.ranges.length && spans.length > 0, spans };
  }
  return { whole: true, spans: [] };
}
function cover(coverage: ChargedCoverage, key: string, material: ContentCoverage) {
  if (!material.whole && !material.spans.length) return;
  const prior = coverage.get(key);
  coverage.set(key, {
    whole: !!prior?.whole || material.whole,
    spans: normalize([...(prior?.spans ?? []), ...material.spans]),
  });
}
const nothing: ContentCoverage = { whole: false, spans: [] };

/** Per source, in the order given: identical content selected twice is paid for once. */
function charge(
  sources: readonly ChargeSource[],
  coverage: ChargedCoverage,
  charactersPerPage: number,
  regeneration: boolean,
): { amounts: Amounts; paid: ContentCoverage[] } {
  const covered: ChargedCoverage = new Map(
    [...coverage].map(([key, item]) => [key, { whole: item.whole, spans: [...item.spans] }]),
  );
  const used = emptyAmounts();
  const paid = sources.map((source): ContentCoverage => {
    const key = contentKey(source);
    const prior = covered.get(key);
    const material = selection(source);
    cover(covered, key, material);
    if (prior?.whole) return nothing;
    if (source.kind === "audio" || source.kind === "pdf") {
      const rest = subtract(material.spans, prior?.spans ?? []);
      if (source.kind === "audio") used.audio += Math.ceil(length(rest) / 1000);
      else used.document += length(rest);
      return { whole: !prior && material.whole, spans: rest };
    }
    used.document +=
      source.kind === "image"
        ? 1
        : equivalentPages(source.blocks.map((block) => block.text).join("\n"), charactersPerPage);
    return { whole: true, spans: [] };
  });
  used.regeneration = regeneration ? 1 : 0;
  return { amounts: amountsSchema.parse(used), paid };
}

/**
 * Units these sources add beyond `coverage`. With empty coverage this is the full estimate of
 * FR-QUOTA-004, except that identical content and overlapping ranges are counted once.
 */
export function chargeableAmounts(
  sources: readonly ChargeSource[],
  coverage: ChargedCoverage,
  charactersPerPage: number,
  regeneration: boolean,
): Amounts {
  return charge(sources, coverage, charactersPerPage, regeneration).amounts;
}

const spans = (material: ContentCoverage) => (material.whole ? "whole" : material.spans);
const coverageFrom = (value: ChargedMaterial["used"]): ContentCoverage =>
  value === "whole" ? { whole: true, spans: [] } : { whole: false, spans: normalize(value) };
function marker(
  source: ChargeSource,
  entitlementId: string,
  paid: ContentCoverage,
): ChargedMaterial {
  return chargedMaterialSchema.parse({
    version: 1,
    sha256: source.sha256,
    kind: source.kind,
    entitlementId,
    used: spans(selection(source)),
    paid: spans(paid),
  });
}

interface CoverageEntry {
  runId: string;
  sessionId: string;
  sources: { sourceId: string; material: ChargedMaterial }[];
}
interface LegacyEntry extends CoverageEntry {
  reservationId: string;
  settledAt: Date;
  snapshotSources: ChargeSource[];
  charactersPerPage: number | null;
}
/**
 * Runs settled before D59 have no markers. One that charged its whole reservation published all of
 * its sources, so its snapshot is what it paid for; a partial or unreadable one counts as nothing.
 */
async function legacyEntries(
  db: Connection,
  ctx: LearnerContext,
  runIds?: readonly string[],
): Promise<LegacyEntry[]> {
  if (runIds && !runIds.length) return [];
  const runs = await db
    .selectFrom("proc.processing_run as run")
    .select([
      "run.id",
      "run.session_id",
      "run.reservation_id",
      "run.requested_amounts",
      // Only the charge fields: a long class transcript stays in the database.
      sql<unknown>`(select coalesce(jsonb_agg(jsonb_build_object(
          'sourceId', source->'sourceId', 'kind', source->'kind', 'sha256', source->'sha256',
          'ranges', source->'ranges', 'durationMs', source->'durationMs',
          'pageCount', source->'pageCount',
          'blocks', case when source->>'kind' in ('html', 'text')
            then source->'blocks' else '[]'::jsonb end)), '[]'::jsonb)
        from jsonb_array_elements(case when jsonb_typeof(run.input_snapshot->'sources') = 'array'
          then run.input_snapshot->'sources' else '[]'::jsonb end) as source)`.as("sources"),
      sql<unknown>`run.settings->'provider'->'charactersPerPage'`.as("characters_per_page"),
    ])
    .where("run.user_id", "=", ctx.userId)
    .where("run.kind", "=", "class")
    .where("run.state", "in", ["ready", "partial_ready"])
    .$if(runIds !== undefined, (qb) => qb.where("run.id", "in", [...(runIds ?? [])]))
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("proc.run_step as step")
            .select("step.run_id")
            .whereRef("step.run_id", "=", "run.id")
            .where("step.step", "like", CHARGE_STEP_PATTERN),
        ),
      ),
    )
    .execute();
  const settled = new Map(
    (
      await settledReservations(
        db,
        ctx,
        runs.map((run) => run.reservation_id),
      )
    ).map((reservation) => [reservation.id, reservation]),
  );
  return runs.flatMap((run) => {
    const reservation = settled.get(run.reservation_id);
    const requested = amountsSchema.safeParse(run.requested_amounts);
    const sources = z.array(chargeSourceSchema).min(1).safeParse(run.sources);
    const charactersPerPage = z.number().int().positive().safeParse(run.characters_per_page);
    if (
      !reservation ||
      !requested.success ||
      !sources.success ||
      reservation.settled.audio + reservation.settled.document === 0 ||
      reservation.settled.audio !== requested.data.audio ||
      reservation.settled.document !== requested.data.document
    )
      return [];
    return [
      {
        runId: run.id,
        sessionId: run.session_id,
        reservationId: run.reservation_id,
        settledAt: reservation.closedAt,
        snapshotSources: sources.data,
        charactersPerPage: charactersPerPage.success ? charactersPerPage.data : null,
        // A legacy run paid for everything it used.
        sources: sources.data.map((source) => ({
          sourceId: source.sourceId,
          material: marker(source, reservation.entitlementId, selection(source)),
        })),
      },
    ];
  });
}
async function markerEntries(db: Connection, ctx: LearnerContext): Promise<CoverageEntry[]> {
  const rows = await db
    .selectFrom("proc.run_step as step")
    .innerJoin("proc.processing_run as run", "run.id", "step.run_id")
    .select(["run.id as run_id", "run.session_id", "step.step", "step.output"])
    .where("run.user_id", "=", ctx.userId)
    .where("run.kind", "=", "class")
    .where("step.step", "like", CHARGE_STEP_PATTERN)
    .execute();
  const entries = new Map<string, CoverageEntry>();
  for (const row of rows) {
    const material = chargedMaterialSchema.safeParse(row.output);
    if (!material.success) continue;
    const entry = entries.get(row.run_id) ?? {
      runId: row.run_id,
      sessionId: row.session_id,
      sources: [],
    };
    entry.sources.push({ sourceId: row.step.slice(CHARGE_STEP.length), material: material.data });
    entries.set(row.run_id, entry);
  }
  return [...entries.values()];
}
function coverageOf(
  entries: readonly CoverageEntry[],
  scope: { sessionId: string; entitlementId: string | null; excludeRunId?: string },
): ChargedCoverage {
  const coverage: ChargedCoverage = new Map();
  for (const entry of entries) {
    if (entry.runId === scope.excludeRunId) continue;
    for (const { material } of entry.sources)
      if (entry.sessionId === scope.sessionId)
        cover(coverage, contentKey(material), coverageFrom(material.used));
      else if (material.entitlementId === scope.entitlementId)
        cover(coverage, contentKey(material), coverageFrom(material.paid));
  }
  return coverage;
}

/** What the learner already paid for that a run of `sessionId` in `entitlementId` may reuse. */
export async function readChargedCoverage(
  db: Connection,
  ctx: LearnerContext,
  scope: { sessionId: string; entitlementId: string | null; excludeRunId?: string },
): Promise<ChargedCoverage> {
  return coverageOf([...(await markerEntries(db, ctx)), ...(await legacyEntries(db, ctx))], scope);
}

export async function chargeableRunAmounts(
  db: Connection,
  ctx: LearnerContext,
  input: {
    sessionId: string;
    entitlementId: string | null;
    sources: readonly ChargeSource[];
    charactersPerPage: number;
    regeneration: boolean;
    excludeRunId?: string;
  },
): Promise<Amounts> {
  return chargeableAmounts(
    input.sources,
    await readChargedCoverage(db, ctx, input),
    input.charactersPerPage,
    input.regeneration,
  );
}

async function writeMarkers(
  tx: Tx,
  runId: string,
  sources: readonly { sourceId: string; material: ChargedMaterial }[],
  now: Date,
) {
  if (!sources.length) return;
  await tx
    .insertInto("proc.run_step")
    .values(
      sources.map((source) => ({
        run_id: runId,
        step: `${CHARGE_STEP}${source.sourceId}`,
        output: JSON.stringify(source.material),
        completed_at: now,
      })),
    )
    .onConflict((oc) => oc.columns(["run_id", "step"]).doNothing())
    .execute();
}

/**
 * Settle a published class run inside its account-locked publication transaction: charge only
 * what earlier publications have not paid for, never more than the reservation, and record what
 * this publication covered.
 */
export async function settleClassMaterial(
  tx: Tx,
  ctx: LearnerContext,
  input: {
    runId: string;
    sessionId: string;
    reservationId: string;
    held: Amounts;
    sources: readonly ChargeSource[];
    charactersPerPage: number;
    now: Date;
  },
): Promise<Amounts> {
  const entitlementId = await reservationEntitlement(tx, ctx, input.reservationId);
  const { amounts: actual, paid } = charge(
    input.sources,
    await readChargedCoverage(tx, ctx, {
      sessionId: input.sessionId,
      entitlementId,
      excludeRunId: input.runId,
    }),
    input.charactersPerPage,
    input.held.regeneration > 0,
  );
  // Coverage can only shrink after the reservation if paid material was deleted meanwhile. The
  // charge then stops at the reservation, and other classes never treat the rest as paid.
  const capped = DIMENSIONS.some((dimension) => actual[dimension] > input.held[dimension]);
  for (const dimension of DIMENSIONS)
    actual[dimension] = Math.min(actual[dimension], input.held[dimension]);
  await settleAllowance(tx, ctx, input.reservationId, actual, input.now);
  await writeMarkers(
    tx,
    input.runId,
    input.sources.map((source, index) => ({
      sourceId: source.sourceId,
      material: marker(source, entitlementId, capped ? nothing : (paid[index] ?? nothing)),
    })),
    input.now,
  );
  return actual;
}

/**
 * Before a source cleanup removes run snapshots, keep what the class paid for its other files:
 * write markers for legacy runs and drop only the deleted source's markers.
 */
export async function keepChargedMaterialOnSourceCleanup(
  tx: Tx,
  ctx: LearnerContext,
  runIds: readonly string[],
  deletedSourceId: string,
  now: Date,
): Promise<void> {
  if (!runIds.length) return;
  for (const entry of await legacyEntries(tx, ctx, runIds))
    await writeMarkers(
      tx,
      entry.runId,
      entry.sources.filter((source) => source.sourceId !== deletedSourceId),
      now,
    );
  await tx
    .deleteFrom("proc.run_step")
    .where("run_id", "in", [...runIds])
    .where("step", "=", `${CHARGE_STEP}${deletedSourceId}`)
    .execute();
}

export interface ReturnedDuplicateCharge {
  runId: string;
  sessionId: string;
  reservationId: string;
  returned: Amounts;
}
/**
 * D59 correction for class runs settled before charge-once accounting. Replays those charged
 * publications in settlement order, works out what each would have cost under D59 and, when
 * `apply` is set, hands back the difference. Regeneration, speech and storage are unchanged.
 * Later publications already saw these runs as paid, so they never make an earlier one free.
 */
export async function returnDuplicateClassCharges(
  db: Database,
  ctx: LearnerContext,
  input: { actorId: string; reason: string; apply: boolean; now?: Date },
): Promise<ReturnedDuplicateCharge[]> {
  const now = input.now ?? new Date();
  return db.transaction().execute(async (tx) => {
    // Settlements serialize on the same lock, so the replay sees one consistent history.
    await lockAccount(tx, ctx.userId);
    const entries = (await legacyEntries(tx, ctx)).sort(
      (a, b) => a.settledAt.getTime() - b.settledAt.getTime() || a.runId.localeCompare(b.runId),
    );
    const reservations = new Map(
      (
        await settledReservations(
          tx,
          ctx,
          entries.map((entry) => entry.reservationId),
        )
      ).map((reservation) => [reservation.id, reservation]),
    );
    const results: ReturnedDuplicateCharge[] = [];
    const earlier: LegacyEntry[] = [];
    for (const entry of entries) {
      const reservation = reservations.get(entry.reservationId);
      if (!reservation || entry.charactersPerPage === null) continue;
      const expected = chargeableAmounts(
        entry.snapshotSources,
        coverageOf(earlier, {
          sessionId: entry.sessionId,
          entitlementId: reservation.entitlementId,
        }),
        entry.charactersPerPage,
        false,
      );
      earlier.push(entry);
      const returned = emptyAmounts();
      returned.audio = Math.max(0, reservation.settled.audio - expected.audio);
      returned.document = Math.max(0, reservation.settled.document - expected.document);
      if (returned.audio + returned.document === 0) continue;
      if (input.apply)
        await returnSettledCharge(
          tx,
          ctx,
          {
            reservationId: entry.reservationId,
            amounts: returned,
            actorId: input.actorId,
            reason: input.reason,
          },
          now,
        );
      results.push({
        runId: entry.runId,
        sessionId: entry.sessionId,
        reservationId: entry.reservationId,
        returned,
      });
    }
    return results;
  });
}
