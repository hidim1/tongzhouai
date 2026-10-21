import path from 'node:path';
import {readPart,tags} from './office-package.mjs';
import {safeOfficeFormula} from './office-formula.mjs';
// Run before any Office conversion/recalculation, not just before delivery.
export async function assertSafeOfficeResources(zip){
 if(Object.keys(zip.files).some(n=>/(?:^|\/)(?:vbaProject\.bin|macrosheets|activeX)(?:\/|$)/i.test(n)))throw Error('不自动处理带宏或主动控件的文件');
 for(const name of Object.keys(zip.files).filter(n=>n.endsWith('.rels'))){const $=await readPart(zip,name),base=name==='_rels/.rels'?'':path.posix.dirname(path.posix.dirname(name));
  for(const node of $('Relationship').toArray()){const e=$(node),target=e.attr('Target')||'';
   if(e.attr('TargetMode')==='External'){if(!/\/hyperlink$/.test(e.attr('Type')||'')||! /^(?:https?:|mailto:)/i.test(target))throw Error('文件含需要外部加载的资源，不能自动处理');continue;}
   const resolved=target.startsWith('/')?target.slice(1):path.posix.normalize(path.posix.join(base,target));if(!target||target.includes('\\')||resolved==='..'||resolved.startsWith('../')||/^[a-z]+:/i.test(target))throw Error('文件资源引用越界，不能自动处理');
  }
 }
 if(zip.file('xl/workbook.xml')){const $=await readPart(zip,'xl/workbook.xml');for(const node of tags($,'definedName').toArray())safeOfficeFormula($(node).text());}
 for(const name of Object.keys(zip.files).filter(n=>/^word\/.*\.xml$/.test(n)&&!zip.files[n].dir)){if(/DDEAUTO|INCLUDETEXT|INCLUDEPICTURE/i.test(await zip.file(name).async('string')))throw Error('文件含外部内容字段，不能自动处理');}
}
