'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'..');
const OUT=path.join(ROOT,'test-results');
const BASE=process.env.TEST_BASE_URL||'http://127.0.0.1:5173';
const normalInputs=[
  {text:'反诈提醒：不要缴纳所谓解冻保证金，不要向任何人提供短信验证码。遇到可疑消息，请通过官方渠道核实。',label:'反诈与安全提醒',slug:'safety'},
  {text:'图书馆通知：您借阅的图书即将到期，请通过学校图书馆官网查询并按时归还。',label:'日常事务通知',slug:'notice'}
];
fs.mkdirSync(OUT,{recursive:true});
async function main(){
  const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const page=await context.newPage();const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try {
    await page.goto(BASE);await page.locator('.sample-btn').first().waitFor();
    assert.ok(await page.locator('#startupDialog').isVisible());assert.ok(await page.locator('#startupLocal').isChecked());
    await page.waitForFunction(()=>document.getElementById('startupStatus').textContent.includes('尚未配置'));
    assert.ok(await page.locator('#startupCloud').isDisabled());
    await page.evaluate(()=>Promise.allSettled(document.getAnimations().map(animation=>animation.finished)));
    for(const width of [360,390,768,1024,1440]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.getElementById('startupDialog').getBoundingClientRect().width<=innerWidth));await page.screenshot({path:path.join(OUT,`startup-local-${width}.png`)});}
    const radioStyle=await page.locator('#startupLocal').evaluate(el=>{const css=getComputedStyle(el);return {outline:css.outlineStyle,radius:css.borderRadius,width:css.width,height:css.height};});assert.equal(radioStyle.outline,'none');assert.equal(radioStyle.radius,'50%');assert.equal(radioStyle.width,radioStyle.height);
    assert.equal(await page.locator('#startupDialog').evaluate(el=>getComputedStyle(el).animationName),'startup-enter');
    await page.setViewportSize({width:360,height:520});await page.locator('#startWorkbenchBtn').scrollIntoViewIfNeeded();assert.ok(await page.locator('#startWorkbenchBtn').isVisible());await page.click('#startWorkbenchBtn');await page.locator('#startupDialog').waitFor({state:'hidden'});assert.equal(await page.locator('#inputProcessingMode').innerText(),'本地处理');await page.setViewportSize({width:1440,height:1000});
    assert.equal(await page.locator('i[data-lucide]').count(),0,'icons rendered');
    assert.ok(await page.locator('.brand img').evaluate(el=>el.complete&&el.naturalWidth>0));
    await page.screenshot({path:path.join(OUT,'desktop-empty.png'),fullPage:true});
    await page.click('#analyzeBtn');assert.match(await page.locator('#inputError').innerText(),/填写/);
    await page.click('[data-case="task"]');await page.click('#analyzeBtn');await page.waitForFunction(()=>!document.getElementById('resultContent').hidden);
    assert.equal(await page.locator('#riskLabel').innerText(),'高风险');
    const officialLinks=await page.locator('#referenceList a').evaluateAll(links=>links.map(link=>link.href));assert.ok(officialLinks.length);for(const value of officialLinks){const url=new URL(value);assert.equal(url.hostname,'gaj.gz.gov.cn');assert.match(url.pathname,/\/content\/post_\d+\.html$/);}
    const quote=await page.locator('.evidence blockquote').first().innerText();
    await page.locator('[data-quote-index]').first().click();assert.equal(await page.locator('mark').innerText(),quote);
    await page.click('[data-report-tab="evidence"]');
    await page.locator('.action-item input').first().check();assert.match(await page.locator('#actionProgress').innerText(),/^1/);
    await page.locator('[data-quiz-index="0"]').click();assert.match(await page.locator('#quizFeedback').innerText(),/再核对/);
    await page.locator('[data-quiz-index="1"]').click();assert.match(await page.locator('#quizFeedback').innerText(),/判断正确/);
    const downloadPromise=page.waitForEvent('download');await page.click('#jsonBtn');const download=await downloadPromise;await download.saveAs(path.join(OUT,'exported-report.json'));
    const exported=JSON.parse(fs.readFileSync(path.join(OUT,'exported-report.json'),'utf8'));assert.equal(exported.level,'high');assert.deepEqual(exported.checkedActions,[0]);
    await page.screenshot({path:path.join(OUT,'desktop-report.png'),fullPage:true});
    await page.click('[data-case="notice"]');await page.click('#analyzeBtn');await page.waitForFunction(()=>document.getElementById('riskLabel').textContent==='低风险');
    for(const sample of normalInputs){
      await page.click('#resetBtn');await page.fill('#message',sample.text);await page.click('#analyzeBtn');await page.waitForFunction(()=>!document.getElementById('resultContent').hidden);
      assert.equal(await page.locator('#riskLabel').innerText(),'低风险');assert.equal(await page.locator('#contentType').innerText(),sample.label);
      assert.ok(await page.locator('#riskScorePanel').isHidden());assert.equal(await page.locator('#assessmentDetails dt').count(),4);assert.match(await page.locator('#assessmentDetails').innerText(),/未核实身份/);
      assert.match(await page.locator('#riskDescription').innerText(),/未核实/);assert.ok(!await page.locator('#actionList').innerText().then(text=>text.includes('保留原始聊天')));
      assert.equal(await page.locator('.evidence-tag').first().innerText(),'内容线索');
      await page.locator('[data-quote-index]').first().click();assert.ok(sample.text.includes(await page.locator('mark').innerText()));await page.click('[data-report-tab="evidence"]');
      await page.screenshot({path:path.join(OUT,`desktop-${sample.slug}-report.png`),fullPage:true});
    }
    await page.click('#resetBtn');await page.fill('#message','反诈提醒：识别为“反诈与安全提醒”，没有把否定语句当作危险要求。');await page.click('#analyzeBtn');await page.waitForFunction(()=>!document.getElementById('resultContent').hidden);
    assert.equal(await page.locator('#riskLabel').innerText(),'不适用风险评级');assert.ok(await page.locator('#riskScorePanel').isHidden());assert.ok(await page.locator('#actionsHeading').isHidden());assert.ok(await page.locator('#quizSection').isHidden());assert.ok(await page.locator('#missingSection').isHidden());
    assert.match(await page.locator('#riskDescription').innerText(),/描述一次/);
    await page.screenshot({path:path.join(OUT,'desktop-meta-report.png'),fullPage:true});
    await page.click('#resetBtn');await page.fill('#message','学校附近有兼职');await page.click('#analyzeBtn');await page.waitForFunction(()=>document.getElementById('riskLabel').textContent==='待核验');assert.equal(await page.locator('#riskScore').innerText(),'—');
    assert.ok(await page.locator('#missingSection').isVisible());assert.match(await page.locator('#missingInformation').innerText(),/工作内容/);assert.ok(await page.locator('#actionsHeading').isHidden());
    await page.click('#resetBtn');await page.fill('#message','请提供短信验证码并开启屏幕共享。这是真的吗？');await page.fill('#background','我认识老师，想核实收费，联系13800138000');await page.click('#analyzeBtn');await page.waitForFunction(()=>!document.getElementById('resultContent').hidden);
    assert.equal(await page.locator('#riskLabel').innerText(),'高风险');assert.match(await page.locator('#verificationAnswer').innerText(),/不能仅凭/);assert.ok(!await page.locator('#backgroundText').innerText().then(text=>text.includes('13800138000')));
    await page.click('[data-report-tab="original"]');assert.ok(!(await page.locator('#originalText').innerText()).includes('我认识老师'));
    for(const width of [360,390,768,1024,1440]){await page.setViewportSize({width,height:900});await page.evaluate(()=>{document.activeElement.blur();window.scrollTo(0,0);});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if([390,1440].includes(width))await page.screenshot({path:path.join(OUT,`background-local-${width}.png`),fullPage:true});}
    await page.click('[data-view="history"]');await page.locator('[data-history]').first().click();assert.match(await page.locator('#background').inputValue(),/我认识老师/);
    await page.fill('#background','变更背景');assert.ok(await page.locator('#resultContent').isHidden());await page.click('#resetBtn');assert.equal(await page.locator('#background').inputValue(),'');
    await page.fill('#background','有个兼职让我付款，是真的吗？');await page.click('#analyzeBtn');await page.waitForFunction(()=>!document.getElementById('resultContent').hidden);assert.equal(await page.locator('#riskLabel').innerText(),'待核验');assert.match(await page.locator('#verificationAnswer').innerText(),/补充消息原文/);
    await page.click('#tab-link');await page.fill('#linkInput','https://www.nju.edu.cn/');await page.click('#analyzeBtn');await page.waitForFunction(()=>!document.getElementById('urlSection').hidden);
    assert.match(await page.locator('#referenceList').innerText(),/域名与网址结构/);assert.match(await page.locator('#referenceList').innerText(),/项目规则说明/);assert.equal(await page.locator('#referenceList a').count(),0);assert.ok(!/CISA|OWASP|undefined|null/.test(await page.locator('#referenceList').innerText()));
    await page.fill('#linkInput','javascript:alert(1)');await page.click('#analyzeBtn');assert.ok(await page.locator('#inputError').isVisible());
    await page.fill('#linkInput','https://school.edu.cn:private-pass@example.com/login?token=private-token');await page.fill('#linkContext','请提供验证码并转账到个人账户');await page.click('#analyzeBtn');await page.waitForFunction(()=>!document.getElementById('resultContent').hidden&&document.getElementById('urlDetails').textContent.includes('example.com'));
    assert.match(await page.locator('#urlDetails').innerText(),/example\.com/);
    await page.click('[data-report-tab="original"]');const redacted=await page.locator('#originalText').innerText();assert.ok(!redacted.includes('private-pass')&&!redacted.includes('private-token'));
    await page.click('[data-view="cases"]');await page.fill('#caseSearch','保证金');assert.equal(await page.locator('.case-card').count(),1);await page.fill('#caseSearch','不存在的案例');assert.equal(await page.locator('.case-card').count(),0);await page.fill('#caseSearch','');await page.selectOption('#caseFilter','unknown');assert.equal(await page.locator('.case-card').count(),2);
    await page.selectOption('#caseFilter','all');await page.screenshot({path:path.join(OUT,'desktop-cases.png'),fullPage:true});
    await page.click('[data-view="knowledge"]');assert.equal(await page.locator('.knowledge-item').count(),10);assert.equal(await page.locator('.knowledge-item a').count(),6);for(const value of await page.locator('.knowledge-item a').evaluateAll(links=>links.map(link=>link.href))){assert.equal(new URL(value).hostname,'gaj.gz.gov.cn');}
    await page.fill('#knowledgeSearch','班主任');assert.ok(await page.locator('.knowledge-item a').count()>0);assert.match(await page.locator('#knowledgeList').innerText(),/发布 2023-10-12/);assert.match(await page.locator('#knowledgeList').innerText(),/链接核对 2026-10-22/);
    await page.fill('#knowledgeSearch','提示词');assert.equal(await page.locator('.knowledge-item a').count(),0);assert.match(await page.locator('#knowledgeList').innerText(),/无外部引用/);
    for(const width of [390,1440]){await page.fill('#knowledgeSearch','');await page.setViewportSize({width,height:900});await page.evaluate(()=>{document.activeElement.blur();window.scrollTo(0,0);});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(OUT,`knowledge-cn-official-${width}.png`),fullPage:true});}
    await page.fill('#knowledgeSearch','验证码');assert.ok(await page.locator('.knowledge-item').count()>0);await page.fill('#knowledgeSearch','不存在的知识');assert.equal(await page.locator('.knowledge-item').count(),0);
    await page.click('[data-view="history"]');assert.ok(await page.locator('.history-item').count()>=4);await page.locator('[data-history]').last().click();assert.equal(await page.locator('#riskLabel').innerText(),'高风险');assert.ok(await page.locator('.action-item input').first().isChecked());
    await page.click('#settingsBtn');assert.ok(await page.locator('#settingsDialog').isVisible());assert.ok(await page.locator('#cloudOption').isDisabled());await page.keyboard.press('Escape');assert.ok(!await page.locator('#settingsDialog').isVisible());
    const imageFixture=await page.locator('.brand img').screenshot();
    await page.click('#resetBtn');await page.click('#tab-image');await page.setInputFiles('#imageFile',{name:'sample.png',mimeType:'image/png',buffer:imageFixture});
    await page.waitForFunction(()=>!document.getElementById('imagePreviewWrap').hidden);assert.ok(await page.locator('#imagePreview').evaluate(el=>el.naturalWidth>0));
    await page.click('#analyzeBtn');assert.match(await page.locator('#inputError').innerText(),/填写截图文字/);await page.fill('#imageNote','请提供验证码并开启屏幕共享');await page.click('#analyzeBtn');assert.match(await page.locator('#inputError').innerText(),/文字确认/);await page.check('#imageTextConfirmed');await page.click('#analyzeBtn');await page.waitForFunction(()=>document.getElementById('riskLabel').textContent==='高风险');
    await page.click('#resetBtn');await page.fill('#message','<img src=x onerror="window.__injected=true">请转账到个人账户');await page.click('#analyzeBtn');await page.waitForFunction(()=>!document.getElementById('resultContent').hidden);await page.click('[data-report-tab="original"]');assert.ok(!await page.evaluate(()=>window.__injected));assert.equal(await page.locator('#originalText img').count(),0);
    for(const width of [360,390,768,1024,1440]){
      await page.setViewportSize({width,height:900});await page.click('#resetBtn');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`no overflow ${width}`);
      for(const view of ['cases','knowledge','history','workbench']){
        await page.click(`[data-view="${view}"]`);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${view} no overflow ${width}`);
      }
      if(width===390){await page.evaluate(()=>{document.activeElement.blur();window.scrollTo(0,0);});await page.screenshot({path:path.join(OUT,'mobile-empty.png'),fullPage:true});}
      await page.click('[data-case="task"]');await page.click('#analyzeBtn');await page.waitForFunction(()=>!document.getElementById('resultContent').hidden);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`report no overflow ${width}`);
      if(width===390){await page.screenshot({path:path.join(OUT,'mobile-report-viewport.png')});await page.evaluate(()=>{document.activeElement.blur();window.scrollTo(0,0);});await page.screenshot({path:path.join(OUT,'mobile-report.png'),fullPage:true});}
    }
    await page.goto(pathToFileURL(path.join(ROOT,'index.html')).href);await page.locator('#startupDialog').waitFor();assert.ok(await page.locator('#startupCloud').isDisabled());assert.match(await page.locator('#startupStatus').innerText(),/本地文件/);await page.keyboard.press('Escape');await page.locator('#startupDialog').waitFor({state:'hidden'});assert.equal(await page.locator('#inputProcessingMode').innerText(),'本地处理');await page.click('[data-case="task"]');await page.click('#analyzeBtn');await page.waitForFunction(()=>document.getElementById('riskLabel').textContent==='高风险');
    const cloud=await context.newPage();cloud.on('pageerror',error=>errors.push(error.message));
    await cloud.route('**/api/status',route=>route.fulfill({json:{configured:true,model:'test-only',vision:true}}));
    let apiMode='success',pendingRoute,ocrMode='success',pendingOcr,ocrCalls=0,analyzeCalls=0,lastAnalysis;
    await cloud.route('**/api/transcribe',async route=>{
      ocrCalls++;const payload=route.request().postDataJSON();assert.equal(payload.imageConsent,true);assert.ok(payload.image.startsWith('data:image/jpeg;base64,'));assert.equal(payload.text,'');
      if(ocrMode==='delay'){pendingOcr=route;return;}
      if(ocrMode==='error'){await route.fulfill({status:503,json:{error:'识别服务返回错误，请稍后重试。'}});return;}
      await route.fulfill({json:{status:'needs_review',text:'请提供短信验证码并开启屏幕享。联系电话13800138000',redacted:false}});
    });
    await cloud.route('**/api/analyze',async route=>{
      analyzeCalls++;lastAnalysis=route.request().postDataJSON();assert.ok(!lastAnalysis.image);assert.ok(!lastAnalysis.imageConsent);
      if(apiMode==='delay'){pendingRoute=route;return;}
      if(apiMode==='error'){await route.fulfill({status:503,json:{error:'temporary'}});return;}
      const payload=route.request().postDataJSON();assert.ok(!JSON.stringify(payload).includes('13800138000'));
      let report=require('../engine').analyze(payload);
      if(apiMode==='context')report=require('../model').validateModel({risk_level:'low',evidence:[],content_assessment:{type:'routine_notice',quote:payload.text}},report,payload);
      else if(report.level==='low')report=require('../model').validateModel({risk_level:'unknown',evidence:[],summary:'发送者未核实'},report,payload);
      report.source='cloud';report.sourceLabel='云端模型 + 原文证据校验';await route.fulfill({json:report});
    });
    await cloud.goto(BASE);await cloud.waitForFunction(()=>!document.getElementById('startupCloud').disabled);assert.ok(await cloud.locator('#startupLocal').isChecked());assert.equal(analyzeCalls,0);assert.equal(ocrCalls,0);
    await cloud.locator('#startupLocal').focus();await cloud.keyboard.press('ArrowDown');assert.ok(await cloud.locator('#startupCloud').isChecked());assert.equal(await cloud.locator('#startupCloud').evaluate(el=>getComputedStyle(el).outlineStyle),'none');
    await cloud.evaluate(()=>Promise.allSettled(document.getAnimations().map(animation=>animation.finished)));
    for(const width of [390,1440]){await cloud.setViewportSize({width,height:900});await cloud.screenshot({path:path.join(OUT,`startup-cloud-${width}.png`)});}await cloud.click('#startWorkbenchBtn');await cloud.locator('#startupDialog').waitFor({state:'hidden'});assert.equal(await cloud.evaluate(()=>document.activeElement.id),'tab-text');
    assert.equal(await cloud.locator('#inputProcessingMode').innerText(),'云端处理');assert.match(await cloud.locator('#sidebarPrivacy').innerText(),/云端处理/);
    await cloud.fill('#message','课程通知：明天在教室上课，请按时参加。是真的吗？');await cloud.fill('#background','这是真的吗？我还没付款，联系13800138000');await cloud.click('#analyzeBtn');await cloud.waitForFunction(()=>!document.getElementById('resultContent').hidden);
    assert.equal(await cloud.locator('#riskLabel').innerText(),'低风险');assert.match(await cloud.locator('#verificationAnswer').innerText(),/不能证明消息是真的/);assert.ok(!lastAnalysis.background.includes('13800138000'));assert.ok(!lastAnalysis.text.includes('我还没付款'));
    const backgroundDownloadPromise=cloud.waitForEvent('download');await cloud.click('#jsonBtn');const backgroundDownload=await backgroundDownloadPromise;await backgroundDownload.saveAs(path.join(OUT,'exported-background-report.json'));
    const backgroundExport=JSON.parse(fs.readFileSync(path.join(OUT,'exported-background-report.json'),'utf8'));assert.ok(backgroundExport.background);assert.ok(backgroundExport.verificationResponse);assert.ok(!backgroundExport.original.includes('我还没付款'));
    const backgroundMarkdownPromise=cloud.waitForEvent('download');await cloud.click('#exportBtn');const backgroundMarkdown=await backgroundMarkdownPromise;await backgroundMarkdown.saveAs(path.join(OUT,'exported-background-report.md'));const backgroundMd=fs.readFileSync(path.join(OUT,'exported-background-report.md'),'utf8');assert.match(backgroundMd,/用户补充（自述，未核实）/);assert.match(backgroundMd,/核验回应/);assert.ok(!backgroundMd.includes('13800138000'));
    for(const width of [390,1440]){await cloud.setViewportSize({width,height:900});await cloud.evaluate(()=>{document.activeElement.blur();window.scrollTo(0,0);});assert.ok(await cloud.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await cloud.screenshot({path:path.join(OUT,`background-cloud-${width}.png`),fullPage:true});}
    await cloud.click('#resetBtn');await cloud.click('#tab-link');await cloud.fill('#linkInput','https://school.edu.cn@example.com/login');await cloud.fill('#background','对方自称学校老师，是真的吗？');await cloud.click('#analyzeBtn');await cloud.waitForFunction(()=>!document.getElementById('urlSection').hidden);assert.equal(await cloud.locator('#riskLabel').innerText(),'中风险');assert.match(await cloud.locator('#urlDetails').innerText(),/example.com/);assert.match(await cloud.locator('#uncertaintyText').innerText(),/未访问/);assert.equal(lastAnalysis.text,'');assert.match(lastAnalysis.background,/自称学校老师/);
    await cloud.fill('#linkInput','https://example.org/');await cloud.fill('#linkContext','');await cloud.click('#analyzeBtn');await cloud.waitForFunction(()=>document.getElementById('riskLabel').textContent==='待核验');assert.match(await cloud.locator('#verificationAnswer').innerText(),/已覆盖的结构检查项/);assert.equal(await cloud.locator('#urlChecks li').count(),6);
    await cloud.fill('#linkContext','请提供验证码');await cloud.click('#analyzeBtn');await cloud.waitForFunction(()=>document.getElementById('riskLabel').textContent==='高风险');
    for(const sample of normalInputs){
      await cloud.click('#resetBtn');await cloud.fill('#message',sample.text);await cloud.click('#analyzeBtn');await cloud.waitForFunction(()=>!document.getElementById('resultContent').hidden);
      assert.equal(await cloud.locator('#riskLabel').innerText(),'低风险');assert.equal(await cloud.locator('#contentType').innerText(),sample.label);assert.match(await cloud.locator('#analysisSource').innerText(),/云端模型/);
      assert.ok(await cloud.locator('#riskScorePanel').isHidden());assert.match(await cloud.locator('#assessmentDetails').innerText(),/足以作内容初筛/);
      for(const width of [390,1440]){
        await cloud.setViewportSize({width,height:900});assert.ok(await cloud.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`normal report no overflow ${width}`);
        await cloud.screenshot({path:path.join(OUT,`cloud-${sample.slug}-${width}.png`),fullPage:true});
      }
    }
    await cloud.click('#resetBtn');await cloud.fill('#message','反诈提醒：识别为“反诈与安全提醒”，没有把否定语句当作危险要求。');await cloud.click('#analyzeBtn');await cloud.waitForFunction(()=>!document.getElementById('resultContent').hidden);
    assert.equal(await cloud.locator('#riskLabel').innerText(),'不适用风险评级');assert.ok(await cloud.locator('#actionsHeading').isHidden());assert.ok(await cloud.locator('#quizSection').isHidden());
    for(const width of [360,390,1440]){await cloud.setViewportSize({width,height:900});assert.ok(await cloud.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await cloud.screenshot({path:path.join(OUT,`cloud-meta-${width}.png`),fullPage:true});}
    const metaDownloadPromise=cloud.waitForEvent('download');await cloud.click('#jsonBtn');const metaDownload=await metaDownloadPromise;await metaDownload.saveAs(path.join(OUT,'exported-meta-report.json'));
    const metaExport=JSON.parse(fs.readFileSync(path.join(OUT,'exported-meta-report.json'),'utf8'));assert.equal(metaExport.level,'not_applicable');assert.equal(metaExport.score,null);assert.equal(metaExport.assessment.sourceVerification,'not_verified');assert.deepEqual(metaExport.actions,[]);assert.equal(metaExport.quiz,null);
    apiMode='context';await cloud.click('#resetBtn');await cloud.fill('#message','操场检修将在明日下午结束，届时恢复开放，请留意校内公告。');await cloud.click('#analyzeBtn');await cloud.waitForFunction(()=>!document.getElementById('resultContent').hidden);
    assert.equal(await cloud.locator('#riskLabel').innerText(),'低风险');assert.equal(await cloud.locator('#contentType').innerText(),'日常事务通知');assert.equal(await cloud.locator('.evidence-tag').first().innerText(),'内容线索');apiMode='success';
    await cloud.setViewportSize({width:1440,height:900});
    await cloud.click('#settingsBtn');await cloud.selectOption('#analysisMode','local');await cloud.click('#saveSettingsBtn');assert.equal(await cloud.locator('#inputProcessingMode').innerText(),'本地处理');assert.match(await cloud.locator('#sidebarPrivacy').innerText(),/仅在本机/);
    await cloud.click('#settingsBtn');await cloud.selectOption('#analysisMode','cloud');await cloud.click('#saveSettingsBtn');
    await cloud.fill('#message','联系13800138000，提供验证码');await cloud.click('#analyzeBtn');await cloud.waitForFunction(()=>document.getElementById('analysisSource').textContent.includes('云端模型'));assert.equal(await cloud.locator('#riskLabel').innerText(),'高风险');
    apiMode='error';await cloud.click('#analyzeBtn');await cloud.waitForFunction(()=>!document.getElementById('fallbackNotice').hidden);assert.match(await cloud.locator('#analysisSource').innerText(),/本地/);
    apiMode='delay';await cloud.click('#analyzeBtn');await cloud.waitForFunction(()=>!document.getElementById('cancelBtn').hidden);await cloud.click('#cancelBtn');assert.ok(await cloud.locator('#loadingState').isHidden());assert.ok(await cloud.locator('#analyzeBtn').isEnabled());if(pendingRoute)await pendingRoute.abort().catch(()=>{});
    const screenshotData=await cloud.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=760;canvas.height=240;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,760,240);ctx.fillStyle='#202723';ctx.font='26px Microsoft YaHei';ctx.fillText('请提供短信验证码并开启屏幕共享。',30,75);ctx.fillText('虚构测试截图，请勿填写真实个人信息。',30,130);return canvas.toDataURL('image/png').split(',')[1];});
    const textImage=Buffer.from(screenshotData,'base64');
    await cloud.click('#resetBtn');await cloud.click('#tab-image');await cloud.setInputFiles('#imageFile',{name:'sample.png',mimeType:'image/png',buffer:textImage});await cloud.waitForFunction(()=>!document.getElementById('imagePreviewWrap').hidden);
    const beforeAnalyze=analyzeCalls,beforeHistory=await cloud.locator('#historyCount').innerText();
    await cloud.click('#recognizeBtn');assert.match(await cloud.locator('#inputError').innerText(),/勾选云端识图授权/);assert.equal(ocrCalls,0);
    await cloud.click('#analyzeBtn');assert.match(await cloud.locator('#inputError').innerText(),/先识别/);assert.equal(analyzeCalls,beforeAnalyze);
    ocrMode='error';await cloud.check('#imageConsent');await cloud.click('#recognizeBtn');await cloud.waitForFunction(()=>document.getElementById('imageRecognitionStatus').textContent.includes('未完成'));
    assert.ok(await cloud.locator('#resultContent').isHidden());assert.equal(await cloud.locator('#historyCount').innerText(),beforeHistory);
    await cloud.screenshot({path:path.join(OUT,'cloud-image-failed.png'),fullPage:true});
    ocrMode='success';await cloud.click('#recognizeBtn');await cloud.waitForFunction(()=>document.getElementById('imageRecognitionStatus').textContent.includes('文字已识别'));
    assert.ok(!await cloud.locator('#imageNote').inputValue().then(text=>text.includes('13800138000')));
    assert.equal(analyzeCalls,beforeAnalyze);assert.ok(await cloud.locator('#resultContent').isHidden());assert.ok(!await cloud.locator('#imageTextConfirmed').isChecked());
    assert.equal(await cloud.locator('#historyCount').innerText(),beforeHistory);
    await cloud.click('#analyzeBtn');assert.match(await cloud.locator('#inputError').innerText(),/文字确认/);assert.equal(analyzeCalls,beforeAnalyze);
    await cloud.check('#imageTextConfirmed');await cloud.fill('#imageNote','请提供短信验证码并开启屏幕共享。');assert.ok(!await cloud.locator('#imageTextConfirmed').isChecked());
    for(const width of [360,390,768,1024,1440]){await cloud.setViewportSize({width,height:900});await cloud.evaluate(()=>{document.activeElement.blur();window.scrollTo(0,0);});assert.ok(await cloud.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await cloud.screenshot({path:path.join(OUT,`image-review-${width}.png`),fullPage:true});await cloud.click('#zoomImageBtn');assert.ok(await cloud.locator('#imageDetail').evaluate(el=>el.complete&&el.naturalWidth>0));assert.ok(await cloud.evaluate(()=>document.getElementById('imageDialog').scrollWidth<=innerWidth));await cloud.click('#imageSizeBtn');if(width<768)assert.ok(await cloud.locator('#imageDetailViewport').evaluate(el=>el.scrollWidth>el.clientWidth));if([390,1440].includes(width))await cloud.screenshot({path:path.join(OUT,`image-zoom-${width}.png`)});await cloud.click('#imageSizeBtn');assert.equal(await cloud.locator('#imageSizeBtn').getAttribute('aria-pressed'),'false');await cloud.keyboard.press('Escape');}
    await cloud.check('#imageTextConfirmed');await cloud.fill('#background','这是真的吗？我已经付款，对方又要交钱。');assert.ok(await cloud.locator('#imageTextConfirmed').isChecked());apiMode='success';const beforeOcr=ocrCalls;
    await cloud.click('#analyzeBtn');await cloud.waitForFunction(()=>!document.getElementById('resultContent').hidden);
    assert.equal(await cloud.locator('#riskLabel').innerText(),'高风险');assert.equal(ocrCalls,beforeOcr);assert.equal(lastAnalysis.imageTextConfirmed,true);assert.equal(lastAnalysis.text,'请提供短信验证码并开启屏幕共享。');
    assert.match(await cloud.locator('#processingStatus').innerText(),/用户确认/);assert.match(await cloud.locator('#uncertaintyText').innerText(),/仅分析/);
    assert.match(await cloud.locator('#imageRecognitionStatus').innerText(),/完成风险分析/);assert.ok(!(await cloud.locator('#imageRecognitionStatus').innerText()).includes('尚未分析'));
    assert.match(await cloud.locator('#backgroundAdvice').innerText(),/根据你自述的已付款情况/);assert.ok(!lastAnalysis.text.includes('我已经付款'));
    await cloud.fill('#background','我还没付款');assert.ok(await cloud.locator('#resultContent').isHidden());assert.ok(await cloud.locator('#imageTextConfirmed').isChecked());
    apiMode='error';await cloud.click('#analyzeBtn');await cloud.waitForFunction(()=>!document.getElementById('fallbackNotice').hidden);assert.match(await cloud.locator('#imageRecognitionStatus').innerText(),/本地回退报告/);apiMode='success';await cloud.click('#analyzeBtn');await cloud.waitForFunction(()=>document.getElementById('fallbackNotice').hidden);
    const imageExportPromise=cloud.waitForEvent('download');await cloud.click('#jsonBtn');const imageExport=await imageExportPromise;await imageExport.saveAs(path.join(OUT,'exported-image-report.json'));
    const imageReport=JSON.parse(fs.readFileSync(path.join(OUT,'exported-image-report.json'),'utf8'));assert.equal(imageReport.inputReview.status,'user_confirmed');assert.ok(!JSON.stringify(imageReport).includes('data:image'));
    await cloud.click('[data-view="history"]');await cloud.locator('[data-history]').first().click();assert.equal(await cloud.locator('#imageNote').inputValue(),imageReport.original);assert.ok(!await cloud.locator('#imageTextConfirmed').isChecked());assert.ok(await cloud.locator('#imagePreviewWrap').isHidden());
    await cloud.setInputFiles('#imageFile',{name:'replacement.png',mimeType:'image/png',buffer:textImage});await cloud.waitForFunction(()=>!document.getElementById('imagePreviewWrap').hidden);assert.equal(await cloud.locator('#imageNote').inputValue(),'');assert.ok(!await cloud.locator('#imageConsent').isChecked());assert.ok(!await cloud.locator('#imageTextConfirmed').isChecked());assert.ok(await cloud.locator('#resultContent').isHidden());
    ocrMode='delay';await cloud.check('#imageConsent');await cloud.click('#recognizeBtn');await cloud.waitForFunction(()=>!document.getElementById('cancelBtn').hidden);await cloud.click('#cancelBtn');if(pendingOcr)await pendingOcr.abort().catch(()=>{});assert.equal(await cloud.locator('#imageNote').inputValue(),'');assert.ok(await cloud.locator('#loadingState').isHidden());assert.ok(await cloud.locator('#recognizeBtn').isEnabled());
    await cloud.fill('#imageNote','旧文字');cloud.once('dialog',dialog=>dialog.dismiss());await cloud.click('#recognizeBtn');assert.equal(await cloud.locator('#imageNote').inputValue(),'旧文字');
    await cloud.route('**/api/status',route=>route.fulfill({json:{configured:true,model:'text-only',vision:false}}));await cloud.reload();await cloud.waitForFunction(()=>!document.getElementById('startupCloud').disabled);assert.ok(await cloud.locator('#startupDialog').isVisible());assert.ok(await cloud.locator('#startupLocal').isChecked());await cloud.check('#startupCloud');await cloud.click('#closeStartupBtn');assert.equal(await cloud.locator('#inputProcessingMode').innerText(),'本地处理');await cloud.click('#settingsBtn');await cloud.selectOption('#analysisMode','cloud');await cloud.click('#saveSettingsBtn');await cloud.click('#tab-image');await cloud.setInputFiles('#imageFile',{name:'sample.png',mimeType:'image/png',buffer:textImage});await cloud.waitForFunction(()=>!document.getElementById('imagePreviewWrap').hidden);assert.ok(await cloud.locator('#recognizeBtn').isDisabled());
    await cloud.fill('#imageNote','请提供验证码');await cloud.check('#imageTextConfirmed');await cloud.click('#analyzeBtn');await cloud.waitForFunction(()=>!document.getElementById('resultContent').hidden);assert.equal(await cloud.locator('#riskLabel').innerText(),'高风险');assert.ok(!lastAnalysis.image);
    await cloud.close();
    const delayed=await context.newPage();delayed.on('pageerror',error=>errors.push(error.message));let releaseStatus;const statusRequested=new Promise(resolve=>releaseStatus=resolve);let statusRoute;
    await delayed.route('**/api/status',route=>{statusRoute=route;releaseStatus();});await delayed.goto(BASE);await statusRequested;
    assert.ok(await delayed.locator('#startupDialog').isVisible());assert.ok(await delayed.locator('#startupCloud').isDisabled());await delayed.click('#startWorkbenchBtn');assert.equal(await delayed.locator('#inputProcessingMode').innerText(),'本地处理');
    await statusRoute.fulfill({json:{configured:true,model:'late-model',vision:true}});await delayed.waitForFunction(()=>!document.getElementById('cloudOption').disabled);await delayed.locator('#startupDialog').waitFor({state:'hidden'});assert.equal(await delayed.locator('#inputProcessingMode').innerText(),'本地处理');await delayed.close();
    const unavailable=await context.newPage();unavailable.on('pageerror',error=>errors.push(error.message));await unavailable.emulateMedia({reducedMotion:'reduce'});await unavailable.route('**/api/status',route=>route.fulfill({status:503,json:{error:'unavailable'}}));await unavailable.goto(BASE);await unavailable.waitForFunction(()=>document.getElementById('startupStatus').textContent.includes('未连接'));assert.ok(await unavailable.locator('#startupCloud').isDisabled());assert.ok(await unavailable.locator('#startupDialog').evaluate(el=>parseFloat(getComputedStyle(el).animationDuration)<.01));await unavailable.keyboard.press('Escape');await unavailable.locator('#startupDialog').waitFor({state:'hidden'});assert.equal(await unavailable.locator('#inputProcessingMode').innerText(),'本地处理');await unavailable.close();
    const timedOut=await context.newPage();let timedOutRoute;await timedOut.route('**/api/status',route=>{timedOutRoute=route;});await timedOut.goto(BASE);await timedOut.waitForFunction(()=>document.getElementById('startupStatus').textContent.includes('未连接'));assert.ok(await timedOut.locator('#startupCloud').isDisabled());await timedOut.click('#startWorkbenchBtn');assert.equal(await timedOut.locator('#inputProcessingMode').innerText(),'本地处理');if(timedOutRoute)await timedOutRoute.abort().catch(()=>{});await timedOut.close();
    assert.equal(errors.length,0,errors.join('\n'));
    console.log('Browser checks passed: startup mode selection, local/cloud/offline, refresh/escape/late status/error/timeout, existing text/link/image/background workflows; widths 360/390/768/1024/1440 and short mobile viewport.');
  }catch(error){await page.screenshot({path:path.join(OUT,'browser-failure.png'),fullPage:true});throw error;}
  finally{await context.close();await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
