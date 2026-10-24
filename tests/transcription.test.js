'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {transcribeImage,analyzeWithModel}=require('../model');
const {createServer,validateInput}=require('../server');
const config={configured:true,vision:true,endpoint:'https://example.test/v1/chat/completions',key:'fake-test-key',model:'test'};
const image='data:image/png;base64,iVBORw0KGgo=';
const input={mode:'image',text:'',image,imageConsent:true};
const reply=(data,finish_reason='stop')=>new Response(JSON.stringify({choices:[{finish_reason,message:{content:JSON.stringify(data)}}]}));
const mock=text=>async()=>reply({extracted_text:text});

test('识图仅返回脱敏待复核文字，不返回风险报告',async()=>{
  let request;
  const result=await transcribeImage(input,config,{fetch:async(url,options)=>{request=JSON.parse(options.body);return reply({extracted_text:'不要转账。联系13800138000。',risk_level:'low'});}});
  assert.equal(result.status,'needs_review');assert.ok(result.text.includes('不要转账'));
  assert.ok(!result.text.includes('13800138000'));assert.equal(result.redacted,true);
  assert.deepEqual(Object.keys(result).sort(),['redacted','status','text']);
  assert.match(request.messages[0].content,/不作风险或安全判断/);
  assert.equal(request.messages[1].content[1].image_url.url,image);
});

test('空白、不可读、畸形及过长识别结果拒绝而非生成安全结论',async()=>{
  for(const text of ['', '   ', '[无法辨认]\n[无法辨认]', 'a'.repeat(8001)])await assert.rejects(transcribeImage(input,config,{fetch:mock(text)}));
  for(const data of [null,{}, {extracted_text:42}])await assert.rejects(transcribeImage(input,config,{fetch:async()=>reply(data)}),{code:'invalid_output'});
  await assert.rejects(transcribeImage(input,config,{fetch:async()=>new Response('not json')}),{code:'invalid_output'});
  await assert.rejects(transcribeImage(input,config,{fetch:async()=>reply({extracted_text:'部分文字'},'length')}),{code:'truncated_output'});
});

test('识图配置错误、提供商错误不泄露密钥及上游细节',async()=>{
  await assert.rejects(transcribeImage(input,{configured:false}),{code:'not_configured'});
  await assert.rejects(transcribeImage(input,{...config,vision:false}),{code:'vision_disabled'});
  await assert.rejects(transcribeImage(input,config,{fetch:async()=>new Response('private error and key',{status:500})}),{code:'provider_error'});
});

test('识图超时和主动取消均不产生风险结果',async()=>{
  const fetch=async(url,options)=>new Promise((resolve,reject)=>{if(options.signal.aborted)reject(new Error('aborted'));else options.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});
  await assert.rejects(transcribeImage(input,config,{fetch,timeoutMs:10}),{code:'timeout'});
  const controller=new AbortController();const pending=transcribeImage(input,config,{fetch,signal:controller.signal});controller.abort();
  await assert.rejects(pending);
});

test('接口分离图片授权与文字确认，拒绝直接提交图片分析',()=>{
  assert.throws(()=>validateInput(input,true));
  assert.throws(()=>validateInput({...input,imageConsent:false},true,'transcription'));
  assert.throws(()=>validateInput({mode:'image',text:'请提供验证码'},true));
  assert.throws(()=>validateInput({mode:'image',text:'',imageTextConfirmed:true},true));
  assert.throws(()=>validateInput({mode:'text',text:'你好'},true,'transcription'));
  const confirmed=validateInput({mode:'image',text:'请提供验证码',imageTextConfirmed:true},false);
  assert.equal(confirmed.imageTextConfirmed,true);assert.ok(!('image' in confirmed));
});

test('确认后的分析只上传文字，视觉开关不影响文字分析',async()=>{
  let request;
  const result=await analyzeWithModel({mode:'image',text:'不要转账',imageTextConfirmed:true},{...config,vision:false},{fetch:async(url,options)=>{request=JSON.parse(options.body);return reply({risk_level:'unknown',evidence:[]});}});
  assert.equal(typeof request.messages[1].content,'string');assert.ok(!JSON.stringify(request).includes('image_url'));
  assert.equal(result.inputReview.status,'user_confirmed');assert.equal(result.assessment.sourceVerification,'not_verified');
});

test('识图 API 授权、错误、限流和文字复核完整工作流',async()=>{
  let calls=0;
  const server=createServer(config,{fetch:async(url,options)=>{calls++;const body=JSON.parse(options.body);return Array.isArray(body.messages[1].content)?reply({extracted_text:'请提供验证码'}):reply({risk_level:'unknown',evidence:[]});}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(route,data,headers={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
  try {
    assert.equal((await post('/api/transcribe',input,{Origin:'https://evil.test'})).status,403);
    assert.equal((await post('/api/transcribe',input,{'Content-Type':'text/plain'})).status,415);
    assert.equal((await post('/api/transcribe',{...input,imageConsent:false})).status,400);
    assert.equal((await post('/api/analyze',input)).status,400);assert.equal(calls,0);
    const draft=await (await post('/api/transcribe',input)).json();assert.equal(draft.status,'needs_review');assert.ok(!('level' in draft));
    assert.equal((await post('/api/analyze',{mode:'image',text:draft.text})).status,400);
    const report=await (await post('/api/analyze',{mode:'image',text:draft.text,imageTextConfirmed:true})).json();
    assert.equal(report.level,'high');assert.equal(report.inputReview.status,'user_confirmed');assert.equal(calls,2);
    let limited=false;
    for(let i=0;i<21;i++){const response=await post('/api/transcribe',input);if(response.status===429){limited=true;break;}}
    assert.ok(limited,'transcription shares analyze rate budget');
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('未配置或识图失败的 API 不返回伪造的风险报告',async()=>{
  for(const settings of [{configured:false,vision:false},config]){
    const server=createServer(settings,{fetch:async()=>new Response('secret-upstream',{status:500})});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try {
      const response=await fetch(`http://127.0.0.1:${server.address().port}/api/transcribe`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
      const result=await response.json();assert.equal(response.status,503);assert.ok(result.error);assert.ok(!('level' in result));assert.ok(!JSON.stringify(result).includes('secret-upstream'));
    }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  }
});
