# متن‌های رابط در انتظار تأیید مالک محصول

متن رابط باید از طرح مصوب بیاید (CLAUDE.md، «پیاده‌سازی رابط کاربری»؛ D34 و D35). متن‌های زیر برای حالت‌هایی نوشته شده‌اند که نه در `handoff/copy.md` هستند و نه در گزارش‌های بازطراحی 2026-10-04. هیچ‌کدام هنوز تأیید نشده‌اند. همه در [`apps/web/src/ui/pending-copy.ts`](../../apps/web/src/ui/pending-copy.ts) نگه داشته می‌شوند و آزمون `pending-copy.test.ts` بررسی می‌کند که هر متن عیناً در همین فهرست ثبت شده باشد.

پس از تأیید یا اصلاح هر مورد، متن نهایی به جای خودش در متن صفحه منتقل و ردیفش از این فهرست حذف می‌شود. تأییدهای تاریخ‌دار در بخش‌های زیر ثبت شده‌اند؛ آخرین‌ها «تأیید 2026-10-19» (ده متن دستهٔ ۵ و واژگان A، [D86](../PRODUCT_DECISIONS_LOG.md) و D87؛ و جملهٔ `provider_outcome_unresolved` و برچسب مجموعه‌های کارت، D89 و D88) هستند. ۱۶ متن کارت «System health» (پیشنهاد دستهٔ ۳) هم در 2026-10-19 تأیید شدند ([D97](../PRODUCT_DECISIONS_LOG.md)، بخش پایانی). هشت متن پیشرفت پایلوت و وظیفه‌های تازه (پیشنهاد دستهٔ ۱۳) هم در همان روز تأیید شدند ([D98](../PRODUCT_DECISIONS_LOG.md)). ده برچسب کارت دستهٔ ۵ (`workspace/card-labels.ts`) هم در همان روز عیناً تأیید شدند ([D100](../PRODUCT_DECISIONS_LOG.md)، بخش «تأیید 2026-10-19 — برچسب‌های کارت»). پیشنهادهای دیگر دستهٔ ۵ تأیید نشده‌اند.

**تأیید 2026-10-10:** مالک محصول همهٔ ۴۳ متنی را که در این تاریخ در فهرست بودند تأیید کرد (پیگیری D54). ۳۴ متن عیناً منتقل شدند: متن‌های صدا به [`voice/voice-copy.ts`](../../apps/web/src/ui/voice/voice-copy.ts)، متن‌های بازبینی پردازش به `AutomaticLearningView.tsx` و متن‌های `learningMemory.*` به `learning-memory-copy.ts`. نُه متن صدا (`voice.reference.short`، `expired` و `missing`؛ `voice.match.no_sample`، `no_reference` و `policy_unavailable`؛ `voice.readiness.needs_sample`، `needs_class` و `unavailable`) با D54 نمی‌خواندند، چون ممکن بود در حالتی نمایش داده شوند که calibration خود حساب (۲۰ تأیید و ۲۰ رد) کلاس‌های بعد را خودکار بپذیرد. مالک محصول در همان روز متن اصلاح‌شدهٔ هر نُه متن را عیناً تأیید کرد و آن‌ها هم به `voice-copy.ts` رفتند. پیشنهاد PR #23 برای `voice.readiness.unavailable` بدون جملهٔ سوم پذیرفته شد، چون آن جمله با سیاست `autoAccept: false` درست نیست.

پس از آن تأیید فهرست خالی شد.

**تأیید دوم 2026-10-10:** مالک محصول سه متن D55 (`voice.confirmBlockedSummary`، `voice.playback.listenFirst` و `voice.playback.clipFailed`) را عیناً تأیید کرد. این متن‌ها به [`voice/voice-copy.ts`](../../apps/web/src/ui/voice/voice-copy.ts) منتقل شدند.

**تأیید 2026-10-11:** مالک محصول چهار متن D59 و FR-QUOTA-007 (`allowance.shortage`، `allowance.shortageItem`، `allowance.none` و `allowance.covered`) را عیناً تأیید کرد. شرطش این بود که هر متن اقدام متناسب خودش را داشته باشد. متن‌ها به [`allowance-copy.ts`](../../apps/web/src/ui/allowance-copy.ts) منتقل شدند. اقدام‌ها از برچسب‌های موجود و `handoff/copy.md` ساخته شده‌اند و متن تازه‌ای ندارند:

| حالت و متن | اقدام اصلی | اقدام‌های دیگر |
|---|---|---|
| کمبود سهمیه (`allowance.shortage` با `allowance.shortageItem`) | «Ask for more allowance» | «Review material» فقط وقتی انتخاب مواد کمتر کمبود را برطرف می‌کند (صوت یا صفحه، نه نسخهٔ تازه)، و «Review allowance» |
| نبود سهمیهٔ فعال (`allowance.none`) | «Ask the pilot operator» (از بخش Allowance در `handoff/copy.md`) | «Review allowance» |
| سهمیهٔ کافی (`allowance.covered`) | «Retry» در خود پیام، و دکمهٔ اصلی «Retry processing» | پیوند درخواست سهمیه نمایش داده نمی‌شود، چون سهمیه کافی است |

