# پرامپت کامل ادامهٔ مهاجرت Haiku 5.5 برای Claude Code

این فایل را به‌عنوان دستور ادامهٔ کار بخوان. مالک محصول خواسته است کارهای Codex را بررسی کنی، هرجا لازم بود اصلاح کنی و کار مهاجرت را ادامه بدهی. نتیجهٔ فعلی **آمادهٔ انتشار نیست**؛ قبولی آزمون فنی و معتبر بودن JSON را به‌جای کیفیت آموزش اعلام نکن.

## هدف و اولویت مالک محصول

Recalino باید در Class Notes مانند یک معلم خصوصیِ مهربان، متناسب با زمینهٔ اعلام‌شدهٔ زبان‌آموز، از Material و transcript کلاس درس و فلش‌کارت بسازد. MVP باید کم‌هزینه بماند. مدل پیشنهادی متن `anthropic/claude-haiku-5.5` است؛ صرف تغییر ID کافی نیست. سیستم فعلی یک pipeline محدود است و عامل‌های زمان اجرا به محصول اضافه نشده‌اند. نقش‌های موازیِ Codex فقط برای توسعه و ارزیابی بودند.

مالک محصول ابتدا انجام مهاجرت را مجاز کرد؛ اکنون صریحاً خواسته است وضعیت ثبت شود و Claude Code ادامه دهد و همهٔ تغییرها را بررسی و اصلاح کند. تنظیم production یا دادهٔ ابری تغییر نکرده است. آزمون‌ها نشان داده‌اند فعال‌سازی فوری 5.5 قابل توصیه نیست. مدل فعلی production باید تا عبور از دروازه‌های لازم حفظ شود. این نتیجه ادعا نمی‌کند 4.5 در آزمون تازه کیفیت بهتری دارد؛ A/B تازهٔ کور انجام نشده است.

## محل دقیق کار؛ ابتدا این را بررسی کن

- checkout مشترک و محل credential موجود: `D:\Claude Projects\Recalino`.
- **محل تمام کدهای این مهاجرت:** `C:\Users\Ali-PC\.codex\worktrees\haiku55-migration\Recalino`.
- برنچ: `codex/haiku55-migration`.
- مبنای نهایی: `9d3fa4e301d4d420385546c6a8acd9ce0dfaf10f`، برنچ منتشرشدهٔ `codex/allowance-recovery`.
- مبنای اولیه `a80fb14` بود. پس از بررسی deployment فعال، برنچ مهاجرت با مبنای جدید fast-forward و تغییر worker با merge سه‌طرفه حفظ شد. آماده‌سازی دسته‌ای PDF، آپلود پس‌زمینه، اعلان‌ها و اصلاح تفکیک اعتبار کاربر از سقف هزینهٔ سرویس در آن باقی مانده‌اند.
- checkout مشترک دارای تغییرهای کارهای دیگر است؛ هیچ‌کدام را reset، حذف، stage یا commit نکن. کار را فقط در worktree بالا ادامه بده. آن worktree را archive نکن.

```powershell
Set-Location -LiteralPath 'C:\Users\Ali-PC\.codex\worktrees\haiku55-migration\Recalino'
git status --short
git branch --show-current
git log -3 --oneline
```

ابتدا `CLAUDE.md`، `docs/PROJECT_SPEC.md`، طرح `docs/plans/HAIKU55_MIGRATION_2026-10-08.md` و سند `docs/design/HAIKU55_MIGRATION_2026-10-08.md` را بخوان. تغییر D/FR/ADR یا سرویس/بستهٔ تازه را خودسرانه تصویب نکن. migration مدل، dependency یا migration دیتابیس تازه ایجاد نکرده است؛ دو migration آپلود/اعلان در مبنای production از کار قبلی آمده‌اند.

## وضعیت Git و آزمون هنگام تحویل

