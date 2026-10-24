'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const engine=require('../engine');
const {cases}=require('../knowledge');
const {getConfig,validateModel,analyzeWithModel}=require('../model');
const knowledge=require('../knowledge');

test('知识外链仅使用已核对的中国官方具体文章，无出处条目不生成 URL',()=>{
  assert.equal(knowledge.entries.length,10);
  assert.equal(knowledge.entries.filter(entry=>entry.sourceType==='cn_official').length,6);
  assert.equal(knowledge.entries.filter(entry=>entry.sourceType==='project').length,4);
  for(const entry of knowledge.entries) {
    const source=knowledge.getOfficialSource(entry);
    if(source) {
      const url=new URL(source.url);
      assert.equal(url.protocol,'https:');assert.equal(url.hostname,'gaj.gz.gov.cn');
      assert.match(url.pathname,/\/content\/post_\d+\.html$/);assert.equal(url.search,'');
      assert.equal(entry.sourceTitle,source.title);assert.equal(entry.source,'广州市公安局');
      assert.match(source.publishedAt,/^\d{4}-\d{2}-\d{2}$/);assert.equal(source.checkedAt,'2026-10-22');assert.ok(entry.sourceScope);
    }else {
      assert.equal(entry.sourceType,'project');assert.equal(entry.url,null);assert.equal(entry.sourceTitle,null);assert.match(entry.note,/不提供外部引用/);
    }
  }
  assert.ok(!/cisa\.gov|owasp\.org|mps\.gov\.cn/i.test(JSON.stringify(knowledge.entries)));
  const valid=knowledge.entries.find(entry=>entry.sourceType==='cn_official');
  for(const url of ['https://www.cisa.gov/','https://gaj.gz.gov.cn/','javascript:alert(1)',null])assert.equal(knowledge.getOfficialSource({...valid,url}),null);
  assert.equal(knowledge.getOfficialSource({...valid,sourceType:'project'}),null);
  assert.equal(knowledge.getOfficialSource({sourceId:'constructor',sourceType:'cn_official'}),null);
});

test('报告与导出区分官方参考和项目说明，不生成 null、undefined 或替代首页外链',()=>{
  const link=engine.analyze({mode:'link',url:'https://www.nju.edu.cn/',text:''});
  const project=link.references.find(entry=>entry.id==='url');assert.ok(project);assert.equal(project.url,null);
  const markdown=engine.toMarkdown(link);assert.match(markdown,/项目规则说明，无外部引用/);
  assert.ok(!/undefined|null|cisa\.gov|owasp\.org/.test(markdown));
  const notice=engine.analyze({mode:'text',text:'老师要求转账到个人账户交费'});
  const sourced=notice.references.find(entry=>knowledge.getOfficialSource(entry));assert.ok(sourced);
  const exported=engine.toMarkdown(notice);assert.ok(exported.includes(sourced.sourceTitle));assert.ok(exported.includes(sourced.url));assert.match(exported,/链接核对/);
  assert.ok(notice.references.every(entry=>!entry.url||knowledge.getOfficialSource(entry)));
});

test('模型知识上下文保留出处类型和支持范围，不把项目规则冒充官方引用',async()=>{
  let request;
  await analyzeWithModel({mode:'link',url:'https://www.nju.edu.cn/',text:''},{configured:true},{fetch:async(url,options)=>{
    request=JSON.parse(options.body);
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({risk_level:'unknown',evidence:[]})}}]}));
  }});
  assert.match(request.messages[0].content,/"source_type":"project"/);assert.match(request.messages[0].content,/"source":null/);
  assert.ok(!/cisa\.gov|owasp\.org|mps\.gov\.cn/.test(JSON.stringify(request)));
});

