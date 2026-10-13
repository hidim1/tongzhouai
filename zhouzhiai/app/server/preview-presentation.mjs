import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import {canvasProblems} from './preview-canvas.mjs';
import {presentationAssets} from './preview-presentation-assets.mjs';
import {verifyPresentationContent} from './office-content.mjs';
import {officePackage,readPart,tags,tagPrefix} from './office-package.mjs';

// Numeric-looking category labels are identifiers, not amounts. Keep leading zeros.
export async function preserveChartCategoryText(file){
 const zip=await officePackage(file);let changed=false;
 for(const name of Object.keys(zip.files).filter(p=>/^ppt\/(?:slides\/)?charts\/[^/]+\.xml$/.test(p))){const $=await readPart(zip,name);let touched=false;for(const cat of tags($,'cat').toArray()){
  for(const [from,to] of [['numLit','strLit'],['numRef','strRef'],['numCache','strCache']])for(const n of tags($,from,$(cat)).toArray()){n.name=tagPrefix(n)+to;touched=true;}
  if(touched)tags($,'formatCode',$(cat)).remove();
 }if(touched){zip.file(name,$.xml());changed=true;}}
 if(changed)await fs.writeFile(file,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));return{changed};
}

// Local preview only: use the desktop's bundled runtime, without changing it.
const runtime=process.env.ZHOUZHI_PRESENTATION_RUNTIME || '/Users/lhy19950000/.cache/codex-runtimes/codex-primary-runtime/dependencies';
const skill=process.env.ZHOUZHI_PRESENTATION_SKILL || '/Users/lhy19950000/.codex/plugins/cache/openai-primary-runtime/presentations/26.1011.11113/skills/presentations';
const requireRuntime=createRequire(path.join(runtime,'node/package.json'));
export const presentationInstructions=(process.env.TONGZHOU_DEPLOYMENT==='server'?'字体选择Noto Sans CJK SC（默认无衬线）或Noto Serif CJK SC。':'字体选择Arial Unicode MS或Songti SC。')+`先按内容、读者和汇报用途确定视觉方向，然后逐页设计，禁止把聊天正文原样贴成同一种背景和项目符号。使用canvas结构，每页1280×720，自行决定背景、留白、文字层级、图文关系、图表位置。不是选择固定风格模板，配色按内容决定，可以交替使用浅底正文和重点页，不能每页机械复制。slides[].elements的文字、表格、图表都是原生可编辑对象，x/y/width/height为像素坐标。内容元素不得重叠、越界；四周留至少48px，标题通常44至72px，正文28至36px，图注至少20px。text写纯正文，不带Markdown星号，标题role=title且text与页面title相同。表格按短字段和长描述分配columnWeights，数据过多分页，不做等宽细长列。图表只用真实数值，不捏造数据。配图通过assets引用：uploaded使用本轮真实fileId，brand仅用于确实介绍同舟/舟知的文稿，generated由系统按prompt生成示意插画；禁止任意URL或本机路径。允许按实际需要自动生成配图，不设置张数上限，优先现有图片，不能为凑图重复生图。为每张插画明确内容、配色、构图和留白位置，不生成文字、商标或假装真实项目照片；不以图片替代正文或数据图表。image的assetId必须存在，layer=background只用于真实背景，内容图片用content。cover有明确视觉中心，结束页表达用途相关结论或收束，不强加谢谢页；如用户要求封底必须包含且计入总页数。N页请求必须恰好N页。每页只讲一个主线，避免连续多页文字列表；关系用合理空间布局或图示，比较用编辑表格，趋势用图表。不得遗漏关键证据、虚构Logo或数字，不用缩小字体解决内容过密。notes只放实际来源与事实说明。未用素材数组为空。最终会渲染逐页核对并作一次必要的排版修正。`;