کد به‌صورت WIP روی برنچ ایزوله حفظ شده است. checkpoint محلی با پیام `WIP: checkpoint Haiku 5.5 migration and Claude handoff` در Git ثبت می‌شود؛ SHA نهایی را از `git log` و `HANDOFF_STATE.json` بررسی کن. مبنای patch، 9d3fa4e است. push، PR، merge، deployment یا تغییر runtime انجام نشده است. برای ثبتِ قابل بازیابی، patch کامل فایل‌های modified/new و snapshot فایل‌ها، همراه با manifestِ hashها و شواهد، در `D:\Claude Projects\Recalino\artifacts\verification\haiku55-codex-handoff` ذخیره شده‌اند. `HANDOFF_STATE.json` مشخصات واقعی snapshot و وضعیت آزمون هنگام تحویل را دارد. منبع اصلی ادامه همان worktree ایزوله است؛ بستهٔ بازیابی را روی checkout مشترک apply نکن.

- `pnpm verify` نهایی: **موفق، exit 0**؛ lint، typecheck همهٔ بسته‌ها و tools و بررسی مرزها موفق شدند. Vitest: **267 فایل موفق، 1 فایل اختیاری skip؛ 2823 آزمون موفق، 1 اختیاری skip؛ صفر شکست**. مدت Vitest=1233.39s و شروع آن `2026-10-08 12:00:30 UTC` بود. log نهایی در `artifacts/verification/haiku55-verify-final-frozen.log` است. این آزمون از قبل شروع‌شده هنگام آماده‌سازی handoff تمام شد؛ فراخوان AI یا آزمایش تازه پس از درخواست handoff اجرا نشده است.
- build نهاییِ همین کد و مبنای production: **موفق**؛ `artifacts/verification/haiku55-build-current-production-base.log`.
- `pnpm check:client-bundle`: **موفق**، بدون secret در خروجی client.
- ۱۵ آزمون integration جدید worker: موفق؛ `artifacts/verification/haiku55-worker-schema-recovery.log`.
- ۴۷ آزمون generation: موفق؛ core TypeScript و Biome نیز موفق.
- آزمون‌های provider/ops/defaults متمرکز: ۱۱۳ موفق در مرحلهٔ پیشین؛ renderer/multilingual/export: ۲۳۷ موفق؛ کنترل harness/quality/scope: ۲۵ موفق. این شمارهای متمرکز را با شمار نهایی کل suite جمع نزن؛ اشتراک دارند.
- E2E مرورگرِ تازه برای این مهاجرت اجرا نشده است. UI React تازه ساخته نشده؛ تغییر نمایش فقط افزودن note موجودِ recognition به HTML مورد اعتماد Class Notes است.
- تنها skip پیش‌فرض suite، backup drill اختیاریِ موجود است؛ آزمون شکست‌خورده‌ای برای گرفتن نتیجهٔ سبز حذف یا skip نشده است.

verify نهاییِ Codex تمام شده است؛ فایل log متعلق به همین worktree و پایگاه 55322 است. همهٔ processهای node یا stackهای Docker دیگر را متوقف نکن؛ کارهای موازی فعال‌اند. بعد از هر اصلاح لازم، روی نسخهٔ تازه آزمون مناسب و بررسی نهایی اجرا شود. آزمون‌های قطعیِ موفق به‌تنهایی مجوز انتشار مدل با gate کیفیت شکست‌خورده نیستند.

دورهای کامل قدیمی را نهایی معرفی نکن: یک run با چند worker به state مشترک fixtureها برخورد کرد؛ یک run هم هنگام تغییر کد، تست جدید را با transform cache قدیمی اجرا کرد. دو آزمون `priv/media` در دیتابیسِ دارای jobهای قبلی شکست خوردند. run در حال اصلاح صریحاً متوقف شد؛ دیتابیس محلیِ ایزوله برای run نهایی reset شد. تست‌های production را برای پنهان‌کردن این وضعیت ضعیف نکن. اجرای نهایی با `VITEST_MAX_WORKERS=1` و بدون build هم‌زمان با integration شروع شده است.

## چه چیزهایی پیاده‌سازی شده است

### Provider و تنظیمات

