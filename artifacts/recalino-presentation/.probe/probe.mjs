import fs from 'node:fs/promises';
import { Presentation, PresentationFile } from 'file:///C:/Users/Ali-PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs';
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/Ali-PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/probe.cjs');
for (const name of ['skia-canvas', '@napi-rs/canvas']) {
  try { const m = require(name); console.log(name, m.FontLibrary?.families ?? m.GlobalFonts?.families); } catch(e) { console.log(name, String(e)); }
}
const presentation=Presentation.create({slideSize:{width:1280,height:720}});
const slide=presentation.slides.add();slide.background.fill='#FFFFFF';
const samples=[
  ['Segoe UI', 'یادگیری هدفمند با Recalino', {}, 32],
  ['Segoe UI', 'یادگیری\u00a0هدفمند\u00a0با\u00a0Recalino', {}, 136],
  ['Segoe UI', 'یادگیری\u202fهدفمند\u202fبا\u202fRecalino', {}, 240],
  ['Segoe UI', 'یادگیری\u2007هدفمند\u2007با\u2007Recalino', {}, 344],
  ['Segoe UI', 'یادگیریهدفمندباRecalino', {}, 448],
  ['Segoe UI', 'یادگیری\u2060 هدفمند\u2060 با\u2060 Recalino', {}, 552],
];
for(const [family,txt,para,top] of samples){
  const shape=slide.shapes.add({geometry:'textbox',position:{left:72,top,width:1136,height:86},fill:'none',line:{fill:'none',width:0}});
  shape.text=[{runs:[txt],paragraphStyle:para}];shape.text.style={typeface:family,fontSize:48,color:'#142735',alignment:'right',autoFit:'none',insets:{left:0,right:0,top:0,bottom:0}};
}
const dir='D:/Claude Projects/Recalino/artifacts/recalino-presentation/.probe';
await (await PresentationFile.exportPptx(presentation)).save(dir+'/probe.pptx');
const png=await presentation.export({slide,format:'png',scale:1});
await fs.writeFile(dir+'/probe.png',new Uint8Array(await png.arrayBuffer()));
await fs.writeFile(dir+'/layout.json',await (await slide.export({format:'layout'})).text());
console.log('done');
