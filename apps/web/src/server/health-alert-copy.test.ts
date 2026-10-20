import { HEALTH_ALERT_TEXT } from "@recalino/core/ops";
import { describe, expect, it } from "vitest";
import { systemHealthCopy } from "../ui/admin/copy";

// OPS-02 (D96, D97): the health admin task repeats the approved System health alert sentences, so
// the core copy and the admin card copy must stay identical.
describe("health alert sentences", () => {
  it("are the same in the admin task and the System health card", () => {
    expect(HEALTH_ALERT_TEXT).toEqual(systemHealthCopy.alert);
  });
});