وقتی مقدارها معلوم‌اند و سهمیه کم است یا وجود ندارد، دکمهٔ «Retry after allowance changes» نمایش داده نمی‌شود، چون تلاش دوباره فقط دوباره متوقف می‌شود. وضعیت هر چند ثانیه دوباره خوانده می‌شود و پس از افزایش سهمیه، «Retry processing» ظاهر می‌شود (FR-QUOTA-007 قاعدهٔ ۵). اگر مقدارها در وضعیت نیامده باشند، همان دکمهٔ «Retry after allowance changes» می‌ماند.

در Session sources، اعلان پس از بارگذاری و پیام وضعیت بدون رسید بارگذاری همین اقدام‌ها را نشان می‌دهند: کمبود سهمیه «Ask for more allowance» و «Review allowance»، نبود سهمیه «Ask the pilot operator» و «Review allowance»، و سهمیهٔ کافی «Retry processing».

**تأیید 2026-10-13 (D65، بازبینی یک‌جای پایان کار پنج مشکل):** مالک محصول همهٔ ۳۵ متن پنج جریان کار را عیناً تأیید کرد و متن‌ها از `pending-copy.ts` به فایل نهایی خود منتقل شدند:

| جریان کار | کلیدها | مقصد |
|---|---|---|
| تشخیص صدا، دور دوم (نمونهٔ صدا در شرایط کلاس، پاسخ ۸ مالک) | `voiceSample.classConditions`، `voiceSample.recordAgain`، `voiceSample.replaces` | [`voice/voice-copy.ts`](../../apps/web/src/ui/voice/voice-copy.ts) |
| ناوبری جلسه و گام بعد (۱۴ متن `sessionNavigation.*`) | `nextStep`، `uploadCount`، `audioNotReceived`، `savedOnDevice.*`، `capture.*`، `voiceCheck.*`، `voice.*` | [`workspace/session-navigation-copy.ts`](../../apps/web/src/ui/workspace/session-navigation-copy.ts) |
| ضبط داخل اپ (۴ متن `recordingCapture.*`، فقط پس از Stop) | `missingSummary`، `missingInterval`، `missingHint`، `partMissing` | [`recording/recording-copy.ts`](../../apps/web/src/ui/recording/recording-copy.ts) |
| پایداری آپلود (۶ متن `uploadReliability.*`) | `audio.uploadClosed`، `audio.notStarted`، `audio.incomplete`، `automatic.rejected`، `automatic.notStarted`، `automatic.incomplete` | [`workspace/upload-copy.ts`](../../apps/web/src/ui/workspace/upload-copy.ts) |
| کیفیت درس و عکس تخته (۸ متن `lessonQuality.*`) | `coverage.title`، `coverage.reason.*`، `review.tooLarge` | [`workspace/lesson-quality-copy.ts`](../../apps/web/src/ui/workspace/lesson-quality-copy.ts) (در جای خود، با یادداشت تأیید) |

در همان تأیید، متن مقدمهٔ صفحهٔ ضبط («After Stop, all recorded parts are saved on this device, then uploaded automatically to prepare and save your session notes and flashcards.») که با D60 دقیق نبود، با پیشنهاد گزارش ضبط جایگزین شد: «Recorded parts are saved on this device and sent while you record; after Stop the last part is sent and your notes are prepared.» (`recordingCopy.introduction`).

**تأیید دوم 2026-10-13 (D72، پیگیری مالک محصول):** مالک محصول هر هشت متن خوانایی عکس تخته (`photoQuality.ok`، `blurry`، `too_dark`، `too_bright`، `glare`، `low_detail`، `retake` و `zoomPrompt`؛ [گزارش](../plans/PHOTO_READABILITY_2026-10-13.md)) را عیناً تأیید کرد. متن‌ها از `pending-copy.ts` به [`recording/recording-copy.ts`](../../apps/web/src/ui/recording/recording-copy.ts) (`recordingCopy.photoQuality.*`) منتقل شدند. عنوان Sheet بزرگ‌نمایی همان متن alt موجود است («Board captured around {time}») و متن تازه نیست.

**تأیید 2026-10-14 (D76):** مالک محصول چهار متن حذف عکسی که فقط روی دستگاه است را عیناً تأیید کرد: «Remove this photo» (دکمهٔ ردیف عکس، footer Sheet و دکمهٔ تأیید حذف)، «Remove this photo from this device?» (عنوان `ConfirmDialog`)، «It has not been uploaded.» (تنها پیامد) و «Keep» (گزینهٔ امن). متن‌ها از `pending-copy.ts` به [`recording/recording-copy.ts`](../../apps/web/src/ui/recording/recording-copy.ts) (`recordingCopy.photoRemove.*`) منتقل شدند.

در همان روز، متن بخش «Topics covered» جلسهٔ خالی که هنوز به دکمه‌های «below» اشاره می‌کرد، با متن تأییدشدهٔ مالک محصول جایگزین شد: «Record this session or add material to get started. Your lesson title, notes and flashcards will appear automatically.» (`app/(app)/sessions/[id]/page.tsx`). این متن به جای دکمه‌ها اشاره نمی‌کند، چون اقدام‌ها در کارت بالای صفحه‌اند (D71).

پس از این تأیید فهرست خالی است.

## تأیید 2026-10-19 (ممیزی 2026-10-18، دستهٔ ۵ — متن و اصطلاحات، `fix/audit-5`)

