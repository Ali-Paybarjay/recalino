"use client";
import type { AdminScreenProps } from "./AdminScreenProps";
import type { AdminRun } from "./contracts";
import { formatMoney } from "./model";
import { Badge, Button, Notice, Panel, Table } from "./primitives";

/** One explicitly selected class; no source content or provider payload is displayed. */
export function ProcessingReviewDetails({
  run,
  props,
}: {
  run: AdminRun;
  props: AdminScreenProps;
}) {
  const { t, locale, navigate, mode } = props;
  const costs = run.costs;
  return (
    <Panel title={run.title ?? t("Selected class processing", "پردازش کلاس انتخاب‌شده")}>
      <p>
        <Badge state={run.state} locale={locale} />{" "}
        {run.lastError ? <bdi>{run.lastError}</bdi> : null}
      </p>
      <p>
        {t("Run", "پردازش")}: <bdi>{run.id}</bdi>
      </p>
      {run.review?.requestedAt ? (
        <Notice>
          {t(
            "The learner requested review of this class's processing.",
            "کاربر بررسی پردازش این کلاس را درخواست کرده است.",
          )}
        </Notice>
      ) : null}
      {run.review?.state === "retrying" || run.review?.state === "resolved" ? (
        <Notice>
          {run.review.state === "resolved"
            ? t(
                "This class's processing has finished. The earlier failed attempt is preserved in the history.",
                "پردازش این کلاس تمام شده است. تلاش ناموفق قبلی در سابقه حفظ شده است.",
              )
            : t(
                "Processing is continuing for this class. The earlier failed attempt is preserved in the history.",
                "پردازش این کلاس در حال ادامه است. تلاش ناموفق قبلی در سابقه حفظ شده است.",
              )}
        </Notice>
      ) : null}
      {costs ? (
        <Table columns={[t("This class · USD", "این کلاس · دلار"), t("Amount", "مقدار")]}>
          {[
            [t("Actual charges", "هزینهٔ قطعی"), costs.actualMicros],
            [
              t("Estimated charges without a final bill", "هزینهٔ برآوردی بدون صورتحساب نهایی"),
              costs.estimatedMicros,
            ],
            [t("Open reservations", "رزروهای باز"), costs.reservedMicros],
            [t("Per-class spending limit", "سقف هزینهٔ هر کلاس"), costs.limitMicros],
          ].map(([label, amount]) => (
            <tr key={String(label)}>
              <td>{label}</td>
              <td>
                <bdi>{amount === null ? "—" : formatMoney(Number(amount), locale)}</bdi>
              </td>
            </tr>
          ))}
        </Table>
      ) : null}
      {costs?.unknownCount ? (
        <Notice warning>
          {t(
            "Unresolved provider charges must be reconciled before continuing.",
            "هزینه‌های نامعلوم سرویس باید پیش از ادامه بررسی شوند.",
          )}
        </Notice>
      ) : null}
      <p>
        {t(
          "Review the failure and any budget change before continuing. Saved extraction and permitted paid checkpoints are reused; unresolved provider work is never bypassed.",
          "پیش از ادامه، علت خطا و هر تغییر بودجه را بررسی کنید. استخراج ذخیره‌شده و مراحل پرداخت‌شدهٔ قابل استفاده حفظ می‌شوند؛ نتیجهٔ نامعلوم سرویس نادیده گرفته نمی‌شود.",
        )}
      </p>
      <div style={{ marginTop: 16 }}>
        {run.review?.runId && run.review.runId !== run.id ? (
          <Button onClick={() => navigate("processing", run.review?.runId)}>
            {t("Open this class's current processing", "بازکردن پردازش فعلی همین کلاس")}
          </Button>
        ) : null}
        {mode === "costs" ? (
          <Button onClick={() => navigate("processing", run.id)}>
            {t("Return to this processing review", "بازگشت به بررسی همین پردازش")}
          </Button>
        ) : (
          <Button onClick={() => navigate("costs", run.id)}>
            {t("Review this class's costs and limits", "بررسی هزینه و سقف همین کلاس")}
          </Button>
        )}
      </div>
    </Panel>
  );
}
