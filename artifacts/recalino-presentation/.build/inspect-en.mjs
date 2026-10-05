import fs from 'node:fs/promises';
import {FileBlob,PresentationFile} from '@oai/artifact-tool';
const pres=await PresentationFile.importPptx(await FileBlob.load('D:/Claude Projects/Recalino/artifacts/recalino-presentation/output/Recalino_Introduction_FA_v4.pptx'));
const snap=await pres.inspect({kind:'slide,textbox,shape,image,notes,layout',maxChars:200000});
await fs.writeFile('D:/Claude Projects/Recalino/artifacts/recalino-presentation/.build/english-source-inspect.ndjson',snap.ndjson);
const records=snap.ndjson.split('\n').filter(Boolean).map(x=>JSON.parse(x));
const target=pres.resolve(records.find(r=>r.kind==='textbox'&&r.name==='Deck title').id);
console.log(JSON.stringify({records:records.length,slides:records.filter(r=>r.kind==='slide').length,images:records.filter(r=>r.kind==='image').length,text:{fontSize:target.text.fontSize,color:target.text.color,bold:target.text.bold,typeface:target.text.typeface,alignment:target.text.alignment},frame:target.position}));