مالک محصول در این تاریخ ده متن را عیناً تأیید کرد: هفت متن دستهٔ ۴ (UX-03، UX-09، UX-10، UX-12 و UX-14) و سه پیشنهاد UX-01 و UX-13. تأیید فقط برای دستهٔ ۵ است. ثبت نسخه‌دار: [D86](../PRODUCT_DECISIONS_LOG.md) (دستهٔ ۹، همان روز). هر متن از [`pending-copy.ts`](../../apps/web/src/ui/pending-copy.ts) (که خالی ماند) مستقیم به فایل متن صفحهٔ خودش رفت و «تا تأیید» موقت دستهٔ ۴ برداشته شد. آزمون `approved-copy.test.ts` بررسی می‌کند که هر متن عیناً در رابط و در همین بخش باشد.

- **UX-03، پیام Undo پس از Reject** (`cardActionsCopy.rejected` در [`workspace/card-actions-copy.ts`](../../apps/web/src/ui/workspace/card-actions-copy.ts)): «Card rejected». Snackbar با دکمهٔ Undo و الگوی قاب E3؛ هنگام ضبط فعال نمایش داده نمی‌شود (PRD-REC-02). دکمهٔ موقت «Undo last card change» روی کارت ردشده برداشته شد.
- **UX-09، راهنمای پیشرفت وقتی Terms تازه پردازش را نگه داشته** (`learningProgressCopy.termsGuidance` در [`workspace/learning-progress-copy.ts`](../../apps/web/src/ui/workspace/learning-progress-copy.ts)): «Read and accept the updated Terms to continue.» جملهٔ موقت `strings.settings.termsChanged` و تاریخ آن (`termsChangedOn`) از مسیر پیشرفت برداشته شد.
- **UX-10، رسید حذف حساب در وضعیت `needs_operator`** (`privacyCopy.needsOperator` در [`workspace/privacy-copy.ts`](../../apps/web/src/ui/workspace/privacy-copy.ts)): «Your account and sessions are already hidden. Removing the rest of your data needs the pilot operator. Contact the pilot operator and give them the request reference below.»
- **UX-12، صفحهٔ Allowance، «Need more allowance?»** (`allowanceHelp.need` در [`allowance-copy.ts`](../../apps/web/src/ui/allowance-copy.ts)): «The pilot operator sets your allowance. Processing starts automatically when your material is ready, as long as your allowance covers it.»
- **UX-12، صفحهٔ Allowance، «Reserved and used»** (`allowanceHelp.reserved`): «Reserved allowance is held while your material is processed. Only usable published output is charged.»
- **UX-12، خطای تغییر منابع پس از برآورد** (`workspaceErrors.sourcesChanged` در [`workspace/error-copy.ts`](../../apps/web/src/ui/workspace/error-copy.ts)): «The selected sources have changed. Check your session material, then try again.» عیناً مانده است، حتی با واژهٔ «sources»؛ بند «واژهٔ material» پایین‌تر را ببینید.
- **UX-14، بالای صفحهٔ Your data** (`privacyCopy.downloadFirst`): «To keep a copy first, open a session, choose More session tools, then Download notes and cards.»
- **UX-01، صفحهٔ ورود** (`experienceCopy.welcome.pilotNote` در [`experience-copy.ts`](../../apps/web/src/ui/experience-copy.ts)): «Built for a small pilot group. Sign in with Google to start.» همان جایی است که یادداشت حذف‌شدهٔ «coming next» بود.
- **UX-13، برآورد انتظار** (`learningProgressCopy.waitEstimate`): «Most sessions are ready within a few minutes after you stop recording. Longer recordings take longer. You can leave this page.» زیر «Waiting to process» و «Creating notes and flashcards» می‌آید و پیش از جملهٔ قبلی «Processing continues automatically, and progress updates here.» است. بدون عدد و بدون داده‌های NFR-07 است.
- **UX-13، دعوت به اعلان** (`learningProgressCopy.notificationQuestion` و `notificationAction`): «Want a message when your notes are ready? Turn on notifications in Settings.» جملهٔ دوم دکمه‌ای است که پنل «Notifications» را باز می‌کند؛ کلید روشن‌کردن اعلان دستگاه همان‌جاست و در صفحهٔ `/me` چنین ردیفی نیست. فقط وقتی دیده می‌شود که مرورگر Push را بشناسد و اجازه هنوز پرسیده نشده باشد، و هرگز هنگام ضبط فعال.

## تأیید 2026-10-19 — واژگان A (تصمیم مالک محصول برای دستهٔ ۵، UX-06)

ثبت نسخه‌دار: واژگان در [D86](../PRODUCT_DECISIONS_LOG.md) و نام تب «Sessions» در D87 (اصلاح D50).

«session» برای جلسهٔ کلاس، «course» برای درس، «material» برای همهٔ فایل‌های بارگذاری‌شده و هر پیوند به `/courses` با برچسب «Manage courses». «class» فقط برای کلاس واقعی می‌ماند («From class»، «Class audio»، «During class»). برچسب‌هایی که این واژگان می‌خواهند و در `handoff/copy.md` نیستند، با همین تصمیم تأیید شده‌اند. آزمون `strings.test.ts` برای تنها رشتهٔ `strings` آن (نام تب «Sessions») یک ورودی در `APPROVED_DEVIATIONS` دارد.

