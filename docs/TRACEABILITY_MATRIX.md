# ماتریس ردیابی — ریکالینو (Recalino)

> **وضعیت:** پیش‌نویس ۰٫۱ — همراه نقشه قابلیت‌ها، در انتظار تأیید مالک محصول  
> **تاریخ:** 2026-09-30  
> **مبنا:** [PRD نسخه ۰٫۳](../PRD_Recalino_FA_v0.3.md) · [نقشه قابلیت‌ها](MVP_FUNCTIONAL_REQUIREMENTS_FA.md#capability-map)

این ماتریس هر شناسه PRD را به **یک ماژول مالک** در نقشه قابلیت‌ها وصل می‌کند. ستون‌های FR و تست بعد از نوشتن spec هر ماژول پر می‌شوند (زنجیره PRD ← FR ← Test طبق PRD بخش ۳۱.۲).

- پوشش: **197 شناسه** از PRD استخراج شد (126 الزام PRD، 12 NFR، 20 معیار پذیرش، 27 تصمیم، 12 دروازه)؛ همه مالک دارند و هیچ شناسه‌ای بی‌مالک نمانده است.
- «مالک» جایی است که FR و آزمون اصلی آن الزام نوشته می‌شود؛ «مرتبط» ماژولی است که باید به آن احترام بگذارد یا داده‌اش را فراهم کند.
- `D30` در PRD نام متریک بازگشت روز ۳۰ (D7/D30) است، نه تصمیم محصول؛ عمداً در این ماتریس نیامده است. به همین دلیل دفتر تصمیم‌ها هم شناسه D30 را استفاده نمی‌کند و از D29 به D31 می‌رود.
- این فایل با اسکریپت از PRD تولید شده؛ پس از تأیید نقشه، ستون FR دستی تکمیل می‌شود.

## خلاصه مالکیت

شناسه‌های دارای چند مالک (مثل `PRD-CORE-04`) برای هر مالک شمرده شده‌اند؛ مالک‌های «همه ماژول‌ها»، ADR و دروازه غیرکدی در این جدول نیستند.

| ماژول | نام | PRD | NFR | AC | D | G | جمع |
|---|---|---|---|---|---|---|---|
| `PLT` | پلتفرم و حفاظت پایه | 5 | 3 | 0 | 0 | 0 | 8 |
| `ACC` | حساب و پروفایل یادگیری | 6 | 0 | 0 | 5 | 1 | 12 |
| `AIP` | مرز تأمین‌کنندگان AI | 2 | 0 | 0 | 0 | 1 | 3 |
| `QUOTA` | پلن، سهمیه و دفتر مصرف | 7 | 2 | 2 | 1 | 2 | 14 |
| `ORG` | دوره و جلسه | 1 | 0 | 1 | 1 | 0 | 3 |
| `SRC` | منابع و آپلود | 6 | 0 | 0 | 1 | 1 | 8 |
| `REC` | ضبط و بازیابی | 12 | 1 | 4 | 2 | 1 | 20 |
| `LKM` | مدل دانشی و منشأ | 13 | 1 | 2 | 3 | 0 | 19 |
| `PROC` | پردازش غیرهمزمان | 16 | 3 | 6 | 2 | 0 | 27 |
| `NOTE` | جزوه | 5 | 1 | 1 | 3 | 0 | 10 |
| `HTML` | خروجی HTML | 5 | 0 | 1 | 2 | 0 | 8 |
| `MEDIA` | رسانه کارت | 5 | 0 | 1 | 1 | 0 | 7 |
| `CARD` | کارت و کنترل کاربر | 11 | 0 | 1 | 5 | 0 | 17 |
| `SRS` | موتور مرور | 14 | 1 | 2 | 2 | 1 | 20 |
| `ANKI` | خروجی Anki | 5 | 0 | 1 | 2 | 0 | 8 |
| `PERS` | شخصی‌سازی و گزارش یادگیری | 5 | 0 | 1 | 1 | 0 | 7 |
| `PRIV` | نگهداری، حذف و حقوق محتوا | 6 | 0 | 0 | 0 | 2 | 8 |
| `OPS` | عملیات و سنجش | 0 | 2 | 0 | 0 | 1 | 3 |
| `EVAL` | ارزیابی کیفیت AI | 0 | 1 | 0 | 0 | 0 | 1 |

## الزامات PRD (`PRD-*`)

| شناسه | بخش PRD | مالک | مرتبط | FR | تست |
|---|---|---|---|---|---|
| PRD-CORE-01 | ۵. اصول طراحی و شناسه الزامات | LKM | NOTE, PROC | — | — |
| PRD-CORE-02 | ۵. اصول طراحی و شناسه الزامات | ORG | REC, PROC | FR-ORG-006 | — |
| PRD-CORE-03 | ۵. اصول طراحی و شناسه الزامات | LKM | NOTE, CARD | — | — |
| PRD-CORE-04 | ۵. اصول طراحی و شناسه الزامات | SRS, QUOTA, PLT | PROC | FR-QUOTA-001, FR-QUOTA-005, FR-QUOTA-010 | — |
| PRD-CORE-05 | ۵. اصول طراحی و شناسه الزامات | NOTE, CARD | PROC | — | — |
| PRD-CORE-06 | ۵. اصول طراحی و شناسه الزامات | همه ماژول‌ها | قاعده دامنه؛ آزمون AC-20 | — | — |
| PRD-ONB-01 | ۶. پروفایل، زبان و ورود اولیه | ACC | PLT | FR-PLT-011, FR-ACC-003 | `e2e/text.spec.ts`, `ui/direction.test.ts` (FR-PLT-011); core `acc/profile.int.test.ts`, `e2e/setup.spec.ts` (FR-ACC-003) |
| PRD-ONB-02 | ۶. پروفایل، زبان و ورود اولیه | ACC | — | FR-ACC-003 | core `acc/acc.test.ts`, `acc/profile.int.test.ts`; web `app/setup/languages.test.ts`, `e2e/setup.spec.ts` |
| PRD-ONB-03 | ۶. پروفایل، زبان و ورود اولیه | ACC | EVAL | FR-ACC-003 | core `acc/acc.test.ts` (سطح Experimental)؛ `e2e/setup.spec.ts`. کیفیت واقعی زبان‌ها با EVAL |
| PRD-ONB-04 | ۶. پروفایل، زبان و ورود اولیه | ACC | PERS | FR-ACC-003 | core `acc/profile.int.test.ts`؛ `e2e/setup.spec.ts`. ترجیح‌های آموخته‌شده با PERS |
| PRD-ONB-05 | ۶. پروفایل، زبان و ورود اولیه | ACC | PROC, QUOTA | FR-ACC-004, FR-ACC-005 | core `acc/profile.int.test.ts` (نسخه‌ها)؛ web `cross-account/profile.int.test.ts`, `e2e/account.spec.ts` |
| PRD-PLT-01 | ۸.۱. پلتفرم اولیه | PLT | REC | FR-PLT-010 | بخشی: web `e2e/pwa.spec.ts` (manifest با نام، رنگ‌ها و چهار آیکون any و maskable که با نوع PNG سرو می‌شوند؛ لینک favicon SVG؛ لینک و سرو شدن Apple touch icon)، `ui/styles/vendor.test.ts` (برابری بایت‌به‌بایت هشت فایل آیکون و favicon با تحویل دور ۲) |
| PRD-PLT-02 | ۸.۱. پلتفرم اولیه | REC | SRC | FR-SRC-007 (بخشی) | — |
| PRD-SRC-01 | ۸.۲. منابع قابل قبول | SRC | PROC | FR-SRC-002, FR-SRC-003, FR-SRC-005, FR-SRC-007 | — |
| PRD-SRC-02 | ۸.۲. منابع قابل قبول | SRC | PLT, PROC | FR-SRC-006, FR-SRC-012 | — |
| PRD-SRC-03 | ۸.۲. منابع قابل قبول | PROC | SRC, AIP | FR-SRC-010 (بخشی) | — |
| PRD-SRC-04 | ۸.۲. منابع قابل قبول | PROC | LKM, NOTE, QUOTA | FR-SRC-008 (بخشی) | — |
| PRD-SRC-05 | ۸.۲. منابع قابل قبول | SRC | PROC, NOTE, CARD | FR-SRC-009 | — |
| PRD-REC-01 | ۹.۱. رفتار پایه | REC | — | — | — |
| PRD-REC-02 | ۹.۱. رفتار پایه | REC | QUOTA | — | — |
| PRD-REC-03 | ۹.۱. رفتار پایه | REC | — | — | — |
| PRD-REC-04 | ۹.۲. ذخیره و بازیابی | REC | — | — | — |
| PRD-REC-05 | ۹.۲. ذخیره و بازیابی | REC | PROC | — | — |
| PRD-REC-06 | ۹.۲. ذخیره و بازیابی | REC | PROC | — | — |
| PRD-REC-07 | ۹.۲. ذخیره و بازیابی | REC | SRC | FR-SRC-004, FR-SRC-005, FR-SRC-007 (بخشی) | — |
| PRD-REC-08 | ۹.۲. ذخیره و بازیابی | REC | SRC | FR-SRC-004, FR-SRC-007 (بخشی) | — |
| PRD-REC-09 | ۹.۲. ذخیره و بازیابی | REC | PRIV | — | — |
| PRD-SEG-01 | ۱۰.۱. سه مفهوم مستقل | PROC | AIP | — | — |
| PRD-SEG-02 | ۱۰.۱. سه مفهوم مستقل | PROC | LKM, NOTE, CARD | — | — |
| PRD-SEG-03 | ۱۰.۱. سه مفهوم مستقل | PROC | QUOTA | — | — |
| PRD-SEG-04 | ۱۰.۱. سه مفهوم مستقل | PROC | QUOTA | — | — |
| PRD-ALIGN-01 | ۱۰.۲. زمان و تصاویر | REC | PROC | — | — |
| PRD-ALIGN-02 | ۱۰.۲. زمان و تصاویر | PROC | SRC | FR-SRC-003, FR-SRC-008 (بخشی) | — |
| PRD-ALIGN-03 | ۱۰.۲. زمان و تصاویر | PROC | SRC, LKM | FR-SRC-003, FR-SRC-008 (بخشی) | — |
| PRD-SPK-01 | ۱۰.۳. گویندگان | PROC | NOTE | — | — |
| PRD-SPK-02 | ۱۰.۳. گویندگان | PROC | — | — | — |
| PRD-SPK-03 | ۱۰.۳. گویندگان | LKM | PROC, NOTE | — | — |
| PRD-PROC-01 | ۱۱. پردازش، وضعیت‌ها و خطاها | PROC | PLT | — | — |
| PRD-PROC-02 | ۱۱. پردازش، وضعیت‌ها و خطاها | PROC | LKM | — | — |
| PRD-PROC-03 | ۱۱. پردازش، وضعیت‌ها و خطاها | PROC | QUOTA, PLT | FR-PLT-004 (بخشی) | بخشی (FR-PLT-004): core plt/idempotency.int.test.ts |
| PRD-PROC-04 | ۱۱. پردازش، وضعیت‌ها و خطاها | PROC | NOTE | — | — |
| PRD-PROC-05 | ۱۱. پردازش، وضعیت‌ها و خطاها | PROC | ORG, PRIV | FR-ORG-007, FR-SRC-013 (بخشی) | — |
| PRD-LKM-01 | ۱۲.۱. خروجی ساخت‌یافته | LKM | PROC, NOTE | — | — |
| PRD-LKM-02 | ۱۲.۱. خروجی ساخت‌یافته | LKM | AIP, PROC | — | — |
| PRD-LKM-03 | ۱۲.۲. دو برچسب اصلی، اطلاعات منشأ دقیق‌تر | LKM | NOTE | — | — |
| PRD-LKM-04 | ۱۲.۲. دو برچسب اصلی، اطلاعات منشأ دقیق‌تر | LKM | NOTE, CARD | — | — |
| PRD-LKM-05 | ۱۲.۲. دو برچسب اصلی، اطلاعات منشأ دقیق‌تر | LKM | EVAL | — | — |
| PRD-LKM-06 | ۱۲.۲. دو برچسب اصلی، اطلاعات منشأ دقیق‌تر | LKM | CARD | — | — |
| PRD-LKM-07 | ۱۲.۲. دو برچسب اصلی، اطلاعات منشأ دقیق‌تر | LKM | PROC | — | — |
| PRD-NOTE-01 | ۱۳. جزوه آموزشی داخل اپ | NOTE | — | — | — |
| PRD-NOTE-02 | ۱۳. جزوه آموزشی داخل اپ | NOTE | SRC, PRIV | FR-SRC-012 (بخشی) | — |
| PRD-NOTE-03 | ۱۳. جزوه آموزشی داخل اپ | NOTE | — | — | — |
| PRD-NOTE-04 | ۱۳. جزوه آموزشی داخل اپ | CARD | NOTE | — | — |
| PRD-NOTE-05 | ۱۳. جزوه آموزشی داخل اپ | NOTE | PROC | — | — |
| PRD-CARD-01 | ۱۴.۱. واحد یادگیری و کارت | CARD | LKM, SRS | — | — |
| PRD-CARD-02 | ۱۴.۱. واحد یادگیری و کارت | CARD | PROC | — | — |
| PRD-CARD-03 | ۱۴.۱. واحد یادگیری و کارت | CARD | MEDIA | — | — |
| PRD-CARD-04 | ۱۴.۱. واحد یادگیری و کارت | CARD | PROC | — | — |
| PRD-CARD-05 | ۱۴.۲. ورود به مرور | CARD | — | — | — |
| PRD-CARD-06 | ۱۴.۲. ورود به مرور | CARD | PROC | — | — |
| PRD-CARD-07 | ۱۴.۲. ورود به مرور | CARD | SRS | — | — |
| PRD-MEDIA-01 | ۱۴.۳. صوت و تصویر در MVP | MEDIA | SRC, CARD | FR-SRC-011 (بخشی) | — |
| PRD-MEDIA-02 | ۱۴.۳. صوت و تصویر در MVP | MEDIA | AIP, QUOTA | — | — |
| PRD-MEDIA-03 | ۱۴.۳. صوت و تصویر در MVP | MEDIA | CARD | — | — |
| PRD-MEDIA-04 | ۱۴.۳. صوت و تصویر در MVP | MEDIA | SRC, ANKI | FR-SRC-007 (بخشی) | — |
| PRD-MEDIA-05 | ۱۴.۳. صوت و تصویر در MVP | MEDIA | CARD, SRS | — | — |
| PRD-EDIT-01 | ۱۵. کنترل کاربر و قواعد ویرایش کارت | CARD | SRS | — | — |
| PRD-EDIT-02 | ۱۵. کنترل کاربر و قواعد ویرایش کارت | CARD | MEDIA, SRS | — | — |
| PRD-SRS-01 | ۱۶.۱. الگوریتم | SRS | — | — | — |
| PRD-SRS-02 | ۱۶.۱. الگوریتم | SRS | — | — | — |
| PRD-SRS-03 | ۱۶.۱. الگوریتم | SRS | — | — | — |
| PRD-SRS-04 | ۱۶.۱. الگوریتم | SRS | — | — | — |
| PRD-SRS-05 | ۱۶.۲. صف روزانه | SRS | CARD | — | — |
| PRD-SRS-06 | ۱۶.۲. صف روزانه | SRS | — | — | — |
| PRD-SRS-07 | ۱۶.۲. صف روزانه | SRS | — | — | — |
| PRD-SRS-08 | ۱۶.۲. صف روزانه | SRS | CARD | — | — |
| PRD-SRS-09 | ۱۶.۳. تاریخ، همگام‌سازی و آفلاین | SRS | ACC | FR-PLT-013, FR-ACC-006 (بخشی) | بخشی (FR-PLT-013): core plt/time.test.ts؛ (FR-ACC-006): core `acc/profile.int.test.ts`, `e2e/setup.spec.ts` |
| PRD-SRS-10 | ۱۶.۳. تاریخ، همگام‌سازی و آفلاین | SRS | PLT | — | — |
| PRD-SRS-11 | ۱۶.۳. تاریخ، همگام‌سازی و آفلاین | SRS | PLT | — | — |
| PRD-SRS-12 | ۱۶.۳. تاریخ، همگام‌سازی و آفلاین | SRS | PERS | — | — |
| PRD-PERS-01 | ۱۷. شخصی‌سازی، سطح و تحلیل یادگیری | PERS | ACC, NOTE, CARD | [D49](plans/TEACHING_MEMORY_2026-10-08.md) | core `pers/memory.int.test.ts`، `proc/processing.int.test.ts` (D49)؛ web `cross-account/learningFeedback.int.test.ts` |
| PRD-PERS-02 | ۱۷. شخصی‌سازی، سطح و تحلیل یادگیری | PERS | ACC | [D49](plans/TEACHING_MEMORY_2026-10-08.md) | core `pers/memory-rules.test.ts`، `pers/profile.int.test.ts`؛ web `e2e/learning-memory.spec.ts`، `e2e/learning-privacy.spec.ts` |
| PRD-PERS-03 | ۱۷. شخصی‌سازی، سطح و تحلیل یادگیری | PERS | ACC | [D49](plans/TEACHING_MEMORY_2026-10-08.md) | core `pers/memory-rules.test.ts`، `pers/memory.int.test.ts` |
| PRD-PERS-04 | ۱۷. شخصی‌سازی، سطح و تحلیل یادگیری | PERS | PROC | [D49](plans/TEACHING_MEMORY_2026-10-08.md) | core `proc/learner-context.test.ts`، `pers/profile.int.test.ts` (سطح تخمینی و Speaking همچنان Unknown) |
| PRD-PERS-05 | ۱۷. شخصی‌سازی، سطح و تحلیل یادگیری | PERS | SRS | [D49](plans/TEACHING_MEMORY_2026-10-08.md) | core `pers/memory.int.test.ts`؛ web `ui/workspace/LearningMemory.test.ts`، `e2e/learning-memory.spec.ts` |
| PRD-EXP-01 | ۱۸.۱. HTML مستقل | HTML | NOTE | — | — |
| PRD-EXP-02 | ۱۸.۱. HTML مستقل | HTML | NOTE | — | — |
| PRD-EXP-03 | ۱۸.۱. HTML مستقل | HTML | PRIV | — | — |
| PRD-EXP-04 | ۱۸.۱. HTML مستقل | HTML | — | — | — |
| PRD-EXP-05 | ۱۸.۲. Anki/AnkiDroid | ANKI | MEDIA | — | — |
| PRD-EXP-06 | ۱۸.۲. Anki/AnkiDroid | ANKI | SRS | — | — |
| PRD-EXP-07 | ۱۸.۲. Anki/AnkiDroid | ANKI | — | — | — |
| PRD-EXP-08 | ۱۸.۲. Anki/AnkiDroid | ANKI | — | — | — |
| PRD-COST-01 | ۱۹.۱. واحدهای مصرف | QUOTA | AIP | FR-QUOTA-001, FR-QUOTA-008, FR-QUOTA-011 | — |
| PRD-COST-02 | ۱۹.۲. رفتار سهمیه | QUOTA | PROC | FR-QUOTA-004, FR-QUOTA-005, FR-QUOTA-006 | — |
| PRD-COST-03 | ۱۹.۲. رفتار سهمیه | QUOTA | PROC | FR-QUOTA-006 | — |
| PRD-COST-04 | ۱۹.۲. رفتار سهمیه | QUOTA | REC, SRC | FR-QUOTA-004, FR-QUOTA-007, FR-QUOTA-011, FR-SRC-003, FR-SRC-007, FR-SRC-008 (بخشی) | — |
| PRD-COST-05 | ۱۹.۲. رفتار سهمیه | QUOTA | NOTE, SRS, MEDIA | FR-QUOTA-010 | — |
| PRD-COST-06 | ۱۹.۲. رفتار سهمیه | QUOTA | CARD, MEDIA, PROC | FR-QUOTA-003, FR-QUOTA-010 | — |
| PRD-PRIV-01 | ۲۰.۱. ضبط و داده اشخاص | REC | SRC, ACC | FR-SRC-015 (بخشی) | — |
| PRD-PRIV-02 | ۲۰.۱. ضبط و داده اشخاص | G11 (غیرکدی) | AIP | — | — |
| PRD-PRIV-03 | ۲۰.۱. ضبط و داده اشخاص | HTML, ANKI | PROC, NOTE | — | — |
| PRD-PRIV-04 | ۲۰.۱. ضبط و داده اشخاص | ACC | G11 | FR-ACC-001 | core `acc/signup.int.test.ts`; web `auth/flow.int.test.ts`, `e2e/signin.spec.ts` |
| PRD-PRIV-05 | ۲۰.۲. استفاده از داده در AI | AIP | G10 | — | — |
| PRD-PRIV-06 | ۲۰.۲. استفاده از داده در AI | PLT | OPS | FR-PLT-007 | core plt/log.test.ts; web server/api.test.ts (canary) |
| PRD-DEL-01 | ۲۰.۳. نگهداری و حذف | PRIV | همه ماژول‌ها | — | — |
| PRD-DEL-02 | ۲۰.۳. نگهداری و حذف | PRIV | ORG, SRC | FR-SRC-013 (بخشی) | — |
| PRD-DEL-03 | ۲۰.۳. نگهداری و حذف | PRIV | همه ماژول‌ها | FR-SRC-011, FR-SRC-013, FR-PLT-014 (بخشی) | — |
| PRD-DEL-04 | ۲۰.۳. نگهداری و حذف | PRIV | OPS | — | — |
| PRD-DEL-05 | ۲۰.۳. نگهداری و حذف | PRIV | HTML, ANKI, REC | — | — |
| PRD-SEC-01 | ۲۰.۴. امنیت ورودی و مدل | PLT | همه ماژول‌ها | FR-PLT-001, FR-PLT-002, FR-PLT-008 | بخشی (FR-PLT-002): core plt/access.int.test.ts, plt/settings.test.ts; web server/api.int.test.ts, server/route-coverage.test.ts؛ (FR-PLT-001): web `auth/flow.int.test.ts`, `auth/return-path.test.ts`, `cross-account/*.int.test.ts`, `e2e/account.spec.ts` (رد توکن پس از خروج) |
| PRD-SEC-02 | ۲۰.۴. امنیت ورودی و مدل | SRC | PLT | FR-SRC-002, FR-SRC-004, FR-SRC-005, FR-SRC-006 | — |
| PRD-SEC-03 | ۲۰.۴. امنیت ورودی و مدل | PROC | LKM, AIP | FR-SRC-006 (بخشی) | — |
| PRD-SEC-04 | ۲۰.۴. امنیت ورودی و مدل | PLT | OPS | FR-PLT-006, FR-PLT-007, FR-PLT-009 | core plt/rate-limit.int.test.ts, plt/log.test.ts; web server/api.int.test.ts; tools/client-bundle/scan.test.ts |
| PRD-RIGHTS-01 | ۲۰.۵. حقوق منابع | G11 (غیرکدی) | PRIV | — | — |
| PRD-RIGHTS-02 | ۲۰.۵. حقوق منابع | PRIV | SRC, HTML, ANKI | FR-ACC-001, FR-ACC-007 (بخشی), FR-SRC-015 (بخشی) | بخشی (FR-ACC-001، FR-ACC-007): core `acc/signup.int.test.ts`, `acc/profile.int.test.ts`; `e2e/account.spec.ts` |
| PRD-ARCH-01 | ۲۱.۲. تصمیم‌های معماری | ADR-0001 | PLT | — | — |
| PRD-ARCH-02 | ۲۱.۲. تصمیم‌های معماری | ADR-0001 | PLT, PROC | FR-PLT-005 | — |
| PRD-ARCH-03 | ۲۱.۲. تصمیم‌های معماری | AIP | G03 | — | — |
| PRD-ARCH-04 | ۲۱.۲. تصمیم‌های معماری | LKM | — | — | — |
| PRD-ARCH-05 | ۲۱.۲. تصمیم‌های معماری | ADR-0001 | — | — | — |
| PRD-DATA-01 | ۲۲.۱. قواعد مهم مدل | SRC | — | FR-SRC-001 | — |
| PRD-DATA-02 | ۲۲.۱. قواعد مهم مدل | LKM | CARD | — | — |
| PRD-DATA-03 | ۲۲.۱. قواعد مهم مدل | LKM | SRC | FR-SRC-010 (بخشی) | — |
| PRD-DATA-04 | ۲۲.۱. قواعد مهم مدل | SRS | PERS | — | — |
| PRD-DATA-05 | ۲۲.۱. قواعد مهم مدل | SRC | PRIV, LKM | FR-SRC-010, FR-SRC-011, FR-SRC-013, FR-PLT-014 | — |

## الزامات غیرعملکردی (`NFR-*`)

| شناسه | موضوع در PRD | مالک | مرتبط | FR | تست |
|---|---|---|---|---|---|
| NFR-01 | صحت دسترسی | PLT | همه ماژول‌ها | FR-PLT-002 | web server/route-coverage.test.ts, server/api.int.test.ts; core plt/access.int.test.ts |
| NFR-02 | صحت مرور/مصرف | SRS, QUOTA, PROC | PLT | FR-PLT-004, FR-PLT-005 (بخشی), FR-QUOTA-005, FR-QUOTA-006 | بخشی (FR-PLT-004): core plt/idempotency.int.test.ts; web server/api.int.test.ts |
| NFR-03 | سلامت ضبط | REC | — | — | — |
| NFR-04 | پاسخ تعاملی | PLT | — | PLT: قیود غیرعملکردی (بخشی) | — |
| NFR-05 | نمایش محتوا | NOTE | — | — | — |
| NFR-06 | موفقیت پردازش | PROC | EVAL | — | — |
| NFR-07 | زمان AI | PROC | EVAL | — | — |
| NFR-08 | ارجاع | LKM | — | — | — |
| NFR-09 | کیفیت آموزشی | EVAL | LKM, CARD | — | — |
| NFR-10 | دسترس‌پذیری | PLT | همه ماژول‌ها | FR-PLT-012 (بخشی) | `e2e/ui-kit.spec.ts`, `e2e/shell.spec.ts` (axe و صفحه‌کلید) |
| NFR-11 | بازیابی سرویس | OPS | PRIV | — | — |
| NFR-12 | هزینه | QUOTA, OPS | AIP | FR-QUOTA-008, FR-QUOTA-009 | — |

## معیارهای پذیرش سطح محصول (`AC-*`)

| شناسه | موضوع در PRD | مالک | مرتبط | FR | تست |
|---|---|---|---|---|---|
| AC-01 | کاربر بدون ساخت Course روی New Class می‌زند | ORG | — | FR-ORG-001, FR-ORG-002 | — |
| AC-02 | ضبط از دقیقه ۹۰ عبور می‌کند | REC | — | — | — |
| AC-03 | ضبط ۱۸۰ دقیقه‌ای تمام می‌شود | REC, PROC | NOTE | — | — |
| AC-04 | میکروفون واقعاً قطع می‌شود | REC | — | — | — |
| AC-05 | اینترنت قطع و بعد برمی‌گردد | REC | SRC | FR-SRC-004, FR-SRC-007 (بخشی) | — |
| AC-06 | فقط ۶۰ دقیقه سهمیه برای فایل ۱۸۰ دقیقه‌ای موجود است | QUOTA | REC, PROC | FR-QUOTA-007 | — |
| AC-07 | یک بخش صوت یا صفحه استخراج نمی‌شود | PROC | NOTE | FR-SRC-010 (بخشی) | — |
| AC-08 | موضوع فقط در PDF وجود دارد | LKM | NOTE | — | — |
| AC-09 | نقش گوینده یا محل عکس مبهم است | PROC | SRC | FR-SRC-008 (بخشی) | — |
| AC-10 | AI برای درس مثال تازه می‌سازد | LKM | NOTE | — | — |
| AC-11 | کاربر جزوه و کارت را ویرایش و سپس بازتولید می‌کند | NOTE, CARD | PROC | — | — |
| AC-12 | حالت Simple و Advanced استفاده می‌شود | SRS | — | — | — |
| AC-13 | پاسخ مرور یا درخواست پردازش دوبار ارسال می‌شود | SRS, PROC, QUOTA | PLT | FR-PLT-004 (بخشی), FR-QUOTA-005, FR-QUOTA-006 | بخشی (FR-PLT-004): core plt/idempotency.int.test.ts; web server/api.int.test.ts |
| AC-14 | HTML بدون اینترنت باز می‌شود | HTML | — | — | — |
| AC-15 | APKG در کلاینت‌های هدف وارد می‌شود | ANKI | MEDIA | — | — |
| AC-16 | متن PDF دستور دسترسی به حساب دیگر دارد | PROC | PLT | FR-SRC-006 (بخشی) | — |
| AC-17 | کاربر جلسه را حین پردازش حذف می‌کند | PROC | PRIV, ORG | FR-ORG-007, FR-SRC-013 (بخشی) | — |
| AC-18 | کاربر هنوز نمونه Speaking ندارد | PERS | — | — | — |
| AC-19 | کارت صوتی چندبار مرور می‌شود | MEDIA | SRS | — | — |
| AC-20 | کاربر وارد MVP می‌شود | همه ماژول‌ها | قاعده دامنه | — | — |

## تصمیم‌های قطعی محصول (`D*`)

| شناسه | موضوع در PRD | مالک | مرتبط | FR | تست |
|---|---|---|---|---|---|
| D01 | مخاطب | ACC | — | FR-ACC-001 | web `auth/flow.int.test.ts`, `e2e/signin.spec.ts` |
| D02 | حوزه | ADR-0001 | ACC | — | — |
| D03 | زبان‌ها (دامنه با D31 گسترش یافت) | ACC | LKM | FR-ACC-003 | core `acc/acc.test.ts`, `acc/profile.int.test.ts` |
| D04 | توضیحات دوزبانه (با D31 اصلاح شد) | LKM | NOTE | FR-ACC-005 (بخشی) | بخشی (FR-ACC-005): core `acc/profile.int.test.ts` |
| D05 | ورود صدا | REC, SRC | — | FR-SRC-007 (بخشی؛ ضبط در REC) | — |
| D06 | گویندگان | PROC | LKM | — | — |
| D07 | منشأ محتوا | LKM | NOTE, CARD | — | — |
| D08 | جزوه | NOTE, HTML | — | — | — |
| D09 | ورود کارت | CARD | — | — | — |
| D10 | Anki | ANKI | — | — | — |
| D11 | رسانه کارت | MEDIA, CARD | — | — | — |
| D12 | ارزیابی مرور | SRS | — | — | — |
| D13 | ساختار | ORG | — | FR-ORG-001..005 | — |
| D14 | ویرایش | NOTE, CARD | PERS | — | — |
| D15 | کنترل کارت | CARD | — | — | — |
| D16 | گسترش آموزشی | LKM | PROC | — | — |
| D17 | کلاس طولانی | REC, PROC | — | — | — |
| D18 | مصرف | QUOTA | — | FR-QUOTA-001, FR-QUOTA-003 | — |
| D19 | کسب‌وکار | ADR-0001 | PLT | — | — |
| D20 | مدرس | همه ماژول‌ها | خارج از دامنه؛ AC-20 | — | — |
| D21 | اشتراک‌گذاری | HTML, ANKI | خارج از دامنه برای اشتراک داخلی | — | — |
| D22 | سن | ACC | PRIV | FR-ACC-001 | core `acc/signup.int.test.ts`; web `auth/flow.int.test.ts`, `e2e/signin.spec.ts` |
| D23 | هدف یادگیری | ACC | — | FR-ACC-003 | core `acc/profile.int.test.ts`, `e2e/setup.spec.ts` |
| D24 | سطح | ACC, PERS | — | FR-ACC-003 (بخشی) | core `acc/profile.int.test.ts`, `e2e/setup.spec.ts` |
| D25 | ارزش محوری | NOTE, CARD, SRS | OPS (معیار ۲۵.۱) | — | — |
| D26 | کتاب‌خانه | همه ماژول‌ها | خارج از دامنه؛ آمادگی در SRC و LKM | FR-SRC-001 (بخشی) | — |
| D27 | نام محصول | CLAUDE.md | — | — | — |

## دروازه‌های تصمیم/انتشار (`G*`)

| شناسه | موضوع در PRD | مالک | مرتبط | FR | تست |
|---|---|---|---|---|---|
| G01 | حفاظت برند و هویت بصری | خارج از FR (برند) | — | — | — |
| G02 | Stack و Hosting | ADR-0001 | — | — | — |
| G03 | ارائه‌دهنده AI | AIP | EVAL | — | — |
| G04 | ماتریس ضبط | REC | PLT | FR-PLT-010 (بخشی) | — |
| G05 | زبان‌های اول (رویکرد با D31 بسته شد؛ ۱۰ زبان آزمون پایلوت در PILOT_SETUP) | ACC | EVAL | FR-ACC-003 (بخشی) | core `acc/acc.test.ts` (فهرست زبان‌ها و سطح) |
| G06 | قرارداد ورودی (مقادیر اولیه، HEIC و PDF رمزدار مصوب 2026-10-01؛ سقف صوت پس از spikeها) | SRC | — | FR-SRC-002, FR-SRC-005 | — |
| G07 | سیاست FSRS (مرز روز ساعت ۴ صبح مصوب 2026-10-01؛ بقیه باز) | SRS | — | FR-PLT-013 (بخشی) | بخشی (مرز روز قابل پیکربندی): core plt/time.test.ts |
| G08 | مقدار پلن‌ها | QUOTA | — | FR-QUOTA-001, FR-QUOTA-002 (مقادیر باز) | — |
| G09 | سیاست لغو/مصرف (مصوب 2026-10-01: فقط خروجی منتشرشده) | QUOTA | PROC | FR-QUOTA-006 | — |
| G10 | نگهداری/حذف | PRIV | AIP | — | — |
| G11 | حقوق و حریم خصوصی (پیش‌نویس متن‌ها ۰٫۱ و فهرست بازبینی در docs/legal، 2026-10-01) | PRIV | ACC | FR-ACC-001, FR-ACC-007, FR-SRC-015 (متن) | `tools/legal/build.test.ts` (همگامی متن‌های اپ با docs/legal)؛ core `acc/acc.test.ts` (نسخه‌ها) |
| G12 | ظرفیت و SLA (اندازه پایلوت ۱۱ تا ۲۵ نفر) | OPS | PLT | — | — |

## تصمیم‌های محصول پس از PRD v0.3

منبع: [PRODUCT_DECISIONS_LOG.md](PRODUCT_DECISIONS_LOG.md). این بخش دستی نگهداری می‌شود و با اسکریپت تولید نشده است.

| شناسه | موضوع | مالک | مرتبط | الزامات متأثر PRD | FR | تست |
|---|---|---|---|---|---|---|
| D28 | هزینه زیرساخت MVP | ADR-0001 | QUOTA, OPS | PRD-ARCH-05, NFR-12 | — | — |
| D29 | صوت کلاس روی دستگاه؛ نسخه سرور موقت | REC, PRIV | SRC, PROC, NOTE, MEDIA, AIP | PRD-REC-07, PRD-REC-08, PRD-REC-09, PRD-DEL-01, PRD-DEL-02, PRD-NOTE-02, PRD-NOTE-05, PRD-MEDIA-04, PRD-COST-04, PRD-PROC-03, AC-05 | FR-SRC-007, FR-SRC-011, FR-SRC-012 (بخشی) | بخشی (قاعده ۳، حذف خودکار پس از رونویسی): core `src/audio-expiry.int.test.ts`, `proc/voice-processing.int.test.ts` |
| D31 | زبان اول: همه زبان‌ها با دو سطح کیفیت؛ زبان توضیح دوگزینه‌ای | ACC | EVAL, LKM, PROC, NOTE, CARD, PLT | D03, D04, PRD-ONB-01, PRD-ONB-02, PRD-ONB-03, PRD-CARD-01, G05، PRD بخش ۲۴.۱ | FR-ACC-003, FR-ACC-005, FR-PLT-011 | `e2e/theme.spec.ts`, `e2e/budget.spec.ts` (قاعده ۸)؛ core `acc/acc.test.ts`; web `app/setup/languages.test.ts`, `e2e/setup.spec.ts` |
| D32 | ضبط با یک لمس (Record first) | ORG | REC, ACC | PRD بخش ۷ (گام ۲)، D13 | FR-ORG-008 | — |
| D33 | رضایت ضبط یک بار در تنظیم پروفایل، نسخه‌دار | ACC | REC, SRC | PRD-PRIV-01 | FR-ACC-003, FR-SRC-015 | core `acc/profile.int.test.ts`; web `cross-account/consents.int.test.ts`, `e2e/setup.spec.ts`, `e2e/account.spec.ts` |
| D39 | تعریف چند کورس، جلسهٔ تاریخ‌دار و مطالعهٔ پیوسته | ORG, NOTE | ACC, LKM | D13، PRD-CORE-02، PRD-NOTE-01 | FR-ORG-001، FR-ORG-002، FR-ORG-005؛ [معیارهای تغییر](plans/COURSE_LEARNING_2026-10-04.md) | core `note/course-materials.int.test.ts`؛ web `e2e/organization.spec.ts`، `e2e/course-materials.spec.ts` |
| D40 | عنوان و موضوع‌های جلسه از مطالب آموزشی با حفظ تاریخ و نام سفارشی | NOTE, LKM | ORG, PROC | PRD-CORE-02، PRD-NOTE-01 | FR-ORG-001، FR-ORG-005؛ [معیارهای تغییر](plans/SESSION_LEARNING_TITLES_2026-10-04.md) | core `note/learning-sessions.int.test.ts`؛ web `e2e/learning-session.spec.ts`؛ preview `e2e-preview/workspace.spec.ts` |
| D46 | تلفظ Recall و تدریس متناسب با سطح و هدف اعلامی | CARD, MEDIA, PROC, LKM | ACC, NOTE, SRS | PRD-CARD-01، PRD-MEDIA-04، PRD-ONB-05، PRD-SEC-01 | [AC-D46-01 تا AC-D46-07](design/RECALL_PRONUNCIATION_PERSONALIZED_NOTES_2026-10-07.md) | core `card/study-content.test.ts`، `card/study-content.int.test.ts`، `priv/media.int.test.ts`، `proc/learner-context.test.ts`، `proc/processing.int.test.ts`، `proc/generated-study-practice.test.ts`، `lkm/study-target.test.ts`، `lkm/schema.test.ts`، `lkm/study-render.test.ts` و تست‌های transport/repair؛ web `server/recall-pronunciation.test.ts`، `cross-account/classMedia.int.test.ts` و `e2e/recall-pronunciation.spec.ts`؛ ارزیابی live opt-in و replay جدا از CI در مشخصات |
| D49 | تدریس در Class Notes و حافظهٔ آموزشی شواهدمحور | PERS, LKM, PROC | SRS, CARD, NOTE, ACC, PRIV | PRD-PERS-01 تا PRD-PERS-05، PRD-NOTE-01، PRD-LKM-01، PRD-SRS-02 | [برنامهٔ D49](plans/TEACHING_MEMORY_2026-10-08.md) | core `pers/memory-rules.test.ts`، `pers/memory.int.test.ts`، `proc/learner-context.test.ts`، `proc/processing.int.test.ts`، `lkm/study-render.test.ts`؛ web `cross-account/learningFeedback.int.test.ts`، `privacy-composition.int.test.ts`، `ui/workspace/LearningMemory.test.ts`، `e2e/learning-memory.spec.ts` |
