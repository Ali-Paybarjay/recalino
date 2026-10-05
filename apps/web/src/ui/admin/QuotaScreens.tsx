"use client";

import { useState } from "react";
import styles from "./Admin.module.css";
import type { AdminScreenProps } from "./AdminScreenProps";
import { dateLabel } from "./CoreScreens";
import type { AdminQuota, Dimension, PriceRate, QuotaAmounts } from "./contracts";
import { dimensionNames, stageNames, unitNames } from "./copy";
import {
  availableQuota,
  dimensions,
  displayQuota,
  dollarsToMicros,
  exactQuotaUnits,
  formatMoney,
  formatNumber,
  friendlyQuotaUnits,
  parseQuota,
  type QuotaUnitConfig,
  quotaFields,
  rateConfigurationProblem,
  switchQuotaFieldUnit,
} from "./model";
import { Badge, Button, Empty, Field, Notice, Panel, Table } from "./primitives";

const zero: QuotaAmounts = { audio: 0, document: 0, regeneration: 0, tts: 0, storage: 0 };
function QuotaTable({
  quota,
  props,
  proposed,
  units = friendlyQuotaUnits,
}: {
  quota: AdminQuota;
  props: AdminScreenProps;
  proposed?: QuotaAmounts;
  units?: QuotaUnitConfig;
}) {
  const { t, locale } = props;
  return (
    <Table
      columns={[
        t("Type", "نوع"),
        t("Allocated", "تخصیص"),
        t("Used", "مصرف"),
        t("Reserved", "رزرو"),
        t("Available", "قابل استفاده"),
        ...(proposed
          ? [t("New allocation", "تخصیص تازه"), t("New available", "قابل استفادهٔ تازه")]
          : []),
      ]}
    >
      {dimensions.map((dimension) => (
        <tr key={dimension}>
          <th scope="row">{quotaDimensionLabel(dimension, props, units)}</th>
          {(
            [
              ["allocated", quota.allocated[dimension]],
              ["consumed", quota.consumed[dimension]],
              ["reserved", quota.reserved[dimension]],
              ["available", quota.available[dimension]],
              ...(proposed
                ? [
                    ["proposed", proposed[dimension]],
                    [
                      "proposedAvailable",
                      availableQuota(
                        proposed[dimension],
                        quota.consumed[dimension],
                        quota.reserved[dimension],
                      ),
                    ],
                  ]
                : []),
            ] as [string, number][]
          ).map(([key, value]) => (
            <td key={key}>
              <bdi>{formatNumber(displayQuota(value, dimension, units), locale)}</bdi>
            </td>
          ))}
        </tr>
      ))}
    </Table>
  );
}
function quotaDimensionLabel(
  dimension: Dimension,
  props: AdminScreenProps,
  units: QuotaUnitConfig,
): string {
  if (dimension === "audio" && units.audio === "seconds")
    return props.t("Audio seconds", "ثانیهٔ صوت");
  if (dimension === "storage" && units.storage === "bytes")
    return props.t("Storage · bytes", "فضا · بایت");
  return dimensionNames[dimension][props.locale];
}
function UserQuota(props: AdminScreenProps) {
  const { data, t, locale, compose, navigate, act, busy, reload } = props;
  const user = data.user;
  const [editing, setEditing] = useState(false);
  const initialAmounts = data.quota?.allocated ?? data.pilot?.defaults ?? zero;
  const [units, setUnits] = useState<QuotaUnitConfig>(() => exactQuotaUnits(initialAmounts));
  const [values, setValues] = useState<Record<Dimension, string>>(() =>
    quotaFields(initialAmounts, exactQuotaUnits(initialAmounts)),
  );
  const [unitError, setUnitError] = useState(false);
  const [reason, setReason] = useState("");
  const [periodDays, setPeriodDays] = useState(String(data.pilot?.periodDays ?? 30));
  const [startsAt, setStartsAt] = useState(new Date().toISOString().slice(0, 16));
  const [review, setReview] = useState<QuotaAmounts | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [closing, setClosing] = useState(false);
  if (!user)
    return (
      <Empty>
        {t(
          "This account is unavailable. Reload the user list.",
          "این حساب در دسترس نیست. فهرست کاربران را دوباره بارگذاری کنید.",
        )}
      </Empty>
    );
  const existing = Boolean(data.quota?.entitlementId);
  const quota = data.quota ?? {
    entitlementId: null,
    allocated: zero,
    consumed: zero,
    reserved: zero,
    available: zero,
    startsAt: null,
    endsAt: null,
  };
  function prepare() {
    const amounts = parseQuota(values, units);
    const validPeriod =
      existing ||
      (Number.isSafeInteger(Number(periodDays)) &&
        Number(periodDays) > 0 &&
        Number.isFinite(Date.parse(`${startsAt}Z`)));
    setInvalid(!amounts || !reason.trim() || !validPeriod);
    if (amounts && reason.trim() && validPeriod) setReview(amounts);
  }
  function fillAmounts(amounts: QuotaAmounts) {
    const next = exactQuotaUnits(amounts, units);
    setUnits(next);
    setValues(quotaFields(amounts, next));
    setUnitError(false);
    setReview(null);
  }
  function changeUnits(dimension: "audio" | "storage", next: QuotaUnitConfig) {
    const converted = switchQuotaFieldUnit(values[dimension], dimension, units, next);
    if (converted === null) {
      setUnitError(true);
      return;
    }
    setUnits(next);
    setValues({ ...values, [dimension]: converted });
    setUnitError(false);
    setReview(null);
  }
  async function save() {
    if (!review) return;
    const input = existing
      ? { userId: user?.id, entitlementId: quota.entitlementId, amounts: review, reason }
      : {
          userId: user?.id,
          amounts: review,
          startsAt: new Date(`${startsAt}Z`).toISOString(),
          periodDays: Number(periodDays),
          reason,
        };
    const result = await act(
      existing ? "quota.set" : "pilot.grant",
      input,
      t("The allocation was saved.", "تخصیص سهمیه ذخیره شد."),
    );
    if (result) {
      setEditing(false);
      setReview(null);
      reload();
    }
  }
  return (
    <>
      <Panel title={user.name || t("Unnamed account", "حساب بدون نام")}>
        <bdi className={styles.muted}>{user.email ?? "—"}</bdi>
        <div className={styles.actions}>
          <Button primary onClick={() => compose([user.id])}>
            {t("Send email", "ارسال ایمیل")}
          </Button>
          <Button onClick={() => navigate("feedback")}>
            {t("Feedback inbox", "صندوق بازخورد")}
          </Button>
          <Button onClick={() => navigate("users")}>
            {t("Back to users", "بازگشت به کاربران")}
          </Button>
        </div>
      </Panel>
      <Panel title={t("Allowance for this account", "سهمیهٔ این حساب")}>
        {existing ? (
          <>
            <p className={styles.muted}>
              {t("Current period", "دورهٔ جاری")}: {dateLabel(quota.startsAt, locale)} —{" "}
              {dateLabel(quota.endsAt, locale)}
            </p>
            <QuotaTable quota={quota} props={props} units={units} />
            <p className={styles.help}>
              {t(
                "1 MiB = 1,048,576 bytes. Available excludes usage and open reservations.",
                "هر MiB برابر ۱٬۰۴۸٬۵۷۶ بایت است. مصرف و رزروهای باز از مقدار قابل استفاده کم می‌شوند.",
              )}
            </p>
          </>
        ) : (
          <Empty>
            {t(
              "No active allowance is assigned. Choose a custom allocation to admit this account to the pilot.",
              "سهمیهٔ فعالی تخصیص نیافته است. برای پذیرش این حساب در پایلوت، سهمیهٔ دلخواه تعیین کنید.",
            )}
          </Empty>
        )}
        <div className={styles.actions}>
          <Button
            primary
            onClick={() => {
              setEditing(true);
              setReview(null);
              fillAmounts(existing ? quota.allocated : (data.pilot?.defaults ?? zero));
            }}
          >
            {existing
              ? t("Adjust allocation", "تغییر تخصیص")
              : t("Admit to pilot", "پذیرش در پایلوت")}
          </Button>
          {existing && (
            <Button
              danger
              onClick={() => {
                setClosing(true);
                setReason("");
              }}
            >
              {t("Close allowance", "بستن سهمیه")}
            </Button>
          )}
        </div>
      </Panel>
      {editing && (
        <Panel
          title={
            existing
              ? t("Set any allocation for this user", "تخصیص دلخواه برای این کاربر")
              : t("Custom pilot allocation", "تخصیص سفارشی پایلوت")
          }
        >
          <Notice>
            {t(
              "Set each total independently. Presets only fill the form; they do not limit your allocation. Shared API budgets still apply.",
              "کل هر سهمیه را مستقل تعیین کنید. پیش‌فرض فقط فرم را پر می‌کند و سقف تخصیص نیست. بودجهٔ مشترک API همچنان اعمال می‌شود.",
            )}
          </Notice>
          {data.pilot && (
            <div className={styles.actions} style={{ marginBottom: 20 }}>
              <Button
                onClick={() => {
                  fillAmounts(data.pilot?.defaults ?? zero);
                }}
              >
                {t("Fill pilot preset", "پرکردن با پیش‌فرض پایلوت")}
              </Button>
            </div>
          )}
          <div className={styles.split}>
            <Field label={t("Audio entry unit", "واحد ورود صوت")}>
              <select
                disabled={busy}
                className={styles.select}
                value={units.audio}
                onChange={(e) =>
                  changeUnits("audio", {
                    ...units,
                    audio: e.target.value as QuotaUnitConfig["audio"],
                  })
                }
              >
                <option value="minutes">{t("Minutes", "دقیقه")}</option>
                <option value="seconds">{t("Seconds · exact", "ثانیه · دقیق")}</option>
              </select>
            </Field>
            <Field label={t("Storage entry unit", "واحد ورود فضا")}>
              <select
                disabled={busy}
                className={styles.select}
                value={units.storage}
                onChange={(e) =>
                  changeUnits("storage", {
                    ...units,
                    storage: e.target.value as QuotaUnitConfig["storage"],
                  })
                }
              >
                <option value="mib">MiB</option>
                <option value="bytes">{t("Bytes · exact", "بایت · دقیق")}</option>
              </select>
            </Field>
          </div>
          {unitError && (
            <Notice warning>
              {t(
                "This value cannot convert exactly. Correct the value first, or keep seconds/bytes for precise entry. Your current value is preserved.",
                "این مقدار دقیق تبدیل نمی‌شود. ابتدا مقدار را اصلاح کنید یا برای ورود دقیق از ثانیه و بایت استفاده کنید. مقدار فعلی شما حفظ می‌شود.",
              )}
            </Notice>
          )}
          <div className={styles.split}>
            {dimensions.map((dimension) => (
              <Field
                key={dimension}
                label={quotaDimensionLabel(dimension, props, units)}
                help={
                  dimension === "storage"
                    ? units.storage === "mib"
                      ? t("1 MiB = 1,048,576 bytes", "هر MiB برابر ۱٬۰۴۸٬۵۷۶ بایت است")
                      : t("Whole bytes", "بایتِ صحیح")
                    : dimension === "audio"
                      ? units.audio === "minutes"
                        ? t(
                            "60 seconds per minute. Use seconds for exact entry.",
                            "هر دقیقه ۶۰ ثانیه است. برای ورود دقیق، ثانیه را انتخاب کنید.",
                          )
                        : t("Whole seconds", "ثانیهٔ صحیح")
                      : undefined
                }
              >
                <input
                  type="number"
                  min="0"
                  step={
                    (dimension === "audio" && units.audio === "minutes") ||
                    (dimension === "storage" && units.storage === "mib")
                      ? "any"
                      : "1"
                  }
                  disabled={busy}
                  required
                  className={styles.input}
                  dir="ltr"
                  value={values[dimension]}
                  onChange={(e) => {
                    setValues({ ...values, [dimension]: e.target.value });
                    setReview(null);
                    setUnitError(false);
                  }}
                />
              </Field>
            ))}
          </div>
          {!existing && (
            <div className={styles.split}>
              <Field label={t("Start, UTC", "شروع، UTC")}>
                <input
                  type="datetime-local"
                  className={styles.input}
                  dir="ltr"
                  value={startsAt}
                  onChange={(e) => {
                    setStartsAt(e.target.value);
                    setReview(null);
                  }}
                />
              </Field>
              <Field label={t("Period, days", "دوره، روز")}>
                <input
                  type="number"
                  min="1"
                  step="1"
                  className={styles.input}
                  dir="ltr"
                  value={periodDays}
                  onChange={(e) => {
                    setPeriodDays(e.target.value);
                    setReview(null);
                  }}
                />
              </Field>
            </div>
          )}
          <Field label={t("Reason for this allocation", "دلیل این تخصیص")}>
            <input
              required
              className={styles.input}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setReview(null);
              }}
            />
          </Field>
          {invalid && (
            <Notice error>
              {t(
                "Enter nonnegative finite values with exact units and a reason. Pages, requests and characters must be whole numbers.",
                "مقدار نامنفی و متناهی با واحد دقیق و دلیل وارد کنید. صفحه، درخواست و نویسه باید عدد صحیح باشند.",
              )}
            </Notice>
          )}
          <div className={styles.actions}>
            <Button primary onClick={prepare} disabled={busy}>
              {t("Review allocation", "بازبینی تخصیص")}
            </Button>
            <Button
              onClick={() => {
                setEditing(false);
                setReview(null);
              }}
            >
              {t("Cancel", "انصراف")}
            </Button>
          </div>
          {review && (
            <div style={{ marginTop: 24 }}>
              <h3>{t("Review before saving", "پیش از ذخیره بررسی کنید")}</h3>
              <QuotaTable quota={quota} props={props} proposed={review} units={units} />
              {dimensions.some(
                (key) => review[key] < quota.consumed[key] + quota.reserved[key],
              ) && (
                <Notice warning>
                  {t(
                    "This allocation is below current usage or reservations. New use in affected dimensions pauses. Existing results, usage and reservations are preserved.",
                    "این تخصیص کمتر از مصرف یا رزرو فعلی است. استفادهٔ تازه در بُعد مربوط متوقف می‌شود. نتیجه‌ها، مصرف و رزروهای قبلی حفظ می‌شوند.",
                  )}
                </Notice>
              )}
              <div className={styles.actions}>
                <Button
                  primary
                  disabled={busy}
                  onClick={() => {
                    void save();
                  }}
                >
                  {t("Confirm & save allocation", "تأیید و ذخیرهٔ تخصیص")}
                </Button>
                <Button onClick={() => setReview(null)}>
                  {t("Edit values", "ویرایش مقدارها")}
                </Button>
              </div>
            </div>
          )}
        </Panel>
      )}
      {closing && (
        <Panel title={t("Close this allowance", "بستن این سهمیه")}>
          <Notice warning>
            {t(
              "New use is stopped. Existing results, usage and history are preserved.",
              "استفادهٔ تازه متوقف می‌شود. نتیجه‌ها، مصرف و تاریخچهٔ قبلی حفظ می‌شوند.",
            )}
          </Notice>
          <Field label={t("Reason", "دلیل")}>
            <input
              className={styles.input}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <div className={styles.actions}>
            <Button
              danger
              disabled={busy || !reason.trim()}
              onClick={() => {
                void act(
                  "quota.close",
                  { userId: user.id, entitlementId: quota.entitlementId, reason },
                  t("Allowance closed.", "سهمیه بسته شد."),
                ).then((result) => {
                  if (result) {
                    setClosing(false);
                    reload();
                  }
                });
              }}
            >
              {t("Confirm closure", "تأیید بستن")}
            </Button>
            <Button onClick={() => setClosing(false)}>{t("Cancel", "انصراف")}</Button>
          </div>
        </Panel>
      )}
    </>
  );
}
function Pilot(props: AdminScreenProps) {
  const { data, t, locale, busy, act, reload, navigate } = props;
  const pilot = data.pilot;
  const [capacity, setCapacity] = useState(String(pilot?.capacity ?? ""));
  const [reason, setReason] = useState("");
  const [review, setReview] = useState(false);
  const [invalid, setInvalid] = useState(false);
  if (!pilot)
    return <Empty>{t("Pilot policy is not configured.", "سیاست پایلوت تنظیم نشده است.")}</Empty>;
  const value = Number(capacity);
  return (
    <Panel title={t("Admission capacity", "ظرفیت پذیرش")}>
      <div className={styles.grid}>
        <div>
          <small className={styles.muted}>{t("Historical admissions", "پذیرش‌های تاریخی")}</small>
          <div className={styles.metric}>{formatNumber(pilot.admitted, locale)}</div>
        </div>
        <div>
          <small className={styles.muted}>{t("Active allowances", "سهمیه‌های فعال")}</small>
          <div className={styles.metric}>{formatNumber(pilot.active, locale)}</div>
        </div>
        <div>
          <small className={styles.muted}>{t("Current capacity", "ظرفیت فعلی")}</small>
          <div className={styles.metric}>{formatNumber(pilot.capacity, locale)}</div>
        </div>
      </div>
      <Field
        label={t("Maximum admissions", "حداکثر پذیرش")}
        help={t(
          "Any nonnegative whole number. Zero pauses new admissions.",
          "هر عدد صحیح نامنفی؛ صفر پذیرش تازه را متوقف می‌کند.",
        )}
      >
        <input
          type="number"
          min="0"
          step="1"
          className={styles.input}
          dir="ltr"
          value={capacity}
          onChange={(e) => {
            setCapacity(e.target.value);
            setReview(false);
          }}
        />
      </Field>
      <Field label={t("Reason for change", "دلیل تغییر")}>
        <input
          className={styles.input}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setReview(false);
          }}
        />
      </Field>
      {invalid && (
        <Notice error>
          {t("Enter a nonnegative whole number and a reason.", "عدد صحیح نامنفی و دلیل وارد کنید.")}
        </Notice>
      )}
      <div className={styles.actions}>
        <Button
          primary
          disabled={busy}
          onClick={() => {
            const valid =
              capacity.trim() && Number.isSafeInteger(value) && value >= 0 && reason.trim();
            setInvalid(!valid);
            setReview(Boolean(valid));
          }}
        >
          {t("Review capacity change", "بازبینی تغییر ظرفیت")}
        </Button>
        <Button onClick={() => navigate("users")}>{t("Back to users", "بازگشت به کاربران")}</Button>
      </div>
      {review && (
        <div style={{ marginTop: 24 }}>
          <Notice warning={value <= pilot.admitted}>
            <strong>
              <bdi>
                {formatNumber(pilot.capacity, locale)} → {formatNumber(value, locale)}
              </bdi>
            </strong>
            <p>
              {value <= pilot.admitted
                ? t(
                    "New admissions will pause. Existing accounts, allowance and history stay intact.",
                    "پذیرش تازه متوقف می‌شود. حساب‌ها، سهمیه‌ها و تاریخچهٔ موجود حفظ می‌شوند.",
                  )
                : `${formatNumber(value - pilot.admitted, locale)} ${t("places will be available.", "جایگاه آزاد خواهد بود.")}`}
            </p>
            <p>{t("The shared API budget does not change.", "بودجهٔ مشترک API تغییر نمی‌کند.")}</p>
          </Notice>
          <Button
            primary
            disabled={busy}
            onClick={() => {
              void act(
                "pilot.configure",
                { capacity: value, reason },
                t("Pilot capacity saved.", "ظرفیت پایلوت ذخیره شد."),
              ).then((result) => {
                if (result) {
                  setReview(false);
                  reload();
                }
              });
            }}
          >
            {t("Confirm & save capacity", "تأیید و ذخیرهٔ ظرفیت")}
          </Button>
        </div>
      )}
    </Panel>
  );
}
function Rates(props: AdminScreenProps) {
  const { data, t, locale, act, busy, reload } = props;
  const [rates, setRates] = useState<PriceRate[]>(data.rates ?? []);
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(
      (data.rates ?? []).map((rate) => [rate.id, String(rate.rateMicros / 1_000_000)]),
    ),
  );
  const [reason, setReason] = useState("");
  const [review, setReview] = useState<PriceRate[] | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [rateProblem, setRateProblem] = useState<"duplicate" | "ambiguous" | null>(null);
  function change(id: string, update: Partial<PriceRate>) {
    setRates(rates.map((rate) => (rate.id === id ? { ...rate, ...update } : rate)));
    setReview(null);
  }
  function prepare() {
    const problem = rateConfigurationProblem(rates);
    setRateProblem(problem);
    const converted = rates.map((rate) => ({
      ...rate,
      model: rate.model.trim(),
      rateMicros: dollarsToMicros(values[rate.id] ?? ""),
    }));
    const valid =
      rates.length > 0 &&
      !problem &&
      reason.trim() &&
      converted.every((rate) => rate.model.trim() && rate.rateMicros !== null);
    setInvalid(!valid);
    if (valid) setReview(converted as PriceRate[]);
  }
  return (
    <Panel title={t("Versioned estimate rates", "نرخ‌های برآورد نسخه‌دار")}>
      <Notice>
        {t(
          "Rates affect future estimates. Actual costs, previous records and safety reservations stay intact. Choose the unit actually charged for each model; avoid charging pages and tokens twice.",
          "نرخ‌ها بر برآوردهای آینده اثر دارند. هزینهٔ قطعی، سوابق قبلی و رزرو ایمن حفظ می‌شوند. واحد واقعی هر مدل را انتخاب کنید؛ صفحه و توکن را دوبار حساب نکنید.",
        )}
      </Notice>
      <p className={styles.muted}>
        {t("Active version", "نسخهٔ فعال")}: <bdi>{data.rateVersion ?? "—"}</bdi>
      </p>
      {rates.map((rate) => (
        <div key={rate.id} className={styles.panel}>
          <div className={styles.split}>
            <Field label={t("Stage", "مرحله")}>
              <select
                className={styles.select}
                value={rate.stage}
                onChange={(e) => change(rate.id, { stage: e.target.value as PriceRate["stage"] })}
              >
                {Object.entries(stageNames).map(([key, name]) => (
                  <option value={key} key={key}>
                    {name[locale]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("Provider / model", "سرویس / مدل")}>
              <input
                className={styles.input}
                dir="ltr"
                value={rate.model}
                onChange={(e) => change(rate.id, { model: e.target.value })}
              />
            </Field>
            <Field label={t("Rate unit", "واحد نرخ")}>
              <select
                className={styles.select}
                value={rate.unit}
                onChange={(e) => change(rate.id, { unit: e.target.value as PriceRate["unit"] })}
              >
                {Object.entries(unitNames).map(([key, name]) => (
                  <option value={key} key={key}>
                    {name[locale]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={unitNames[rate.unit][locale]}>
              <input
                type="number"
                min="0"
                step="0.000001"
                className={styles.input}
                dir="ltr"
                value={values[rate.id] ?? ""}
                onChange={(e) => {
                  setValues({ ...values, [rate.id]: e.target.value });
                  setReview(null);
                }}
              />
            </Field>
          </div>
          <Button
            danger
            onClick={() => {
              setRates(rates.filter((item) => item.id !== rate.id));
              setReview(null);
            }}
          >
            {t("Remove rate", "حذف نرخ")}
          </Button>
        </div>
      ))}
      <Button
        onClick={() => {
          const id = crypto.randomUUID();
          setRates([
            ...rates,
            { id, stage: "generation", model: "", unit: "input_million_tokens", rateMicros: 0 },
          ]);
          setValues({ ...values, [id]: "" });
          setReview(null);
        }}
      >
        {t("Add a rate", "افزودن نرخ")}
      </Button>
      <div style={{ marginTop: 20 }}>
        <Field label={t("Reason for rate revision", "دلیل نسخهٔ تازهٔ نرخ")}>
          <input
            className={styles.input}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setReview(null);
            }}
          />
        </Field>
      </div>
      {invalid && (
        <Notice error>
          {t(
            "Add a model and a nonnegative USD rate for every row, and explain the revision.",
            "برای هر ردیف مدل و نرخ دلار نامنفی وارد کنید و دلیل نسخهٔ تازه را بنویسید.",
          )}
          {rateProblem && (
            <p>
              {rateProblem === "duplicate"
                ? t(
                    "Use only one rate for each stage, model and unit.",
                    "برای هر مرحله، مدل و واحد فقط یک نرخ تعریف کنید.",
                  )
                : t(
                    "Choose one billing basis for each stage and model. Input and output token rates can be paired; pages, minutes and characters cannot be combined with another basis.",
                    "برای هر مرحله و مدل یک مبنای قیمت انتخاب کنید. نرخ توکن ورودی و خروجی می‌توانند کنار هم باشند؛ صفحه، دقیقه و نویسه با مبنای دیگری ترکیب نمی‌شوند.",
                  )}
            </p>
          )}
        </Notice>
      )}
      <Button primary disabled={busy} onClick={prepare}>
        {t("Review rate changes", "بازبینی تغییر نرخ")}
      </Button>
      {review && (
        <div style={{ marginTop: 24 }}>
          <Table columns={[t("Model / unit", "مدل / واحد"), t("Before", "قبل"), t("After", "بعد")]}>
            {review.map((rate) => (
              <tr key={rate.id}>
                <td>
                  <bdi>{rate.model}</bdi>
                  <br />
                  {unitNames[rate.unit][locale]}
                </td>
                <td>
                  <bdi>
                    {data.rates?.find((item) => item.id === rate.id)
                      ? formatMoney(
                          data.rates.find((item) => item.id === rate.id)?.rateMicros ?? 0,
                          locale,
                        )
                      : "—"}
                  </bdi>
                </td>
                <td>
                  <bdi>{formatMoney(rate.rateMicros, locale)}</bdi>
                </td>
              </tr>
            ))}
          </Table>
          <div className={styles.actions}>
            <Button
              primary
              disabled={busy}
              onClick={() => {
                void act(
                  "pricing.save",
                  { rates: review, reason },
                  t("Rate version saved.", "نسخهٔ نرخ ذخیره شد."),
                ).then((result) => {
                  if (result) {
                    setReview(null);
                    reload();
                  }
                });
              }}
            >
              {t("Activate rate version", "فعال‌کردن نسخهٔ نرخ")}
            </Button>
            <Button onClick={() => setReview(null)}>{t("Edit rates", "ویرایش نرخ‌ها")}</Button>
          </div>
        </div>
      )}
    </Panel>
  );
}
function Costs(props: AdminScreenProps) {
  const { data, t, locale, navigate, busy, act, reload } = props;
  const costs = data.costs;
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(costs?.limits ?? {}).map(([key, value]) => [key, String(value / 1_000_000)]),
    ),
  );
  const [stop, setStop] = useState(costs?.killSwitch ?? false);
  const [reason, setReason] = useState("");
  const [review, setReview] = useState<Record<string, number> | null>(null);
  const [invalid, setInvalid] = useState(false);
  const limits: ["session" | "userMonth" | "systemDay" | "systemMonth", string][] = [
    ["session", t("Per class session", "هر جلسهٔ کلاس")],
    ["userMonth", t("User / UTC month", "کاربر / ماه UTC")],
    ["systemDay", t("Project / UTC day", "پروژه / روز UTC")],
    ["systemMonth", t("Project / UTC month", "پروژه / ماه UTC")],
  ];
  if (!costs)
    return (
      <Empty>
        {t(
          "Cost policy is not configured. No spending figures are assumed.",
          "سیاست هزینه تنظیم نشده است. عدد مصرف فرضی نمایش داده نمی‌شود.",
        )}
      </Empty>
    );
  return (
    <>
      <div className={`${styles.grid} ${styles.metrics}`}>
        {[
          [t("Actual charges", "هزینهٔ قطعی"), costs.actualMicros],
          [t("Estimates", "برآورد"), costs.estimatedMicros],
          [t("Reserved", "رزرو"), costs.reservedMicros],
        ].map(([name, value]) => (
          <Panel key={String(name)} title={String(name)}>
            <div className={styles.metric}>
              <bdi>{formatMoney(Number(value), locale)}</bdi>
            </div>
          </Panel>
        ))}
      </div>
      {costs.unknownCount > 0 && (
        <Notice warning>
          {formatNumber(costs.unknownCount, locale)}{" "}
          {t(
            "provider outcomes are unknown. They remain separate until reconciled and are never treated as free.",
            "نتیجهٔ سرویس نامعلوم است. تا روشن‌شدن نتیجه جدا می‌ماند و رایگان حساب نمی‌شود.",
          )}
        </Notice>
      )}
      <Panel title={t("Budget limits", "سقف بودجه")}>
        <div className={styles.split}>
          {limits.map(([key, name]) => (
            <Field key={key} label={`${name} · USD`}>
              <input
                type="number"
                min="0"
                step="0.000001"
                className={styles.input}
                dir="ltr"
                value={values[key] ?? ""}
                onChange={(e) => {
                  setValues({ ...values, [key]: e.target.value });
                  setReview(null);
                }}
              />
            </Field>
          ))}
        </div>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            className={styles.check}
            checked={stop}
            onChange={(e) => {
              setStop(e.target.checked);
              setReview(null);
            }}
          />
          {t("Pause new AI calls", "توقف تماس‌های تازهٔ AI")}
        </label>
        <p className={styles.help}>
          {t(
            "Recording already underway is not interrupted. Price estimates and individual allowances are separate from these budgets.",
            "ضبط فعال قطع نمی‌شود. برآورد قیمت و سهمیهٔ فردی از این بودجه‌ها مستقل‌اند.",
          )}
        </p>
        <Field label={t("Reason", "دلیل")}>
          <input
            className={styles.input}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setReview(null);
            }}
          />
        </Field>
        {invalid && (
          <Notice error>
            {t("Enter valid USD values and a reason.", "مقدار معتبر دلار و دلیل وارد کنید.")}
          </Notice>
        )}
        <div className={styles.actions}>
          <Button
            primary
            disabled={busy}
            onClick={() => {
              const converted = Object.fromEntries(
                limits.map(([key]) => [key, dollarsToMicros(values[key] ?? "")]),
              );
              const valid =
                reason.trim() && Object.values(converted).every((value) => value !== null);
              setInvalid(!valid);
              if (valid) setReview(converted as Record<string, number>);
            }}
          >
            {t("Review budget change", "بازبینی تغییر بودجه")}
          </Button>
          <Button onClick={() => navigate("rates")}>
            {t("Edit API estimates", "تنظیم برآورد API")}
          </Button>
        </div>
        {review && (
          <div style={{ marginTop: 24 }}>
            <Table columns={[t("Scope", "محدوده"), t("Before", "قبل"), t("After", "بعد")]}>
              {limits.map(([key, name]) => (
                <tr key={key}>
                  <td>{name}</td>
                  <td>
                    <bdi>{formatMoney(costs.limits[key as keyof typeof costs.limits], locale)}</bdi>
                  </td>
                  <td>
                    <bdi>{formatMoney(review[key] ?? 0, locale)}</bdi>
                  </td>
                </tr>
              ))}
            </Table>
            <p>
              <Badge state={stop ? "inactive" : "active"} locale={locale} />{" "}
              {t("AI calls", "تماس‌های AI")}
            </p>
            <Button
              primary
              disabled={busy}
              onClick={() => {
                void act(
                  "cost.configure",
                  { limits: review, killSwitch: stop, reason },
                  t("Budget policy saved.", "سیاست بودجه ذخیره شد."),
                ).then((result) => {
                  if (result) {
                    setReview(null);
                    reload();
                  }
                });
              }}
            >
              {t("Confirm budget change", "تأیید تغییر بودجه")}
            </Button>
          </div>
        )}
      </Panel>
    </>
  );
}
export function QuotaScreens(props: AdminScreenProps) {
  if (props.mode === "user") return <UserQuota key={props.data.user?.id} {...props} />;
  if (props.mode === "pilot") return <Pilot {...props} />;
  if (props.mode === "rates") return <Rates {...props} />;
  if (props.mode === "costs") return <Costs {...props} />;
  return null;
}