| برچسب قدیمی | برچسب تازه | محل |
|---|---|---|
| Courses (تب به `/sessions`) | Sessions | `strings.nav.classes`، تب پایین/کنار |
| Courses (عنوان صفحهٔ `/sessions`) | Sessions | `app/(app)/sessions/page.tsx` |
| Courses (ردیف Settings به `/courses`) | Manage courses | `me/ProfileSettings.tsx` |
| Courses (پیوند راهنمای Goal به `/courses`) | Manage courses | `me/edit/[field]/EditField.tsx` |
| View courses (Course tools به `/courses`) | Manage courses | `workspace/ClassDirectory.tsx` |
| View courses (صفحهٔ Allowance به `/sessions`) | View sessions | `me/quota/page.tsx` |
| Open your courses (Review به `/sessions`، دو جا) | Open your sessions | `workspace/ReviewView.tsx` |
| Go to courses (Your learning به `/sessions`) | Go to sessions | `learning-memory-copy.ts` |
| ← Back to courses (در `/courses`، به `/sessions`) | ← Back to sessions | `courses/page.tsx` |
| ← Back to courses (در `/sessions/organize`، به `/sessions`) | ← Back to sessions | `sessions/organize/page.tsx` |
| ← Back to courses (در مواد درس، به `/courses`) | ← Manage courses | `courses/[id]/materials/page.tsx` |
| Keep your sessions organised (عنوان صفحهٔ گزینه‌های جلسه) | Session options | `sessions/[id]/options/page.tsx` (برابر پیوند «Session options»؛ عنوان `/sessions/organize` همان ماند) |
| this class needs more allowance / covers this class | this session needs more allowance / covers this session | `allowance-copy.ts` (دو متن) |
| Your voice in this class؛ across this class's recordings…whole class؛ confirmed for this whole class؛ the whole class above | همان‌ها با session | `voice/voice-copy.ts` (چهار متن) |
| Session sources (عنوان پنل، پیوند مواد درس، برچسب منشأ، خلاصهٔ «Session sources and explanations») | Session material | `SourcesView.tsx`، `courses/[id]/materials/page.tsx`، `NoteView.tsx` |
| Before adding sources؛ Your existing sources؛ Use an existing source؛ Choose a source؛ فیلد Source؛ Add your first source | Before adding material؛ Your existing material؛ Use existing material؛ Choose material؛ Material؛ Add your first material | `SourcesView.tsx` |
| Source notice accepted؛ Source added…؛ Source deleted from all sessions؛ Source removed from this session | با Material | `SourcesView.tsx` |
| Delete entire source؛ «Deleting the entire source removes it…»؛ «before deleting the source» | Delete from all sessions؛ «Deleting from all sessions removes this material…»؛ «before deleting this material» | `SourcesView.tsx` |
| Change sources؛ Review sources؛ Your sources have changed…؛ selected sources؛ session sources | Change material؛ Review material؛ Your material has changed…؛ selected material؛ session material | `ProcessingView.tsx` |
| Some source details need checking؛ some source limitations | Some material details need checking؛ some material limitations | `NoteView.tsx`، `AutomaticLearningView.tsx` |
| «…remove a source from its Sources page»؛ «Removing a source from one session…»؛ «Shared cards and source files…» | «…remove material from its Session material page»؛ «Removing material from one session…»؛ «Shared cards and material files…» | `PrivacyView.tsx` |
| in Session sources (سه پیام) و «Review the sources…» | in Session material و «Review the material…» | `file-processing.ts` |
| Select fewer sources…؛ in Sources؛ Your sources remain saved | Select less material…؛ in Session material؛ Your material remains saved | `workspace/api.ts` |
| Session sources could not be updated | Session material could not be updated | `recording/source-sync.ts` |
| check its current sources؛ the session sources | check its current material؛ the session material | `voice/VoiceConfirmation.tsx` |
| Open session sources (دو پیوند به `/sessions/{id}/sources`) | Open session material | `voice/VoiceConfirmation.tsx`، `recording/RecordingView.tsx` |
| Session source N (عنوان و برچسب هر فایل صدا) | Session material N | `voice/VoiceConfirmation.tsx` |
| Session source (نام جایگزین مرجع منشأ بدون نام فایل) | Session material | `workspace/SourceRefViewer.tsx` |
| Retry adding session sources | Retry adding session material | `recording/RecordingView.tsx`، `recording/RecordingProvider.tsx` (دکمهٔ بعد از Stop) |
| Add to session sources؛ Added to session sources | Add to session material؛ Added to session material | `recording/RecordingView.tsx` |
| «…to add session sources»؛ «Adding session sources was interrupted…»؛ «Session source registration was interrupted…»؛ «…retry adding session sources» (چهار پیام) | با «session material» (پیام سوم: «Adding session material was interrupted. Audio is saved on this device; it will retry when connected.») | `recording/source-sync.ts` |

واژهٔ «sources» در جاهای زیر عمداً ماند: متن تأییدشدهٔ `workspaceErrors.sourcesChanged`، برچسب‌های ارزیابی درس (`lesson-review-copy.ts`: «Source evidence»، «Support from the sources») که به SourceRef اشاره دارند، متن‌های تأییدشدهٔ `voice-copy.ts` که از «this source» و «this session source» می‌گویند (مثل «…the original recording of this session source…»؛ متن مصوب مالک است و بدون تأیید تازه عوض نمی‌شود)، صفحه‌های `/preview` (`preview/screens.ts`، `preview/SourceViews.tsx`: «Session sources»؛ دادهٔ مصنوعی با برچسب دائم و فایل‌هایی که کار موازی دستهٔ ۱۰ است) و خطاهای داخلی بارگذاری. «lesson» برای نتیجهٔ تولیدشده («Lesson quality review»، «generated lesson») ماند.

