import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Presentation, PresentationFile } from '@oai/artifact-tool';
import sharp from 'sharp';

process.env.RUNTIME_NODE_MODULES='C:/Users/Ali-PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';

const ROOT = 'D:/Claude Projects/Recalino';
const BUILD = `${ROOT}/artifacts/recalino-presentation/.build`;
const SKILL = 'C:/Users/Ali-PC/.codex/plugins/cache/openai-primary-runtime/presentations/26.909.12148/skills/presentations';
const PYTHON = 'C:/Users/Ali-PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const VERSION = process.argv[2] ?? 'v2';
const OUT = `${ROOT}/artifacts/recalino-presentation/output/Recalino_Introduction_FA_${VERSION}.pptx`;
const SCREEN = `${ROOT}/artifacts/ui-redesign/complete`;
const { finalizePresentation } = await import(pathToFileURL(`${SKILL}/container_tools/artifact_tool_utils.mjs`).href);
const C = { paper:'#F6F7F2', ink:'#1C3028', green:'#28634A', muted:'#58685F', tint:'#E9F1DD', lime:'#D9EDB1', dark:'#111B17', light:'#EAF0E7', dim:'#B0C1B5', class:'#8C2F6A', ai:'#5D4BB0', edit:'#2B5A8E' };
const FONT = 'Segoe UI';
const pres = Presentation.create({slideSize:{width:1280,height:720}});
pres.theme.colorScheme={name:'Recalino',themeColors:{accent1:C.green,accent2:C.lime,accent3:C.class,accent4:C.ai,accent5:C.edit,accent6:C.muted,bg1:C.paper,bg2:C.dark,tx1:C.ink,tx2:C.muted,dk1:C.dark,dk2:C.ink,lt1:'#FFFFFF',lt2:C.paper,hlink:C.lime,folHlink:C.light}};
let number = 0;
function text(slide, value, x,y,w,h,size=26,color=C.ink,bold=false,align='right',name='Text') {
  const s = slide.shapes.add({geometry:'textbox',name,position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
  s.text = value;
  s.text.style = {typeface:FONT,fontSize:size,color,bold,alignment:align,verticalAlignment:'top',autoFit:'none',wrap:'square',insets:{left:0,right:0,top:0,bottom:0}};
  return s;
}
function slide(bg=C.paper) {
  const s = pres.slides.add(); s.background.fill=bg; number++;
  text(s, String(number).padStart(2,'0'),60,672,60,25,16,bg===C.dark?C.dim:C.muted,false,'left','Page number');
  return s;
}
function title(s,t,color=C.ink){text(s,t,60,44,1160,80,46,color,true,'right','Slide title');}
function note(s,body,sources=[]){
  s.speakerNotes.textFrame.setText(`${body}\n\nمنابع:\n${sources.map(x=>`${ROOT}/${x}`).join('\n')}`);
}
async function image(s,file,x,y,w,h,crop=null,alt='نمای رابط Recalino با دادهٔ نمونه') {
  const p=file.startsWith('/')||/^[A-Z]:/i.test(file)?file:`${SCREEN}/${file}`;
  let bytes=await fs.readFile(p);
  if(crop) bytes=await sharp(bytes).extract({left:crop[0],top:crop[1],width:crop[2],height:crop[3]}).png().toBuffer();
  s.images.add({blob:new Uint8Array(bytes),contentType:crop?'image/png':p.endsWith('.jpg')?'image/jpeg':'image/png',alt,fit:'contain',position:{left:x,top:y,width:w,height:h}});
}
function caption(s,t='نمای رابط با دادهٔ نمونه',color=C.muted,x=60,w=800){text(s,t,x,637,w,28,18,color,false,'left','Screenshot caption');}
function pair(s,heading,body,y,x=905,w=315,color=C.ink,muted=C.muted){
  text(s,heading,x,y,w,60,29,color,true);text(s,body,x,y+66,w,130,24,muted);
}

// 01: A restrained cover built around the official app artwork.
{
 const s=slide(C.dark);
 await image(s,`${ROOT}/apps/web/public/icons/icon-512.png`,125,237,250,250,null,'آیکون رسمی Recalino');
 text(s,'Recalino',535,182,680,112,88,C.light,true,'right','Deck title');
 text(s,'یادگیری انگلیسی،\nبا محتوای کلاس خودت',535,316,680,165,48,C.lime,true);
 text(s,'فضای شخصی زبان‌آموزان بزرگسال ۱۸+',535,527,680,46,27,C.dim);
 text(s,'۴ اکتبر ۲۰۲۶',535,590,680,32,19,C.dim);
 note(s,'ریکالینو یک فضای شخصی یادگیری انگلیسی برای بزرگسالان است. منابع هر جلسه را کنار هم نگه می‌دارد و آن‌ها را به جزوه و تمرین تبدیل می‌کند. این ارائه تجربهٔ محصول و امکانات پیاده‌سازی‌شدهٔ نسخهٔ اولیه را معرفی می‌کند.', ['PRD_Recalino_FA_v0.3.md','CLAUDE.md']);
}
// 02: Product problem without invented market figures.
{
 const s=slide();title(s,'فاصلهٔ میان کلاس و تمرین');
 text(s,'کلاس تمام می‌شود.\nمنابع هنوز پراکنده‌اند.',650,190,570,180,49,C.ink,true);
 text(s,'ریکالینو محتوای همان کلاس را\nبه نقطهٔ شروع تمرین بعدی تبدیل می‌کند.',650,411,570,123,30,C.green);
 pair(s,'منابع در چند جا','صدای کلاس، جزوه و عکس تخته باید دوباره کنار هم قرار بگیرند.',193,60,480);
 pair(s,'فرصت محدود برای مرور','زبان‌آموز به یک مسیر روشن برای انتخاب و تمرین نکات مهم نیاز دارد.',411,60,480);
 note(s,'این‌ها مسئله‌ها و فرض‌های طراحی در سند محصول هستند، نه نتایج یک پژوهش بازار یا ادعای اندازه‌گیری‌شده. مخاطب اولیه، زبان‌آموز بزرگسال انگلیسی است که می‌خواهد بعد از کلاس با محتوای مرتبط تمرین کند.', ['PRD_Recalino_FA_v0.3.md']);
}
// 03: Four distinct actions in a flat, editable composition.
{
 const s=slide(C.dark);title(s,'مسیر یادگیری در ریکالینو',C.light);
 const steps=[['۰۱','منابع کلاس','ضبط یا افزودن صوت،\nسند، عکس و متن'],['۰۲','جزوهٔ مستند','نکات درس با ارجاع\nبه منابع همان جلسه'],['۰۳','کارت‌های منتخب','انتخاب و ویرایش نکاتی\nکه می‌خواهی تمرین کنی'],['۰۴','مرور روزانه','یادآوری فعال با\nزمان‌بندی متناسب با پاسخ']];
 for(let i=0;i<4;i++){const x=955-i*298;text(s,steps[i][0],x,240,265,92,65,C.lime,true);text(s,steps[i][1],x,352,265,64,34,C.light,true);text(s,steps[i][2],x,440,265,135,25,C.dim);}
 note(s,'چرخهٔ اصلی چهار مرحله دارد. کاربر منابع را انتخاب می‌کند، جزوهٔ مستند می‌خواند، کارت‌ها را تأیید یا ویرایش می‌کند و در مرور روزانه به آن‌ها پاسخ می‌دهد. برنامهٔ مرور واقعی از FSRS استفاده می‌کند. فضای نمونه برنامهٔ مرور واقعی را محاسبه نمی‌کند.', ['docs/plans/M5_MVP_COMPLETION.md','packages/core/src/card/schema.ts']);
}
// 04: Current signed-in UI captured during this task.
{
 const s=slide();title(s,'شروع روشن برای هر روز');
 await image(s,`${BUILD}/assets/today-live.jpg`,60,145,630,477,[0,0,901,896],'اسکرین‌شات تازهٔ صفحهٔ واقعی Today در حساب بدون کلاس');
 text(s,'یک صفحه برای\nقدم بعدی یادگیری',750,181,470,127,39,C.ink,true);
 text(s,'ضبط کلاس یا افزودن منابع\nدیدن جلسه‌های اخیر\nشروع مرور کارت‌های امروز',750,373,470,168,29,C.green);
 caption(s,'نمای واقعی صفحهٔ امروز، پیش از افزودن اولین کلاس');
 note(s,'این تصویر در همین درخواست از صفحهٔ واقعی /today در مرورگر ثبت شد. حساب هنوز کلاسی ندارد، بنابراین تصویر وضعیت آغاز استفاده را نشان می‌دهد. بازبودن این صفحه تنها مشاهدهٔ رابط فعلی است و تأیید کامل پردازش کلاس واقعی محسوب نمی‌شود.', ['apps/web/src/app/(app)/today/page.tsx']);
}
// 05: The class is the organizing unit.
{
 const s=slide();title(s,'هر جلسه، فضای یادگیری خودش را دارد');
 await image(s,'class-desktop-light.png',60,146,805,480,[286,180,1120,800]);
 pair(s,'نظم بر اساس کلاس','منابع، جزوه و کارت‌ها به همان جلسه متصل می‌مانند.',171);
 pair(s,'دوره و واحد','جلسه‌ها را دسته‌بندی، جابه‌جا یا دوباره پیدا می‌کنی.',403);
 caption(s);
 note(s,'سازمان‌دهی محصول از دوره، واحد و جلسه پشتیبانی می‌کند. صفحهٔ کلاس نقطهٔ اتصال منابع به جزوه، کارت‌ها و تاریخچه است. عنوان Present perfect و تعداد منابع در تصویر مربوط به دادهٔ مصنوعی فضای نمونه‌اند.', ['docs/plans/M5_MVP_COMPLETION.md','apps/web/src/ui/workspace/CourseManager.tsx','apps/web/src/ui/workspace/ClassRows.tsx']);
}
// 06: Actual source options, shown with the recording preview.
{
 const s=slide();title(s,'صدای کلاس و منابع نوشتاری، کنار هم');
 await image(s,'upload-desktop-light.png',60,152,638,468,[306,240,1076,895]);
 await image(s,'recording-mobile-light.png',734,149,188,470,[0,274,390,731]);
 text(s,'ورودی‌های کلاس',962,169,258,54,30,C.ink,true);
 text(s,'صوت\nعکس تخته\nسند و متن',962,244,258,158,29,C.green);
 text(s,'منابع و مصرف سهمیه را پیش از پردازش بررسی می‌کنی.',962,454,258,157,24,C.muted);
 caption(s,'نمای رابط با دادهٔ نمونه؛ ضبط در این پیش‌نمایش نمایشی است');
 note(s,'بک‌اند نسخهٔ اولیه برای ضبط مرورگر با مکث و ادامه، ذخیره و بازیابی محلی، و افزودن صوت، عکس، PDF و متن پیاده‌سازی شده است. تصویر ضبط فقط نمایش مصنوعی است و میکروفون را فعال نمی‌کند. ضبط واقعی باید با اجازهٔ افراد حاضر انجام شود. آزمون ضبط طولانی در دستگاه‌های هدف هنوز کامل نشده است.', ['docs/plans/M5_MVP_COMPLETION.md','apps/web/src/ui/recording/RecordingView.tsx','apps/web/src/ui/workspace/SourcesView.tsx']);
}
// 07: A large crop keeps the note text legible.
{
 const s=slide();title(s,'جزوهٔ کلاس با نکات و مثال‌های مرتبط');
 await image(s,'notes-desktop-light.png',60,148,800,478,[305,580,700,535]);
 pair(s,'نکات همان جلسه','توضیح، مثال و تمرین در یک جزوهٔ قابل ویرایش جمع می‌شوند.',171);
 pair(s,'ویرایش نسخه‌دار','اصلاح‌های تو حفظ می‌شوند و نسخهٔ جدید را می‌توان مقایسه کرد.',403);
 caption(s,'بخشی از جزوهٔ نمونهٔ Present perfect');
 note(s,'جزوه از مدل دانشی ساخت‌یافته ساخته می‌شود و بخش‌های محتوایی منشأ مشخص دارند. ویرایش کاربر نسخهٔ جدید می‌سازد. تولید مجدد به صورت پیشنهاد انجام می‌شود و نباید اصلاح‌های کاربر را بدون تصمیم او بازنویسی کند. مثال‌های این تصویر مصنوعی‌اند.', ['apps/web/src/ui/workspace/NoteView.tsx','docs/plans/M5_MVP_COMPLETION.md','CLAUDE.md']);
}
// 08: Provenance is the differentiation, stated concretely.
{
 const s=slide();title(s,'منبع هر نکته روشن است');
 await image(s,'source-desktop-light.png',60,154,591,470,[304,244,1079,858]);
 const items=[['از کلاس',C.class,'ارجاع به زمان صوت یا صفحهٔ سند'],['توضیح هوش مصنوعی',C.ai,'توضیح تکمیلی با منشأ مشخص'],['ویرایش تو',C.edit,'اصلاح شخصی با حفظ تاریخچه']];
 for(let i=0;i<3;i++){text(s,items[i][0],728,178+i*153,492,53,32,items[i][1],true);text(s,items[i][2],728,239+i*153,492,64,25,C.muted);}
 caption(s,'نمای منبعِ جزوه در فضای نمونه');
 note(s,'تمایز میان محتوای کلاس، توضیح افزودهٔ AI و ویرایش کاربر یک اصل محصول است. ادعای منتسب به کلاس باید ارجاع معتبر داشته باشد. ارجاع قابل بررسی، تضمین صحت آموزشی کامل نیست و زبان‌آموز باید نکات مهم را با منبع مقایسه کند.', ['CLAUDE.md','apps/web/src/ui/workspace/SourceRefViewer.tsx','docs/plans/M5_MVP_COMPLETION.md']);
}
// 09: Six card formats, as native slide labels plus a source screenshot.
{
 const s=slide();title(s,'شش قالب برای تمرین نکات مهم');
 await image(s,'card-types-desktop-light.png',60,149,725,480,[305,374,1076,862]);
 text(s,'پرسش و پاسخ\nواژگان\nجای خالی\nنکتهٔ گرامری\nاصلاح خطا\nشنیداری',853,154,367,408,29,C.green);
 text(s,'کارت‌ها را پیش از افزودن\nبه مرور انتخاب و ویرایش می‌کنی.',853,563,367,76,24,C.muted);
 caption(s,'نمونه‌های شش قالب کارت در رابط برنامه');
 note(s,'شش نوع کارت در schema واقعی تعریف شده‌اند: پرسش و پاسخ، واژگان، جای‌خالی، گرامر، اصلاح خطا و شنیداری. کارت‌های پیشنهادشده ابتدا در کنترل کاربرند. صوت نمونهٔ شنیداری، صدای رایانه‌ای است و بریدهٔ ضبط کلاس نیست. تصویر تولیدی AI در دامنهٔ MVP نیست.', ['packages/core/src/card/schema.ts','apps/web/src/ui/workspace/CardsView.tsx','apps/web/src/ui/workspace/CardEditor.tsx']);
}
// 10: A calmer, dark slide for the focused review interaction.
{
 const s=slide(C.dark);title(s,'مرور بر اساس پاسخ تو',C.light);
 await image(s,'review-answer-desktop-light.png',78,151,381,480,[459,269,522,808]);
 text(s,'یادآوری پیش از\nدیدن پاسخ',586,180,634,137,44,C.lime,true);
 text(s,'پاسخ را مقایسه می‌کنی و نتیجهٔ یادآوری را ثبت می‌کنی. زمان مرور بعدی با الگوریتم FSRS تنظیم می‌شود.',586,373,634,136,29,C.light);
 text(s,'مرور کوتاه با هدف زمانی قابل تنظیم',586,568,634,54,25,C.dim);
 caption(s,'نمای جلسهٔ نمونه؛ زمان‌بندی واقعی در پیش‌نمایش اجرا نمی‌شود',C.dim,60,1160);
 note(s,'مرور محصول واقعی از FSRS استفاده می‌کند. رابط Simple و Advanced، بازگرداندن پاسخ اخیر و هدف زمانی را پشتیبانی می‌کند. نتیجهٔ پاسخ کاربر ورودی زمان‌بندی است. نمایش Forgot و Remembered در تصویر متعلق به نمونهٔ مستقل است. این نمونه برنامهٔ واقعی حساب را تغییر نمی‌دهد.', ['apps/web/src/ui/workspace/ReviewView.tsx','apps/web/src/ui/workspace/ReviewSettings.tsx','docs/plans/M5_MVP_COMPLETION.md']);
}
// 11: Personalization with the experimental label retained.
{
 const s=slide();title(s,'توضیح‌ها به زبان انتخابی تو');
 await image(s,'setup-explanations-desktop-light.png',60,151,705,470,[339,268,761,526]);
 pair(s,'انتخاب زبان توضیح','انگلیسی یا زبان اول؛ واژه‌ها و مثال‌های کلاس انگلیسی می‌مانند.',176,819,401);
 pair(s,'تنظیم مسیر شخصی','سطح و هدف یادگیری و منطقهٔ زمانی را خودت انتخاب می‌کنی.',406,819,401);
 caption(s,'نمای نمونه؛ توضیح به زبان اول فعلاً آزمایشی است');
 note(s,'رابط اصلی نسخهٔ اولیه انگلیسی است. زبان توضیح قابل انتخاب است و محتوا برای فارسی و دیگر خط‌ها نمایش مناسب دارد. توضیح زبان اول با برچسب Experimental ارائه می‌شود و ادعای کیفیت تضمین‌شده ندارد. سطح انتخابی کاربر نتیجهٔ آزمون تعیین سطح محسوب نمی‌شود.', ['apps/web/src/ui/workspace/LearningProfile.tsx','apps/web/src/ui/profile-copy.ts','docs/PRODUCT_DECISIONS_LOG.md']);
}
// 12: Preview HTML crop avoids presenting an inactive Anki demo as live.
{
 const s=slide();title(s,'جزوه و کارت‌ها همراهت می‌مانند');
 await image(s,'export-desktop-light.png',99,148,351,481,[318,399,400,548]);
 text(s,'HTML',623,178,597,56,39,C.green,true,'right');
 text(s,'نسخهٔ مستقل جزوه برای مطالعه در مرورگر،\nحتی بدون اتصال به برنامه',553,248,667,105,29,C.ink);
 text(s,'Anki',623,410,597,56,39,C.green,true,'right');
 text(s,'خروجی کارت‌ها در قالب APKG\nبرای انتقال به Anki',553,480,667,105,29,C.ink);
 caption(s,'بخش خروجی HTML در فضای نمونه');
 note(s,'خروجی HTML مستقل و خروجی APKG در بک‌اند پیاده‌سازی شده‌اند. یک APKG با دادهٔ مصنوعی به Anki وارد و تکرار بدون دوگانگی آزمایش شده است. فضای preview به صادرکنندهٔ APKG واقعی متصل نیست. همگام‌سازی یا واردکردن داده از Anki و مرور کاملاً آفلاین جزو MVP نیستند.', ['apps/web/src/ui/workspace/ExportView.tsx','docs/plans/M5_MVP_COMPLETION.md','artifacts/verification/anki-import.json']);
}
// 13: Privacy explained as product behavior.
{
 const s=slide();title(s,'کنترل روشن روی منابع و داده‌ها');
 await image(s,'data-controls-desktop-light.png',70,150,567,474,[414,269,611,586]);
 text(s,'انتخاب دقیق برای حذف',718,178,502,60,33,C.ink,true);
 text(s,'فقط جداکردن از کلاس، حذف فایل اصلی یا حذف کامل محتوای وابسته',718,256,502,127,28,C.muted);
 text(s,'صدای اصلی روی دستگاه',718,427,502,60,33,C.green,true);
 text(s,'نسخهٔ سرور برای رونویسی است و حداکثر ۲۴ ساعت پس از رونویسی موفق حذف می‌شود.',718,505,502,127,26,C.muted);
 caption(s,'نمای انتخاب‌های حذف در فضای نمونه');
 note(s,'این اسلاید رفتار مصوب و پیاده‌سازی‌شدهٔ نسخهٔ اولیه را توضیح می‌دهد. منابع خصوصی‌اند. نسخهٔ اصلی ضبط روی دستگاه کاربر می‌ماند و نسخهٔ سرور برای رونویسی حداکثر ۲۴ ساعت پس از موفقیت نگه داشته می‌شود. متن حقوقی و قرارداد پردازش داده پیش از پایلوت با محتوای واقعی هنوز نیازمند تأییدند. هیچ ادعای گواهی امنیت یا انطباق حقوقی مستقل مطرح نمی‌شود.', ['docs/PRODUCT_DECISIONS_LOG.md','CLAUDE.md','docs/plans/M5_MVP_COMPLETION.md','apps/web/src/ui/workspace/PrivacyView.tsx']);
}
// 14: Maturity without implying a production launch or proven outcomes.
{
 const s=slide(C.dark);title(s,'وضعیت نسخهٔ فعلی',C.light);
 text(s,'پیاده‌سازی‌شده',731,186,489,60,38,C.lime,true);
 text(s,'سازمان‌دهی کلاس و منابع\nجزوه و کارت‌های قابل ویرایش\nمرور FSRS و خروجی فایل',731,274,489,222,29,C.light);
 text(s,'مرحلهٔ بعد',60,186,560,60,38,C.lime,true);
 text(s,'پایلوت کنترل‌شده با زبان‌آموزان\nارزیابی انسانی کیفیت آموزشی\nتکمیل تأییدهای حقوقی و داده',60,274,560,222,29,C.light);
 text(s,'آزمون‌های AI و نمونه‌های این ارائه از دادهٔ مصنوعی استفاده کرده‌اند.',60,573,1160,61,24,C.dim);
 note(s,'بر اساس گزارش تکمیل MVP در ۴ اکتبر ۲۰۲۶، امکانات اصلی پیاده‌سازی و با آزمون‌های خودکار و دادهٔ مصنوعی بررسی شده‌اند. تصاویر نمونه، شواهد یادگیری کاربران واقعی نیستند. بازبودن صفحهٔ واقعی Today در مرورگر در زمان تهیهٔ ارائه مشاهده شد، بنابراین ادعای قدیمی غیرفعال‌بودن ورود Google در این اسلاید تکرار نمی‌شود. فعال‌سازی پردازش محتوای واقعی و کیفیت آموزشی هنوز به تأییدها و پایلوت وابسته است. نتیجهٔ آموزشی یا نرخ نگهداشت ساختگی ارائه نشده است.', ['docs/plans/M5_MVP_COMPLETION.md','docs/PRODUCT_DECISIONS_LOG.md']);
}
// 15: Closing with the mobile interface, never reused elsewhere.
{
 const s=slide(C.dark);
 await image(s,'today-mobile-dark.png',99,68,269,548,[0,0,390,749]);
 text(s,'Recalino',511,155,709,98,76,C.light,true,'right');
 text(s,'کلاس امروز،\nتمرین روزهای بعد',511,286,709,156,49,C.lime,true);
 const link=text(s,'مشاهدهٔ فضای نمونهٔ ریکالینو',511,511,709,53,28,C.light,true);
 link.text.get('مشاهدهٔ فضای نمونهٔ ریکالینو').link={uri:'https://recalino-hme6gdlf3-ali-paybarjay-s-projects.vercel.app/preview/today',isExternal:true};
 link.text.get('مشاهدهٔ فضای نمونهٔ ریکالینو').fill=C.lime;
 text(s,'فضایی برای یادگیری با محتوای خودت',511,595,709,47,26,C.dim);
 caption(s,'نمای موبایل با دادهٔ نمونه',C.dim,60,390);
 note(s,'برای ادامهٔ معرفی، فضای نمونه را باز کنید و مسیر Today، Class، Notes، Cards و Review را طی کنید. لینک به همان استقرار مشاهده‌شده در مرورگر اشاره دارد و ممکن است دسترسی به محافظت استقرار وابسته باشد. نمای موبایل دادهٔ مصنوعی دارد. این دعوت برای تجربهٔ رابط است.', ['apps/web/src/ui/preview/screens.ts','docs/design/COMPLETE_UI_REDESIGN_2026-10-04.md']);
}

await fs.mkdir(`${BUILD}/draft-render`,{recursive:true});
const candidate=`${BUILD}/candidate-${VERSION}.pptx`;
await (await PresentationFile.exportPptx(pres)).save(candidate);
await fs.writeFile(`${BUILD}/deck.json`,JSON.stringify(pres.toProto()));
// Native text stays editable. OOXML adds Persian reading direction, which the
// Artifact Tool paragraph facade currently does not expose.
const {spawnSync}=await import('node:child_process');
const rtlCandidate=`${BUILD}/candidate-rtl-${VERSION}.pptx`;
const patch=spawnSync(PYTHON,[`${ROOT}/artifacts/recalino-presentation/.probe/patch_persian_rtl.py`,candidate,rtlCandidate,'--font',FONT],{encoding:'utf8'});
if(patch.status!==0)throw new Error(`RTL patch failed: ${patch.stderr||patch.stdout}`);
console.log(patch.stdout);
const finalized=await finalizePresentation({workspaceDir:ROOT,candidatePath:rtlCandidate,finalPath:OUT,pythonExecutable:PYTHON,integrityValidatorPath:`${SKILL}/container_tools/inspect_presentation_package_integrity.py`,layoutValidatorPath:`${SKILL}/container_tools/inspect_presentation_layout_geometry.py`,layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-heading-fit'],fontPolicy:{basis:'design',families:[FONT]},verifyArtifactToolImport:true,requiredNativeTableOwnerSlides:[],requiredNativeChartOwnerSlides:[],receiptPath:`${BUILD}/validation-${VERSION}.json`});
console.log(JSON.stringify({output:OUT,slideCount:number,validation:'passed',sha256:finalized.finalSha256}));
