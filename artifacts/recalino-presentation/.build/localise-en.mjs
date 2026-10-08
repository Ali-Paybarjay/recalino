import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {FileBlob,PresentationFile} from '@oai/artifact-tool';

process.env.RUNTIME_NODE_MODULES='C:/Users/Ali-PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const ROOT='D:/Claude Projects/Recalino';
const BUILD=`${ROOT}/artifacts/recalino-presentation/.build`;
const SKILL='C:/Users/Ali-PC/.codex/plugins/cache/openai-primary-runtime/presentations/26.909.12148/skills/presentations';
const VERSION=process.argv[2]??'v1';
const OUT=`${ROOT}/artifacts/recalino-presentation/output/Recalino_Introduction_EN${VERSION==='v1'?'':`_${VERSION}`}.pptx`;
const dictionary=JSON.parse(await fs.readFile(`${BUILD}/english-copy.json`,'utf8'));
const arabic=/[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/;
function translate(value){
  if(Object.hasOwn(dictionary,value)) return dictionary[value];
  if(arabic.test(value)) throw new Error(`Missing English copy: ${value}`);
  return value;
}

const pres=await PresentationFile.importPptx(await FileBlob.load(`${ROOT}/artifacts/recalino-presentation/output/Recalino_Introduction_FA_v4.pptx`));
const before=await pres.inspect({kind:'slide,textbox,shape,image,notes,layout',maxChars:200000});
const records=before.ndjson.split('\n').filter(Boolean).map(s=>JSON.parse(s));
await fs.writeFile(`${BUILD}/english-before-${VERSION}.ndjson`,before.ndjson);
const slides=new Map(records.filter(r=>r.kind==='slide').map(r=>[r.slide,pres.resolve(r.id)]));
let replaced=0;
for(const record of records){
  if(record.kind==='textbox'){
    const shape=pres.resolve(record.id);
    const translated=translate(record.text);
    if(translated!==record.text){shape.text=translated;replaced++;}
    shape.text.alignment='left';
    // Workflow and status progress from left to right for an English audience.
    if([2,3,14].includes(record.slide)&&record.name==='Text'){
      const [x,y,w,h]=record.bbox;
      shape.position={left:1280-x-w,top:y,width:w,height:h};
    }
    if(record.slide===15&&record.text==='مشاهدهٔ فضای نمونهٔ ریکالینو'){
      shape.text.get(translated).link={uri:'https://recalino-hme6gdlf3-ali-paybarjay-s-projects.vercel.app/preview/today',isExternal:true};
    }
  }
  if(record.kind==='notes'){
    const [body,sources]=record.text.split('\n\nمنابع:\n');
    slides.get(record.slide).speakerNotes.textFrame.setText(`${translate(body)}${sources?`\n\nSources:\n${sources}`:''}`);
  }
  if(record.kind==='image'){
    const img=pres.resolve(record.id);
    img.alt=record.slide===1?'Official Recalino app icon':record.slide===4?'Live Today page before adding the first class':'Recalino interface using sample data';
  }
}
const after=await pres.inspect({kind:'slide,textbox,shape,image,notes',maxChars:200000});
await fs.writeFile(`${BUILD}/english-after-${VERSION}.ndjson`,after.ndjson);
const remaining=after.ndjson.split('\n').filter(Boolean).map(x=>JSON.parse(x)).filter(r=>['textbox','notes'].includes(r.kind)&&arabic.test(r.text??''));
if(remaining.length) throw new Error('Untranslated authored text remains');

const candidate=`${BUILD}/candidate-en-${VERSION}.pptx`;
await (await PresentationFile.exportPptx(pres)).save(candidate);
const {finalizePresentation}=await import(pathToFileURL(`${SKILL}/container_tools/artifact_tool_utils.mjs`).href);
const result=await finalizePresentation({workspaceDir:ROOT,candidatePath:candidate,finalPath:OUT,pythonExecutable:'C:/Users/Ali-PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',integrityValidatorPath:`${SKILL}/container_tools/inspect_presentation_package_integrity.py`,layoutValidatorPath:`${SKILL}/container_tools/inspect_presentation_layout_geometry.py`,layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-heading-fit'],fontPolicy:{basis:'design',families:['Segoe UI']},verifyArtifactToolImport:true,requiredNativeTableOwnerSlides:[],requiredNativeChartOwnerSlides:[],receiptPath:`${BUILD}/validation-en-${VERSION}.json`});
console.log(JSON.stringify({output:OUT,slides:slides.size,images:records.filter(r=>r.kind==='image').length,translatedTextBoxes:replaced,validation:'passed',sha256:result.finalSha256}));