**تعارض با D50 و بند ۱۱ بازبینی تحویل (حل‌شده با D87، 2026-10-19):** دستهٔ ۹ D87 را ثبت کرد، یادداشت اصلاح به D50 افزود و بند ۱۱ [`HANDOFF_R1_REVIEW.md`](HANDOFF_R1_REVIEW.md) را هم‌خوان کرد. متن زیر وضعیت پیش از آن را می‌گوید. D50 در `PRODUCT_DECISIONS_LOG.md` و بند ۱۱ زبانهٔ ناوبری را «Courses» مصوب کرده بودند و در این شاخه به تصمیم صریح مالک محصول (واژگان A، 2026-10-19) «Sessions» شد، چون زبانه به `/sessions` می‌رود و فهرست جلسه‌ها را نشان می‌دهد. تصمیم D50 دربارهٔ «Manage courses» برای صفحهٔ مدیریت کورس‌ها با واژگان A یکی است و عوض نشد. `PRODUCT_DECISIONS_LOG.md` و بند ۱۱ این شاخه تغییر نکردند (طبق `CLAUDE.md` تعارض گزارش می‌شود، نه اینکه خودسرانه حل شود)؛ دستهٔ تصمیم‌ها باید D50 و بند ۱۱ را با این تغییر هم‌خوان کند. مثل یادداشت D79 در بخش «دستهٔ ۵ — پیشنهادهای ثبت‌شده» پایین‌تر.

## ممیزی 2026-10-18، دستهٔ ۵ — پیشنهادهای ثبت‌شده (UX-04 و UX-05)

دو دسته‌اند. **پیشنهادهای تازه** (رسید حذف حساب و پیام‌های سرور) هنوز تأیید نشده‌اند و **در رابط نیستند**؛ جملهٔ `provider_outcome_unresolved` در 2026-10-19 تأیید شد (D89، بخش «تأیید 2026-10-19 — دستهٔ ۹» پایین)؛ هر مورد می‌گوید رابط تا تأیید چه نشان می‌دهد. **برچسب‌های ساخته‌شده از واژه‌های موجود طرح** (کارت، نوع فایل، رسانه) در رابط‌اند، چون تنها یک واژهٔ پیش‌تر مصوب را به‌جای مقدار خام می‌گذارند؛ مالک محصول آن‌ها را برای تأیید نهایی ببیند.

- **UX-04، پیام اتصال:** از متن موجود `accountCopy.error.connection` استفاده شد: «We couldn't connect. Check your internet connection and try again.» متن تازه لازم نبود. هر `catch` در `ui/workspace` (و صدا و ضبط) از `userMessage(failure, fallback)` می‌گذرد؛ خطای شبکه این پیام را می‌گیرد، کد `idempotency_mismatch` و `cross_site` متن عمومی همان صفحه را می‌گیرند و هیچ متن خام استثنا دیده نمی‌شود.
- **UX-05، خطای `provider_outcome_unresolved`** (`workspace/api.ts`) — **تأییدشده، D89 (2026-10-19)؛ متن نهایی در بخش دستهٔ ۹ پایین. شرح زیر وضعیت پیش از تأیید است.** پیشنهاد: «A result is still being checked. Contact the pilot operator before trying again.» جمله‌ٔ قدیمی «A provider result is still being checked…» واژهٔ داخلی provider داشت. تا تأیید: متن عمومی موجود «The change could not be saved. Try again.»؛ کارت پیشرفت جملهٔ مصوب «Open Processing review below for the next step.» را همچنان نشان می‌دهد. **هشدار برای مالک:** متن موقت به «Try again» دعوت می‌کند، در حالی که سرور می‌گوید تا بررسی اپراتور تلاش نکن؛ جملهٔ پیشنهادی را زودتر تأیید کن. «Open Processing review below…» را به‌جای آن نگذاشتیم، چون این خطا در صفحه‌هایی مثل Notes و Processing هم دیده می‌شود که کارت «Processing review» پایین آن‌ها نیست.
- **UX-05، رسید حذف حساب در حالت جاری** (`PrivacyView.tsx`): جمله‌ٔ «Server cleanup has been queued.» برداشته شد. پیشنهاد: «Your account and sessions are hidden. The rest of your data is being removed.» تا تأیید: فقط «Your account and sessions are hidden.»
- **UX-05، پیام‌های سرور با واژهٔ provider** (`apps/web/src/server/automatic-learning.ts`، به رابط از راه `status.message` می‌رسد): «Processing is paused while a provider result is checked…» و «…the AI service rejected a processing request…». پیشنهاد: «Processing is paused while a result is checked. Your earlier notes and cards are available. Contact the pilot operator before retrying.» این فایل سمت سرور است و آزمون‌های سرور متن را می‌سنجند، پس بدون تأیید عوض نشد.
- **UX-05، برچسب‌های کارت** (`workspace/card-labels.ts`): از واژه‌های موجود طرح ساخته شد: «Suggested» (قاب)، «Suspended»، «Known»، «Rejected» (واژهٔ وضعیت از «Card suspended»، «Known · chosen by you» و «Card rejected»)، و نام نوع‌ها از قاب‌ها و `/preview`: «Question and answer»، «Vocabulary»، «Cloze»، «Grammar point»، «Error correction»، «Listening». کارت فعال برچسب وضعیت ندارد. پیشنهاد برای وضعیت فعال: «In your review queue». **تأییدشده همان‌طور که هست، D100 (2026-10-19)؛ بخش «تأیید 2026-10-19 — برچسب‌های کارت» پایین. پیشنهاد «In your review queue» جزو آن تأیید نیست.**
- **UX-05، مجموعه‌ها** (`studySetLabel`) — **تأییدشده برای «Core cards» و «Supplementary cards»، D88 (2026-10-19)، اصلاح D79:** «Core cards»، «Supplementary cards»، «Other cards» از `learning-memory-copy.ts` (حرف اول بزرگ). **تعارض با D79 (حل‌شده با D88):** D79 همین دو برچسب را «Core · production» و «Supplementary · recognition» نوشته بود. طبق UX-05 جایگزین شد و D88 در `PRODUCT_DECISIONS_LOG.md` همراه یادداشت اصلاحیه روی D79 آن را ثبت کرد.
- **UX-05، نوع فایل و رسانه** (`source-labels.ts`، `card-labels.ts`): «Audio»، «Photo»، «PDF»، «HTML»، «Plain text» از متن «Choose audio, JPEG, PNG, WebP, PDF, HTML or plain text.»؛ برای نوع ناشناخته «File». «Computer voice N · Ready» با «Computer voice» از `strings.provenance` و وضعیت‌ها از `strings.classStatus`، به‌جای «Synthetic TTS · ready · شناسه».
- **UX-05، منطقهٔ زمانی:** `Europe/London` به نام شهر «London» تبدیل شد، مثل Settings (`timeZoneCity`).
- **UX-05، «Processing review»:** نام قابلیتی است که مالک محصول در 2026-10-10 تأیید کرده («View processing review»، «Request processing review»). بدون تأیید تازه عوض نشد.
- **UX-05، «queued» در متن‌های تأییدشده:** «The lesson review is queued…» (`lesson-review-copy.ts`) و «…are queued for removal» (حذف جلسه، `ClassForm.tsx`) انگلیسی ساده‌اند و متن مصوب‌اند؛ تغییر نکردند.