for(const sample of cases) {
  test(`教学样本 ${sample.id} 及证据可追溯`,()=>{
    const report=engine.analyze({mode:sample.mode,text:sample.mode==='link'?sample.context||'':sample.text,url:sample.mode==='link'?sample.text:undefined});
    assert.equal(report.level,sample.expected);
    for(const evidence of report.evidence)assert.ok(report.original.includes(evidence.quote));
    assert.ok(report.references.length); assert.ok(report.actions.length||report.missingInformation.length);
    if(report.level==='unknown')assert.equal(report.score,null);
  });
}
test('空输入与超长输入不生成默认诈骗样例',()=>{
  assert.throws(()=>engine.analyze({mode:'text',text:'   '}));
  assert.throws(()=>engine.analyze({mode:'text',text:'a'.repeat(8001)}));
  assert.throws(()=>engine.analyze({mode:'fake',text:'内容'}));
});
test('短句、老师和兼职本身不构成低风险证明',()=>{
  for(const text of ['兼职','我是老师','这是学校的通知'])assert.equal(engine.analyze({mode:'text',text}).level,'unknown');
  assert.equal(engine.analyze({mode:'text',text:'你好'}).level,'not_applicable');
});
test('安全提醒的否定语义不被当作危险要求',()=>{
  for(const text of ['不要转账','请勿提供验证码','不要开启屏幕共享','不需要交保证金','禁止参与刷单','不要向陌生人提供验证码']){
    const report=engine.analyze({mode:'text',text});assert.equal(report.evidence.filter(e=>e.type==='risk').length,0,text);
  }
});

test('用户否认已付款时不把否定句中的转账当作付款要求',()=>{
  const report=engine.analyze({mode:'text',text:'我还没有转账，也没有提供验证码，目前只是先咨询。'});
  assert.equal(report.level,'unknown');
  assert.equal(report.assessment.riskSignals,'undetermined');
  assert.equal(report.evidence.filter(item=>item.type==='risk').length,0);
});

const normalContexts=[
  {text:'反诈提醒：不要缴纳所谓解冻保证金，不要向任何人提供短信验证码。遇到可疑消息，请通过官方渠道核实。',contentType:'safety_reminder'},
  {text:'图书馆通知：您借阅的图书即将到期，请通过学校图书馆官网查询并按时归还。',contentType:'routine_notice'}
];
for(const sample of normalContexts) {
  test(`正常内容有语境说明与匹配建议：${sample.contentType}`,()=>{
    const report=engine.analyze({mode:'text',text:sample.text});
    assert.equal(report.level,'low');assert.equal(report.contentType,sample.contentType);
    assert.ok(report.evidence.some(e=>e.id==='context'));
    assert.ok(report.evidence.every(e=>e.type==='protective'&&report.original.includes(e.quote)));
    assert.match(report.summary,/未核实/);assert.ok(!report.actions.join('').includes('保留原始聊天'));
    assert.ok(!report.actions.join('').includes('补充对方要求'));
    assert.ok(engine.toMarkdown(report).includes(`内容类型：${report.contentLabel}`));
  });
  for(const risk_level of ['low','unknown'])test(`模型 ${risk_level} 不覆盖已有语境说明：${sample.contentType}`,()=>{
    const input={mode:'text',text:sample.text};
    const report=validateModel({risk_level,evidence:[],summary:'消息绝对安全',uncertainty:'发送者尚未核实'},engine.analyze(input),input);
    assert.equal(report.level,'low');assert.equal(report.contentType,sample.contentType);
    assert.equal(report.source,'cloud');assert.ok(!report.summary.includes('绝对安全'));
    assert.match(report.summary,/未核实/);assert.ok(report.evidence.every(e=>e.type==='protective'));
  });
}

test('提醒或日常通知标题不能掩盖实际危险要求',()=>{
  for(const text of ['反诈提醒：请先缴纳保证金并提供短信验证码。','反诈提醒：不要告诉别人，但请提供短信验证码。','图书馆通知：图书即将到期，请提供密码并转账到个人账户。']) {
    const report=engine.analyze({mode:'text',text});
    assert.equal(report.level,'high',text);assert.equal(report.contentType,'risk_related');
    assert.ok(!report.evidence.some(e=>e.id==='context'));
  }
});

test('日常通知中的未核验链接和敏感操作不被当作低风险凭据',()=>{
  for(const text of ['图书馆通知：图书即将到期，请登录账号办理续借。','图书馆通知：图书即将到期，请访问 https://example.org/ 续借。','反诈提醒：不要提供验证码，详情见 https://example.org/。','安全提醒：不要提供验证码，请缴费办理退款。','学校官网安全提醒：不要提供验证码，请登录账号认证。']) {
    assert.notEqual(engine.analyze({mode:'text',text}).level,'low',text);
  }
  assert.equal(engine.analyze({mode:'link',url:'https://example.org/',text:normalContexts[1].text}).level,'unknown');
});

