// Figma native editable email family; source-defined geometry, existing Recalino variables/styles.
let page = figma.root.children.find(p => p.name === '04 · Branded email');
if (page) throw new Error('Email page already exists; resume from ledger rather than duplicate');
page = figma.createPage(); page.name = '04 · Branded email';
await figma.setCurrentPageAsync(page);
await Promise.all(['Noto Sans', 'Noto Sans Arabic'].flatMap(family => ['Regular', 'SemiBold'].map(style => figma.loadFontAsync({family, style}))));
const variables = await figma.variables.getLocalVariablesAsync();
const v = Object.fromEntries(variables.map(n => [n.name, n]));
const styles = await figma.getLocalTextStylesAsync();
const st = Object.fromEntries(styles.map(s => [s.name, s.id]));
const ids = [page.id], components = {}, properties = {};
function paint(node, name) { node.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0,g:0,b:0}}, 'color', v[name])]; }
function spacing(node, size, gap) { for(const prop of ['paddingTop','paddingBottom','paddingLeft','paddingRight']) node.setBoundVariable(prop,v['space/'+size]); if(gap) node.setBoundVariable('itemSpacing',v['space/'+gap]); }
function frame(parent, name, width, direction='VERTICAL') { const f=figma.createAutoLayout(direction); ids.push(f.id); f.name=name; f.resize(width,100); f.layoutSizingVertical='HUG'; f.layoutSizingHorizontal='FIXED'; f.fills=[]; if(parent){parent.appendChild(f);f.layoutSizingHorizontal='FILL';} return f; }
async function text(parent, name, value, locale, role, width, size, color='color/text') { const t=figma.createText(); ids.push(t.id); t.name=name; t.fontName={family:locale==='fa'?'Noto Sans Arabic':'Noto Sans',style:role==='body'?'Regular':'SemiBold'}; await t.setTextStyleIdAsync(st['Recalino/Admin/'+locale+'/'+role]); t.characters=value; t.fontSize=size; t.lineHeight={unit:'PIXELS',value:Math.round(size*1.75)}; t.textAlignHorizontal=locale==='fa'?'RIGHT':'LEFT'; paint(t,color); t.resize(width,50); t.textAutoResize='HEIGHT'; parent.appendChild(t); return t; }
function comp(name, width, direction='VERTICAL') {const c=figma.createComponent(); ids.push(c.id); c.name=name;c.layoutMode=direction;c.resize(width,100);c.layoutSizingVertical='HUG';c.layoutSizingHorizontal='FIXED';c.fills=[];c.description='Recalino branded email v1. Mirrors trusted table-based production renderer. Edit exposed text properties; preserve direction and brand.';c.x=2800;c.y=Object.keys(components).length*200;components[name]=c.id;return c;}
const logoSvg='<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#13261f"/><path fill="#5fd6a8" d="M361.42 130.38A164 164 0 1 1 199.91 101.89A28 28 0 0 1 219.06 154.51A108 108 0 1 0 325.42 173.27A28 28 0 0 1 361.42 130.38Z"/><circle cx="256" cy="256" r="48" fill="#b9f06b"/></svg>';
const header=comp('Recalino/Email/Brand',600,'HORIZONTAL'); header.counterAxisAlignItems='CENTER';header.setBoundVariable('itemSpacing',v['space/16']);
const logo=figma.createNodeFromSvg(logoSvg);header.appendChild(logo);ids.push(logo.id,...logo.findAll(()=>true).map(n=>n.id));logo.name='Existing Recalino logo';logo.resize(48,48);
await text(header,'Wordmark','Recalino','en','title',180,25);
for(const locale of ['en','fa']) {
 const c=comp('Recalino/Email/Action/'+locale,250,'HORIZONTAL');paint(c,'color/cta');spacing(c,16);c.setBoundVariable('topLeftRadius',v['radius/12']);c.setBoundVariable('topRightRadius',v['radius/12']);c.setBoundVariable('bottomLeftRadius',v['radius/12']);c.setBoundVariable('bottomRightRadius',v['radius/12']);c.counterAxisAlignItems='CENTER';c.primaryAxisAlignItems='CENTER';
 const t=await text(c,'Action label',locale==='fa'?'ورود به ریکالینو':'Open Recalino',locale,'label',218,16,'color/ctaText');t.textAlignHorizontal='CENTER';const prop=c.addComponentProperty('Label','TEXT',t.characters);t.componentPropertyReferences={characters:prop};properties[c.name]={label:prop};
 const foot=comp('Recalino/Email/Footer/'+locale,600);foot.setBoundVariable('itemSpacing',v['space/8']);
 await text(foot,'Reply invitation',locale==='fa'?'می‌توانید به همین ایمیل پاسخ دهید.':'You can reply directly to this email.',locale,'body',600,13,'color/muted');
 await text(foot,'Contact','recalino.pilot@gmail.com','en','body',600,13,'color/accent');
}
// Wrapper first; build every section directly within its final parent.
const review=frame(null,'Branded email · EN / فارسی · desktop / mobile',2370);review.x=100;review.y=100;review.setBoundVariable('itemSpacing',v['space/64']);paint(review,'color/surface');spacing(review,32);
await text(review,'Design review','Recalino email · Clear, warm, recognizable','en','title',2200,32);
await text(review,'Scope','Welcome, feedback thanks, support reply. Existing brand; 600px shell and 390px mobile. Editable text, local components and native logo vectors. No tracking pixels.','en','body',2200,16,'color/muted');
const samples=[
 {key:'Welcome',en:{headline:'Your Recalino pilot is ready',label:'WELCOME TO RECALINO',body:'Hi Sara,\n\nWelcome to the Recalino pilot. Your learning workspace is ready. Open the app and sign in with the email you registered.\n\nWe look forward to learning with you.',action:'Open Recalino'},fa:{headline:'پایلوت ریکالینو آمادهٔ شماست',label:'به ریکالینو خوش آمدید',body:'سلام سارا،\n\nبه پایلوت ریکالینو خوش آمدید. فضای یادگیری شما آماده است. وارد اپ شوید و با همان ایمیلی که ثبت‌نام کرده‌اید ادامه دهید.\n\nخوشحالیم که در این مسیر همراه ما هستید.',action:'ورود به ریکالینو'}},
 {key:'Feedback thanks',en:{headline:'Thanks for sharing your feedback',label:'HERE TO HELP',body:'Hi Sara,\n\nThank you for taking the time to tell us about your experience. Your feedback helps us make Recalino more useful.\n\nYou can follow our conversation in the app.',action:'View conversation'},fa:{headline:'از بازخورد شما ممنونیم',label:'در کنار شما',body:'سلام سارا،\n\nممنون که تجربه‌تان را با ما در میان گذاشتید. بازخورد شما به ما کمک می‌کند ریکالینو را کاربردی‌تر کنیم.\n\nمی‌توانید گفت‌وگوی ما را در اپ دنبال کنید.',action:'مشاهدهٔ گفت‌وگو'}},
 {key:'Support reply',en:{headline:'A reply to your question',label:'HERE TO HELP',body:'Hi Sara,\n\nThanks for your question. You can find your saved learning materials by opening your course and selecting the class you want.\n\nIf you need more help, reply here or continue the conversation in the app.',action:'View conversation'},fa:{headline:'پاسخ به سؤال شما',label:'در کنار شما',body:'سلام سارا،\n\nممنون از سؤال شما. برای دیدن مطالب یادگیری ذخیره‌شده، کورس خود را باز کنید و جلسهٔ موردنظر را انتخاب کنید.\n\nاگر به راهنمایی بیشتری نیاز دارید، به همین ایمیل پاسخ دهید یا گفت‌وگو را در اپ ادامه دهید.',action:'مشاهدهٔ گفت‌وگو'}}
];
const frames=[];
for(const sample of samples){
 const row=frame(review,sample.key,2306,'HORIZONTAL');row.setBoundVariable('itemSpacing',v['space/32']);row.counterAxisAlignItems='MIN';
 for(const locale of ['en','fa']) for(const device of ['desktop','mobile']) {
  const width=device==='desktop'?664:390, outer=device==='desktop'?32:8, inset=device==='desktop'?32:24; const content=sample[locale];
  const viewport=frame(row,sample.key+' · '+locale+' · '+device,width);viewport.layoutSizingHorizontal='FIXED';spacing(viewport,outer===8?8:32,24);paint(viewport,'color/bg');
  const title=await text(viewport,'Review label',sample.key+' · '+locale.toUpperCase()+' · '+device,'en','label',width-outer*2,12,'color/muted');
  const brand=header.createInstance();ids.push(brand.id,...brand.findAll(()=>true).map(n=>n.id));viewport.appendChild(brand);brand.resize(width-outer*2,48);
  const card=frame(viewport,'Email card',width-outer*2);paint(card,'color/surface');card.setBoundVariable('topLeftRadius',v['radius/20']);card.setBoundVariable('topRightRadius',v['radius/20']);card.setBoundVariable('bottomLeftRadius',v['radius/20']);card.setBoundVariable('bottomRightRadius',v['radius/20']);card.clipsContent=true;card.strokes=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0,g:0,b:0}},'color',v['color/border'])];card.strokeWeight=1;
  const hero=frame(card,'Headline section',width-outer*2);spacing(hero,inset,16);paint(hero,'color/surface2');
  await text(hero,'Eyebrow',content.label,locale,'label',width-outer*2-inset*2,12,'color/accent');
  await text(hero,'Headline',content.headline,locale,'title',width-outer*2-inset*2,device==='desktop'?28:24);
  const accent=figma.createRectangle();ids.push(accent.id);hero.appendChild(accent);accent.resize(64,5);paint(accent,'color/hero');accent.cornerRadius=4;
  const body=frame(card,'Message section',width-outer*2);spacing(body,inset,20);
  await text(body,'Personalized message',content.body,locale,'body',width-outer*2-inset*2,16);
  const c=await figma.getNodeByIdAsync(components['Recalino/Email/Action/'+locale]);const btn=c.createInstance();ids.push(btn.id,...btn.findAll(()=>true).map(n=>n.id));body.appendChild(btn);btn.setProperties({[properties[c.name].label]:content.action});btn.resize(Math.min(250,width-outer*2-inset*2),60);
  await text(body,'Signature',locale==='fa'?'تیم ریکالینو':'The Recalino team',locale,'label',width-outer*2-inset*2,16,'color/accent');
  const foot=await figma.getNodeByIdAsync(components['Recalino/Email/Footer/'+locale]);const footer=foot.createInstance();ids.push(footer.id,...footer.findAll(()=>true).map(n=>n.id));viewport.appendChild(footer);footer.resize(width-outer*2,footer.height);for(const t of footer.findAllWithCriteria({types:['TEXT']})){t.resize(width-outer*2,50);t.textAutoResize='HEIGHT';}
  frames.push({id:viewport.id,name:viewport.name,width:viewport.width,height:viewport.height});
 }
}
const nodes=review.findAll(()=>true), counts={};for(const n of nodes)counts[n.type]=(counts[n.type]??0)+1;
const fontFamilies=[...new Set(review.findAllWithCriteria({types:['TEXT']}).map(t=>t.fontName.family))];
return {pageId:page.id,reviewId:review.id,createdNodeIds:ids,components,properties,frames,counts,fontFamilies,bounds:{width:review.width,height:review.height},imageNodes:[]};