`config/openrouter-defaults.json` در **برنچ پیشنهادی** مدل متن 5.5، نسخهٔ `openrouter-2026-10-08-1` و prompt `recalino-knowledge-5` دارد. این فایل به‌تنهایی runtime فعال را عوض نمی‌کند؛ `apps/web/src/server/ai.ts` مقدار `OPENROUTER_SETTINGS_JSON` را می‌خواند. این proposal را بی‌توجه به gate شکست‌خورده منتشر نکن.

- بودجهٔ محتوای درس 6144؛ override دقیق 5.5 سقف فیزیکی 12000 شامل reasoning، effort `low`، کل body حداکثر 400000 بایت UTF-8 و `structuredOutputMode=json_object` دارد.
- برای 5.5 temperature ارسال نمی‌شود؛ رفتار مدل‌های دیگر و snapshot قدیمی حفظ شده است.
- privacy همچنان `zdr=true`، `data_collection=deny` و `require_parameters=true` است.
- body کامل شامل system/schema/input پیش از HTTP محدود می‌شود؛ تصاویر تحت این bound متنی پذیرفته نمی‌شوند.
- hold موجود هر درخواست 300000 میکرو‌دلار باقی مانده؛ با نرخ catalog بررسی‌شدهٔ tier بلند و premium منطقه‌ای، شاهد body/output برابر 0.253 دلار است. این نرخ شاهد نسخه‌دار است، نه تضمین نرخ دائمی یا عدد ثابت در runtime.
- vision همچنان 4.5، STT/TTS و صدای تلفظ همان تنظیمات قبلی‌اند.
- mode غایب یا `json_schema` رفتار قبلی دارد. 5.5 مستقیم از transport JSON موجود استفاده می‌کند؛ یک generation یک HTTP دارد. خطای native شناخته‌شده در مدل‌های دیگر همچنان fallback سابق با operation key جدا دارد.

سه شکل schema native روی مسیر ZDR با `compiled grammar is too large` رد شدند؛ schema کوچک روی همان مسیر موفق شد و Anthropic/Azure اختصاصی با این privacy endpoint واجد شرایط نداشتند. privacy کاهش نیافت. **پشتیبانی native schema ادعا نمی‌شود**؛ همهٔ local Zod/LKM validators حفظ شده‌اند.

### DTO، شواهد و server assembly

فایل‌های جدید `packages/core/src/proc/knowledge-evidence.ts`، `knowledge-generation.ts` و `knowledge-generation-step.ts` هستند. builder همان کدی است که هم worker و هم QA واقعی استفاده می‌کنند.

- source text کامل و locator بومی حفظ می‌شوند؛ enum محدود `rN` به شواهد دقیق اشاره می‌کند. کلید ساختگی/خالی یا ref نامعتبر رد می‌شود؛ ادعای مشترک به همهٔ شواهد ضروری نیاز دارد.
- wire نسخهٔ `knowledge_generation_keys_v3` شامل ۶ گروه هر learning item و ۴ گروه Class Notes است؛ سه branch lexical/grammar/recognition الزام‌های نوع و زبان را صریح دارند.
- همهٔ propertyها لازم‌اند. sentinel دقیق `""`/`[]` فقط برای بخش نامرتبط/غایب مجاز است؛ فیلد محتوایی لازم غیرخالی است. content واقعیِ اشتباه در فیلد نامرتبط حذف نمی‌شود، بلکه رد می‌شود.
- lexical سؤال cloze مطابق جملهٔ کامل؛ grammar prompt و جواب همان عمل/subject/tense؛ recognition فقط مثال درست و قابل استفاده دارد. `practice.example` برای production باید دقیقاً خالی باشد.
- در فارسی IPA و تقریب فارسیِ production اجباری‌اند؛ تقریب فارسی فقط Arabic/Common/Inherited است. IPA/Latin داخل تقریب رد می‌شود. در زبان توضیح غیر فارسی، faApprox دقیقاً خالی است. canonical validator زبان ضعیف نشده است.
- UUIDها، SourceRef، origin/creation، speakerRole=unknown، زبان، تاریخ/course، طبقه‌بندی و extraction coverage، source label و practice projection روی سرور ساخته می‌شوند.
- نقش `user_notes`، اسم گوینده، نقل‌قول چاپی و anonymous transcript اثبات مالکیت زبان‌آموز نیست. بدون تأیید معتبر handwriting، mistakes.noteFa/items و learnerAnswer باید خالی باشند. snapshot فعلی چنین اثباتی ندارد؛ از filename/role آن را حدس نزن.
- Class Notes recognition اکنون note موجود را با escaping و جهت زبان درست نشان می‌دهد. source-label انگلیسیِ fallback D31 فقط برای label دقیق و منشأ متناظر مجاز است.