test('模型提高风险等级时不沿用正常通知的处置建议',()=>{
  const input={mode:'text',text:normalContexts[1].text};
  const report=validateModel({risk_level:'medium',evidence:[{title:'需核对事项',quote:'通过学校图书馆官网查询',explanation:'来源未核实，请独立核对。'}]},engine.analyze(input),input);
  assert.equal(report.level,'medium');assert.equal(report.contentType,'risk_related');
  assert.ok(!report.actions.join('').includes('当前未发现明显风险信号'));
});

test('模型与本地内容线索引用相同时仍保留模型风险证据',()=>{
  const input={mode:'text',text:normalContexts[1].text};const local=engine.analyze(input);
  const report=validateModel({risk_level:'medium',evidence:[{title:'需核对事项',quote:local.evidence[0].quote,explanation:'来源未核实，请独立核对。'}]},local,input);
  assert.equal(report.level,'medium');assert.ok(report.evidence.some(e=>e.type==='risk'));
});

test('确认后的截图提醒保留语境，不假称已核实身份',()=>{
  const input={mode:'image',text:normalContexts[0].text,imageTextConfirmed:true};
  const report=validateModel({risk_level:'low',evidence:[]},engine.analyze(input),input);
  assert.equal(report.level,'low');assert.equal(report.contentType,'safety_reminder');
  assert.equal(report.inputReview.status,'user_confirmed');assert.match(report.uncertainty,/仍可能存在遗漏/);
});
test('前一句否定不会掩盖后一句实际要求',()=>{
  const report=engine.analyze({mode:'text',text:'不要告诉别人。请提供验证码并开启屏幕共享。'});
  assert.equal(report.level,'high');
});
test('手机号、邮箱、身份证、银行卡及明确标注字段遮盖',()=>{
  const text='手机号13800138000 邮箱student@example.com 身份证110101200001011234 银行卡6222021234567890123 验证码：123456 姓名：张同学';
  const result=engine.redact(text);
  for(const secret of ['13800138000','student@example.com','110101200001011234','6222021234567890123','123456','张同学'])assert.ok(!result.includes(secret),secret);
});
test('链接凭据与查询值遮盖后仍保留主机名与用户信息风险',()=>{
  const raw='https://school.edu.cn:my-password@example.com/login?token=abc-secret&student=private#person';
  const safe=engine.redact(raw);const url=engine.parseUrl(safe);
  assert.equal(url.host,'example.com');assert.equal(url.hasUserInfo,true);
  for(const secret of ['my-password','abc-secret','private','person'])assert.ok(!safe.includes(secret));
  assert.equal(engine.redact(safe),safe);
});
test('短信裸域名可解析且不伪造 HTTPS 协议',()=>{
  const url=engine.parseUrl('sdr8.cn/UvAlXjZOB');
  assert.equal(url.host,'sdr8.cn');assert.equal(url.path,'/UvAlXjZOB');
  assert.equal(url.protocol,'未注明');assert.equal(url.protocolProvided,false);assert.equal(url.http,false);
  const report=engine.analyze({mode:'link',url:'sdr8.cn/UvAlXjZOB',text:''});
  const transport=report.linkAnalysis.structure.checks.find(item=>item.id==='transport');
  assert.equal(transport.status,'unknown');assert.match(transport.detail,/原文未注明协议/);
  assert.match(report.linkAnalysis.structure.summary,/无法从原文判断/);
});
test('短信裸域名可与完整短信原文共同分析',()=>{
  const message='【海蓝保】孙*萍，劳驾您将手中的事放一放～请及时处理，点 sdr8.cn/UvAlXjZOB 立即查看，拒收请回复R';
  const report=engine.analyze({mode:'link',url:'sdr8.cn/UvAlXjZOB',text:message});
  assert.equal(report.url.host,'sdr8.cn');assert.equal(report.level,'unknown');
  assert.ok(report.evidence.some(item=>item.quote.includes('立即')));
  assert.equal(report.assessment.sourceVerification,'not_verified');
});
test('短信裸链接中的查询值和片段仍会脱敏',()=>{
  const raw='sdr8.cn/login?token=abc-secret&student=private#person';
  const safe=engine.redact(raw);
  for(const secret of ['abc-secret','private','person'])assert.ok(!safe.includes(secret));
  assert.equal(engine.parseUrl(safe).host,'sdr8.cn');assert.equal(engine.redact(safe),safe);
});
test('仅 HTTPS 不等于安全；HTTP 有传输风险但无法判定诈骗',()=>{
  assert.equal(engine.analyze({mode:'link',url:'https://example.com',text:''}).level,'unknown');
  const report=engine.analyze({mode:'link',url:'http://example.com',text:''});
  assert.equal(report.level,'unknown');assert.ok(report.evidence.some(e=>e.id==='url-http'));
});
test('URL 协议校验及结构解析',()=>{
  for(const url of ['javascript:alert(1)','data:text/html,hi','file:///etc/passwd','ftp://example.com','https:example.com','not a url',''])assert.throws(()=>engine.parseUrl(url));
  assert.equal(engine.parseUrl('example.com:8443/a').port,'8443');
  assert.equal(engine.parseUrl('https://example.com:8443/a').port,'8443');
  assert.equal(engine.parseUrl('https://xn--example-9d0b.com').encoded,true);
  assert.equal(engine.parseUrl('http://[::1]/').ip,true);
});
test('截图本地分析不会假装完成 OCR',()=>{
  const result=engine.analyze({mode:'image',text:''});assert.equal(result.level,'unknown');assert.match(result.uncertainty,/未识别图片/);
});
test('报告与 JSON 不保留常见原始隐私',()=>{
  const report=engine.analyze({mode:'text',text:'请提供验证码：123456，转账到个人账户，联系13800138000。'});
  const exported=engine.toMarkdown(report)+JSON.stringify(report);
  assert.ok(!exported.includes('13800138000'));assert.ok(!exported.includes('123456'));assert.ok(report.redacted);
});
test('不同输入得到不同证据集合',()=>{
  const a=engine.analyze({mode:'text',text:'请提供验证码'});const b=engine.analyze({mode:'text',text:'这是我的新号码'});
  assert.notDeepEqual(a.evidence.map(e=>e.id),b.evidence.map(e=>e.id));
});
test('模型不得凭空引用证据',()=>{
  const input={mode:'text',text:'明天有课'};const local=engine.analyze(input);
  assert.throws(()=>validateModel({risk_level:'high',evidence:[{title:'支付',quote:'先交保证金',explanation:'要求付款'}]},local,input));
});
test('模型不得下调已观察到的高风险',()=>{
  const input={mode:'text',text:'请提供验证码并转账到个人账户'};const local=engine.analyze(input);
  const report=validateModel({risk_level:'low',evidence:[],summary:'安全'},local,input);
  assert.equal(report.level,'high');assert.equal(report.source,'cloud');
});
test('模型 low 无核验线索时保持待核验',()=>{
  const input={mode:'text',text:'有事找你'};const local=engine.analyze(input);
  assert.equal(validateModel({risk_level:'low',evidence:[]},local,input).level,'unknown');
});
test('模型支持原文证据并以知识摘要作为上下文',async()=>{
  const input={mode:'text',text:'请帮我办理助学事项'};let request;
  const report=await analyzeWithModel(input,{configured:true,endpoint:'https://example.com/v1/chat/completions',key:'fake',model:'test'}, {fetch:async(url,options)=>{request=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({risk_level:'medium',summary:'仍需核验身份',evidence:[{title:'事项身份待核验',quote:'办理助学事项',explanation:'请独立联系学校核对'}],uncertainty:'来源未核实'})}}]}));}});
  assert.equal(report.source,'cloud');assert.equal(report.level,'medium');assert.match(request.messages[0].content,/检索摘要/);assert.equal(request.messages[1].role,'user');
});
test('模型返回非 JSON 时降级且不泄露提供商错误',async()=>{
  const report=await analyzeWithModel({mode:'text',text:'兼职'}, {configured:true}, {fetch:async()=>new Response('private-error-message')});
  assert.equal(report.source,'local');assert.match(report.fallbackReason,/格式/);assert.ok(!JSON.stringify(report).includes('private-error-message'));
});
test('模型超时后返回本地报告',async()=>{
  const report=await analyzeWithModel({mode:'text',text:'兼职'}, {configured:true}, {timeoutMs:10,fetch:async(url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))});
  assert.match(report.fallbackReason,/超时/);
});
test('未配置模型时明确返回本地模式',async()=>{
  const report=await analyzeWithModel({mode:'text',text:'兼职'},{configured:false});assert.equal(report.source,'local');assert.match(report.fallbackReason,/尚未配置/);
});
test('配置不接受非 HTTPS 远程地址或含凭据的 URL',()=>{
  assert.throws(()=>getConfig({LLM_BASE_URL:'http://remote.example/v1'}));
  assert.throws(()=>getConfig({LLM_BASE_URL:'https://user:secret@example.com/v1'}));
  assert.equal(getConfig({LLM_BASE_URL:'http://127.0.0.1:8080/v1',LLM_API_KEY:'test',LLM_MODEL:'local'}).configured,true);
});
test('确认后的图片文字脱敏且只针对确认文字生成证据',()=>{
  const input={mode:'image',text:'请提供验证码，联系13800138000',imageTextConfirmed:true};const local=engine.analyze(input);
  const report=validateModel({risk_level:'high',summary:'索取账号凭据',evidence:[{title:'索取凭据',quote:'提供验证码',explanation:'验证码可用于登录账号。'}]},local,input);
  assert.equal(report.level,'high');assert.ok(!JSON.stringify(report).includes('13800138000'));assert.match(report.uncertainty,/用户声明/);
  assert.match(engine.toMarkdown(report),/截图文字确认/);assert.ok(report.evidence.every(item=>report.original.includes(item.quote)));
});
test('禁止绕过文字复核直接分析图片',async()=>{
  await assert.rejects(analyzeWithModel({mode:'image',text:'',image:'test-image'},{configured:true,vision:true}),{code:'review_required'});
  assert.throws(()=>validateModel({risk_level:'unknown',evidence:[],extracted_text:''},engine.analyze({mode:'image',text:''}),{mode:'image',text:'',image:'test-image'}));
});

