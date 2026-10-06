import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const requireWeb = createRequire(resolve(root, 'apps/web/package.json'));
const { chromium, firefox, webkit } = requireWeb('@playwright/test');
const output = resolve(root, 'artifacts/branded-email');
mkdirSync(output, {recursive:true});
const report = { synthetic:true, sentRealEmail:false, checkedAt:new Date().toISOString(), engines:[], checks:[] };
for (const [engine, type] of Object.entries({chromium,firefox,webkit})) {
  if (!existsSync(type.executablePath())) { report.engines.push({engine, available:false}); continue; }
  const browser = await type.launch({headless:true});
  report.engines.push({engine, available:true});
  try {
    for (const template of ['pilot_welcome','feedback_thanks','support_reply']) for (const language of ['en','fa']) for (const width of [390,800]) {
      const page = await browser.newPage({viewport:{width,height:1000}});
      const remoteRequests=[];
      await page.route(/^https?:/, route=>{remoteRequests.push(route.request().url());return route.abort();});
      const html=readFileSync(resolve(root,`artifacts/email-branding/${template}-${language}.html`),'utf8');
      await page.setContent(html,{waitUntil:'load'});
      const metrics=await page.evaluate(()=>({
        direction:document.documentElement.dir,language:document.documentElement.lang,
        viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,
        logo:[...document.images].every(image=>image.complete&&image.naturalWidth===192),
        headline:getComputedStyle(document.querySelector('h1')).fontSize,
        body:document.body.innerText.length,
        action:[...document.querySelectorAll('a')].filter(a=>a.dataset.previewHref?.startsWith('https:')).length,
        actionTargets:new Set([...document.querySelectorAll('a')].map(a=>a.dataset.previewHref).filter(url=>url?.startsWith('https:'))).size,
        liveLinks:document.querySelectorAll('a[href]').length,
        scriptCount:document.scripts.length,
      }));
      const passed=metrics.direction===(language==='fa'?'rtl':'ltr')&&metrics.language===language&&metrics.scrollWidth<=width&&metrics.logo&&metrics.body>100&&metrics.action===2&&metrics.actionTargets===1&&metrics.liveLinks===0&&metrics.scriptCount===0&&remoteRequests.length===0;
      report.checks.push({engine,template,language,width,passed,...metrics,remoteRequestCount:remoteRequests.length});
      if(engine==='chromium')await page.screenshot({path:resolve(output,`${template}-${language}-${width}.png`),fullPage:true});
      await page.close();
    }
  } finally {await browser.close();}
}
report.passed=report.checks.length>=12&&report.checks.every(check=>check.passed);
writeFileSync(resolve(output,'render-verification.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,engines:report.engines,failed:report.checks.filter(c=>!c.passed)}));
if(!report.passed)process.exitCode=1;
