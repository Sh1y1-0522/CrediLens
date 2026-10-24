const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');
const out = path.resolve(__dirname, '../test-results/upgrade-plan');
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:816,height:1056},deviceScaleFactor:1.5});
    const reports=[];
    for(const file of fs.readdirSync(out).filter(name=>/^page-\d+\.html$/.test(name)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))){
      await page.goto(pathToFileURL(path.join(out,file)).href);
      const report=await page.evaluate(()=>{
        const content=document.querySelector('.content');
        const box=content.getBoundingClientRect();
        const children=[...content.children];
        const bottom=Math.max(...children.map(el=>el.getBoundingClientRect().bottom));
        return {overflow:bottom>box.bottom+1,bottom,height:box.height,availableBottom:box.bottom,textLength:content.textContent.length};
      });
      await page.screenshot({path:path.join(out,file.replace('.html','.png'))});
      reports.push({file,...report});
    }
    console.log(JSON.stringify(reports,null,2));
    fs.writeFileSync(path.join(out,'layout-check.json'),JSON.stringify(reports,null,2));
    if(reports.some(r=>r.overflow))process.exitCode=1;
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