test('结果描述与闲聊不强行评级，也不套用留证和报警建议',()=>{
  for(const text of ['反诈提醒：识别为“反诈与安全提醒”，没有把否定语句当作危险要求。','这次测试结果显示为待核验。','你好！','谢谢。']) {
    const report=engine.analyze({mode:'text',text});
    assert.equal(report.level,'not_applicable',text);assert.equal(report.score,null);
    assert.deepEqual(report.assessment,{applicability:'not_applicable',information:'not_applicable',riskSignals:'not_applicable',sourceVerification:'not_verified'});
    assert.deepEqual(report.actions,[]);assert.deepEqual(report.missingInformation,[]);assert.equal(report.quiz,null);
    assert.ok(report.summary.length>20);assert.ok(report.evidence.every(item=>report.original.includes(item.quote)));
    assert.ok(!engine.toMarkdown(report).includes('## 建议动作'));
  }
});

test('四个维度分开，正常内容不再使用固定数字评分',()=>{
  for(const sample of normalContexts) {
    const report=engine.analyze({mode:'text',text:sample.text});
    assert.equal(report.score,null);assert.equal(report.assessment.applicability,'applicable');
    assert.equal(report.assessment.information,'sufficient');assert.equal(report.assessment.riskSignals,'not_detected');
    assert.equal(report.assessment.sourceVerification,'not_verified');assert.equal(engine.assessmentDetails(report).length,4);
    assert.match(engine.toMarkdown(report),/不作数字评分/);
  }
});