## تأیید 2026-10-19 — پیشرفت پایلوت و وظیفه‌های تازه (دستهٔ ۱۵، `fix/audit-15`، D98)

دستهٔ ۱۳ (`fix/audit-13`) داده‌های PRD-03 و پیگیری OPS-02 ([D96](../PRODUCT_DECISIONS_LOG.md)) را ساخت، ولی برچسب مصوبی برای آن‌ها در طرح پنل، `ADMIN_COMMUNICATION_COPY_2026-10-05.json` یا متن موجود `apps/web/src/ui/admin/` نبود؛ پس ستون‌ها در رابط نبودند و دو وظیفهٔ تازه عنوان عمومی «Review this task» / «بررسی این کار» را داشتند. مالک محصول در 2026-10-19 هر هشت متن پیشنهادی آن دسته را، انگلیسی و فارسی، عیناً تأیید کرد. ثبت نسخه‌دار: [D98](../PRODUCT_DECISIONS_LOG.md). متن‌ها از این فهرست به `pilotProgressCopy` و `adminTaskTitleCopy` در [`admin/copy.ts`](../../apps/web/src/ui/admin/copy.ts) منتقل شدند و آزمون `approved-copy.test.ts` هر متن انگلیسی و فارسی را عیناً با همین بخش می‌سنجد.

- **ستون‌ها:** فهرست کاربران (`Table` حساب‌ها، پس از «Welcome» و پیش از «Action») و جزئیات کاربر (یک `Table` یک‌ردیفه در کارت بالای صفحه) پنج ستون پیشرفت را نشان می‌دهند. داده همان فیلد `progress` نماهای `users` و `user` در `readAdminSnapshot` است (نوع `PilotProgress` در `packages/core/src/ops/admin-contracts.ts`): فقط تاریخ، با همان قالب تاریخ پنل (`dateLabel`)، بدون متن کلاس یا داده‌ای تازه. گامی که هنوز رخ نداده «Not yet» است. اگر برای حسابی پیشرفتی خوانده نشده باشد، فهرست «—» نشان می‌دهد (مثل بقیهٔ پنل) و جزئیات کاربر جدول را نشان نمی‌دهد. رنگ، اندازه یا کلاس CSS تازه‌ای ندارد.
- **وظیفه‌ها:** عنوان وظیفهٔ `privacy` (حذف در وضعیت `needs_operator`) و `health` (هشدار باز سلامت) متن‌های زیر است. سرور همین عنوان‌ها را می‌فرستد (`ADMIN_TASK_TITLE` در `packages/core/src/ops/admin-read.ts`) و آزمون `admin-task-copy.test.ts` دو نسخه را یکسان نگه می‌دارد. توضیح وظیفهٔ `health` همچنان جملهٔ هشدار همان شاخص از متن‌های «System health» است.
- **دکمهٔ «Take action»:** وظیفهٔ `privacy` نمای «Privacy & storage» و وظیفهٔ `health` نمای کلی (کارت «System health») را باز می‌کند؛ مقصد بقیهٔ وظیفه‌ها تغییری نکرد (`taskDestination` در [`admin/CoreScreens.tsx`](../../apps/web/src/ui/admin/CoreScreens.tsx)).

