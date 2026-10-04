import { randomUUID } from "node:crypto";
import { createDatabase } from "@recalino/core/db";
import { requestHtmlExport } from "@recalino/core/html";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../../../../packages/core/test/local-db";
import { studyFixture } from "../../../../../packages/core/test/study-fixture";
import { defineRoute } from "../api";
import {
  classExportsHandler,
  exportArtifactHandler,
  exportDownloadHandler,
} from "../export-routes";
import { ROUTES } from "../routes";
import { routeDeps } from "../test-support";
import { requestAs } from "./learners";
export function exportCrossAccount(name: "classExports" | "exportArtifact" | "exportDownload") {
  const db = createDatabase(testDatabaseUrl(), { maxConnections: 3 });
  afterAll(() => db.destroy());
  it(`${name} requires a session and hides another account's export identifiers`, async () => {
    const [alice, bob] = await Promise.all([studyFixture(db), studyFixture(db)]);
    const artifact = await requestHtmlExport(
      db,
      alice.ctx,
      { revisionId: alice.notebook.current.id },
      {
        key: randomUUID(),
        settings: {
          version: "synthetic",
          maxBytes: 1000000,
          maxItems: 1000,
          retentionSeconds: 3600,
        },
      },
    );
    const meta = ROUTES[name];
    const handler =
      name === "classExports"
        ? classExportsHandler(alice.session.id)
        : name === "exportArtifact"
          ? exportArtifactHandler("html", artifact.id)
          : exportDownloadHandler("html", artifact.id);
    const route = defineRoute(meta, handler, routeDeps(db));
    expect((await route(requestAs(null, meta.path, "GET"))).status).toBe(401);
    const foreign = await route(requestAs(bob.ctx.userId, meta.path, "GET"));
    expect(foreign.status).toBe(404);
    expect(JSON.stringify(await foreign.json())).not.toContain("Synthetic study fixture");
    if (name !== "exportDownload")
      expect((await route(requestAs(alice.ctx.userId, meta.path, "GET"))).status).toBe(200);
  });
}
