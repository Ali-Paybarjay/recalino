import { ADMIN_TASK_TITLE } from "@recalino/core/ops";
import { describe, expect, it } from "vitest";
import { adminTaskTitleCopy } from "../ui/admin/copy";

// D96, D98: the server and the admin console give the stopped-deletion and health-alert tasks the
// same approved titles, so a task reads the same in the API and in the console.
describe("approved admin task titles", () => {
  it("are the same in the server's tasks and in the admin console", () => {
    for (const [kind, title] of Object.entries(adminTaskTitleCopy))
      expect(ADMIN_TASK_TITLE[kind]).toEqual(title);
  });
});