| جا (کلید در `admin/copy.ts`) | English | فارسی |
|---|---|---|
| ستون ورود (`pilotProgressCopy.column.firstSignInAt`) | «First sign-in» | «نخستین ورود» |
| ستون پایان setup (`pilotProgressCopy.column.setupCompletedAt`) | «Setup finished» | «پایان راه‌اندازی» |
| ستون صوت کلاس (`pilotProgressCopy.column.firstRecordingAt`) | «First class audio» | «نخستین صوت کلاس» |
| ستون پردازش (`pilotProgressCopy.column.firstProcessedAt`) | «First session processed» | «نخستین جلسهٔ پردازش‌شده» |
| ستون مرور (`pilotProgressCopy.column.firstReviewAt`) | «First review» | «نخستین مرور» |
| مقدار خالی (`pilotProgressCopy.notYet`) | «Not yet» | «هنوز نه» |
| عنوان وظیفهٔ `privacy` (`adminTaskTitleCopy.privacy`) | «Finish a stopped data deletion» | «تکمیل حذف داده‌ای که متوقف شده است» |
| عنوان وظیفهٔ `health` (`adminTaskTitleCopy.health`) | «Review a system health alert» | «بررسی هشدار سلامت سامانه» |

## تأیید 2026-10-19 — دستهٔ ۹ (تصمیم‌ها، `fix/audit-9`)

مالک محصول در 2026-10-19 این متن‌ها را عیناً تأیید کرد. ثبت نسخه‌دار در [`PRODUCT_DECISIONS_LOG.md`](../PRODUCT_DECISIONS_LOG.md).

- **D89، خطای `provider_outcome_unresolved` (UX-05):** `workspaceErrors.outcomeUnresolved` در [`workspace/error-copy.ts`](../../apps/web/src/ui/workspace/error-copy.ts)، که `workspace/api.ts` به‌جای متن عمومی «The change could not be saved. Try again.» نشان می‌دهد: «A result is still being checked. Contact the pilot operator before trying again.» هشدار قبلی («Try again» در حالی که سرور می‌گوید تا بررسی اپراتور تلاش نکن) با این تأیید برطرف شد. آزمون `approved-copy.test.ts` این بخش را می‌سنجد.
- **D88، برچسب مجموعه‌های کارت (UX-05، اصلاح D79):** «Core cards» و «Supplementary cards» (`studySetLabel` در `workspace/card-labels.ts`، از `learningMemoryCopy.setProduction` و `setRecognition`). جای «Core · production» و «Supplementary · recognition» در D79 را می‌گیرند. «Other cards» (کارت‌های قدیمی) همان متن پیش‌تر مصوب `learning-memory-copy.ts` است و تغییری نکرد.

هنوز در انتظار تأیید: از دستهٔ ۵ رسید حذف حساب در حالت جاری، پیام‌های سرور با واژهٔ provider، برچسب‌های نوع فایل و رسانه و پیشنهاد «In your review queue». برچسب‌های کارت در 2026-10-19 تأیید شدند (D100، بخش بعد).

## تأیید 2026-10-19 — برچسب‌های کارت (دستهٔ ۱۷، `fix/audit-17`، D100)

مالک محصول در 2026-10-19 برچسب‌هایی را که دستهٔ ۵ برای UX-05 از واژه‌های موجود طرح ساخته بود، همان‌طور که هستند تأیید کرد. ثبت نسخه‌دار: [D100](../PRODUCT_DECISIONS_LOG.md). برچسب‌ها در [`workspace/card-labels.ts`](../../apps/web/src/ui/workspace/card-labels.ts) می‌مانند (`cardStatusLabel` و `cardTemplateLabel`، که `cardSummary` آن‌ها را در فهرست کارت‌ها، ویرایشگر کارت و صفحهٔ خروجی نشان می‌دهد) و آزمون `approved-copy.test.ts` هر برچسب را عیناً با جدول زیر می‌سنجد. جای مقدار خام ذخیره‌شده (`status` و `template`) را می‌گیرند و هیچ مقدار خامی در رابط نمی‌آید.

- کارتی که فقط در مرور زبان‌آموز است (`active`) و کارت حذف‌شده (`deleted`) برچسب وضعیت ندارند. پیشنهاد «In your review queue» جزو این تأیید نیست و در رابط نمی‌آید.
- نوعی که اینجا نیست برچسب ندارد و در خلاصهٔ کارت حذف می‌شود.

| جا | مقدار ذخیره‌شده | برچسب |
|---|---|---|
| وضعیت (`cardStatusLabel`) | `candidate` | «Suggested» |
| وضعیت (`cardStatusLabel`) | `suspended` | «Suspended» |
| وضعیت (`cardStatusLabel`) | `known` | «Known» |
| وضعیت (`cardStatusLabel`) | `rejected` | «Rejected» |
| نوع کارت (`cardTemplateLabel`) | `basic` | «Question and answer» |
| نوع کارت (`cardTemplateLabel`) | `vocabulary` | «Vocabulary» |
| نوع کارت (`cardTemplateLabel`) | `cloze` | «Cloze» |
| نوع کارت (`cardTemplateLabel`) | `grammar` | «Grammar point» |
| نوع کارت (`cardTemplateLabel`) | `correction` | «Error correction» |
| نوع کارت (`cardTemplateLabel`) | `listening` | «Listening» |