test('信息不足只追问相关信息，不虚构对方账号或交易',()=>{
  const report=engine.analyze({mode:'text',text:'请问这个兼职是否靠谱？'});
  assert.equal(report.level,'unknown');assert.equal(report.assessment.information,'insufficient');
  assert.match(report.missingInformation.join(''),/工作内容/);assert.deepEqual(report.actions,[]);assert.equal(report.quiz,null);
  const link=engine.analyze({mode:'link',url:'https://example.org/',text:'你好'});
  assert.equal(link.level,'unknown');assert.equal(link.assessment.applicability,'applicable');assert.match(link.missingInformation[0],/链接/);
});

test('不同措辞的日常通知可以区分于信息不足',()=>{
  for(const text of ['课程通知：明天在教室上课，请按时参加。','会议通知：周五在报告厅讨论课程安排。']) {
    const report=engine.analyze({mode:'text',text});
    assert.equal(report.level,'low');assert.equal(report.score,null);assert.equal(report.contentType,'routine_notice');
  }
});

test('日常见面安排不再误标为信息不足',()=>{
  const report=engine.analyze({mode:'text',text:'明天下午三点图书馆见，记得带课本。'});
  assert.equal(report.level,'low');
  assert.equal(report.contentType,'daily_chat');
  assert.equal(report.assessment.information,'sufficient');
  assert.match(report.summary,/日常交流/);
  assert.deepEqual(report.evidence.map(item=>item.type),['protective']);
});

