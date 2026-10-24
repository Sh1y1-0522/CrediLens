(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./knowledge.js') : root.CrediKnowledge);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CrediEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (knowledge) {
  'use strict';
  const VERSION = '1.1.5';
  const levels = {
    high:{label:'高风险',title:'暂停操作，先核验再继续',summary:'存在高影响信号或多项风险叠加，请优先保护资金与账号。'},
    medium:{label:'中风险',title:'发现异常，需要进一步核验',summary:'原文包含需要核验的要求，暂不要按消息指引继续操作。'},
    low:{label:'低风险',title:'暂未发现明显风险信号',summary:'仅就当前内容未发现明显风险信号，不代表已验证消息真实或操作安全。'},
    unknown:{label:'待核验',title:'信息不足，暂不能判断',summary:'目前缺少可支撑结论的证据，请补充完整上下文或核验来源。'},
    not_applicable:{label:'不适用风险评级',title:'当前内容没有具体风险分析对象',summary:'这段内容未提供需要核验的消息、事件或操作要求，不强行给出风险等级。'}
  };
  const contentLabels={risk_related:'含风险线索内容',safety_reminder:'反诈与安全提醒',routine_notice:'日常事务通知',daily_chat:'日常交流与安排',meta_description:'分析结果描述',greeting:'日常交流',undetermined:'内容类型待核验'};
  function redactPlain(value) {
    return String(value || '')
      .replace(/\b\d{17}[\dXx]\b/g,'[身份证已遮盖]')
      .replace(/\b1[3-9]\d{9}\b/g,'[手机号已遮盖]')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[邮箱已遮盖]')
      .replace(/\b\d{16,19}\b/g,'[银行卡号已遮盖]')
      .replace(/((?:密码|验证码|学号|身份证号|银行卡号|收款账号|银行账号|姓名)\s*[:：是为]\s*)[^\s，。；;！!？?、]{1,40}/g,'$1[已遮盖]')
      .replace(/([?&](?:token|key|secret|password|code|auth|session|access_token|api_key)=)[^&#\s]*/gi,'$1[已遮盖]');
  }
  function redactUrl(value) {
    try {
      const hasProtocol=/^https?:\/\//i.test(value);
      const candidate=hasProtocol?value:value.startsWith('//')?`https:${value}`:`https://${value}`;
      const url=new URL(candidate);
      if(url.username)url.username='redacted-user';
      if(url.password)url.password='redacted-secret';
      for(const key of [...url.searchParams.keys()])url.searchParams.set(key,'[已遮盖]');
      if(url.hash)url.hash='redacted';
      try{url.pathname=redactPlain(decodeURIComponent(url.pathname));}catch{url.pathname=redactPlain(url.pathname);}
      return hasProtocol?url.href:url.href.replace(/^https:\/\//i,'');
    }catch{return redactPlain(value);}
  }
  function redact(value) {
    // Parse URLs before email masking so user-info cannot conceal the actual destination.
    const urls=/(?:https?:\/\/[^\s<>，,。；;！!]+|(?<![\w@.-])(?:www\.)?(?:\[[0-9a-f:.]+\]|(?:\d{1,3}\.){3}\d{1,3}|(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+[\p{L}]{2,})(?::\d+)?(?:[/?#][^\s<>，,。；;！!]+)?)/giu;
    const raw=String(value||'');let output='',last=0;
    for(const match of raw.matchAll(urls)) {
      output+=redactPlain(raw.slice(last,match.index))+redactUrl(match[0]);
      last=match.index+match[0].length;
    }
    return output+redactPlain(raw.slice(last));
  }
  // Clauses keep negated safety instructions from triggering their quoted actions.
  function findSignal(text, regex) {
    const clauses = text.split(/(?:[。！？!?；;\n，,]+|但是|然而|不过|但)/u);
    for (const clause of clauses) {
      const match = regex.exec(clause);
      if (!match) continue;
      const before = clause.slice(Math.max(0,match.index - 16),match.index);
      if (/(?:不要|切勿|请勿|不能|不得|无需|不必|拒绝|勿|不需要|禁止|谨防|警惕|远离|别|没有|没|未曾|未|并未|并没有|不曾|尚未|从未)(?:再|向\S{0,8}|随意|轻易|进行|先|任何|参与|将|开启|提供|[^，。]{0,4})?$/u.test(before)) continue;
      return clause.trim();
    }
    return null;
  }
  const rules = [
    {id:'advance',title:'先付费用或垫资',pattern:/(?:先交|先付|先支付|先充值|先垫付|交纳|缴纳).{0,10}(?:保证金|押金|费用|解冻费|认证费|元)|保证金|解冻费|垫资|垫付/u,weight:42,ref:'advance',explanation:'对方要求先承担资金支出。先付费用与后续返还承诺需要独立核验。'},
    {id:'task',title:'刷单或返利任务',pattern:/刷单|刷信誉|刷销量|返利任务/u,weight:42,ref:'advance',explanation:'刷单任务常伴随垫付、返利或继续充值的要求，请勿参与。'},
    {id:'payment',title:'要求转账或支付',pattern:/转账|转到.{0,8}账户|付款|支付.{0,8}(?:元|费用)|充值|汇款/u,weight:28,ref:'payment',explanation:'消息涉及资金操作，需要核实业务、收款方与官方收费渠道。'},
    {id:'personal',title:'个人收款渠道',pattern:/个人账户|私人账户|个人收款码|私人收款码/u,weight:28,ref:'payment',explanation:'涉及个人收款渠道，应通过学校或机构已知联系方式确认。'},
    {id:'urgency',title:'催促或制造紧迫感',pattern:/马上|立即|限时|只有\s*[0-9一二三四五六七八九十]+\s*个|今天\s*\d{1,2}[:：]\d{2}前|即将冻结|否则.{0,10}(?:冻结|失效|恢复)/u,weight:14,ref:'urgency',explanation:'时间压力会减少核验机会。先暂停，不应因催促跳过验证。'},
    {id:'identity',title:'更换联系方式的身份声明',pattern:/新号码|新手机号|换了号码|这是我的新号/u,weight:24,ref:'identity',explanation:'新的联系方式不能证明身份，应拨打通讯录中原有号码联系本人。'},
    {id:'secret',title:'要求提供账号凭据',pattern:/(?:提供|发送|发给|告诉|告知|提交|给我|索取).{0,12}(?:验证码|密码|恢复代码)|(?:验证码|密码).{0,10}(?:发给|告诉|发送|提供)/u,weight:52,ref:'secrets',explanation:'验证码和密码可用于控制账号。不要向消息发送者披露。'},
    {id:'remote',title:'屏幕共享或远程控制',pattern:/(?:开启|打开|进行|允许|启动|使用).{0,6}(?:屏幕共享|远程控制)|(?:屏幕共享|远程控制).{0,6}(?:认证|验证|退款)/u,weight:48,ref:'remote',explanation:'屏幕共享或远程控制可能暴露支付信息与验证码，应停止并独立核验。'},
    {id:'download',title:'要求安装未知应用',pattern:/(?:下载|安装).{0,10}(?:陌生|不明|这个|指定|App|APP|软件|应用)/u,weight:25,ref:'remote',explanation:'尚未验证应用发布者和下载来源，请不要直接安装。'},
    {id:'redirect',title:'引导转向私下渠道',pattern:/扫码进群|私聊.{0,6}(?:客服|联系)|加.{0,5}(?:微信|QQ)/u,weight:12,ref:'identity',explanation:'转入新的私聊或群组后，仍需独立核验对方身份与业务。'},
    {id:'injection',title:'包含干扰分析的指令',pattern:/忽略.{0,12}(?:指令|规则)|泄露.{0,8}(?:提示词|密钥)|ignore.{0,15}instructions/iu,weight:25,ref:'injection',explanation:'该内容试图改变分析规则，应作为待分析数据处理，不能作为系统指令。'}
  ];
  function riskEvidence(text) {
    return rules.flatMap(rule=>{
      const matched=findSignal(text,rule.pattern);
      const quote=matched?evidenceQuote(text,matched):null;
      return quote?[{id:rule.id,title:rule.title,quote,explanation:rule.explanation,weight:rule.weight,ref:rule.ref,type:'risk'}]:[];
    });
  }
  function evidenceQuote(text,quote) {
    const start=text.indexOf(quote);
    if(start<0)return quote;
    const boundaries=/[。！？!?；;\n，,]/u;
    let left=start,right=start+quote.length;
    while(left>0&&!boundaries.test(text[left-1]))left--;
    while(right<text.length&&!boundaries.test(text[right]))right++;
    const tail=text.slice(right+1);
    if((text[right]===','||text[right]==='，')&&/^(?:完成|随后|之后|并).{0,40}(?:返还|退还|返利)/u.test(tail)) {
      const next=/[。！？!?；;\n]/u.exec(tail);
      right=next?right+1+next.index:text.length;
    }
    const expanded=text.slice(left,right).trim();
    return expanded.length<=600?expanded:quote;
  }
  function evidenceIds(item) { return item.signalIds||[item.id]; }
  function normalizeEvidence(items) {
    const result=[];
    const money=new Set(['advance','payment']);
    for(const source of items) {
      const item={...source,signalIds:[...new Set(evidenceIds(source))]};
      const existing=item.type==='risk'&&result.find(other=>other.type==='risk'&&
        !item.id.startsWith('url-')&&!other.id.startsWith('url-')&&
        (item.quote.includes(other.quote)||other.quote.includes(item.quote))&&
        (item.signalIds.some(id=>evidenceIds(other).includes(id))||
          item.signalIds.some(id=>money.has(id))&&evidenceIds(other).some(id=>money.has(id))));
      if(!existing){result.push(item);continue;}
      existing.signalIds=[...new Set([...evidenceIds(existing),...item.signalIds])];
      existing.weight=Math.max(existing.weight,item.weight);
      if(item.quote.length>existing.quote.length)existing.quote=item.quote;
      const primary=rules.find(rule=>existing.signalIds.includes(rule.id));
      if(primary)Object.assign(existing,{title:primary.title,explanation:primary.explanation,ref:primary.ref});
    }
    return result;
  }
  function parseUrl(raw) {
    const value = String(raw || '').trim();
    if (!value || value.length > 2048) throw new Error('请输入不超过 2,048 个字符的完整链接。');
    if (/\s/u.test(value)) throw new Error('请只填写链接；短信原文可粘贴到下方消息框。');
    const explicitScheme=/^([a-z][a-z\d+.-]*):/i.exec(value);
    const hasProtocol=/^https?:\/\//i.test(value);
    const hostWithPort=/^(?:\[[0-9a-f:.]+\]|(?:[\p{L}\p{N}-]+\.)*[\p{L}\p{N}-]+):\d+(?:[/?#]|$)/iu.test(value);
    if (explicitScheme && !hasProtocol && !hostWithPort) throw new Error('仅支持网页链接；可填写 http(s):// 链接或不带协议的域名。');
    let url;
    const candidate=hasProtocol?value:value.startsWith('//')?`https:${value}`:`https://${value}`;
    try { url = new URL(candidate); } catch { throw new Error('链接格式不正确，请检查域名和路径。'); }
    if (!['http:','https:'].includes(url.protocol) || !url.hostname) throw new Error('仅支持网页链接；可填写 http(s):// 链接或不带协议的域名。');
    const hostname=url.hostname.toLowerCase();
    return {protocol:hasProtocol?url.protocol:'未注明',protocolProvided:hasProtocol,host:hostname,port:url.port || '默认端口',path:url.pathname,hasUserInfo:Boolean(url.username || url.password),http:hasProtocol&&url.protocol==='http:',ip:/^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname)||hostname.startsWith('['),encoded:hostname.includes('xn--'),short:['t.cn','bit.ly','tinyurl.com','suo.im'].includes(hostname),href:redactUrl(value)};
  }
  const purposeLabels={view_information:'查看信息',login:'登录或身份认证',payment:'付款或转账',download:'下载或安装',unknown:'原文未明确说明用途'};
  function linkAnalysis(url,text,evidence) {
    const definitions=[
      ['userinfo','用户信息段',url.hasUserInfo,'地址含 @ 前用户信息段，请以实际主机名为准。','未发现 @ 前用户信息段。'],
      ['transport','传输加密',url.http,'HTTP 不提供传输加密。','使用 HTTPS；加密不等于网站可信。'],
      ['ip','IP 地址',url.ip,'目标使用 IP，不能据此确定机构归属。','主机名不是 IP 地址；仍需核实归属。'],
      ['encoded','编码域名',url.encoded,'包含 Punycode 编码，请检查相似字符。','未发现 Punycode 编码；未进行完整相似域名检测。'],
      ['short','已知短链',url.short,'属于当前规则覆盖的短链服务，最终目标未检查。','未匹配当前短链规则；不代表没有跳转。'],
      ['port','端口',url.port!=='默认端口','使用非默认端口，需确认用途；不等于恶意。','使用协议默认端口。']
    ];
    const checks=definitions.map(([id,label,attention,warning,clear])=>id==='transport'&&!url.protocolProvided
      ?{id,label,status:'unknown',detail:'原文未注明协议，无法判断是否使用加密连接。'}
      :{id,label,status:attention?'attention':'no_signal',detail:attention?warning:clear});
    const count=checks.filter(item=>item.status==='attention').length;
    const unknownCount=checks.filter(item=>item.status==='unknown').length;
    const purposeMatch=[['payment',/转账|付款|支付|缴费|充值/u],['download',/下载|安装/u],['login',/登录|认证|验证身份/u],['view_information',/查看|浏览|阅读/u]].map(([purpose,regex])=>({purpose,match:regex.exec(text)})).find(item=>item.match);
    return {
      structure:{status:count?'signals_detected':unknownCount?'incomplete':'no_obvious_signals',summary:count?`结构检查有 ${count} 项需关注；请结合消息要求判断，不等于已认定恶意。`:unknownCount?`结构检查有 ${unknownCount} 项无法从原文判断；其余已覆盖项目未发现明显异常，不代表网址安全或属于官方。`:'在已覆盖的结构检查项中未发现明显异常；不代表网址安全或属于官方。',checks},
      context:{purpose:purposeMatch?.purpose||'unknown',label:purposeLabels[purposeMatch?.purpose||'unknown'],quote:purposeMatch?.match[0]||'',source:'local',riskCount:evidence.filter(item=>item.type==='risk'&&!item.id.startsWith('url-')).length},
      attribution:{status:'not_requested',summary:'未进行联网归属检索；不会凭域名印象认定官网。',sources:[]},
      page:{status:'not_fetched',summary:'未读取目标网页，未跟随跳转，也未检查页面内容或恶意文件。'}
    };
  }
  function retrieve(text, evidence = []) {
    const related = new Set(evidence.map(item => item.ref));
    return knowledge.entries.map(entry => ({...entry,relevance:(related.has(entry.id)?10:0)+entry.keywords.reduce((sum,word)=>sum+(text.toLowerCase().includes(word.toLowerCase())?1:0),0)})).filter(entry=>entry.relevance>0).sort((a,b)=>b.relevance-a.relevance).slice(0,3);
  }
  function canAssessContext(text) {
    return !/https?:\/\/|www\.|二维码|链接/iu.test(text)&&!findSignal(text,/缴费|交钱|收款|逾期费|登录|认证|验证身份|点击|扫码|绑定|银行卡|账户|账号/u);
  }
  function contentContext(text, evidence) {
    if(evidence.some(item=>item.type==='risk'))return {contentType:'risk_related',contentLabel:'含风险线索内容'};
    if(!canAssessContext(text))return {contentType:'undetermined',contentLabel:'内容类型待核验',blocksLow:true};
    if(/^(?:你好|您好|谢谢|再见|早上好|hello(?: world)?|hi)[！!。，,.\s]*$/iu.test(text))return {contentType:'greeting',contentLabel:contentLabels.greeting,contextQuote:text};
    if(/识别为|判为|分析结果|测试结果|模型输出|否定语句|分类结果/u.test(text))return {contentType:'meta_description',contentLabel:contentLabels.meta_description,contextQuote:text.slice(0,220)};
    const reminder=/(?:不要|切勿|请勿|不得|无需|不需要|禁止)[^。！？\n，,]{0,24}(?:转账|保证金|验证码|密码|屏幕共享|远程控制|刷单)/u.exec(text);
    if(/反诈提醒|反诈宣传|防骗提醒|安全提醒|网络安全提醒/u.test(text)&&reminder)return {contentType:'safety_reminder',contentLabel:'反诈与安全提醒',contextQuote:reminder[0]};
    const routine=/(?:图书馆通知|借阅提醒|图书到期提醒)[^。！？\n]{0,100}(?:到期|归还|续借)/u.exec(text)||(/通知|提醒|安排/u.test(text)&&/图书|课程|讲座|会议|上课|活动/u.test(text)&&/(?:周[一二三四五六日天]|星期[一二三四五六日天]|明天|教室|报告厅|到期|归还|\d{1,2}[:：]\d{2})/u.test(text)?[text.slice(0,220)]:null);
    const sensitive=/登录|账号|验证码|密码|转账|支付|付款|缴费|费用|充值|下载|安装|保证金|押金|兼职|补助|退款|屏幕共享|远程控制/u;
    if(routine&&!sensitive.test(text))return {contentType:'routine_notice',contentLabel:'日常事务通知',contextQuote:routine[0]};
    const daily=/(?:明天|今天|后天|周[一二三四五六日天]|星期[一二三四五六日天])/u.test(text)&&
      /图书馆|食堂|教室|操场/u.test(text)&&/见|吃饭|带课本|一起学习/u.test(text);
    if(daily&&!sensitive.test(text))return {contentType:'daily_chat',contentLabel:contentLabels.daily_chat,contextQuote:text.slice(0,600)};
    return {contentType:'undetermined',contentLabel:'内容类型待核验'};
  }
  function actionsFor(evidence, level, contentType) {
    if(level==='not_applicable'||(level==='unknown'&&!evidence.some(item=>item.type==='risk')))return [];
    if(level==='low'&&contentType==='safety_reminder')return ['遵循提醒，不向他人提供密码、验证码，不参与垫付或保证金交易。','如需转发，请核对提醒的官方出处，避免夹带未经核实的联系方式或链接。'];
    if(level==='low'&&contentType==='routine_notice')return ['如需确认通知事项或办理相关事务，请从已知的学校官网或官方应用独立进入，核对具体安排与记录。','当前未发现明显风险信号；如后续要求付款、提供凭据或安装应用，请重新核验。'];
    if(level==='low'&&contentType==='daily_chat')return ['如后续出现付款、索取凭据或安装应用等要求，请结合新增内容重新核验。'];
    const ids = new Set(evidence.flatMap(evidenceIds));
    const actions = [];
    if (ids.has('payment')||ids.has('advance')||ids.has('task')||ids.has('personal')) actions.push('暂停转账、充值或垫付，通过学校或机构官方渠道核实收费与收款方。');
    if (ids.has('secret')||ids.has('remote')) actions.push('不要提供密码或验证码；停止屏幕共享、远程控制。若已泄露，立即在官方应用修改密码并退出其他会话。');
    if (ids.has('download')||ids.has('url-userinfo')||ids.has('url-ip')) actions.push('暂不打开消息中的链接或安装应用，从已收藏的官网或官方应用独立进入。');
    actions.push('使用通讯录中已有的号码或机构公开电话，独立核验发送者与事项。');
    if (level!=='low') actions.push('保留原始聊天、对方账号、链接和时间，避免删除核验线索。');
    if (level==='high') actions.push('如已产生资金损失，立即联系银行或支付平台并拨打 110 报警；反诈咨询可联系 96110。');
    if (level==='unknown') actions.push('补充对方要求的具体操作、完整通知或截图文字，暂不提供额外个人信息。');
    return [...new Set(actions)];
  }
  function finalizeReport(report) {
    report.evidence=normalizeEvidence(report.evidence);
    const risks=report.evidence.filter(item=>item.type==='risk');
    const noObject=['meta_description','greeting'].includes(report.contentType)&&!risks.length&&!report.url;
    if(noObject)report.level='not_applicable';
    if(risks.length)Object.assign(report,{contentType:'risk_related',contentLabel:contentLabels.risk_related});
    if(['low','unknown','not_applicable'].includes(report.level))report.score=null;
    const applicable=noObject?'not_applicable':risks.length||report.url||['low','medium','high'].includes(report.level)||/兼职|通知|老师|退款|缴费|登录/u.test(report.original)?'applicable':'unclear';
    const information=noObject?'not_applicable':['high','medium','low'].includes(report.level)?'sufficient':'insufficient';
    let missing=[];
    if(information==='insufficient') {
      if(report.mode==='image'&&!report.original)missing=['提供可读的截图文字或更清晰的截图。'];
      else if(report.url)missing=['这个链接来自什么消息，要求你登录、支付、下载，还是仅查看信息？请勿提供密码或验证码。'];
      else if(/兼职/u.test(report.original))missing=['工作内容和对方要求的具体操作是什么？是否要求先交费用或垫资？'];
      else if(/登录|账号|认证/u.test(report.original))missing=['对方要求通过什么入口办理什么事项？请只描述操作，不提供账号凭据。'];
      else missing=['需要核验的消息原文和具体操作要求是什么？请补充上下文，不包含个人隐私。'];
    }
    report.assessment={applicability:applicable,information,riskSignals:risks.length?'detected':noObject?'not_applicable':report.level==='low'?'not_detected':'undetermined',sourceVerification:'not_verified'};
    report.missingInformation=missing;
    if(noObject) {
      Object.assign(report,levels.not_applicable);
      report.summary=report.contentType==='meta_description'?'这段文字是在描述一次识别或测试结果，没有提供具体的可疑消息或操作要求，因此不适用于具体事件的风险评级。如需核验某条消息，请提供消息原文。':'这是一段日常交流，没有具体的消息、事件或操作要求需要核验，因此不作风险评级。';
      report.uncertainty='没有对任何具体事件、发送者或交易作出判断；内容用途识别不等于真实性核验。';
      if(report.mode==='image')report.uncertainty+=report.transcriptionSource==='model'?' 截图文字由模型识别，可能存在错字或遗漏，请对照截图复核。':' 仅分析填写的截图文字，未识别图片像素。';
    } else if(report.level==='low') {
      Object.assign(report,levels.low);
      if(report.contentType==='safety_reminder')Object.assign(report,{title:'内容以反诈与安全提醒为主',summary:'原文是在提醒避免危险操作，当前未发现明显风险操作要求。提醒的出处与发送者身份尚未核实。'});
      if(report.contentType==='routine_notice')Object.assign(report,{title:'日常通知，未发现明显风险信号',summary:'原文主要说明日常事务与安排，未发现转账、索取凭据等明显风险要求。尚未核实通知来源与实际业务记录。'});
      if(report.contentType==='daily_chat')Object.assign(report,{title:'日常交流，未发现明显风险信号',summary:'原文主要是日常交流与安排，未发现明显诈骗操作要求；未核实发送者身份，也不代表后续操作安全。'});
    } else if(report.level==='unknown') {
      Object.assign(report,levels.unknown);
      report.summary=report.url?'已检查链接结构，但未访问目标页面或核实业务。仅凭当前链接与上下文，无法判断具体事件风险。':risks.length?'发现了需要关注的线索，但不足以判断整体风险。请查看原文依据，并补充相关操作背景。':'当前输入尚未提供足够的事件或操作细节，无法据此评估具体风险。下方仅列出影响判断的补充信息。';
      if(report.linkAnalysis) {
        report.title=report.linkAnalysis.structure.status==='signals_detected'?'已发现结构关注项，仍需核验用途与归属':'结构检查已完成，网站归属与内容仍待核验';
        report.summary=report.linkAnalysis.structure.summary+' '+report.linkAnalysis.page.summary;
      }
    }
    report.actions=actionsFor(report.evidence,report.level,report.contentType);
    if(report.source==='cloud'&&['high','medium'].includes(report.level)&&risks.some(item=>item.id.startsWith('model-')))report.actions.unshift('暂不按对方要求支付、提供凭据或安装软件，先通过独立渠道核验。');
    report.checkedActions=(report.checkedActions||[]).filter(index=>index<report.actions.length);
    report.quiz=noObject||(!risks.length&&report.level==='unknown')?null:quizFor(report.evidence);
    report.processing=report.processing||{status:'completed'};
    if(report.inputReview?.status==='user_confirmed')report.uncertainty='仅分析用户声明已对照确认的截图文字，不重新识别图片像素；仍可能存在遗漏，不能据此核实身份、来源或业务真实性。';
    // Keep the verification answer bounded by observed content, not model claims of truth.
    if(['high','medium'].includes(report.level)) {
      report.summary=`原文包含${risks.length}项需要关注的风险线索，请暂停相关操作并独立核验。风险线索不等于已经认定诈骗，也未证实发送者身份与业务真实性。`;
    }
    report.verificationResponse=null;
    if(report.background||/是真的吗|真的吗|是真是假|是否真实|是否可信|是否靠谱|是不是诈骗|是不是骗子|安全吗/u.test(report.original)) {
      const answer=['high','medium'].includes(report.level)?'不能仅凭这段内容认定真假，但原文存在风险线索，建议先暂停相关操作，通过已知官方渠道核实。':report.level==='low'?'当前内容未发现明显风险信号，但这不能证明消息是真的。请通过已知官方渠道核对通知或业务。':report.level==='not_applicable'?'当前没有具体事件可供核验。请提供需要核验的消息原文、链接或截图文字。':report.url?'目前仅检查了链接结构，没有访问目标网页，也没有查询域名信誉，不能据此确认网站真假或安全。':'现有内容不足以判断真假。请补充消息原文、对方的具体要求和必要背景，不要提供密码或验证码。';
      report.verificationResponse={answer,backgroundAdvice:[]};
      if(report.background) {
        report.verificationResponse.backgroundAdvice.push('补充背景为用户自述，尚未独立核实，不作为消息原文证据或来源真实的证明。');
        const clauses=report.background.split(/[。！？!?；;\n]/u);
        if(clauses.some(clause=>/^\s*我(?:已经|已|刚刚|刚)(?:给对方|向对方)?(?:转账|付款|汇款|支付)/u.test(clause)&&!/吗|是否|如果|假如|没|未/u.test(clause)))report.verificationResponse.backgroundAdvice.push('根据你自述的已付款情况：先停止追加付款，尽快通过银行或支付平台官方渠道申请处置并保存交易记录；如怀疑被骗或已发生损失，请报警求助。这里未核实实际交易。');
      }
    }
    if(report.url&&report.linkAnalysis) {
      report.verificationResponse=report.verificationResponse||{answer:'',backgroundAdvice:[]};
      const link=report.linkAnalysis;
      const riskAnswer=['high','medium'].includes(report.level)?'消息或链接存在风险线索；即使域名属于真实机构，也不能据此相信发送者或执行付款、提供凭据等要求。':link.structure.summary;
      report.verificationResponse.answer=`${riskAnswer} ${link.attribution.summary} ${link.page.summary}`;
    }
    return report;
  }
  function markFallback(report,reason,code='unavailable') {
    report.fallbackReason=reason;
    report.processing={status:report.mode==='image'&&!report.original?'failed':'fallback',code};
    if(report.processing.status==='failed') {
      report.label='分析未完成';report.title='图片内容尚未成功识别';report.summary='本次识图因配置、服务或返回内容问题未能完成，尚未对图片内容作出风险判断。请补充可读文字或稍后重试。';
      report.sourceLabel='图片分析未完成';report.uncertainty='尚未可靠识别图片像素，也未对图片中的事件或操作作出判断。';
      Object.assign(report.assessment,{applicability:'not_evaluated',information:'not_evaluated',riskSignals:'not_assessed'});
    }
    return report;
  }
  function assessmentDetails(report) {
    const status=report.assessment;
    if(!status)return [];
    return [
      ['分析对象',{applicable:'有可分析的消息或事项',not_applicable:'无具体风险分析对象',unclear:'尚未明确分析对象',not_evaluated:'识图未完成，尚未评估'}[status.applicability]],
      ['风险发现',{detected:'发现需要关注的风险线索',not_detected:'未发现明显风险信号',not_applicable:'不适用风险判断',undetermined:'现有信息不足以判断',not_assessed:'技术处理未完成，尚未判断'}[status.riskSignals]],
      ['信息充分性',{sufficient:'足以作内容初筛',insufficient:'仍需补充关键信息',not_applicable:'不适用事件信息评估',not_evaluated:'识图未完成，尚未评估'}[status.information]],
      ['来源核实','未核实身份、来源与业务真实性']
    ];
  }
  function quizFor(evidence) {
    const ids = new Set(evidence.flatMap(evidenceIds));
    if (ids.has('advance')||ids.has('task')) return {question:'对方承诺交保证金后返还，你会先做什么？',options:['小额试转，确认能返还再加钱','暂停支付，独立核验招聘主体与业务','删除聊天，避免继续收到消息'],correct:1,explanation:'承诺返还不能证明交易真实。先停止付款并保留证据，再独立核验。'};
    if (ids.has('url-userinfo')||ids.has('url-ip')) return {question:'https://school.edu.cn@example.com/login 的实际主机名是什么？',options:['school.edu.cn','example.com','只要有 https 就无需检查'],correct:1,explanation:'@ 后面的 example.com 才是实际主机名；前面的内容是用户信息，HTTPS 也不保证网站可信。'};
    return {question:'收到自称学校老师或客服的消息，怎样核验更可靠？',options:['直接拨打消息中提供的新号码','看到熟悉头像就相信','通过已有通讯录或官方公开电话联系'],correct:2,explanation:'核验渠道需要独立于可疑消息，姓名、头像和自称身份均不足以证明真实性。'};
  }
  function analyze(input) {
    if (!input || !['text','link','image'].includes(input.mode)) throw new Error('请选择有效的输入类型。');
    const raw = String(input.text || '').trim();
    if (raw.length>8000) throw new Error('输入内容不能超过 8,000 个字符。');
    if(input.background!==undefined&&(typeof input.background!=='string'||input.background.length>1000))throw new Error('补充背景必须是不超过 1,000 字符的文本。');
    const background=redact((input.background||'').trim());
    let url = null;
    if (input.mode==='link') url = parseUrl(input.url);
    if (!raw && !url && !background && input.mode!=='image') throw new Error('请先填写需要分析的内容。');
    const text = redact(raw);
    const original = input.mode==='link' ? `${redact(input.url)}${text?'\n'+text:''}` : text;
    const evidence = normalizeEvidence(riskEvidence(text));
    // One advance-payment operation is not two independent signals. A subsequent
    // refund promise or recruitment context can still justify a strong warning.
    for(const item of evidence)if(evidenceIds(item).includes('advance')&&evidenceIds(item).includes('payment')&&
      (findSignal(text,/返还|退还|返利/u)||/兼职|招聘/u.test(text))) {
      item.weight=70;
      item.explanation='原文要求先承担资金支出，并涉及招聘或后续返还承诺。请暂停支付，独立核验收费依据与收款方；这不等于已认定诈骗。';
    }
    if (url) {
      const add = (id,title,quote,explanation,weight)=>evidence.push({id,title,quote,explanation,weight,ref:'url',type:'risk'});
      if (url.hasUserInfo) add('url-userinfo','网址包含用户信息段',redact(input.url),'@ 前面不是实际主机名，容易被用来伪装学校或品牌域名。',32);
      if (url.ip) add('url-ip','主机使用 IP 地址',redact(input.url),'IP 地址无法直接说明机构归属，需要额外核验；它本身不等于恶意。',15);
      if (url.http) add('url-http','连接未使用 HTTPS',redact(input.url),'HTTP 不提供传输加密，不宜在此输入账号或支付信息。',12);
      if (url.encoded) add('url-encoded','包含编码域名',redact(input.url),'编码域名可能表示国际化域名，也可能有相似字符混淆，请与官网逐字核对。',12);
      if (url.short) add('url-short','短链接隐藏最终目标',redact(input.url),'这里只能看到短链接服务，无法核实最终落地页面。',10);
    }
    const context=contentContext(text,evidence);
    let score = Math.min(98,evidence.reduce((total,item)=>total+item.weight,0));
    let level = score>=50?'high':score>=20?'medium':'unknown';
    if (!evidence.length) {
      const official = /学校官网|教务系统|学校官方|保卫处/u.exec(text);
      const details = /(?:周[一二三四五六日天]|\d{1,2}[:：]\d{2}|教学楼|报告厅|安全提醒|网络安全)/u.exec(text);
      if (!url && context.contextQuote && !['meta_description','greeting'].includes(context.contentType)) {
        level='low'; score=null;
        evidence.push({id:'context',title:context.contentType==='safety_reminder'?'原文是在提醒避免危险操作':'原文包含具体日常事务',quote:context.contextQuote,explanation:'该片段用于说明内容语境，不是消息真实性或发送者身份的证明。',weight:0,ref:'verify',type:'protective'});
      } else if (!url && !context.blocksLow && official && details) {
        level='low'; score=null;
        evidence.push({id:'official',title:'提供独立核验线索',quote:official[0],explanation:'原文提到可核验渠道，但该声明尚未经过独立验证。',weight:0,ref:'verify',type:'protective'});
        evidence.push({id:'details',title:'包含具体安排或安全提醒',quote:details[0],explanation:'这些信息便于向学校核对，不代表已证明消息真实。',weight:0,ref:'verify',type:'protective'});
      }
    }
    if (level==='unknown') score=null;
    if(!url&&['meta_description','greeting'].includes(context.contentType)&&!evidence.length)evidence.push({id:'context',title:'当前内容的用途',quote:context.contextQuote,explanation:'该片段用于说明内容用途，不是风险证据或真实性证明。',weight:0,ref:'verify',type:'contextual'});
    if(level==='low'&&context.contentType==='undetermined')Object.assign(context,{contentType:'routine_notice',contentLabel:'通知与安全信息'});
    const conclusion={...levels[level]};
    evidence.sort((a,b)=>b.weight-a.weight);
    let references = retrieve(original,evidence);
    if (!references.length) references = knowledge.entries.filter(e=>e.id==='verify');
    return finalizeReport({id:globalThis.crypto?.randomUUID?.()||`report-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,version:VERSION,createdAt:new Date().toISOString(),mode:input.mode,background,...(input.mode==='image'&&text&&input.imageTextConfirmed===true?{inputReview:{status:'user_confirmed',scope:'text_only'}}:{}),level,score,...conclusion,contentType:context.contentType,contentLabel:context.contentLabel,evidence,actions:actionsFor(evidence,level,context.contentType),uncertainty:input.mode==='image'?'仅分析填写的截图文字，未识别图片像素。未核实身份、真实业务和交易情况。':url?'已解析 URL 结构；联网检索状态另列。未访问目标页面、解析重定向或查询域名信誉，无法据此确认网站安全。':'未核实发送者真实身份和业务背景。未出现风险信号不代表内容安全。',references,quiz:quizFor(evidence),original,url,...(url?{linkAnalysis:linkAnalysis(url,text,evidence)}:{}),source:'local',sourceLabel:'本地规则 + 关键词知识检索',redacted:background!==(input.background||'').trim()||original!== (input.mode==='link'?`${input.url}${raw?'\n'+raw:''}`:raw),checkedActions:[]});
  }
  function toMarkdown(report) {
    return [`# CrediLens 风险分析报告`,`时间：${report.createdAt}`,`报告编号：${report.id}`,`分析来源：${report.sourceLabel}`,`处理状态：${report.processing?.status||'completed'}`,`内容类型：${report.contentLabel||'未分类'}`,`风险结论：${report.label}`,`风险指标：${report.score===null?'不作数字评分':report.score+' / 100（非概率）'}`,
      ...(report.inputReview?['截图文字确认：用户声明已对照确认；仅分析文字，不代表图片或来源已验证。']:[]),
      '\n## 分析维度',...assessmentDetails(report).map(([key,value])=>`${key}：${value}`),'\n## 结论',report.title,report.summary,'\n## 脱敏原文',report.original||'未提供可识别文字',
      ...(report.background?['\n## 用户补充（自述，未核实）',report.background]:[]),
      ...(report.verificationResponse?['\n## 核验回应',report.verificationResponse.answer,...report.verificationResponse.backgroundAdvice]:[]),
      ...(report.url?['\n## 链接检查',`实际主机名：${report.url.host}`,`协议：${report.url.protocol}；端口：${report.url.port}；路径：${redact(report.url.path)}`]:[]),
      ...(report.linkAnalysis?[
        report.linkAnalysis.structure.summary,...report.linkAnalysis.structure.checks.map(item=>`- ${item.label}：${item.detail}`),
        `消息用途：${report.linkAnalysis.context.label}${report.linkAnalysis.context.quote?'；原文：'+report.linkAnalysis.context.quote:''}`,
        '\n### 归属检索（不是官网认证）',report.linkAnalysis.attribution.summary,
        ...(report.linkAnalysis.attribution.searchedAt?[`检索时间：${report.linkAnalysis.attribution.searchedAt}；服务：${report.linkAnalysis.attribution.provider}`]:[]),
        ...report.linkAnalysis.attribution.sources.map(source=>`- ${source.title}：${source.url}\n  检索摘要（未独立核实）：${source.snippet}`),report.linkAnalysis.page.summary
      ]:[]),
      '\n## 原文依据',...report.evidence.map(e=>`- ${e.title}（${e.type==='risk'?'风险线索':'内容线索'}）\n  原文：${e.quote}\n  解释：${e.explanation}`),
      ...(report.missingInformation?.length?['\n## 需补充的信息',...report.missingInformation.map(text=>`- ${text}`)]:[]),
      ...(report.actions.length?['\n## 建议动作',...report.actions.map((a,i)=>`- [${report.checkedActions?.includes(i)?'x':' '}] ${a}`)]:[]),
      '\n## 不确定性',report.uncertainty,...(report.fallbackReason?[`模型降级：${report.fallbackReason}`]:[]),
      ...(report.level==='not_applicable'?[]:['\n## 相关安全知识',...report.references.map(r=>{
        const source=knowledge.getOfficialSource(r);
        return `- ${r.title}\n  ${source?`${source.publisher}：${source.title} ${source.url}\n  发布：${source.publishedAt}；链接核对：${source.checkedAt}`:'项目规则说明，无外部引用'}\n  ${r.note}`;
      })]),'\n本报告仅作辅助初筛，分数不是诈骗概率。'].join('\n\n');
  }
  return {VERSION,levels,contentLabels,purposeLabels,redact,parseUrl,analyze,retrieve,toMarkdown,canAssessContext,finalizeReport,markFallback,assessmentDetails,riskEvidence,evidenceQuote,normalizeEvidence};
});
