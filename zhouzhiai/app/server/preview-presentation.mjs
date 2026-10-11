import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

// Local preview only: use the desktop's bundled runtime, without changing it.
const runtime=process.env.ZHOUZHI_PRESENTATION_RUNTIME || '/Users/lhy19950000/.cache/codex-runtimes/codex-primary-runtime/dependencies';
const skill=process.env.ZHOUZHI_PRESENTATION_SKILL || '/Users/lhy19950000/.codex/plugins/cache/openai-primary-runtime/presentations/26.1007.11041/skills/presentations';
const requireRuntime=createRequire(path.join(runtime,'node/package.json'));
export const presentationInstructions=(process.env.TONGZHOU_DEPLOYMENT==='server'?'云端可用字体仅限Noto Sans CJK SC、Noto Serif CJK SC，必须在这两个字体中选择。':'')+`PPT必须先根据本轮真实内容、读者和汇报用途选择风格，不使用固定参考模板或上次文件的配色。presentation.design说明选择原因，自行选择十六进制背景、文字、强调色，保证高对比。${process.env.TONGZHOU_DEPLOYMENT==='server'?'可用中文字体为Noto Sans CJK SC或Noto Serif CJK SC，自行选择。':'可用中文字体为Arial Unicode MS（无衬线）或Songti SC（宋体），自行选择。'}presentation.slides必须是完整可编辑演示文稿，用户指定N页时总数恰好N页（含封面），未指定时按内容合理分页。每页选择合适布局：cover封面、text要点、columns比较、table表格、chart有真实数值的图表；这是内容布局，不是风格模板。不要把报告原文堆在幻灯片上，要提炼观点，标题直接点明主题。不要用口号、空泛宣传语或无用副标题，不用竖线、箭头和破折号串联文字。要点正文不要手写编号或项目符号，本地生成器会生成原生项目符号。标题最多40字，text页最多5条且合计最多280字，columns页2至3列每列正文最多130字，table每页最多6行数据和4列且每格最多32字。信息多则分页，禁止省略关键证据或缩小到不可读。未使用的数组留空，未使用chart填type=bar/categories=[]/series=[]/unit=''。图表数值必须来自本轮明确数据，不得编造。不要添加内部批注、制作说明或预设页脚，不生成不存在的图片。notes只放实际来源和必要的事实说明，不放制作过程。配色、字体和叙事随实际内容选择，不要求固定商务蓝或公司背景。`;

const fonts=['Arial Unicode MS','Songti SC','Noto Sans CJK SC','Noto Serif CJK SC'];
const hex=value=>/^#[0-9a-f]{6}$/i.test(value);
function luminance(color){return color.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);}
export function validatePresentation(data){
  if(!data?.design||!Array.isArray(data.slides)||!data.slides.length||data.slides.length>30)throw new Error('PPT需要1至30页完整内容，请缩小任务范围后重试');
  const d=data.design;
  if(![d.background,d.textColor,d.accentColor].every(hex)||!fonts.includes(d.fontFamily))throw new Error('AI返回的PPT配色或字体无效，请重试');
  const lum=[luminance(d.background),luminance(d.textColor)].sort((a,b)=>a-b);
  if((lum[1]+.05)/(lum[0]+.05)<4.5)throw new Error('AI选择的PPT文字与背景对比不足，请要求提高可读性后重试');
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

export async function makePresentation(raw,target,buildDir){
  const data=validatePresentation(raw);
  process.env.RUNTIME_NODE_MODULES ||= path.join(runtime,'node/node_modules');
  const {Presentation,PresentationFile}=await import(pathToFileURL(requireRuntime.resolve('@oai/artifact-tool')).href);
  const {GlobalFonts}=requireRuntime('@napi-rs/canvas');
  if(process.platform==='linux')GlobalFonts.loadFontsFromDir('/usr/share/fonts/opentype/noto');
  const available=process.platform==='linux'?execFileSync('fc-match',['--format','%{family}',data.design.fontFamily],{encoding:'utf8'}).split(',').includes(data.design.fontFamily):GlobalFonts.families.some(f=>f.family===data.design.fontFamily);
  if(!available)throw new Error('运行环境缺少AI选择的字体，PPT未生成');
  const {finalizePresentation,makeNativeBulletParagraphs,applyPresentationChartFont}=await import(pathToFileURL(path.join(skill,'container_tools/artifact_tool_utils.mjs')).href);
  await fs.mkdir(buildDir,{recursive:true});await fs.mkdir(path.dirname(target),{recursive:true});
  const presentation=Presentation.create({slideSize:{width:1280,height:720}}),d=data.design;
  presentation.theme.defaultFont=d.fontFamily;
  const tables=[],charts=[];
  function text(slide,name,value,x,y,w,h,size=28,bold=false,color=d.textColor){
    const shape=slide.shapes.add({geometry:'textbox',name,position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
    shape.text=value;shape.text.style={typeface:d.fontFamily,fontSize:size,bold,color,autoFit:'none',wrap:'square',insets:0,verticalAlignment:'top'};return shape;
  }
  for(const [i,s] of data.slides.entries()){
    const slide=presentation.slides.add();slide.background.fill=d.background;
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
        const chart=slide.charts.add(s.chart.type,{position:{left:72,top,width:1136,height:height-35},categories:s.chart.categories,series:s.chart.series.map(r=>({...r,fill:d.accentColor})),hasLegend:s.chart.series.length>1,dataLabels:{showValue:true,position:s.chart.type==='bar'?'outEnd':'above',textStyle:{fontSize:23,color:d.textColor}},xAxis:{textStyle:{fontSize:22,color:d.textColor}},yAxis:{numberFormatCode:'0.##',textStyle:{fontSize:22,color:d.textColor}},chartFill:d.background,plotAreaFill:d.background});
        applyPresentationChartFont(chart,{fontFamily:d.fontFamily});
        if(s.chart.unit)text(slide,'chart-unit',s.chart.unit,72,655,1000,34,23);
      }
    }
    if(s.notes){slide.speakerNotes.text=s.notes;slide.speakerNotes.setVisible(false);}
  }
  await fs.writeFile(path.join(buildDir,'ai-design.json'),JSON.stringify(data,null,2));
  const candidate=path.join(buildDir,'candidate.pptx');await(await PresentationFile.exportPptx(presentation)).save(candidate);
  await finalizePresentation({workspaceDir:path.resolve(buildDir,'../../..'),candidatePath:candidate,finalPath:target,pythonExecutable:process.env.ZHOUZHI_PYTHON || path.join(runtime,'python/bin/python3'),integrityValidatorPath:path.join(skill,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(skill,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit',...tables.flatMap(n=>['--require-native-table-slide',String(n)])],explicitTotalSlideCount:data.slides.length,requiredNativeTableOwnerSlides:tables,requiredNativeChartOwnerSlides:charts,materializeLiteralChartWorkbooks:charts.length>0,fontPolicy:{basis:'design',families:[d.fontFamily]},verifyArtifactToolImport:true,receiptPath:path.join(buildDir,'validation.json')});
  for(const [i,slide] of presentation.slides.items.entries()){
    const png=await presentation.export({slide,format:'png',scale:1});await fs.writeFile(path.join(buildDir,`slide-${i+1}.png`),new Uint8Array(await png.arrayBuffer()));
  }
  return {slideCount:data.slides.length,designRationale:d.rationale};
}