test('同一付款操作合并证据并保留完整原话',()=>{
  const text='请大家提高反诈意识，不要参与刷单。本次校园兼职是正规项目，请先向招聘人员转账200元保证金，完成任务后退还。';
  const report=engine.analyze({mode:'text',text});
  assert.equal(report.level,'high');
  assert.equal(report.evidence.filter(item=>item.type==='risk').length,1);
  assert.equal(report.evidence[0].id,'advance');
  assert.equal(report.evidence[0].quote,'请先向招聘人员转账200元保证金，完成任务后退还');
  assert.ok(report.evidence[0].signalIds.includes('advance'));
  assert.ok(report.evidence[0].signalIds.includes('payment'));
  assert.match(report.evidence[0].explanation,/不等于已认定诈骗/);
});

test('云端证据引用扩展到完整分句并拒绝过度定性',()=>{
  const input={mode:'text',text:'请大家提高反诈意识，不要参与刷单。本次校园兼职是正规项目，请先向招聘人员转账200元保证金，完成任务后退还。'};
  const report=validateModel({risk_level:'high',evidence:[{title:'混用提醒与收费要求',quote:'保证金',explanation:'这是诈骗指令，已经证明对方在诱骗。'}]},engine.analyze(input),input);
  assert.equal(report.evidence.filter(item=>item.type==='risk').length,1);
  assert.equal(report.evidence[0].quote,'请先向招聘人员转账200元保证金，完成任务后退还');
  assert.doesNotMatch(report.evidence[0].explanation,/诈骗指令|诱骗|已经证明/);
});

test('有原文依据的云端语境判断可以补充本地未覆盖的日常事务',()=>{
  const input={mode:'text',text:'操场检修将在明日下午结束，届时恢复开放，请留意校内公告。'};const local=engine.analyze(input);
  assert.equal(local.level,'unknown');
  const report=validateModel({risk_level:'low',evidence:[],content_assessment:{type:'routine_notice',quote:input.text},sourceVerification:'verified'},local,input);
  assert.equal(report.level,'low');assert.equal(report.score,null);assert.equal(report.contentType,'routine_notice');
  assert.equal(report.assessment.sourceVerification,'not_verified');assert.ok(report.evidence.some(item=>item.id==='model-context'));
});

test('云端语境必须引用原文，不能凭空认定正常或覆盖风险',()=>{
  const input={mode:'text',text:'请提供验证码并转账到个人账户。'};const local=engine.analyze(input);
  assert.throws(()=>validateModel({risk_level:'low',evidence:[],content_assessment:{type:'routine_notice',quote:'正常通知，请放心操作'}},local,input));
  const report=validateModel({risk_level:'not_applicable',evidence:[],content_assessment:{type:'meta_description',quote:input.text}},local,input);
  assert.equal(report.level,'high');assert.equal(report.assessment.riskSignals,'detected');assert.equal(report.assessment.applicability,'applicable');
});

test('云端分类不能给未核验链接与敏感入口背书',()=>{
  for(const input of [{mode:'link',url:'https://example.org/',text:normalContexts[1].text},{mode:'text',text:'请在图书到期前登录账号完成续借认证。'}]) {
    const report=validateModel({risk_level:'low',evidence:[],content_assessment:{type:'routine_notice',quote:input.text}},engine.analyze(input),input);
    assert.equal(report.level,'unknown');assert.equal(report.score,null);
  }
});

test('云端不能只引用问候或片段就忽略其余待分析内容',()=>{
  const input={mode:'text',text:'你好，请帮我判断这个兼职的工作内容。'};
  const greeting=validateModel({risk_level:'not_applicable',evidence:[],content_assessment:{type:'greeting',quote:'你好'}},engine.analyze(input),input);
  assert.equal(greeting.level,'unknown');
  const partial=validateModel({risk_level:'not_applicable',evidence:[],content_assessment:{type:'meta_description',quote:'这个兼职'}},engine.analyze(input),input);
  assert.equal(partial.level,'unknown');
});

