import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshEmailStatuses, releaseSubmissionKey, submissionKey } from "./api";
import type { AdminEmail } from "./contracts";
import { emailDeliveryExplanation, statusName } from "./copy";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const email: AdminEmail = {
  id: "97d4b8fa-79eb-42a5-b694-c7e9037ad1f5",
  userId: "80c373d4-f9d4-4b21-bf40-d405c8085e90",
  email: "synthetic@example.test",
  subject: "Synthetic invitation",
  state: "queued",
  createdAt: "2026-10-06T12:00:00.000Z",
  lastError: null,
  retryAllowed: false,
};

describe("owner mutation intent keys", () => {
  it("reuses a failed request key but starts fresh after confirmed success", () => {
    const holder = { current: new Map<string, string>() };
    const input = { capacity: 12, reason: "Pilot revision" };
    const first = submissionKey(holder, "pilot.configure", input);
    // No completion is recorded when a response is lost.
    expect(submissionKey(holder, "pilot.configure", input)).toBe(first);
    releaseSubmissionKey(holder, "pilot.configure", input);
    expect(submissionKey(holder, "pilot.configure", input)).not.toBe(first);
  });
  it("executes A → B → A allocation changes as three intentional mutations", () => {
    const holder = { current: new Map<string, string>() };
    const keys: string[] = [];
    for (const audio of [36000, 72000, 36000]) {
      const input = {
        userId: "same-user",
        entitlementId: "same-period",
        amounts: { audio },
        reason: "Revised allocation",
      };
      keys.push(submissionKey(holder, "quota.set", input));
      releaseSubmissionKey(holder, "quota.set", input);
    }
    expect(new Set(keys).size).toBe(3);
    expect(holder.current.size).toBe(0);
  });
});

describe("approved email status tracking", () => {
  it("refreshes queued and sending receipts until accepted, using only read requests", async () => {
    vi.useFakeTimers();
    const updates: AdminEmail[][] = [];
    const states = ["sending", "sent"];
    const fetcher = vi.fn(async () =>
      Response.json({ view: "history", emails: [{ ...email, state: states.shift() }] }),
    );
    vi.stubGlobal("fetch", fetcher);
    const tracking = refreshEmailStatuses(
      [email],
      (rows) => updates.push(rows),
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(4000);
    await tracking;
    expect(updates.map((rows) => rows[0]?.state)).toEqual(["sending", "sent"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetcher.mock.calls as unknown as [string, RequestInit][]) {
      expect(url).toBe(`/api/admin?view=history&emailIds=${email.id}`);
      expect(options.method).toBeUndefined();
      expect(options.body).toBeUndefined();
      expect(options.cache).toBe("no-store");
    }
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("stops at a confirmed authentication failure and explains it in both languages", async () => {
    vi.useFakeTimers();
    const failed = {
      ...email,
      state: "failed",
      lastError: "smtp_authentication_rejected",
      retryAllowed: true,
    };
    const fetcher = vi.fn(async () => Response.json({ view: "history", emails: [failed] }));
    vi.stubGlobal("fetch", fetcher);
    let result: AdminEmail[] = [];
    const tracking = refreshEmailStatuses(
      [email],
      (rows) => {
        result = rows;
      },
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(2000);
    await tracking;
    expect(result).toEqual([failed]);
    expect(emailDeliveryExplanation(failed, "en")).toContain("this email was not sent");
    expect(emailDeliveryExplanation(failed, "fa")).toContain("این ایمیل ارسال نشد");
    expect(emailDeliveryExplanation(failed, "fa")).not.toContain("smtp_authentication_rejected");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("leaves unknown receipts for manual checking without a poll or delivery retry", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const unknown = { ...email, state: "unknown", lastError: "smtp_result_unverified" };
    await refreshEmailStatuses([unknown], vi.fn(), new AbortController().signal);
    expect(fetcher).not.toHaveBeenCalled();
    expect(statusName("unknown", "fa")).toBe("نامشخص");
    expect(statusName("unknown", "en")).toBe("Unconfirmed");
    expect(emailDeliveryExplanation(unknown, "fa")).toContain("تلاش مجدد خودکار انجام نمی‌شود");
    expect(emailDeliveryExplanation(unknown, "en")).toContain("There is no automatic retry");
  });
  it("cancels pending reads when the result screen is left", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    const update = vi.fn();
    const tracking = refreshEmailStatuses([email], update, controller.signal);
    controller.abort();
    await tracking;
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetcher).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
  it("chunks a batch to 50 IDs and drops tombstoned recipients without exposing unrelated rows", async () => {
    const emails = Array.from({ length: 51 }, (_, index) => ({
      ...email,
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    }));
    const fetcher = vi.fn(async (url: string) => {
      const ids =
        new URL(url, "https://example.test").searchParams.get("emailIds")?.split(",") ?? [];
      expect(ids.length).toBeLessThanOrEqual(50);
      return Response.json({
        view: "history",
        emails: [
          ...ids
            .filter((id) => id !== emails[0]?.id)
            .map((id) => ({ ...email, id, state: "sent" })),
          { ...email, id: "unrequested-id", state: "sent" },
        ],
      });
    });
    vi.stubGlobal("fetch", fetcher);
    let latest: AdminEmail[] = [];
    await refreshEmailStatuses(
      emails,
      (rows) => {
        latest = rows;
      },
      new AbortController().signal,
      true,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(latest).toHaveLength(50);
    expect(latest.map((row) => row.id)).toEqual(emails.slice(1).map((row) => row.id));
  });
  it("does not turn a failed status read into a resend or repeated network requests", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("Offline");
    });
    vi.stubGlobal("fetch", fetcher);
    const update = vi.fn();
    await expect(
      refreshEmailStatuses([email], update, new AbortController().signal, true),
    ).rejects.toThrow("Offline");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
  });
  it("aborts a stalled status read after ten seconds without replacing a known failure", async () => {
    vi.useFakeTimers();
    const failed = {
      ...email,
      state: "failed",
      lastError: "smtp_authentication_rejected",
      retryAllowed: true,
    };
    const controller = new AbortController();
    let transportSignal: AbortSignal | undefined;
    const fetcher = vi.fn(
      (_url: string, options: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          transportSignal = options.signal as AbortSignal;
          transportSignal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    let latest: AdminEmail[] = [failed];
    const tracking = refreshEmailStatuses(
      latest,
      (rows) => {
        latest = rows;
      },
      controller.signal,
      true,
    );
    // Observe the rejection before advancing timers, so a timeout cannot be an unhandled rejection.
    const result = tracking.catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(9999);
    expect(transportSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject({ name: "AbortError" });
    expect(transportSignal?.aborted).toBe(true);
    expect(controller.signal.aborted).toBe(false);
    expect(latest).toEqual([failed]);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