### Worker، checkpoint و هزینه

مسیر DTO تازه فقط برای ID دقیق 5.5 فعال است؛ 4.5 و rollback قرارداد قبلی را دارند. builder قبل از رزرو hold اجرا می‌شود.

- canonical response پیش از بررسی معنایی checkpoint می‌شود؛ accounting پاسخ پولی با خطای assembly نیز حفظ می‌شود.
- پاسخ بریدهٔ معلوم marker `knowledge:truncated` و یک compact recovery دارد.
- پاسخ ساختاریِ نامعتبرِ اولیه، فقط با accounting معلوم و فقط برای 5.5، در همان تراکنشِ تسویه marker `knowledge:schema-invalid` می‌سازد. job بعدی یک regeneration از منابع اصلی با بودجهٔ کامل و diagnostic `provider_schema_invalid` انجام می‌دهد؛ checkpoint محدود `knowledge:repair` و canonical knowledge/context را ثبت می‌کند.
- پاسخ دومِ ساختاری/معنایی نامعتبر یا بریده، پایان صریح است؛ generation سوم ممنوع است. اختلاف جمله از targeted study repair موجود استفاده می‌کند و از سقف دو پرداخت عبور نمی‌کند.
- unknown outcome یا نبود accounting خودکار تکرار نمی‌شود؛ hold نامعلوم بدون مدرک آزاد نمی‌شود. started/uncertain attempt در resume محافظت می‌شود.
- هیچ quota، ID، دسترسی، موعد SRS یا idempotency به LLM واگذار نشده است.

## نتیجهٔ واقعی نهایی؛ مهم‌ترین مانع ادامه

آزمون ۱۴ اجرای مصنوعی = ۱۲ درس متمایز + تکرار H04/H06 است. همهٔ inputها/قواعد/قیمت‌ها hash شدند؛ expected answer keys به ورودی مدل project نشدند. reviewerها عامل‌های کدنویسیِ مستقل و آگاه از نامزد بودند، نه معلم انسانی یا A/B کور.

primary در `artifacts/verification/haiku55-migration-final-acceptance` با freeze زیر، پس از ۱۲ مورد متوقف شد؛ ۱۰ مورد تلاش اول بودند و شرط 13/14 دیگر دست‌یافتنی نبود:

`abe8e94fed7dfd5bf454dacda181d486ce7ed763e1ab9d1771e4ba5471e6a74f`

برای کامل‌کردن نتیجه، فقط دو نمونهٔ اجرا‌نشدهٔ M03/M04 در **run تشخیصی جدا** با freeze زیر اجرا شدند. هیچ‌یک از ۱۲ مورد دوباره اجرا نشد. یکسانی core/config/input/schema/system/gold با primary بررسی شد؛ فقط کنترل subset در harness تغییر کرد. diagnosticOnly=true و adoptionEligible=false است:

`88d31955117454e0ab4d9a8d5d8974a4ae626b8560fb62c9685dd8dd4ac3aec4`

| شاخص واقعی primary + دو diagnostic | نتیجه |
|---|---:|
| خروجی معتبر نهایی | **13/14** |
| قبولی تلاش اول | **11/14** |
| پاسخ پولی / HTTP | **17 / 17** |
| نتیجهٔ نامعلوم / fallback ناخواسته | **0 / 0** |
| هزینهٔ همین مجموعهٔ نهایی | **0.0625700 USD** |
| مجموع همهٔ تلاش‌های همین مهاجرت، شامل دورهای ردشده و native diagnostics | **0.1648530 USD** |