const fonts=['Arial Unicode MS','Songti SC','Noto Sans CJK SC','Noto Serif CJK SC'];
const hex=value=>/^#[0-9a-f]{6}$/i.test(value);
function luminance(color){return color.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);}
export function validatePresentation(data){
  if(!data?.design||!Array.isArray(data.slides)||!data.slides.length||data.slides.length>30)throw new Error('PPT需要1至30页完整内容，请缩小任务范围后重试');
  const d=data.design;
  if(![d.background,d.textColor,d.accentColor].every(hex)||!fonts.includes(d.fontFamily))throw new Error('AI返回的PPT配色或字体无效，请重试');
  const lum=[luminance(d.background),luminance(d.textColor)].sort((a,b)=>a-b);
  if((lum[1]+.05)/(lum[0]+.05)<4.5)throw new Error('AI选择的PPT文字与背景对比不足，请要求提高可读性后重试');
  if(data.slides.every(s=>s.layout==='canvas')){
    const issues=canvasProblems(data);if(issues.length)throw Error('PPT构图需要调整：'+issues.join('；'));
    return data;
  }
  for(const s of data.slides){
    if(!s.title?.trim()||s.title.length>52)throw new Error('PPT标题过长或为空，请要求提炼后重试');
    if(s.layout==='text'&&(!s.paragraphs?.length||s.paragraphs.length>5||s.paragraphs.join('').length>330))throw new Error('PPT单页内容过密，请要求合理分页后重试');
    if(s.layout==='columns'&&(s.columns.length<2||s.columns.length>3||s.columns.some(c=>!c.heading||c.heading.length>28||c.body.length>160)))throw new Error('PPT比较页内容过密，请要求分页后重试');
    if(s.layout==='table'&&(!s.tableHeaders.length||s.tableHeaders.length>4||s.tableRows.length>6||!s.tableRows.length||[s.tableHeaders,...s.tableRows].some(r=>r.length!==s.tableHeaders.length||r.some(v=>v.length>36))))throw new Error('PPT表格过密或列数不一致，请要求分页后重试');
    if(s.layout==='chart'&&(!s.chart.categories.length||s.chart.categories.length>10||!s.chart.series.length||s.chart.series.length>3||s.chart.series.some(r=>r.values.length!==s.chart.categories.length||r.values.some(v=>!Number.isFinite(v)))))throw new Error('PPT图表数据不完整，请补充准确数据后重试');
    if(!['cover','text','columns','table','chart'].includes(s.layout))throw new Error('PPT布局无效');
  }
  return data;
}