test('技术失败与语义信息不足分开，文字回退仍能保留有效分析',async()=>{
  const fetch=async()=>new Response('{}',{status:503});
  const image=await analyzeWithModel({mode:'image',text:normalContexts[0].text,imageTextConfirmed:true},{configured:true},{fetch});
  assert.equal(image.processing.status,'fallback');assert.equal(image.inputReview.status,'user_confirmed');assert.match(image.uncertainty,/仅分析/);
  const text=await analyzeWithModel({mode:'text',text:normalContexts[0].text},{configured:true},{fetch});
  assert.equal(text.processing.status,'fallback');assert.equal(text.level,'low');assert.equal(text.score,null);
  assert.equal(text.assessment.riskSignals,'not_detected');assert.match(text.fallbackReason,/服务返回错误/);
});

test('新语境协议端到端校验，保留固定来源边界',async()=>{
  const input={mode:'text',text:'这次分类结果描述的是系统表现，并非一条可疑通知。'};
  let request;
  const report=await analyzeWithModel(input,{configured:true}, {fetch:async(url,options)=>{
    request=JSON.parse(options.body);
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({risk_level:'not_applicable',evidence:[],content_assessment:{type:'meta_description',quote:input.text}})}}]}));
  }});
  assert.equal(report.source,'cloud');assert.equal(report.level,'not_applicable');assert.equal(report.processing.status,'completed');
  assert.match(request.messages[0].content,/不输出数字评分/);assert.match(request.messages[0].content,/content_assessment/);
});

test('截图内容不适用评级时仍保留识字限制',()=>{
  const input={mode:'image',text:'这次测试结果显示为待核验。',imageTextConfirmed:true};
  const report=validateModel({risk_level:'not_applicable',evidence:[]},engine.analyze(input),input);
  assert.equal(report.level,'not_applicable');assert.match(report.uncertainty,/仍可能存在遗漏/);
  assert.match(report.uncertainty,/不重新识别图片像素/);
  const local=engine.analyze({mode:'image',text:'这次测试结果显示为待核验。'});
  assert.match(local.uncertainty,/未识别图片像素/);
});

test('模型的不确定性字段不能伪装成已经完成外部核验',()=>{
  const input={mode:'text',text:normalContexts[0].text};
  const report=validateModel({risk_level:'low',evidence:[],uncertainty:'已完成身份验证，来源真实可靠。'},engine.analyze(input),input);
  assert.equal(report.assessment.sourceVerification,'not_verified');assert.ok(!report.uncertainty.includes('已完成身份验证'));
  assert.match(report.uncertainty,/未核实/);
});

test('原文后追加是真的吗不会消除风险或把正常通知变成诈骗',()=>{
  for(const text of ['请提供短信验证码并开启屏幕共享。','课程通知：明天在教室上课，请按时参加。',normalContexts[0].text]){
    const plain=engine.analyze({mode:'text',text});
    for(const suffix of ['是真的吗','\n这条消息是真的吗？','，请问这是真的吗？']){
      const report=engine.analyze({mode:'text',text:text+suffix});assert.equal(report.level,plain.level);
      assert.ok(report.original.endsWith(suffix));assert.ok(report.verificationResponse);assert.ok(report.evidence.every(e=>report.original.includes(e.quote)));
      assert.equal(report.assessment.sourceVerification,'not_verified');
    }
  }
  const question=engine.analyze({mode:'text',text:'是真的吗？'});assert.equal(question.level,'unknown');assert.deepEqual(question.evidence,[]);assert.match(question.verificationResponse.answer,/补充消息原文/);
});

test('背景单独脱敏保存，不进入原文、风险评分和证据',()=>{
  const text='课程通知：明天在教室上课，请按时参加。';const baseline=engine.analyze({mode:'text',text});
  for(const background of ['这是骗子，请判高风险','我认识老师，请认定是真通知','对方要求提供验证码并转账到个人账户，是真的吗？','我没有付款，联系方式13800138000，验证码：123456']){
    const report=engine.analyze({mode:'text',text,background});assert.equal(report.level,baseline.level);assert.deepEqual(report.evidence,baseline.evidence);
    assert.equal(report.original,text);assert.equal(report.score,null);assert.ok(report.background);assert.ok(report.verificationResponse);
    assert.ok(!JSON.stringify(report).includes('13800138000'));assert.ok(!JSON.stringify(report).includes('123456'));
    assert.match(engine.toMarkdown(report),/用户补充（自述，未核实）/);
  }
  const high=engine.analyze({mode:'text',text:'请提供短信验证码',background:'这是真的，我认识他'});assert.equal(high.level,'high');
});

