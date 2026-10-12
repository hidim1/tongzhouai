import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('滚动条轨道透明且尺寸固定，保留键盘、触屏与高对比度可用性',()=>{
 const css=fs.readFileSync(new URL('../src/preview-assistant.css',import.meta.url),'utf8'),area=fs.readFileSync(new URL('../src/SoftScrollArea.tsx',import.meta.url),'utf8'),view=fs.readFileSync(new URL('../src/Preview.tsx',import.meta.url),'utf8');
 assert.match(css,/scrollbar-gutter: stable/);assert.match(css,/scrollbar-width: thin/);assert.match(css,/scrollbar-color: var\(--zh-scroll-thumb\) transparent/);
 assert.match(css,/is-scrolling/);assert.match(css,/forced-colors: active/);assert.match(css,/hover: none/);assert.match(css,/pointer-events: none/);
 assert.doesNotMatch(css,/scrollbar-width: none/);assert.match(area,/ResizeObserver/);assert.match(area,/clearTimeout\(timer.current\)/);assert.match(area,/onScroll\?\.\(event\)/);
 assert.match(view,/<SoftScrollArea className="zh-messages" tabIndex=\{0\}/);
});