## تأیید 2026-10-19 — System health (دستهٔ ۱۴، `fix/audit-14`، D97)

مالک محصول در 2026-10-19 هر ۱۶ متن کارت «System health» را که دستهٔ ۳ (`fix/audit-3`، یافتهٔ OPS-02؛ ADM-01 و ADM-12 در `ADMIN_FEEDBACK_SPEC_2026-10-05.md`) پیشنهاد کرده بود، عیناً تأیید کرد. ثبت نسخه‌دار: [D97](../PRODUCT_DECISIONS_LOG.md). متن‌ها از این فهرست به `systemHealthCopy` در [`admin/copy.ts`](../../apps/web/src/ui/admin/copy.ts) منتقل شدند و آزمون `approved-copy.test.ts` هر متن انگلیسی و فارسی را عیناً با همین بخش می‌سنجد.

- **کارت:** `SystemHealthCard` در [`admin/CoreScreens.tsx`](../../apps/web/src/ui/admin/CoreScreens.tsx)، در نمای کلی پنل مالک پس از سه کارت شاخص و پیش از «Recent activity». فقط با کامپوننت‌ها و کلاس‌های موجود پنل ساخته شده است: `Panel`، `Notice` (هشدار، یکی برای هر شاخص باز)، ردیف‌های `.task` و متن `.muted`. رنگ، اندازه یا کلاس CSS تازه‌ای ندارد.
- **داده:** همان فیلد `health` نمای `overview` در `readAdminSnapshot` (نوع `SystemHealth` در `packages/core/src/ops/admin-contracts.ts`)؛ فقط شمار و زمان، بدون متن کلاس، ایمیل یا کلید. آستانه‌ها همان `RECALINO_HEALTH_JSON` هستند. حجم با MB دهدهی (واحد سقف پلن Supabase)، انتظار صف با دقیقه، ساعت یا روزِ خود `Intl` و نسبت به زمان بررسی سرور، و آخرین اجرای runner با همان قالب تاریخ پنل نمایش داده می‌شود. نام واحدها را `Intl` می‌سازد و متن تازه نیست. وقتی صفی نیست یا runner هرگز اجرا نشده، مقدار «—» است، مثل بقیهٔ پنل. اگر نسخهٔ schema مقایسه نشده باشد (`schema: null`)، وضعیت «Cannot be checked» است.
- هشدارها همچنان در «Recent activity» و «Activity history» با شناسهٔ اقدام هم دیده می‌شوند: `ops.health_alert` و `ops.health_recovered` (موضوع: نام شاخص)، و `ops.schema_behind` (موضوع: نسخهٔ migration مورد انتظار).

| جا (کلید در `systemHealthCopy`) | English | فارسی |
|---|---|---|
| عنوان کارت (`title`) | «System health» | «سلامت سامانه» |
| ردیف حجم دیتابیس (`databaseSize`) | «Database size» | «حجم دیتابیس» |
| توضیح حجم (`databaseSizeDetail`) | «{size} of {limit} alert limit» | «{size} از آستانهٔ هشدار {limit}» |
| ردیف کارهای ناموفق (`failedJobs`) | «Jobs failed in the last hour» | «کارهای ناموفق در ساعت گذشته» |
| ردیف صف (`queueWait`) | «Longest wait in the queue» | «طولانی‌ترین انتظار در صف» |
| ردیف runner (`lastRunner`) | «Last job runner run» | «آخرین اجرای اجراکنندهٔ کارها» |
| ردیف schema (`schema`) | «Database schema» | «نسخهٔ schema دیتابیس» |
| وضعیت schema: `current` (`schemaState.current`) | «Up to date» | «به‌روز» |
| وضعیت schema: `ahead` (`schemaState.ahead`) | «Newer than the app» | «جلوتر از اپ» |
| وضعیت schema: `behind` (`schemaState.behind`) | «A migration is missing; jobs are paused» | «یک migration اعمال نشده است؛ اجرای کارها متوقف است» |
| وضعیت schema: `unknown` (`schemaState.unknown`) | «Cannot be checked» | «قابل بررسی نیست» |
| بدون هشدار (`noAlert`) | «No signal is over its threshold.» | «هیچ شاخصی از آستانه‌اش نگذشته است.» |
| هشدار `database_size` (`alert.database_size`) | «The database is near its size limit.» | «دیتابیس به سقف حجم نزدیک است.» |
| هشدار `failed_jobs` (`alert.failed_jobs`) | «A job failed and will not retry.» | «کاری ناموفق شد و دوباره اجرا نمی‌شود.» |
| هشدار `queue_delay` (`alert.queue_delay`) | «Jobs are waiting longer than expected.» | «کارها بیش از حد انتظار در صف مانده‌اند.» |
| هشدار `runner_stale` (`alert.runner_stale`) | «The job runner has not run recently.» | «اجراکنندهٔ کارها اخیراً اجرا نشده است.» |
