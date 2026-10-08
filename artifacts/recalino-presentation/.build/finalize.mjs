import {pathToFileURL} from 'node:url';
process.env.RUNTIME_NODE_MODULES='C:/Users/Ali-PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const root='D:/Claude Projects/Recalino';
const skill='C:/Users/Ali-PC/.codex/plugins/cache/openai-primary-runtime/presentations/26.909.12148/skills/presentations';
const {finalizePresentation}=await import(pathToFileURL(`${skill}/container_tools/artifact_tool_utils.mjs`).href);
const result=await finalizePresentation({workspaceDir:root,candidatePath:`${root}/artifacts/recalino-presentation/.build/candidate-rtl.pptx`,finalPath:`${root}/artifacts/recalino-presentation/output/Recalino_Introduction_FA.pptx`,pythonExecutable:'C:/Users/Ali-PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',integrityValidatorPath:`${skill}/container_tools/inspect_presentation_package_integrity.py`,layoutValidatorPath:`${skill}/container_tools/inspect_presentation_layout_geometry.py`,layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-heading-fit'],fontPolicy:{basis:'design',families:['Segoe UI']},verifyArtifactToolImport:true,requiredNativeTableOwnerSlides:[],requiredNativeChartOwnerSlides:[],receiptPath:`${root}/artifacts/recalino-presentation/.build/validation.json`});
console.log(JSON.stringify({path:result.finalPath,success:result.status??true}));