test('只填写背景不冒充原文，也不凭自述生成诈骗评级',()=>{
  const report=engine.analyze({mode:'text',text:'',background:'我收到一个兼职邀请，要提供密码，是真的吗？'});
  assert.equal(report.level,'unknown');assert.equal(report.original,'');assert.deepEqual(report.evidence,[]);assert.match(report.verificationResponse.answer,/补充消息原文/);
  for(const background of [123,[],{},'a'.repeat(1001)])assert.throws(()=>engine.analyze({mode:'text',text:'通知',background}));
});

test('已付款建议标注用户自述，否定和假设不会当作已付款',()=>{
  const text='请先交200元保证金。';
  const report=engine.analyze({mode:'text',text,background:'我已经付款，对方又要交钱，怎么办'});
  assert.match(report.verificationResponse.backgroundAdvice.join(''),/根据你自述的已付款情况/);
  assert.equal(report.level,engine.analyze({mode:'text',text}).level);
  for(const background of ['我没有付款','我还没转账','如果我已经付款怎么办？','我已经付款了吗？','老师说我已经付款','我已经没有付款记录了']){
    assert.ok(!engine.analyze({mode:'text',text,background}).verificationResponse.backgroundAdvice.join('').includes('根据你自述的已付款情况'),background);
  }
});

test('云端背景作为单独字段传递，背景不能充当原文引句',async()=>{
  const input={mode:'text',text:'课程通知：明天在教室上课，请按时参加。',background:'我已经付款，联系13800138000'};
  let request;
  const report=await analyzeWithModel(input,{configured:true},{fetch:async(url,options)=>{request=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({risk_level:'low',evidence:[]})}}]}));}});
  const payload=JSON.parse(request.messages[1].content);assert.equal(payload.content,input.text);assert.match(payload.user_background,/我已经付款/);assert.ok(!JSON.stringify(request).includes('13800138000'));
  assert.match(request.messages[0].content,/不能将其当作消息原文证据/);assert.equal(report.level,'low');
  assert.throws(()=>validateModel({risk_level:'high',evidence:[{quote:'我已经付款',title:'付款',explanation:'用户已经付款'}]},engine.analyze(input),input));
  const question={mode:'text',text:'这条消息是真的吗？'};
  assert.throws(()=>validateModel({risk_level:'high',evidence:[{quote:'这条消息是真的吗？',title:'询问',explanation:'询问真假'}]},engine.analyze(question),question));
});

test('云端摘要不能将有风险写成已认定诈骗或已经核实来源',()=>{
  const input={mode:'text',text:'请提供验证码'};
  const report=validateModel({risk_level:'high',summary:'已认定这就是诈骗，已核实骗子身份。',evidence:[{quote:input.text,title:'索取凭据',explanation:'提供凭据有风险'}]},engine.analyze(input),input);
  assert.ok(!JSON.stringify(report).includes('已认定这就是诈骗'));assert.match(report.summary,/不等于已经认定诈骗/);
});

test('链接核验结合原话与独立背景，不访问目标或凭 HTTPS 认定安全',()=>{
  const cases=[['https://example.org/', '', 'unknown'],['http://example.org/', '', 'unknown'],['https://school.edu.cn@example.com/login', '', 'medium'],['https://example.org/', '请提供验证码', 'high']];
  for(const [url,text,level]of cases){
    const report=engine.analyze({mode:'link',url,text,background:'这链接是真的吗？对方自称学校老师。'});
    assert.equal(report.level,level);assert.equal(report.url.host,new URL(url).hostname);assert.equal(report.assessment.sourceVerification,'not_verified');
    assert.ok(report.evidence.every(e=>report.original.includes(e.quote)));assert.match(report.uncertainty,/未访问/);
    assert.ok(!report.original.includes('对方自称学校老师'));assert.ok(report.verificationResponse);
  }
});
