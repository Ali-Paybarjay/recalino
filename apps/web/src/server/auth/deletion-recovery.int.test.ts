import { randomUUID } from "node:crypto";
import { tombstoneAccount } from "@recalino/core/acc";
import { type PrivacyDependencies, requestAccountDeletion } from "@recalino/core/priv";
import { beforeEach, expect, it, vi } from "vitest";
import WorkspaceLayout from "../../app/(app)/layout";
import DeletionRecoveryPage from "../../app/deletion/page";
import WelcomePage from "../../app/page";
import { orgFixture, orgTestDatabase } from "../cross-account/org-support";
import { fakeAuth } from "../test-support";
import {
  getPendingAccountDeletion,
  pendingAccountDeletion,
  privacySessions,
  requireLearner,
} from "./learner";

const identity = vi.hoisted(() => ({ current: null as string | null }));
vi.mock("../db", () => ({ getDatabase: () => db }));
vi.mock("./gateway", () => ({
  supabaseAuth: { currentUser: async () => (identity.current ? { id: identity.current } : null) },
}));
vi.mock("next/navigation", () => ({
  redirect: (location: string) => {
    throw new Error(`Redirect:${location}`);
  },
}));
const db = orgTestDatabase();
const dependencies: PrivacyDependencies = {
  hooks: [
    {
      module: "fixture",
      tombstoneSession: async () => {},
      cleanupSession: async () => {},
      cleanupAccount: async () => {},
    },
  ],
};
beforeEach(() => {
  identity.current = null;
});

it("anonymous reload recovery redirects to sign-in without exposing a deletion receipt", async () => {
  expect(await getPendingAccountDeletion()).toBeNull();
  // The shared capture wrapper must not replace a page's actual return path with /today.
  await expect(WorkspaceLayout({ children: null })).resolves.toBeDefined();
  await expect(DeletionRecoveryPage()).rejects.toThrow("Redirect:/");
  await expect(requireLearner("/me/data")).rejects.toThrow("Redirect:/?next=%2Fme%2Fdata");
});

it("verified hidden owners recover their one pending receipt while learner pages remain blocked", async () => {
  const fixture = await orgFixture(db);
  const receipt = await requestAccountDeletion(db, fixture.actor, randomUUID(), dependencies);
  identity.current = fixture.owner;
  expect(await getPendingAccountDeletion()).toEqual({
    userId: fixture.owner,
    requestId: receipt.id,
  });
  await expect(requireLearner("/today")).rejects.toThrow("Redirect:/deletion");
  await expect(WelcomePage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
    "Redirect:/deletion",
  );
  const page = await DeletionRecoveryPage();
  const serialized = JSON.stringify(page);
  expect(serialized).toContain(receipt.id);
  expect(serialized).toContain(fixture.owner);
  expect(serialized).not.toContain(fixture.session.title);
  expect(serialized).not.toContain("lastError");
  const recovered = await requestAccountDeletion(
    db,
    fixture.actor,
    `delete-account:${receipt.id}`,
    dependencies,
  );
  expect(recovered.id).toBe(receipt.id);
  const requests = await db
    .selectFrom("priv.deletion_request")
    .select("id")
    .where("user_id", "=", fixture.owner)
    .execute();
  expect(requests).toHaveLength(1);
});

it("live accounts, other identities and completed receipts cannot enter recovery", async () => {
  const fixture = await orgFixture(db);
  const auth = fakeAuth().gateway;
  auth.currentUser = async () => ({ id: fixture.owner });
  expect(await pendingAccountDeletion(auth, () => db)).toBeNull();
  const receipt = await requestAccountDeletion(db, fixture.actor, randomUUID(), dependencies);
  const foreign = await orgFixture(db);
  await db.transaction().execute((tx) => tombstoneAccount(tx, foreign.actor, new Date()));
  identity.current = foreign.owner;
  expect(await getPendingAccountDeletion()).toBeNull();
  await expect(DeletionRecoveryPage()).rejects.toThrow("Redirect:/");
  await db
    .updateTable("priv.deletion_request")
    .set({ state: "completed", completed_at: new Date() })
    .where("id", "=", receipt.id)
    .execute();
  identity.current = fixture.owner;
  expect(await getPendingAccountDeletion()).toBeNull();
  expect(
    await privacySessions(auth, () => db).getSession(
      new Request("http://localhost/api/privacy/account"),
    ),
  ).toBeNull();
  await expect(DeletionRecoveryPage()).rejects.toThrow("Redirect:/");
});
