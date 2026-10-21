// New documents use a purpose-specific design; native edits bypass this module.
const profiles={
 brief:{accent:'176B78',ink:'193E48',tint:'EAF4F5',font:'Microsoft YaHei',bodySize:24,titleSize:40,line:330},
 formal:{accent:'26384A',ink:'202B35',tint:'EDF0F3',font:'Microsoft YaHei',bodySize:24,titleSize:38,line:360},
 analytical:{accent:'275DA6',ink:'20354F',tint:'EAF0F9',font:'Microsoft YaHei',bodySize:23,titleSize:42,line:330},
 plan:{accent:'2C7060',ink:'244139',tint:'EDF5F1',font:'Microsoft YaHei',bodySize:24,titleSize:40,line:340},
 educational:{accent:'785B31',ink:'433A2E',tint:'F8F3EA',font:'Microsoft YaHei',bodySize:25,titleSize:42,line:350},
};
export const officeDesignSchema={type:'object',additionalProperties:false,required:['purpose','accent','density','rationale'],properties:{purpose:{type:'string',enum:Object.keys(profiles)},accent:{type:'string'},density:{type:'string',enum:['comfortable','compact']},rationale:{type:'string'}}};
export function officeDesign(title,body='',selection=null){
 const text=title+'\n'+body.slice(0,2500),purpose=selection?.purpose||(/分析|核对|预算|成本|数据|对比/.test(text)?'analytical':/通知|公文|合同|制度|函件/.test(text)?'formal':/规划|计划|路线|安排/.test(text)?'plan':/培训|教程|操作指南/.test(text)?'educational':'brief');
 if(!profiles[purpose])throw Error('文档用途样式无效');const result={...profiles[purpose],purpose};
 if(selection){if(!['comfortable','compact'].includes(selection.density)||typeof selection.rationale!=='string'||selection.rationale.length>500)throw Error('文档设计要求无效');if(selection.accent){if(!/^#[0-9a-f]{6}$/i.test(selection.accent))throw Error('文档配色无效');const rgb=selection.accent.slice(1).match(/../g).map(c=>parseInt(c,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4),lum=rgb.reduce((n,c,i)=>n+c*[.2126,.7152,.0722][i],0);if(1.05/(lum+.05)<4.5)throw Error('文档配色对比不足，须使用深色强调色');result.accent=selection.accent.slice(1).toUpperCase();}if(selection.density==='compact'){result.bodySize=23;result.line=310;}result.rationale=selection.rationale;}
 return result;
}
