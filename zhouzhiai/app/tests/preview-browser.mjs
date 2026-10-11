import {chromium} from '/Users/lhy19950000/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,...(!fs.existsSync(chromium.executablePath())?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
const page=await browser.newPage({viewport:{width:1512,height:982}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const root=path.resolve('../local-data/qa');fs.mkdirSync(root,{recursive:true});
try{
 await page.goto('http://127.0.0.1:14318');await page.getByRole('heading',{name:'把日常工作，交给舟知搭把手。'}).waitFor();
 await page.screenshot({path:path.join(root,'01-智能工作助理.png'),fullPage:true});
 await page.getByRole('button',{name:'膜预算平台 AI',exact:true}).click();await page.getByRole('button',{name:'演示流程',exact:true}).click();await page.getByRole('button',{name:'查看演示重组',exact:true}).click();
 assert.equal(await page.locator('.zh-tabs').count(),0);assert.equal(await page.getByText('历史样机候选',{exact:true}).count(),0);
 const icons=await page.locator('.zh-nav svg').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().x));assert.equal(icons[0],icons[1],'parallel navigation must align');
 await page.getByText('演示样例 · 非工程结论',{exact:true}).waitFor();
 await page.screenshot({path:path.join(root,'02-膜预算清单重组.png'),fullPage:true});
 const dl=page.waitForEvent('download');await page.getByRole('button',{name:'清单 Excel',exact:true}).click();const download=await dl;await download.saveAs(path.join(root,'演示清单.xlsx'));
 await page.getByRole('button',{name:'保存已核对版本',exact:true}).click();await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').textContent(),/未核对|演示/);
 await page.locator('summary').filter({hasText:'方案经验估算与已核对清单的外购金额'}).click();await page.getByRole('button',{name:'计算经验估算',exact:true}).click();await page.getByRole('heading',{name:'中档方案成本构成',exact:true}).waitFor();
 await page.screenshot({path:path.join(root,'03-预算口径.png'),fullPage:true});
 await page.locator('summary').filter({hasText:'按已核对方案与参考视图生成概念展示'}).click();assert.equal(await page.getByRole('button',{name:'生成效果图',exact:true}).isEnabled(),false);
 await page.getByLabel('向舟知发送消息').waitFor();assert.equal(await page.getByText('原工程工作台，归入膜预算平台。').count(),0);
 await page.getByRole('button',{name:'智能工作助理 AI',exact:true}).click();await page.getByText('Word / Excel / PPT / Markdown',{exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(root,'04-移动端.png'),fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'mobile horizontal overflow');
 assert.deepEqual(errors,[]);console.log('浏览器验证通过：双入口对齐、后台匹配、统一成果区、Excel下载、核对门槛、原预算计算、直接工程AI、PPT入口、移动布局。');
}finally{await browser.close();}
