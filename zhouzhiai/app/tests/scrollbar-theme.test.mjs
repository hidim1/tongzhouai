import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {scrollbarTheme} from '../server/scrollbar-theme.mjs';
import {memberPage} from '../server/member-gateway.mjs';

const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
test('全局主题覆盖所有原生滚动容器，横纵同宽且不改变页面溢出布局',()=>{
  assert.equal(scrollbarTheme,read('server/ui/scrollbars.css'));
  assert.match(scrollbarTheme,/\*\s*\{[^}]*scrollbar-width: thin/s);
  assert.match(scrollbarTheme,/\*::-webkit-scrollbar \{ width: 6px; height: 6px;/);
  assert.match(scrollbarTheme,/\*::-webkit-scrollbar-corner \{ background: transparent;/);
  assert.match(scrollbarTheme,/\*::-webkit-scrollbar-thumb \{[^}]*border-radius: 10px/s);
  assert.match(scrollbarTheme,/data-zh-scrolling/);
  assert.doesNotMatch(scrollbarTheme,/scrollbar-width:\s*none|overflow:\s*hidden|scrollbar-gutter:/);
  assert.match(scrollbarTheme,/@media \(hover: none\) and \(pointer: coarse\)/);
  assert.match(scrollbarTheme,/@media \(forced-colors: active\)/);
  assert.match(scrollbarTheme,/width: revert; height: revert/);
});
test('管理员和普通用户入口、登录激活和修改密码共用同一个主题',()=>{
  for(const entry of ['src/main.tsx','src/member-main.tsx'])assert.match(read(entry),/import '\.\.\/server\/ui\/scrollbars\.css'/);
  for(const activate of [false,true]){
    assert.ok(memberPage(activate).includes(`<style data-zhouzhi-scrollbars>${scrollbarTheme}</style>`));
  }
  assert.match(read('server/access.mjs'),/<style data-zhouzhi-scrollbars>\$\{scrollbarTheme\}<\/style>/);
  assert.match(read('desktop/electron-builder.yml'),/server\/\*\*\/\*/);
});
test('页面不得另设滚动条宽度或配色，避免侧栏、表格、弹窗以后出现分叉',()=>{
  const visit=dir=>fs.readdirSync(new URL('../'+dir,import.meta.url),{withFileTypes:true}).flatMap(entry=>{
    const file=dir+'/'+entry.name;
    return entry.isDirectory()?visit(file):file.endsWith('.css')?[file]:[];
  });
  for(const file of visit('src'))assert.doesNotMatch(read(file),/scrollbar-(?:width|color)\s*:|::-webkit-scrollbar|--zh-scroll-(?:thumb|idle|active|hover)\s*:/,file);
});
test('滚动状态捕获原生嵌套容器及整页，保留默认操作并在卸载时清理',()=>{
  const hook=read('src/useScrollActivity.ts');
  assert.match(read('src/Preview.tsx'),/useScrollActivity\(\)/);
  assert.match(hook,/document\.scrollingElement/);
  assert.match(hook,/addEventListener\('scroll',mark,\{capture:true,passive:true\}\)/);
  assert.match(hook,/removeEventListener\('scroll',mark,true\)/);
  assert.match(hook,/clearTimeout\(timer\)/);
  assert.match(hook,/timers\.delete\(target\)/);
  assert.doesNotMatch(hook,/preventDefault|stopPropagation|setInterval/);
});
