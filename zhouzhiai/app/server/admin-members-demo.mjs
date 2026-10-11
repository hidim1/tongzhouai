// Local UI prototype only. Never reads cloud member records or starts member workers.
const date='2026-10-10T02:30:00Z';
const document=(id,name,content)=>({id,name,content});
const files=[
 document('requirements','项目设计输入_演示.md','# 项目设计输入（演示）\n果汁澄清，设计处理量 2 m³/h。要求卫生设计、在线清洗。膜面积与仪表配置待工程师确认。\n仅用于本地页面预览，不是实际客户资料。'),
 document('notice','设计资料收集通知_演示.md','# 设计资料收集通知（演示）\n请设计团队整理 2D/3D 图纸、全量物料库与计算依据；运营管理团队更新采购价及标准件制造成本。\n此文件只用于展示下载效果。'),
 document('list','设备清单与预算_演示.csv','名称,数量,单位,已确认金额,状态\n超滤膜组件,1,套,54000,已核对\n卫生级进料泵,1,台,21000,已核对\n缓冲罐,1,台,9000,已核对\n仪表与控制,1,套,,待确认\n自制件制造,,,18000,已核对\n安装装配,,,8000,已核对\n调试验证,,,6000,已核对\n已确认小计,,,116000,不是完整项目总预算'),
 document('proposal','项目方案说明_演示.md','# 果汁澄清膜设备方案（演示）\n均衡档，超滤路线，2 m³/h。初步目标成本 220000 元，已确认预算小计 116000 元，仪表与控制尚待核对。\n本资料是本地界面演示，不是工程结论或正式报价。'),
 document('test','测试记录_演示.md','# 测试记录（演示）\n验证工作对话、项目方案及文件下载的只读展示。此账号不含云端测试内容。')
];
const rows=[
 {id:'row1',name:'超滤膜组件',spec:'按澄清目标确认膜面积',quantity:1,unit:'套',action:'调整',reviewed:true,amount:54000,source:'演示采购记录'},
 {id:'row2',name:'卫生级进料泵',spec:'材质与流量按新项目核对',quantity:1,unit:'台',action:'替换',reviewed:true,amount:21000,source:'演示采购记录'},
 {id:'row3',name:'缓冲罐',spec:'容量按工艺节拍确认',quantity:1,unit:'台',action:'沿用',reviewed:true,amount:9000,source:'演示自制件记录'},
 {id:'row4',name:'仪表与控制',spec:'测点、控制范围待补充',quantity:1,unit:'套',action:'新增',reviewed:false,amount:null,source:'依据待补充'}
];
const version={id:'scheme2',name:'均衡方案 v2',createdAt:date,status:'draft',summary:'依据新项目要求重新选配设备，清单与预算保持同一方案版本。',rows,budget:{target:220000,confirmed:116000,total:null,extras:[{name:'自制件制造',amount:18000,source:'演示标准件成本表'},{name:'安装装配',amount:8000,source:'演示工时记录'},{name:'调试验证',amount:6000,source:'演示交付要求'}]},outputs:['list','proposal'],technical:[{title:'工艺方案',body:'采用超滤路线进行果汁澄清。膜面积、温度与清洗条件仍需依据正式设计资料核对。'},{title:'待确认事项',body:'仪表测点、控制范围、供货边界与最终膜面积尚未确认，不能作为完整采购预算或正式投标文件。'}]};
const project=(id,name)=>({id,name,updatedAt:date,status:'draft',files:['requirements'],direction:{industry:'食品与饮料',capacity:'2 m³/h',route:'超滤',quality:['卫生设计 / 易清洗','食品接触材料安全','在线清洗（CIP）'],tier:'均衡档',target:220000,note:'快速估算定方向；详细预算仍以同版清单及核对依据为准。'},versions:[{...version,id:id+'-v1',name:'基础方案 v1',budget:{...version.budget,target:180000},outputs:['proposal']},{...version,id:id+'-v2'}]});
const fixture=[
 {username:'zhouzhi01',activated:true,sessions:[
  {id:'dialog1',name:'设计与成本资料收集',updatedAt:date,files:['requirements'],messages:[{role:'user',text:'整理设计团队与运营管理团队需要提供的资料，生成一份收集通知。'},{role:'assistant',text:'已按职责整理：设计团队提供图纸、设计依据与全量物料库；运营管理团队提供更新的采购价目表及自制标准件制造成本。',files:['notice']}]},
  {id:'dialog2',name:'本周项目推进安排',updatedAt:'2026-10-09T08:00:00Z',files:[],messages:[{role:'user',text:'梳理本周需要完成的项目事项。'},{role:'assistant',text:'先确认供货边界，再核对设备清单与成本依据；待确认项单独汇总，不将初步估算作为正式预算。'}]},
  {id:'dialog-archived',name:'早期讨论记录',updatedAt:'2026-10-08T06:00:00Z',archivedAt:'2026-10-09T06:00:00Z',files:[],messages:[{role:'user',text:'这是一条已删除的演示对话。'},{role:'assistant',text:'只读查看仍可展示保留的记录，管理员在此处不能恢复或修改。'}]}
 ],projects:[project('project1','果汁澄清膜设备 · 演示项目')]},
 ...Array.from({length:9},(_,i)=>({username:'zhouzhi'+String(i+2).padStart(2,'0'),activated:false,sessions:[],projects:[]})),
 {username:'zhouzhics',activated:true,sessions:[{id:'test-dialog',name:'客户端功能测试',updatedAt:date,files:[],messages:[{role:'user',text:'验证文件下载与成员工作区的只读查看。'},{role:'assistant',text:'本地演示文件已准备好。这里不会读取云端测试账号的实际内容。',files:['test']}]}],projects:[project('test-project','测试膜设备方案 · 演示项目')]}
];
const visible=items=>items.filter(x=>!x.archivedAt);
const publicFile=(username,id)=>{const f=files.find(f=>f.id===id);return f?{id:f.id,name:f.name,url:`/api/admin/members/${username}/files/${f.id}`} : null;};
const clean=(username,item)=>({...item,files:(item.files||[]).map(id=>publicFile(username,id)).filter(Boolean)});
export function installAdminMembersDemo(app,{enabled=false}={}){
 if(!enabled)return;
 app.use('/api/admin/members',(req,res,next)=>{
  res.set('Cache-Control','no-store');
  if(!['GET','HEAD'].includes(req.method))return res.status(405).set('Allow','GET, HEAD').json({error:'成员工作区仅支持只读查看'});
  next();
 });
 app.get('/api/admin/members',(req,res)=>res.json({demo:true,members:fixture.map(u=>({username:u.username,status:u.activated?'activated':'pending',conversations:visible(u.sessions).length,projects:visible(u.projects).length,archived:[...u.sessions,...u.projects].filter(x=>x.archivedAt).length,lastActivity:[...u.sessions,...u.projects].map(x=>x.updatedAt).sort().at(-1)||null}))}));
 app.get('/api/admin/members/:username',(req,res)=>{
  const u=fixture.find(u=>u.username===req.params.username);if(!u)return res.status(404).json({error:'账号不存在'});
  res.json({demo:true,readonly:true,username:u.username,status:u.activated?'activated':'pending',sessions:u.sessions.map(s=>({...clean(u.username,s),messages:s.messages.map(m=>clean(u.username,m))})),projects:u.projects.map(p=>({...clean(u.username,p),versions:p.versions.map(v=>({...v,outputs:v.outputs.map(id=>publicFile(u.username,id))}))}))});
 });
 app.get('/api/admin/members/:username/files/:id',(req,res)=>{
  const u=fixture.find(u=>u.username===req.params.username),id=req.params.id;
  if(!u)return res.status(404).json({error:'文件不存在'});
  const allowed=[...u.sessions.flatMap(s=>[...s.files,...s.messages.flatMap(m=>m.files||[])]),...u.projects.flatMap(p=>[...p.files,...p.versions.flatMap(v=>v.outputs)])];
  const f=allowed.includes(id)&&files.find(f=>f.id===id);if(!f)return res.status(404).json({error:'文件不存在'});
  res.set('X-Content-Type-Options','nosniff').attachment(f.name).type(f.name.endsWith('.csv')?'text/csv':'text/markdown').send((f.name.endsWith('.csv')?'\uFEFF':'')+f.content);
 });
}
