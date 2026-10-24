'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const engine = window.CrediEngine;
  const library = window.CrediKnowledge;
  const state = { mode:'text', analysisMode:'local', report:null, history:[], image:null, imageVersion:0, imageLoading:false, request:null, configured:false, vision:false, searchConfigured:false };
  let toastTimer;
  const escape = value => String(value??'').replace(/[&<>"']/g, char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const icon = name => `<i data-lucide="${name}"></i>`;
  const icons = () => window.lucide?.createIcons();
  function knowledgeSource(entry) {
    const source=library.getOfficialSource(entry);
    return source?`<a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${escape(source.title)} ${icon('arrow-up-right')}</a><small>${escape(source.publisher)} · 发布 ${escape(source.publishedAt)} · 链接核对 ${escape(source.checkedAt)}</small>`:'<small>项目规则说明 · 无外部引用</small>';
  }
  const date = value => new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  function toast(message) { clearTimeout(toastTimer); $('toast').textContent=message; $('toast').hidden=false; toastTimer=setTimeout(()=>$('toast').hidden=true,3500); }
  function inputError(message) { $('inputError').textContent=message; $('inputError').hidden=!message; }
  function updateSearchStatus() {
    const available=state.analysisMode==='cloud'&&state.searchConfigured;
    $('searchConsent').disabled=Boolean(state.request)||!available;
    if(!available)$('searchConsent').checked=false;
    $('searchStatus').textContent=!state.searchConfigured?'Tavily 检索未配置（需在 .env 设置 TAVILY_API_KEY 并重启服务），授权开关暂不可用；仍可检查链接结构与消息要求。':state.analysisMode!=='cloud'?'Tavily 已配置；切换到云端模式后可单次授权。本地模式不会发送域名。':'仅发送实际主机名，不发送路径、查询参数、消息或背景；不读取目标网页。';
  }
  function route() {
    const view = location.hash.slice(1);
    const current = ['workbench','cases','knowledge','history'].includes(view)?view:'workbench';
    document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==`view-${current}`);
    document.querySelectorAll('[data-view]').forEach(el=>{ el.classList.toggle('active',el.dataset.view===current); if(el.dataset.view===current) el.setAttribute('aria-current','page'); else el.removeAttribute('aria-current'); });
    if(current==='history') renderHistory();
    icons();
  }
  function updateModeStatus() {
    const cloud = state.analysisMode==='cloud';
    $('engineStatus').innerHTML='<span class="status-dot"></span>'+(cloud?'云端分析':'本地分析');
    $('inputProcessingMode').textContent=cloud?'云端处理':'本地处理';
    $('sidebarPrivacy').textContent=cloud?'云端处理，图片单独授权':'内容仅在本机处理';
    $('footerMode').textContent=cloud?'云端分析 · 图片单独授权':'本地处理 · 无内容上传';
    $('imageConsentRow').hidden=!cloud || !state.image;
    $('imageRecognition').hidden=!state.image;
    $('recognizeBtn').disabled=Boolean(state.request)||state.imageLoading||!cloud||!state.vision;
    $('privacyText').textContent=cloud?'原文及补充背景脱敏后将发送到已配置模型；请检查个人信息':'手机号、邮箱和常见账号字段将自动遮盖';
    updateSearchStatus();
  }
  function setMode(mode, focus=false) {
    if(state.request)cancelRequest();
    state.mode=mode;
    $('searchConsent').checked=false;
    document.querySelectorAll('[data-mode]').forEach(el=>{ const selected=el.dataset.mode===mode; el.classList.toggle('active',selected); el.setAttribute('aria-selected',String(selected)); el.tabIndex=selected?0:-1; });
    ['text','link','image'].forEach(name=>$(`panel-${name}`).hidden=name!==mode);
    inputError('');
    if(focus) $(`tab-${mode}`).focus();
  }
  function clearImage() {
    if(state.mode==='image')cancelRequest();
    state.imageVersion++; state.image=null; $('imagePreview').removeAttribute('src'); $('imagePreviewWrap').hidden=true;
    state.imageLoading=false;$('imageDialog').close();$('imageDetail').removeAttribute('src');
    $('imageTextConfirmed').checked=false; $('recognizeLabel').textContent='识别图片文字';
    $('imageRecognitionStatus').textContent='尚未识别，可手动填写截图文字。';
    $('uploadZone').hidden=false; $('imageFile').value=''; $('imageConsent').checked=false; updateModeStatus();
    $('analyzeBtn').disabled=Boolean(state.request);
  }
  function cancelRequest() {
    state.request?.abort(); state.request=null; setBusy(false);
  }
  function clearReport() {
    state.report=null;$('emptyState').hidden=false;$('resultContent').hidden=true;$('resultTime').textContent='尚未提交';
  }
  function imageTextChanged() {
    $('imageTextConfirmed').checked=false;
    $('imageTextCount').textContent=`${$('imageNote').value.length.toLocaleString()} / 8,000`;
    clearReport();
  }
  function reset() {
    cancelRequest(); state.report=null;
    ['message','linkInput','linkContext','imageNote','background'].forEach(id=>$(id).value='');$('backgroundCount').textContent='0 / 1,000';
    clearImage(); imageTextChanged(); setMode('text'); $('charCount').textContent='0 / 8,000';
    $('emptyState').hidden=false; $('resultContent').hidden=true; $('resultTime').textContent='尚未提交'; $('message').focus();
  }
  function useCase(id) {
    const sample=library.cases.find(item=>item.id===id); if(!sample)return;
    cancelRequest(); clearImage(); setMode(sample.mode);
    $('background').value='';$('backgroundCount').textContent='0 / 1,000';clearReport();
    if(sample.mode==='link'){ $('linkInput').value=sample.text; $('linkContext').value=sample.context||''; }
    else $('message').value=sample.text;
    $('charCount').textContent=`${$('message').value.length.toLocaleString()} / 8,000`;
    location.hash='workbench'; route();
    $(sample.mode==='link'?'linkInput':'message').focus();
    toast('已填入样例，可运行分析');
  }
  function setBusy(busy) {
    $('analyzeBtn').disabled=busy||state.imageLoading; $('cancelBtn').hidden=!busy; $('loadingState').hidden=!busy;
    $('resultPanel').setAttribute('aria-busy',String(busy));
    document.querySelectorAll('#analysisForm textarea, #analysisForm input, [data-mode], #settingsBtn, #removeImageBtn').forEach(el=>el.disabled=busy);
    $('recognizeBtn').disabled=busy||state.imageLoading||state.analysisMode!=='cloud'||!state.vision;
    updateSearchStatus();
    if(busy){$('emptyState').hidden=true; $('resultContent').hidden=true; $('resultTime').textContent='分析中';}
    else { $('resultContent').hidden=!state.report; $('emptyState').hidden=Boolean(state.report); $('resultTime').textContent=state.report?date(state.report.createdAt):'尚未提交'; }
  }
  function setReportTab(tab, quote) {
    document.querySelectorAll('[data-report-tab]').forEach(btn=>{btn.classList.toggle('active',btn.dataset.reportTab===tab);btn.setAttribute('aria-pressed',String(btn.dataset.reportTab===tab));});
    $('originalPanel').hidden=tab!=='original'; $('evidenceList').hidden=tab!=='evidence';
    if(tab==='original' && state.report) {
      const text=state.report.original; const index=quote?text.indexOf(quote):-1;
      $('originalText').replaceChildren();
      if(index<0) $('originalText').textContent=text||'未提供文字内容';
      else {
        const mark=document.createElement('mark'); mark.textContent=quote;
        $('originalText').append(document.createTextNode(text.slice(0,index)),mark,document.createTextNode(text.slice(index+quote.length)));
        mark.scrollIntoView({block:'nearest'});
      }
    }
  }
  function updateActionProgress() {
    if(state.report)$('actionProgress').textContent=`${state.report.checkedActions.length} / ${state.report.actions.length} 已处理`;
  }
  function renderReport(report) {
    state.report=report;
    $('emptyState').hidden=true; $('resultContent').hidden=false; $('loadingState').hidden=true;
    $('resultTime').textContent=date(report.createdAt);
    $('riskSummary').className=`risk-summary ${report.level}`;
    $('riskScore').textContent=report.score??'—'; $('scoreCaption').textContent=report.score===null?'暂不评分':report.source==='cloud'?'综合风险分':'规则风险分';
    $('riskScorePanel').hidden=['low','not_applicable'].includes(report.level)||report.processing?.status==='failed';
    $('riskLabel').textContent=report.label; $('riskTitle').textContent=report.title; $('riskDescription').textContent=report.summary;
    $('analysisSource').textContent=report.sourceLabel; $('contentType').textContent=report.contentLabel||'内容类型待核验'; $('evidenceCount').textContent=`${report.evidence.length} 项输入证据`;
    $('fallbackNotice').hidden=!report.fallbackReason; $('fallbackNotice').textContent=report.fallbackReason||'';
    $('processingStatus').textContent=report.processing?.status==='failed'?'云端处理失败，尚未完成图片内容分析':report.processing?.status==='fallback'?'云端处理未完成，以下为本地回退结果':'内容分析已完成';
    if(report.inputReview?.status==='user_confirmed')$('processingStatus').textContent+=' · 仅分析用户确认的截图文字';
    if(report.mode==='image')$('imageRecognitionStatus').textContent=report.processing?.status==='fallback'?'云端分析未完成，已对确认文字生成本地回退报告。':'已对确认文字完成风险分析，未核实图片与消息来源。';
    $('verificationSection').hidden=!report.verificationResponse;
    $('verificationAnswer').textContent=report.verificationResponse?.answer||'';
    $('backgroundAdvice').innerHTML=(report.verificationResponse?.backgroundAdvice||[]).map(text=>`<li>${escape(text)}</li>`).join('');
    $('backgroundAdvice').hidden=!report.verificationResponse?.backgroundAdvice?.length;
    $('backgroundSection').hidden=!report.background;$('backgroundText').textContent=report.background||'';
    $('assessmentDetails').innerHTML=engine.assessmentDetails(report).map(([key,value])=>`<div><dt>${escape(key)}</dt><dd>${escape(value)}</dd></div>`).join('');
    const emptyEvidence=report.processing?.status==='failed'?'图片内容分析未完成，不能把处理失败解释成没有风险。':report.level==='not_applicable'?'当前没有具体风险分析对象，不虚构风险证据。':report.level==='low'?'当前未发现明显风险信号；这不代表已核实消息来源或真实性。':'未提取到足以支持风险结论的原文线索，请查看需要补充的信息。';
    $('evidenceList').innerHTML=report.evidence.length?report.evidence.map((e,index)=>`<div class="evidence ${e.type!=='risk'?'protective':''}"><div class="evidence-heading"><span class="evidence-number">${String(index+1).padStart(2,'0')}</span><h4>${escape(e.title)}</h4><span class="evidence-tag">${e.id==='context'||e.type==='contextual'?'内容线索':e.type==='protective'?'核验线索':'风险信号'}</span></div><blockquote>${escape(e.quote)}</blockquote><p>${escape(e.explanation)}</p><button type="button" class="inline-link" data-quote-index="${index}">定位原文 ${icon('arrow-up-right')}</button></div>`).join(''):`<div class="evidence"><p>${emptyEvidence}</p></div>`;
    $('urlSection').hidden=!report.url;
    if(report.url) $('urlDetails').innerHTML=[['实际主机名',report.url.host],['传输协议',report.url.protocol.replace(':','').toUpperCase()],['端口',report.url.port],['路径',engine.redact(report.url.path)]].map(([key,value])=>`<dt>${escape(key)}</dt><dd>${escape(value)}</dd>`).join('');
    const link=report.linkAnalysis;
    $('urlCheckDetails').open=link?.structure.status==='signals_detected';
    $('urlStructureSummary').textContent=link?.structure.summary||'该历史报告未包含分项结构检查。';
    $('urlChecks').innerHTML=(link?.structure.checks||[]).map(item=>`<li class="${item.status==='attention'?'attention':''}"><strong>${escape(item.label)}</strong><span>${escape(item.detail)}</span></li>`).join('');
    const messageRiskCount=report.evidence.filter(item=>item.type==='risk'&&!item.id.startsWith('url-')).length;
    $('urlContext').textContent=link?`${link.context.label}${link.context.quote?'；原文：“'+link.context.quote+'”':''}。${messageRiskCount?`原文有 ${messageRiskCount} 项风险线索，详见原文依据；域名归属不能消除这些要求的风险。`:'当前未提取到明确的消息风险要求；不代表已确认业务或发送者身份。'}`:'';
    $('attributionStatus').textContent=link?.attribution.summary||'该报告未进行归属检索。';
    $('attributionTime').hidden=!link?.attribution.searchedAt;
    $('attributionTime').textContent=link?.attribution.searchedAt?`${link.attribution.provider} · ${date(link.attribution.searchedAt)} · 检索域名：${link.attribution.queryHost}`:'';
    $('attributionSources').replaceChildren();
    for(const source of link?.attribution.sources||[]) {
      let url;try{url=new URL(source.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)continue;}catch{continue;}
      const item=document.createElement('li'),anchor=document.createElement('a'),host=document.createElement('small'),snippet=document.createElement('p');
      anchor.href=url.href;anchor.target='_blank';anchor.rel='noopener noreferrer';anchor.referrerPolicy='no-referrer';anchor.textContent=source.title;
      host.textContent=url.hostname+' · 检索摘要，未独立核实';snippet.textContent=source.snippet;
      item.append(anchor,host,snippet);$('attributionSources').append(item);
    }
    $('attributionSources').hidden=!$('attributionSources').childElementCount;
    $('urlPageStatus').textContent=link?.page.summary||'未读取目标网页或跟随跳转。';
    $('actionList').innerHTML=report.actions.map((action,index)=>`<label class="action-item"><input type="checkbox" data-action-index="${index}" ${report.checkedActions.includes(index)?'checked':''}><span>${escape(action)}</span></label>`).join('');
    $('actionsHeading').hidden=!report.actions.length;$('actionList').hidden=!report.actions.length;
    $('missingSection').hidden=!report.missingInformation?.length;
    $('missingInformation').innerHTML=(report.missingInformation||[]).map(text=>`<li>${escape(text)}</li>`).join('');
    updateActionProgress(); $('uncertaintyText').textContent=report.uncertainty;
    $('referenceList').innerHTML=report.references.map(ref=>`<div class="reference-item">${icon('book-open')}<div><strong class="reference-title">${escape(ref.title)}</strong>${knowledgeSource(ref)}<small>${escape(ref.note)}</small></div></div>`).join('');
    $('referencesHeading').hidden=report.level==='not_applicable';$('referenceList').hidden=report.level==='not_applicable';
    $('quizSection').hidden=!report.quiz;
    $('quizQuestion').textContent=report.quiz?.question||'';
    $('quizOptions').innerHTML=(report.quiz?.options||[]).map((option,index)=>`<button type="button" data-quiz-index="${index}" aria-pressed="false"><span class="quiz-letter">${String.fromCharCode(65+index)}</span>${escape(option)}</button>`).join('');
    $('quizFeedback').hidden=true; setReportTab('evidence'); icons();
  }
  function getInput() {
    return {mode:state.mode,text:state.mode==='text'?$('message').value:state.mode==='image'?$('imageNote').value:$('linkContext').value,background:$('background').value,url:state.mode==='link'?$('linkInput').value:undefined,...(state.mode==='link'?{searchConsent:state.analysisMode==='cloud'&&state.searchConfigured&&$('searchConsent').checked}:{}),...(state.mode==='image'?{imageTextConfirmed:$('imageTextConfirmed').checked}:{})};
  }
  async function runAnalysis(event) {
    event.preventDefault(); if(state.request||state.imageLoading)return;
    inputError(''); clearTimeout(toastTimer); $('toast').hidden=true; const input=getInput();
    if(state.mode==='image'&&!input.text.trim()){inputError('请先识别或手动填写截图文字，再对照确认。');return;}
    if(state.mode==='image'&&!input.imageTextConfirmed){inputError('请对照原图检查文字，并勾选文字确认后再分析。');return;}
    let report;
    try { report=engine.analyze(input); } catch(error) { inputError(error.message); return; }
    $('searchConsent').checked=false;
    const controller=new AbortController(); state.request=controller; setBusy(true);
    $('loadingLabel').textContent=state.analysisMode==='cloud'?input.searchConsent?'正在分析消息并检索域名出处':'正在请求模型分析':'正在核对原文证据';
    $('loadingDescription').textContent=input.searchConsent?'公开出处是核验线索，不读取目标网页；检索失败不等于网站异常':state.analysisMode==='cloud'?'模型超时后将返回本地分析结果':'检查风险信号、网址结构与相关知识';
    try {
      if(state.analysisMode==='cloud') {
        try {
          const payload={...input,text:engine.redact(input.text),background:engine.redact(input.background),url:input.url?engine.redact(input.url):undefined};
          const response=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(40000)])});
          const data=await response.json();
          if(!response.ok)throw new Error(data.error||'模型服务暂不可用');
          report=data;
        } catch(error) {
          if(controller.signal.aborted)return;
          engine.markFallback(report,report.mode==='image'&&!report.original?'云端请求未完成，图片内容尚未分析。请补充文字或稍后重试。':'云端请求未完成，以下为本地内容分析结果。','request_failed');
          if(input.searchConsent&&report.linkAnalysis){report.linkAnalysis.attribution={status:'request_failed',summary:'联网请求未完成或结果未收到，无法确认检索是否完成；以下没有归属检索结论。',sources:[]};engine.finalizeReport(report);}
        }
      } else {
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      }
      if(controller.signal.aborted)return;
      state.history.unshift(report); state.history=state.history.slice(0,20); $('historyCount').textContent=state.history.length;
      renderReport(report);
      if(matchMedia('(max-width:760px)').matches) $('resultPanel').scrollIntoView({block:'start'});
    } finally {
      if(state.request===controller){state.request=null;setBusy(false);}
    }
  }
  async function recognizeImage() {
    if(state.request||state.imageLoading||!state.image)return;
    inputError('');
    if(state.analysisMode!=='cloud'||!state.vision){inputError('识图需选择已启用视觉能力的云端模型；也可手动填写截图文字。');return;}
    if(!$('imageConsent').checked){inputError('请先遮盖个人信息，并勾选云端识图授权。');return;}
    if($('imageNote').value.trim()&&!window.confirm('重新识别会替换当前截图文字，是否继续？'))return;
    imageTextChanged();const version=state.imageVersion,controller=new AbortController();state.request=controller;setBusy(true);
    $('loadingLabel').textContent='正在识别截图文字';$('loadingDescription').textContent='本步骤不进行风险判断';
    $('imageRecognitionStatus').textContent='正在识别，尚未进行风险分析。';
    try {
      const response=await fetch('/api/transcribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'image',text:'',image:state.image,imageConsent:true}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(40000)])});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'识别服务暂不可用，请重试或手动填写。');
      if(data.status!=='needs_review'||typeof data.text!=='string'||!data.text.trim()||data.text.length>8000)throw new Error('识别结果无效，请重试或手动填写。');
      if(controller.signal.aborted||version!==state.imageVersion)return;
      $('imageNote').value=engine.redact(data.text);imageTextChanged();
      $('imageRecognitionStatus').textContent='文字已识别，尚未分析风险；请对照原图检查，常见敏感字段已遮盖。';
      $('recognizeLabel').textContent='重新识别文字';
    } catch(error) {
      if(controller.signal.aborted||version!==state.imageVersion)return;
      $('imageRecognitionStatus').textContent='识别未完成，尚未进行风险分析；可重试或手动填写。';
      inputError(error.name==='TimeoutError'?'识别请求超时，请重试或手动填写。':error instanceof TypeError?'无法连接识别服务，请重试或手动填写。':error.message);
    } finally {
      if(state.request===controller){state.request=null;setBusy(false);$('imageNote').focus();}
    }
  }
  async function upload(file) {
    if(!file||state.request)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)){inputError('请使用 PNG、JPG 或 WebP 图片。');return;}
    if(file.size>3*1024*1024){inputError('图片超过 3 MB，请压缩后重试。');return;}
    inputError(''); const version=++state.imageVersion;state.imageLoading=true; $('analyzeBtn').disabled=true;$('recognizeBtn').disabled=true;
    try {
      const bitmap=await createImageBitmap(file);
      if(version!==state.imageVersion){bitmap.close();return;}
      const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
      const canvas=document.createElement('canvas'); canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
      state.image=canvas.toDataURL('image/jpeg',.86); $('imagePreview').src=state.image; $('imagePreviewWrap').hidden=false; $('uploadZone').hidden=true; $('imageConsent').checked=false;
      $('imageNote').value='';imageTextChanged();$('recognizeLabel').textContent='识别图片文字';
      $('imageRecognitionStatus').textContent=state.analysisMode==='cloud'&&state.vision?'截图已就绪，尚未识别文字。':'本地或无视觉能力模式，请手动填写截图文字。';updateModeStatus();
    } catch { inputError('无法读取这张图片，请换一张有效截图。'); }
    finally {if(version===state.imageVersion){state.imageLoading=false;$('analyzeBtn').disabled=Boolean(state.request);updateModeStatus();}}
  }
  function renderCases() {
    const query=$('caseSearch').value.trim().toLowerCase(), filter=$('caseFilter').value;
    const cases=library.cases.filter(item=>(filter==='all'||item.expected===filter)&&`${item.title}${item.category}${item.text}`.toLowerCase().includes(query));
    $('caseList').innerHTML=cases.map(item=>`<article class="case-card"><div class="case-top">${icon(item.icon)}<span class="badge ${item.expected}">${engine.levels[item.expected].label}样本</span></div><h2>${escape(item.title)}</h2><p>${escape(item.text)}</p><button class="text-btn" data-case="${item.id}">载入工作台 ${icon('arrow-right')}</button></article>`).join('')||`<p class="list-empty">${icon('search-x')}没有匹配的案例</p>`; icons();
  }
  function renderKnowledge() {
    const query=$('knowledgeSearch').value.trim().toLowerCase();
    const entries=library.entries.filter(entry=>`${entry.title}${entry.category}${entry.summary}${entry.keywords.join(' ')}${entry.source}${entry.sourceTitle||''}`.toLowerCase().includes(query));
    $('knowledgeList').innerHTML=entries.map(entry=>`<article class="knowledge-item"><div><h2>${escape(entry.title)}</h2><span class="knowledge-tag">${escape(entry.category)}</span></div><div><p>${escape(entry.summary)}</p>${knowledgeSource(entry)}<small>${escape(entry.note)}</small></div></article>`).join('')||'<p class="list-empty">没有匹配的知识条目</p>';icons();
  }
  function renderHistory() {
    $('clearHistoryBtn').disabled=!state.history.length;
    $('historyList').innerHTML=state.history.map(report=>`<article class="history-item"><span class="badge ${report.level}">${report.label}</span><div><h2>${escape(report.title)}</h2><p>${date(report.createdAt)} · ${escape(report.sourceLabel)} · ${report.evidence.length} 项证据</p></div><button class="text-btn" data-history="${escape(report.id)}">查看 ${icon('arrow-right')}</button></article>`).join('')||`<p class="list-empty">${icon('history')}本次会话还没有分析记录</p>`;icons();
  }
  function download(format) {
    if(!state.report)return;
    const content=format==='json'?JSON.stringify(state.report,null,2):engine.toMarkdown(state.report);
    const blob=new Blob([content],{type:format==='json'?'application/json;charset=utf-8':'text/markdown;charset=utf-8'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a');a.href=url;a.download=`CrediLens-${state.report.id.slice(0,8)}.${format==='json'?'json':'md'}`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);toast('已导出脱敏报告');
  }
  async function checkServer() {
    if(location.protocol==='file:'){ $('serverStatus').textContent='当前直接打开本地文件。如需云端模型，请先启动项目服务。';$('startupStatus').textContent=$('serverStatus').textContent;return; }
    try {
      const response=await fetch('/api/status',{signal:AbortSignal.timeout(3000)});if(!response.ok)throw new Error('status_unavailable');
      const status=await response.json();state.configured=Boolean(status.configured);state.vision=Boolean(status.vision);$('cloudOption').disabled=!status.configured;
      state.searchConfigured=Boolean(status.searchConfigured);
      $('cloudOption').textContent=status.configured?'云端模型 + 本地证据校验':'云端模型（未配置）';
      $('serverStatus').textContent=status.configured?`模型服务已配置：${status.model}，${status.vision?'已启用识图':'未启用识图'}。选择云端模式后才会发送输入。`:'服务已启动，尚未配置模型。本地分析可正常使用。';
    }catch{ $('serverStatus').textContent='未连接模型后端，本地分析可正常使用。'; }
    finally { $('startupCloud').disabled=!state.configured;$('startupStatus').textContent=$('serverStatus').textContent;updateSearchStatus(); }
  }
  function applyAnalysisMode(mode) {
    state.analysisMode=mode==='cloud'&&state.configured?'cloud':'local';
    $('searchConsent').checked=false;
    $('imageConsent').checked=false;updateModeStatus();
  }
  let startupClosing=false;
  async function enterWorkbench(mode) {
    if(startupClosing)return;
    startupClosing=true;applyAnalysisMode(mode);
    const dialog=$('startupDialog');dialog.classList.add('is-closing');
    await Promise.allSettled(dialog.getAnimations().map(animation=>animation.finished));
    dialog.close();dialog.classList.remove('is-closing');startupClosing=false;$(`tab-${state.mode}`).focus();
  }
  $('startupForm').addEventListener('submit',event=>{event.preventDefault();enterWorkbench($('startupCloud').checked?'cloud':'local');});
  $('closeStartupBtn').addEventListener('click',()=>enterWorkbench('local'));
  $('startupDialog').addEventListener('cancel',event=>{event.preventDefault();enterWorkbench('local');});
  $('analysisForm').addEventListener('submit',runAnalysis);
  $('resetBtn').addEventListener('click',reset); $('cancelBtn').addEventListener('click',()=>{cancelRequest();if(state.mode==='image')$('imageRecognitionStatus').textContent='请求已取消，可重试或修改文字；尚未生成新的风险报告。';toast('已取消请求');});
  document.querySelectorAll('[data-mode]').forEach(el=>{
    el.addEventListener('click',()=>setMode(el.dataset.mode));
    el.addEventListener('keydown',event=>{const tabs=['text','link','image'];let index=tabs.indexOf(state.mode);if(event.key==='ArrowRight')index=(index+1)%3;else if(event.key==='ArrowLeft')index=(index+2)%3;else if(event.key==='Home')index=0;else if(event.key==='End')index=2;else return;event.preventDefault();setMode(tabs[index],true);});
  });
  $('message').addEventListener('input',()=>{$('charCount').textContent=`${$('message').value.length.toLocaleString()} / 8,000`;inputError('');clearReport();});
  ['linkInput','linkContext'].forEach(id=>$(id).addEventListener('input',()=>{$('searchConsent').checked=false;inputError('');clearReport();}));
  $('searchConsent').addEventListener('change',()=>{inputError('');clearReport();});
  document.addEventListener('click',event=>{
    const sample=event.target.closest('[data-case]');if(sample)useCase(sample.dataset.case);
    const history=event.target.closest('[data-history]');if(history){cancelRequest();const report=state.history.find(r=>r.id===history.dataset.history);if(report){clearImage();setMode(report.mode);$('background').value=report.background||'';$('backgroundCount').textContent=`${$('background').value.length.toLocaleString()} / 1,000`;if(report.mode==='link'){$('linkInput').value=report.url?.href||'';$('linkContext').value=report.original.split('\n').slice(1).join('\n');}else $(report.mode==='image'?'imageNote':'message').value=report.original;if(report.mode==='image')imageTextChanged();$('charCount').textContent=`${$('message').value.length.toLocaleString()} / 8,000`;renderReport(report);if(report.mode==='image')$('imageRecognitionStatus').textContent='已恢复报告文字，未保存原图；重新分析前需再次确认。';location.hash='workbench';}}
    const evidence=event.target.closest('[data-quote-index]');if(evidence)setReportTab('original',state.report.evidence[Number(evidence.dataset.quoteIndex)].quote);
    const tab=event.target.closest('[data-report-tab]');if(tab)setReportTab(tab.dataset.reportTab);
    const quiz=event.target.closest('[data-quiz-index]');if(quiz){const index=Number(quiz.dataset.quizIndex);document.querySelectorAll('[data-quiz-index]').forEach(btn=>{btn.classList.remove('correct','incorrect');btn.setAttribute('aria-pressed',String(btn===quiz));});quiz.classList.add(index===state.report.quiz.correct?'correct':'incorrect');$('quizFeedback').hidden=false;$('quizFeedback').textContent=(index===state.report.quiz.correct?'判断正确。':'再核对一下。')+state.report.quiz.explanation;}
  });
  $('actionList').addEventListener('change',event=>{const index=Number(event.target.dataset.actionIndex);if(!Number.isInteger(index)||!state.report)return;state.report.checkedActions=event.target.checked?[...new Set([...state.report.checkedActions,index])]:state.report.checkedActions.filter(i=>i!==index);updateActionProgress();});
  $('imageFile').addEventListener('change',event=>upload(event.target.files[0]));$('removeImageBtn').addEventListener('click',()=>{clearImage();clearReport();});
  $('recognizeBtn').addEventListener('click',recognizeImage);
  function setImageSize(natural) {
    $('imageDetailViewport').classList.toggle('natural-size',natural);$('imageSizeBtn').setAttribute('aria-pressed',String(natural));
    const label=natural?'适应窗口':'按实际像素查看';$('imageSizeBtn').setAttribute('aria-label',label);$('imageSizeBtn').title=label;
    $('imageSizeBtn').innerHTML=icon(natural?'shrink':'zoom-in');icons();
  }
  $('zoomImageBtn').addEventListener('click',()=>{if(state.image){setImageSize(false);$('imageDetail').src=state.image;$('imageDialog').showModal();$('imageDetailViewport').scrollTo(0,0);}});
  $('imageSizeBtn').addEventListener('click',()=>setImageSize($('imageSizeBtn').getAttribute('aria-pressed')!=='true'));
  $('closeImageDialogBtn').addEventListener('click',()=>$('imageDialog').close());
  $('imageNote').addEventListener('input',()=>{imageTextChanged();inputError('');$('imageRecognitionStatus').textContent='文字已修改，请对照原图重新确认。';});
  $('background').addEventListener('input',()=>{clearReport();inputError('');$('backgroundCount').textContent=`${$('background').value.length.toLocaleString()} / 1,000`;if(state.mode==='image')$('imageRecognitionStatus').textContent='补充背景已修改，需重新分析；截图文字确认状态不变。';});
  $('imageTextConfirmed').addEventListener('change',()=>{inputError('');clearReport();});
  $('uploadZone').addEventListener('dragover',event=>{event.preventDefault();$('uploadZone').classList.add('dragging');});$('uploadZone').addEventListener('dragleave',()=>$('uploadZone').classList.remove('dragging'));
  $('uploadZone').addEventListener('drop',event=>{event.preventDefault();$('uploadZone').classList.remove('dragging');upload(event.dataTransfer.files[0]);});
  $('caseSearch').addEventListener('input',renderCases);$('caseFilter').addEventListener('change',renderCases);$('knowledgeSearch').addEventListener('input',renderKnowledge);
  $('clearHistoryBtn').addEventListener('click',()=>{state.history=[];$('historyCount').textContent='0';renderHistory();toast('会话记录已清空');});
  $('copyBtn').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(engine.toMarkdown(state.report));toast('已复制脱敏报告');}catch{toast('无法访问剪贴板，请使用下载报告');}});
  $('exportBtn').addEventListener('click',()=>download('md'));$('jsonBtn').addEventListener('click',()=>download('json'));
  $('settingsBtn').addEventListener('click',()=>{$('analysisMode').value=state.analysisMode;$('settingsDialog').showModal();});
  $('closeSettingsBtn').addEventListener('click',()=>$('settingsDialog').close());
  $('saveSettingsBtn').addEventListener('click',()=>{applyAnalysisMode($('analysisMode').value);$('settingsDialog').close();});
  window.addEventListener('hashchange',route);
  $('quickSamples').innerHTML=library.cases.slice(0,3).map(item=>`<button type="button" class="sample-btn" data-case="${item.id}"><span class="sample-symbol">${icon(item.icon)}</span><span><strong>${escape(item.title)}</strong><small>${escape(item.category)}</small></span>${icon('arrow-up-right')}</button>`).join('');
  $('caseCount').textContent=library.cases.length;renderCases();renderKnowledge();route();icons();$('startupDialog').showModal();checkServer();
})();
