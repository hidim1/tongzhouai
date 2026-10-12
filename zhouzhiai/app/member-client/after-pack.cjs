// Apply company PE resources even when cross-building without Windows signing tools.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
module.exports=async context=>{
  if(context.electronPlatformName!=='win32')return;
  const builder=createRequire(require.resolve('electron-builder'));
  const ResEdit=createRequire(builder.resolve('app-builder-lib'))('resedit');
  const ico=fs.readFileSync(path.join(__dirname,'icon.ico')),icons=ResEdit.Data.IconFile.from(ico).icons.map(i=>i.data);
  const filename=path.join(context.appOutDir,context.packager.appInfo.productFilename+'.exe');
  const exe=ResEdit.NtExecutable.from(fs.readFileSync(filename),{ignoreCert:true}),machine=exe.newHeader.fileHeader.machine;
  const resource=ResEdit.NtExecutableResource.from(exe),groups=resource.entries.filter(e=>e.type===14);
  assert.ok(groups.length,'缺少客户端图标资源');
  for(const group of groups)ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resource.entries,group.id,group.lang,icons);
  resource.outputResource(exe);fs.writeFileSync(filename,Buffer.from(exe.generate()));
  const checked=ResEdit.NtExecutable.from(fs.readFileSync(filename));assert.equal(checked.newHeader.fileHeader.machine,machine);
  const resources=ResEdit.NtExecutableResource.from(checked);assert.ok(resources.entries.some(e=>e.type===3&&Buffer.from(e.bin).equals(Buffer.from(icons.find(i=>i.width===128).bin))));
  fs.writeFileSync(path.join(context.appOutDir,'zhouzhi-crossflow-v1.ico'),ico);
};