export async function makePresentation(raw,target,buildDir,options={}){
  const data=validatePresentation(raw);
  process.env.RUNTIME_NODE_MODULES ||= path.join(runtime,'node/node_modules');
  const {Presentation,PresentationFile}=await import(pathToFileURL(requireRuntime.resolve('@oai/artifact-tool')).href);
  const {GlobalFonts,createCanvas}=requireRuntime('@napi-rs/canvas');
  if(process.platform==='linux')GlobalFonts.loadFontsFromDir('/usr/share/fonts/opentype/noto');
  const available=process.platform==='linux'?execFileSync('fc-match',['--format','%{family}',data.design.fontFamily],{encoding:'utf8'}).split(',').includes(data.design.fontFamily):GlobalFonts.families.some(f=>f.family===data.design.fontFamily);
  if(!available)throw new Error('运行环境缺少AI选择的字体，PPT未生成');
  const {finalizePresentation,makeNativeBulletParagraphs,applyPresentationChartFont}=await import(pathToFileURL(path.join(skill,'container_tools/artifact_tool_utils.mjs')).href);
  await fs.mkdir(buildDir,{recursive:true});await fs.mkdir(path.dirname(target),{recursive:true});
  await fs.writeFile(path.join(buildDir,'ai-design.json'),JSON.stringify(data,null,2));
  const assets=await presentationAssets(data,{...options,buildDir});
  const presentation=Presentation.create({slideSize:{width:1280,height:720}}),d=data.design;
  presentation.theme.defaultFont=d.fontFamily;
  const tables=[],charts=[];
  function text(slide,name,value,x,y,w,h,size=28,bold=false,color=d.textColor){
    const shape=slide.shapes.add({geometry:'textbox',name,position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
    shape.text=value;shape.text.style={typeface:d.fontFamily,fontSize:size,bold,color,autoFit:'none',wrap:'square',insets:0,verticalAlignment:'top'};return shape;
  }
  const canvas=createCanvas(1,1),ctx=canvas.getContext('2d');
  function checkText(e){
    ctx.font=`${e.bold?'bold ':''}${e.fontSize}px "${d.fontFamily}"`;let lines=0;
    for(const line of e.text.split('\n')){let width=0;lines++;for(const c of line){const next=ctx.measureText(c).width;if(width+next>e.width&&width>0){lines++;width=0;}width+=next;}}
    if(lines*e.fontSize*1.3>e.height)throw Error('PPT文字区域不足，请增大空间或提炼内容，不能强制缩小字号');
  }
  for(const [i,s] of data.slides.entries()){
    if(options.cancelled?.())throw Error('已停止任务');
    const slide=presentation.slides.add();slide.background.fill=s.background||d.background;
    if(s.layout==='canvas'){
      const elements=[...s.elements.filter(e=>e.kind==='image'&&e.layer==='background'),...s.elements.filter(e=>!(e.kind==='image'&&e.layer==='background'))];
      for(const e of elements){
        if(e.kind==='text'){
          checkText(e);const colors=[luminance(s.background),luminance(e.color)].sort((a,b)=>a-b);if((colors[1]+.05)/(colors[0]+.05)<4.5&&!s.elements.some(e=>e.kind==='image'&&e.layer==='background'))throw Error('PPT文字对比不足');
          text(slide,e.role==='title'?'slide-title':e.id,e.text,e.x,e.y,e.width,e.height,e.fontSize,e.bold,e.color);
        }else if(e.kind==='image'){
          const a=assets.get(e.assetId);if(!a)throw Error('配图素材不可用');const blob=a.bytes.buffer.slice(a.bytes.byteOffset,a.bytes.byteOffset+a.bytes.byteLength);
          slide.images.add({blob,contentType:a.contentType,alt:a.alt,fit:a.kind==='brand'?'contain':e.fit,position:{left:e.x,top:e.y,width:e.width,height:e.height}});
        }else if(e.kind==='table'){
          tables.push(i+1);const values=[e.headers,...e.rows],sum=e.columnWeights.reduce((a,b)=>a+b,0),widths=e.columnWeights.map(w=>e.width*w/sum);
          if(e.height/values.length<e.fontSize*1.5)throw Error('PPT表格行距不足');
          const table=slide.tables.add({rows:values.length,columns:e.headers.length,left:e.x,top:e.y,width:e.width,height:e.height,values,columnWidths:widths});table.borders.assign({fill:'#CCD6DF',width:.5});
          const color=[luminance(s.background),luminance(d.textColor)].sort((a,b)=>a-b);if((color[1]+.05)/(color[0]+.05)<4.5)throw Error('PPT表格文字与页面背景不匹配');
          for(let r=0;r<values.length;r++)for(let c=0;c<e.headers.length;c++){const cell=table.getCell(r,c);cell.fill=r===0?d.textColor:s.background;cell.text.style={typeface:d.fontFamily,fontSize:e.fontSize,color:r===0?s.background:d.textColor,bold:r===0,insets:12};checkText({text:values[r][c],width:widths[c]-24,height:e.height/values.length-20,fontSize:e.fontSize,bold:r===0});}
        }else if(e.kind==='chart'){
          charts.push(i+1);const chart=slide.charts.add(e.chartType,{position:{left:e.x,top:e.y,width:e.width,height:e.height-(e.unit?36:0)},categories:e.categories,series:e.series.map(r=>({...r,fill:d.accentColor})),hasLegend:e.series.length>1,dataLabels:{showValue:true,numberFormatCode:'0.##',numberFormatSourceLinked:false,position:e.chartType==='bar'?'outEnd':'above',textStyle:{fontSize:22,color:d.textColor}},xAxis:{textStyle:{fontSize:22,color:d.textColor}},yAxis:{numberFormatCode:'0.##',textStyle:{fontSize:22,color:d.textColor}},chartFill:s.background,plotAreaFill:s.background});applyPresentationChartFont(chart,{fontFamily:d.fontFamily});if(e.unit)text(slide,e.id+'-unit',e.unit,e.x,e.y+e.height-30,e.width,30,20);
        }
      }
      if(s.notes){slide.speakerNotes.text=s.notes;slide.speakerNotes.setVisible(false);}
      if(s.elements.some(e=>assets.get(e.assetId)?.generated))slide.speakerNotes.text=(s.notes||'')+'\n配图为示意插画，不代表真实设备或项目现场。';
      continue;
    }
    const accentLum=[luminance(d.background),luminance(d.accentColor)].sort((a,b)=>a-b);
    const headingColor=(accentLum[1]+.05)/(accentLum[0]+.05)>=4.5?d.accentColor:d.textColor;
    if(s.layout==='cover'){
      text(slide,'deck-title',s.title,80,190,1120,180,64,true);
      if(s.subtitle)text(slide,'deck-subtitle',s.subtitle,80,395,1100,105,30);
      if(s.paragraphs?.length)text(slide,'cover-detail',s.paragraphs.join('\n'),80,530,1100,100,25);
    }else{
      text(slide,'slide-title',s.title,72,58,1136,116,44,true,headingColor);
      if(s.subtitle)text(slide,'subtitle',s.subtitle,72,177,1136,66,25);
      const supplementary=s.layout!=='text'&&s.paragraphs?.length?s.paragraphs.join('\n'):'';
      const top=s.subtitle?258:210,height=(supplementary?570:650)-top;
      if(s.layout==='text')text(slide,'key-points',makeNativeBulletParagraphs(s.paragraphs.map(p=>p.replace(/^\s*\d+\s*[.、|｜]\s*/,'')),{marginLeftPoints:20,hangingPoints:10,spaceAfterPoints:18}),72,top,1110,height,30);
      if(supplementary)text(slide,'supporting-statement',supplementary,72,595,1136,80,25);
      if(s.layout==='columns'){
        const width=(1136-48*(s.columns.length-1))/s.columns.length;
        s.columns.forEach((c,n)=>{text(slide,'column-heading-'+n,c.heading,72+n*(width+48),top,width,96,32,true);text(slide,'column-body-'+n,c.body,72+n*(width+48),top+112,width,height-112,28);});
      }
      if(s.layout==='table'){
        tables.push(i+1);const values=[s.tableHeaders,...s.tableRows];
        const table=slide.tables.add({rows:values.length,columns:s.tableHeaders.length,left:72,top,width:1136,height,values,columnWidths:s.tableHeaders.map(()=>1136/s.tableHeaders.length)});
        table.borders.assign({fill:d.textColor,width:.5});
        for(let r=0;r<values.length;r++)for(let c=0;c<s.tableHeaders.length;c++){
          const cell=table.getCell(r,c);cell.fill=r===0?d.textColor:d.background;cell.text.style={typeface:d.fontFamily,fontSize:25,color:r===0?d.background:d.textColor,bold:r===0,insets:12};
        }
      }
      if(s.layout==='chart'){
        charts.push(i+1);
        const chart=slide.charts.add(s.chart.type,{position:{left:72,top,width:1136,height:height-35},categories:s.chart.categories,series:s.chart.series.map(r=>({...r,fill:d.accentColor})),hasLegend:s.chart.series.length>1,dataLabels:{showValue:true,numberFormatCode:'0.##',numberFormatSourceLinked:false,position:s.chart.type==='bar'?'outEnd':'above',textStyle:{fontSize:23,color:d.textColor}},xAxis:{textStyle:{fontSize:22,color:d.textColor}},yAxis:{numberFormatCode:'0.##',textStyle:{fontSize:22,color:d.textColor}},chartFill:d.background,plotAreaFill:d.background});
        applyPresentationChartFont(chart,{fontFamily:d.fontFamily});
        if(s.chart.unit)text(slide,'chart-unit',s.chart.unit,72,655,1000,34,23);
      }
    }
    if(s.notes){slide.speakerNotes.text=s.notes;slide.speakerNotes.setVisible(false);}
  }
  await fs.writeFile(path.join(buildDir,'ai-design.json'),JSON.stringify(data,null,2));
  const candidate=path.join(buildDir,'candidate.pptx');await(await PresentationFile.exportPptx(presentation)).save(candidate);await preserveChartCategoryText(candidate);
  const previews=[];
  for(const [i,slide] of presentation.slides.items.entries()){
    const png=await presentation.export({slide,format:'png',scale:1}),file=path.join(buildDir,`slide-${i+1}.png`);await fs.writeFile(file,new Uint8Array(await png.arrayBuffer()));previews.push(file);
  }
  if(options.review)await options.review({plan:data,previews});
  await finalizePresentation({workspaceDir:path.resolve(buildDir,'../../..'),candidatePath:candidate,finalPath:target,pythonExecutable:process.env.ZHOUZHI_PYTHON || path.join(runtime,'python/bin/python3'),integrityValidatorPath:path.join(skill,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(skill,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit',...tables.flatMap(n=>['--require-native-table-slide',String(n)])],explicitTotalSlideCount:data.slides.length,requiredNativeTableOwnerSlides:tables,requiredNativeChartOwnerSlides:charts,materializeLiteralChartWorkbooks:charts.length>0,fontPolicy:{basis:'design',families:[d.fontFamily]},verifyArtifactToolImport:true,receiptPath:path.join(buildDir,'validation.json')});
  const contentCheck=await verifyPresentationContent(target,data);options.onContentVerified?.(contentCheck);
  return {slideCount:data.slides.length,designRationale:d.rationale,previews,contentCheck};
}
