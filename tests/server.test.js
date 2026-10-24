'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {createServer,validateInput}=require('../server');
let server,base;
before(async()=>{server=createServer({configured:false,vision:false});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;});
after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
const post=(body,headers={})=>fetch(base+'/api/analyze',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
test('静态资源与状态正常返回',async()=>{
  const version=require('../package.json').version;
  assert.equal(require('../engine').VERSION,version);
  const response=await fetch(base);assert.equal(response.status,200);const html=await response.text();assert.match(html,/CrediLens/);assert.ok(html.includes(`<span class="version">${version}</span>`));assert.match(response.headers.get('content-security-policy'),/default-src 'self'/);
  const status=await (await fetch(base+'/api/status')).json();assert.equal(status.configured,false);assert.ok(!('key' in status));
  assert.equal(status.version,version);
});
test('后端实现结构化分析和模型降级',async()=>{
  const response=await post({mode:'text',text:'请提供验证码并转账到个人账户'});const report=await response.json();assert.equal(response.status,200);assert.equal(report.level,'high');assert.equal(report.source,'local');assert.equal(report.version,require('../package.json').version);
});

test('普通通知保留内容说明与来源边界',async()=>{
  const response=await post({mode:'text',text:'图书馆通知：您借阅的图书即将到期，请通过学校图书馆官网查询并按时归还。'});
  const report=await response.json();assert.equal(response.status,200);
  assert.equal(report.level,'low');assert.equal(report.contentType,'routine_notice');
  assert.match(report.summary,/未核实/);assert.ok(report.evidence.every(e=>report.original.includes(e.quote)));
});

test('接口区分不适用与信息不足，并导出四维状态',async()=>{
  const meta=await (await post({mode:'text',text:'反诈提醒：识别为“反诈与安全提醒”，没有把否定语句当作危险要求。'})).json();
  assert.equal(meta.level,'not_applicable');assert.equal(meta.score,null);assert.equal(meta.assessment.applicability,'not_applicable');
  assert.equal(meta.assessment.sourceVerification,'not_verified');assert.deepEqual(meta.actions,[]);
  const vague=await (await post({mode:'text',text:'有一个暑假兼职。'})).json();
  assert.equal(vague.level,'unknown');assert.equal(vague.assessment.information,'insufficient');assert.match(vague.missingInformation[0],/工作内容/);
});
test('仅允许公开静态文件，环境文件与源码接口不可下载',async()=>{
  for(const file of ['/.env','/.env.example','/server.js','/model.js','/tests/engine.test.js','/..%2f.env'])assert.equal((await fetch(base+file)).status,404,file);
});
test('拒绝跨来源请求和非 JSON 请求',async()=>{
  assert.equal((await post({mode:'text',text:'hello'},{Origin:'https://untrusted.example'})).status,403);
  assert.equal((await post({mode:'text',text:'hello'},{'Content-Type':'text/plain'})).status,415);
});
test('无效输入不返回成功报告',async()=>{
  for(const input of [{mode:'text',text:''},{mode:'link',text:'',url:'javascript:alert(1)'},{mode:'text',text:'a'.repeat(8001)},{mode:'image',text:'',image:'data:image/png;base64,AAAA',imageConsent:true}])assert.equal((await post(input)).status,400);
});
test('后端接受短信裸域名并保留协议未知状态',async()=>{
  const response=await post({mode:'link',text:'【海蓝保】请及时处理，点 sdr8.cn/UvAlXjZOB 立即查看。',url:'sdr8.cn/UvAlXjZOB'});
  assert.equal(response.status,200);
  const report=await response.json();
  assert.equal(report.url.host,'sdr8.cn');assert.equal(report.url.protocol,'未注明');
  assert.equal(report.linkAnalysis.structure.checks.find(item=>item.id==='transport').status,'unknown');
});
test('截图不得未经单独授权进入模型',()=>{
  assert.throws(()=>validateInput({mode:'image',text:'hello',image:'data:image/png;base64,AAAA'},true));
});
test('输入在服务端再次脱敏',()=>{
  assert.ok(!validateInput({mode:'text',text:'联系方式13800138000'},false).text.includes('13800138000'));
});

test('背景字段单独限长校验和服务端脱敏',()=>{
  const result=validateInput({mode:'text',text:'这是真的吗',background:'联系13800138000，验证码：123456'},false);
  assert.ok(!JSON.stringify(result).includes('13800138000'));assert.ok(!JSON.stringify(result).includes('123456'));assert.equal(result.text,'这是真的吗');
  for(const background of [true,null,{},[], 'a'.repeat(1001)])assert.throws(()=>validateInput({mode:'text',text:'通知',background},false));
});

test('接口返回背景与核验回应，不混入原文，支持只有背景的补充请求',async()=>{
  const report=await (await post({mode:'text',text:'课程通知：明天在教室上课，请按时参加。是真的吗？',background:'这是真的吗，联系13800138000'})).json();
  assert.equal(report.level,'low');assert.ok(report.verificationResponse);assert.ok(!report.original.includes('联系'));assert.ok(!JSON.stringify(report).includes('13800138000'));
  const response=await post({mode:'text',text:'',background:'有一个兼职让我先交保证金，是真的吗？'});assert.equal(response.status,200);
  const pending=await response.json();assert.equal(pending.level,'unknown');assert.equal(pending.original,'');assert.deepEqual(pending.evidence,[]);
});