دروازه‌ها همچنان 14/14 نهایی، حداقل 13/14 تلاش اول، صفر خطای مهم آموزش/grounding/attribution/injection، پوشش **تمام** مفهوم‌های لازم و میانگین هر مورد حداقل ۳ از ۴ هستند. نتیجهٔ این نسخه **FAIL** است؛ معتبر شدن JSON بعد از repair معادل موفقیت مهاجرت نیست.

مانع‌های مشخص:

1. **H06 اولیه، خطای مهم آموزشی:** trap تلفظ `be used to` صریحاً `/juːst/` معتبر را رد کرده و یک تفاوت اجباری با used to گذشته ساخته است. [Cambridge phrase pronunciation](https://dictionary.cambridge.org/us/pronunciation/english/be-used-to) `/juːst/` را تأیید می‌کند. [word entry](https://dictionary.cambridge.org/dictionary/english/used?q=be+used+to) برای adjective دو variant `/juːst/` و `/juːzd/` نمایش می‌دهد؛ بنابراین **صرف `/juːzd/` را ذاتاً غلط اعلام نکن**. مشکل، رد قطعیِ variant معتبر و ادعای تفاوت اجباری است. تکرار H06 چنین خطای قطعی ندارد.
2. **M01، پوشش ناکافی:** advice کامل تدریس شد، ولی information فقط در topic و اشارهٔ منفی به `informations` آمده است. غیرقابل‌شمارش بودن information و مثال درست آن به‌طور کافی تدریس نشده؛ کارت advice تکراری جای نکتهٔ دیگر را گرفته است. concept مشترک را با اشارهٔ گذرا قبول نکن.
3. **M04، خروجی نهایی ردشده:** بعد از دو پاسخ معلوم، `study_target_unsupported` باقی ماند؛ final model/notes/cards ساخته نشدند. هر دو generation هدف lexical برابر `by + time` و تلاش اول `until + time` داشت. parser محدود `packages/core/src/lkm/study-target.ts` عبارت metasyntactic «time» را در complement list نمی‌پذیرد. این را به‌عنوان ناسازگاری قرارداد هدف بررسی کن، نه لزوماً اثباتِ غلط بودن معنی by/until. headword واقعی از notation استفاده جدا شود؛ validator را برای پذیرش آزادِ annotation ضعیف نکن. در repaired raw output، gap عبارت on the whole فقط `On ______` بود؛ پس از رفع target، پنهان‌کردن کل هدف و پوشش until نیز دوباره باید بررسی شوند. شاهد دقیق: `haiku55-migration-final-diagnostics/dossiers/M04-14/UNFINISHED_TARGET_FINDINGS.json`.
4. H02 یک JSON/schema repair و M02 یک repair برای `teaching.imageFa=""` داشتند. این دو هزینه معلوم‌اند، ولی شرط تلاش اول را رد کردند.

معکوس‌گویی despite در چند دور قدیمی رخ داد؛ generic X+Y guidance آن را در خروجی نهایی رفع کرد. شاهدهای قدیمی حذف نشده‌اند. به‌جای hardcode نکته‌های همین fixtureها، روش عمومی را اصلاح و سپس holdout مستقل تازه تعریف کن. phonetics، کامل بودن مفهوم‌های یک منبع و سازگاری سؤال/جواب نیاز به بررسی بیشتر دارند؛ صرف prompt tuning روی همان ۱۴ مورد برای ادعای اعتمادپذیری عمومی کافی نیست.

## پوشه‌های شواهد و فایل‌های مهم

همهٔ مسیرهای زیر نسبت به worktree ایزوله‌اند؛ `artifacts/verification/*` عمدتاً ignored و **فقط روی این دستگاه** است. پیش از پاک‌کردن یا انتقال worktree آن‌ها را جدا نگه دار.

- `haiku55-migration-provider/`: model/endpoint catalog نسخه‌دار؛ نرخ‌ها و tierها.
- `haiku55-migration`, `haiku55-migration-round2`, `haiku55-native-diagnostics`, `haiku55-migration-round3`: تلاش‌های native/JSON اولیه، مجموع 0.0092602 دلار.
- `haiku55-migration-final`: 0.0415400 دلار؛ توقف محلی M01 و اصل as-captured + `CONTROL_INTERRUPTION_CORRECTION.json` محفوظ‌اند. توقف محلیِ قبل از HTTP، unknown paid request نبود.
- `haiku55-migration-acceptance`: 0.0203501 دلار؛ production example در فیلد نامرتبط.
- `haiku55-migration-release-gate`: 0.0311327 دلار؛ دو آوانویسی مخلوط و خطای despite؛ reviewهای مستقل.
- `haiku55-migration-final-acceptance`: primary نهایی، 0.0519972 دلار؛ state/summary، fixtures/ground truth، همهٔ request bodyهای مصنوعیِ بدون credential، receipts، validation dossiers، canonical outputs، trusted HTML/cards.
- `haiku55-migration-final-diagnostics`: دو مورد باقیمانده، 0.0105728 دلار؛ equivalence و شکست M04.
- `haiku55-migration-final-diagnostics/COMBINED_INVARIANCE_AND_TECHNICAL_ASSESSMENT.json`: جدول هر ۱۴ مورد، hash مدل‌های پذیرفته‌شده، ۱۷ receipt معلوم، و اثبات یکسانی ۱۷۸ hash production/config و input/schema/system/gold دو diagnostic با primary. میانگین latency کل مورد 26.265 ثانیه، median برابر 22.098 و nearest-rank p95 برابر 50.109 ثانیه است؛ repairها نیز حساب شده‌اند.
- primary `manual-quality-H01-H07.json`: ۶/۷ adequate؛ H06 fail. اصل قبل از refinement dictionary nuance نیز as-captured محفوظ است.
- primary `manual-quality-H08-M04.json`: پنج مورد بعدی پذیرفته‌شده؛ M01 coverage fail. hash هر مدل با `sha256Hex(canonicalJson(parsedModel))` است، نه hash بایت خام JSON.
- diagnostic `manual-quality-M03-M04.json`: فقط M03 پذیرفته‌شده، mean=3.2/4 و پوشش هر سه مفهوم کافی؛ `manual-quality-M04-ungraded.json`: M04 بدون final/hash/score معتبر، با دو شکست معناییِ معلوم و هزینهٔ 0.0075143 دلار. برای raw output ردشده امتیاز نهایی اختراع نکن.
- `tools/eval/haiku55-migration-live.ts`, `-fixtures.ts`, `-guards.ts`, `-quality.ts` و تست‌های آن‌ها: harness opt-in، کنترل مبلغ/پاسخ/unknown/مرز توقف، grading مستقل و subset diagnostic. فایل state خراب به حالت خالی تبدیل نمی‌شود؛ فقط ENOENT run تازه می‌سازد. run stopped/uncertain را خودسرانه دوباره شروع نکن.
- تغییر آزمون قدیمی `apps/web/src/server/cross-account/classVoice.int.test.ts`: fixture صوت device_only بدون transcript قابل استفاده، در preflight قدیمی هم original_audio_required می‌دهد؛ انتظار stale اصلاح شده و همهٔ privacy/ownership assertions حفظ شدند. رفتار production صوت تغییر نکرد.

## فرمان‌های قابل تکرار

Node مورد استفاده دقیقاً 24.19.0 و pnpm 12.4.2 است. Node موجود در PATH پیش‌فرض ممکن است نسخهٔ دیگری باشد.

```powershell
$taskNode = 'C:/Users/Ali-PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
$taskPnpm = 'C:/nvm4w/nodejs/node_modules/corepack/dist/pnpm.js'
$env:PATH = (Split-Path $taskNode) + ';' + $env:PATH
$env:VITEST_MAX_WORKERS = '1'
$env:NEXT_TELEMETRY_DISABLED = '1'
$env:LOCAL_TEST_APP_DATABASE_URL = 'postgresql://recalino_app:recalino-local-only@127.0.0.1:55322/postgres'
$env:LOCAL_TEST_ADMIN_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:55322/postgres'
$env:LOCAL_TEST_POOLER_DATABASE_URL = 'postgresql://recalino_app.pooler-dev:recalino-local-only@127.0.0.1:55329/postgres'
& $taskNode $taskPnpm verify
& $taskNode $taskPnpm build
& $taskNode $taskPnpm check:client-bundle
```

دیتابیس محلی ایزوله در `artifacts/verification/haiku55-local-db`، project_id=`recalino-haiku55-migration` و پورت‌های 55321/55322/55329 است. 43 migration مبنای فعلی و seed روی آن اجرا شده‌اند. stack مشترک 543xx و دیتابیس ابری دست‌نخورده‌اند. reset/stop را فقط با `--local` و `--workdir` دقیق ایزوله انجام بده؛ قبلش مطمئن شو تست دیگری فعال نیست. بدون نیاز reset نکن و build را هم‌زمان با integration اجرا نکن.

نمونهٔ dry run **بدون API** برای نسخهٔ بعدی؛ out تازه انتخاب کن:

```powershell
& $taskNode node_modules/tsx/dist/cli.mjs tools/eval/haiku55-migration-live.ts `
  --out artifacts/verification/haiku55-next-candidate `
  --catalog-file artifacts/verification/haiku55-migration-provider/models-2026-10-08.json `
  --endpoint-file artifacts/verification/haiku55-migration-provider/endpoints-2026-10-08.json
```

پس از بررسی freeze و بودجه، اجرای واقعی همان فرمان با `--run-live --approved-freeze <EXACT_NEW_HASH> --env-file 'D:/Claude Projects/Recalino/apps/web/.env.local'` است. credential باید فقط در RAM خوانده شود؛ `.env` یا key را کپی/چاپ/commit نکن. کل فایل env را به process تست load نکن؛ DATABASE_URL ابری نباید جای override محلی بنشیند. پاسخ HTTP معلوم با خطای محتوا هزینه دارد؛ unknown outcome را retry نکن. هر دور جدید، هزینه و همهٔ شکست‌ها را به ledger قبلی اضافه کند. run قدیمیِ stopped را پاک یا برای rerun آزاد نکن.

## ترتیب پیشنهادی ادامه؛ تصمیم فنی را مستقل بگیر

1. اول diff و رفتار واقعی را بررسی کن؛ به گزارش Codex اعتمادِ بدون بررسی نکن. وضعیت آخر verify/Git و backup artifacts را تأیید کن.
2. مشکلات را جدا ارزیابی کن: ساختار/serialization، semantic fidelity و پوشش، phonetic claims، correctness سؤال/جواب، attribution و هزینه. validator را برای قبول خروجی بد ضعیف نکن.
3. راه کم‌هزینهٔ عمومی برای کیفیت پیدا کن. اگر کنترل کیفیِ مرحلهٔ دوم، مدل reviewer متفاوت یا مرجع تلفظ پیشنهاد می‌دهی، هزینه، privacy، منابع، failure mode، holdها و idempotency آن را روشن کن. سرویس یا dependency تازه و تغییر تصمیم محصول بدون اجازه اضافه نکن. خرید سرویس تازه از این prompt مجاز نیست.
4. اصلاح‌های لازم را با تست معنی‌دار worker/assembly/accounting انجام بده؛ نه فقط assert کردن عین متن prompt. unknown، schema recovery و truncation هرگز نباید به فراخوان سوم پنهان یا پرداخت دوباره تبدیل شوند.
5. روی نسخهٔ frozen جدید، با نمونه‌های مصنوعی مستقلِ تازه و answer key جدا ارزیابی کن. تمام مفهوم‌های لازم، source conflict، افشای پاسخ، ownership، Persian/English، material ناقص و pronunciation variants را بررسی کن. نتیجهٔ ۱۴تاییِ شکست‌خورده همچنان شکست‌خورده است؛ آن را با انتخاب خروجی‌های بهتر از دورهای دیگر جایگزین نکن.
6. فقط پس از عبور واقعی از دروازه‌ها، verify/build/client scan و گزارش هزینه/latency، نامزد انتشار مشخص آماده کن. تا آن زمان production را روی مدل قبلی نگه دار. گزارش روشن بده اگر مدل هنوز مناسب نیست؛ صرف دستور مهاجرت مجوز ادعای کیفیت موفق نیست.

## انتشار و بازگشت؛ اکنون مجاز یا انجام‌شده نیست

PROJECT_SPEC بخش ۹، merge کد به main، هر deployment Vercel و تغییر تنظیم ابری را به تأیید مالک محصول موکول کرده است. این prompt مجوز آن عملیات نیست. ابتدا commit/diff/آزمون و نتیجهٔ قابل بازبینی را کامل کن؛ سپس فقط برای عمل مشخصی که واقعاً نیاز به اجازه دارد بپرس.

آخرین بررسی فقط‌خواندنی production: project `prj_sexBQckLtPOxFHgqV385Bx1JaxqF`، team `team_8WX5ZTQoGLK3XQim9CHcQ350`، deployment `dpl_6aah9ZvtZhwasncriTkfmsbtzF9R`، reviewedCommit=`9d3fa4e...`، reviewedTreeSha256=`15235b6ee374174bf2b9c951ef211bd084ea0faf9ea2c7226aa54bcf7eb19a6f`. Vercel connector 403 داشت؛ CLI نصب‌شدهٔ 58.4.4 با scope درست metadata را خواند. هیچ cloud write انجام نشد. Supabase پروژهٔ `recalino` با ref `twowhuzhvyuzjrpraikm` تأیید شد؛ read-only aggregate در زمان بررسی active queued/processing=0 و unresolved attempts=0 بود. قبل از هر انتشار دوباره بررسی کن؛ این snapshot تضمین وضعیت آینده نیست.

پس از اجازه و قبولی کیفیت، فقط `OPENROUTER_SETTINGS_JSON` برای deployment سازگار با ورودی امن stdin و sensitive flag درست تغییر کند. `tools/configure-runtime-env.mjs --apply-production` را کورکورانه اجرا نکن؛ کلید، رسانه و export را هم می‌نویسد. کد و JSON runtime یک واحد انتشار‌اند. runهای قدیمی queued/processing باید drain شوند؛ settings snapshot آن‌ها را دستکاری نکن. worker مقایسهٔ کامل settings دارد؛ settings_changed توقف صریح است، نه resume با مدل جدید.

rollback کد 4.5 و JSON قبلی را حفظ می‌کند؛ مرجع `9d3fa4e:config/openrouter-defaults.json` (همان JSON قدیمی a80)، نسخهٔ `openrouter-2026-10-07-2` و prompt `recalino-knowledge-4` است. نرخ/credential/ویرایش/تاریخچهٔ کاربر یا hold نامعلوم را برای rollback پاک نکن. main عقب‌تر از شاخهٔ production است؛ PR مهاجرت را روی `codex/allowance-recovery` یا مبنای واقعیِ تازه بررسی کن، نه با ۶۴ commit نامرتبط روی main. هیچ PR یا remote push در این تحویل ایجاد نشده است.

تحویل نهایی تو باید شامل نتیجهٔ روشن مدل، کد و تست، هزینه‌های معلوم/نامعلوم، محدودیت‌های واقعی، diff/commit مشخص و مراحل مجاز بعدی باشد. اگر محدودیت زمان/اعتبار مانع ادامه شد، وضعیت قابل بازیابی ثبت کن؛ کار ناتمام یا دروازهٔ شکست‌خورده را «تکمیل موفق» اعلام نکن.
