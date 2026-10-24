'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {getConfig,analyzeWithModel,transcribeImage}=require('./model.js');
const engine=require('./engine.js');
const {getSearchConfig,searchAttribution}=require('./search.js');
const ROOT=__dirname;
const MAX_BODY=5*1024*1024;
const PUBLIC_FILES=new Map([
  ['/','index.html'],['/index.html','index.html'],['/styles.css','styles.css'],['/app.js','app.js'],
  ['/engine.js','engine.js'],['/knowledge.js','knowledge.js'],['/assets/brand.svg','assets/brand.svg'],['/assets/icons.js','assets/icons.js']
]);
const TYPES={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
function validateInput(data,vision,purpose='analysis') {
  if(!data||typeof data!=='object'||!['text','link','image'].includes(data.mode))throw new Error('请选择有效输入类型。');
  if(typeof data.text!=='string'||data.text.length>8000)throw new Error('文字内容必须为不超过 8,000 字符的文本。');
  const input={mode:data.mode,text:engine.redact(data.text.trim())};
  if(data.searchConsent!==undefined) {
    if(typeof data.searchConsent!=='boolean'||data.searchConsent&&data.mode!=='link')throw new Error('联网检索仅适用于链接，需要单独授权。');
    if(purpose==='analysis')input.searchConsent=data.searchConsent;
  }
  if(data.background!==undefined) {
    if(typeof data.background!=='string'||data.background.length>1000)throw new Error('补充背景不能超过 1,000 字符。');
    if(purpose==='analysis')input.background=engine.redact(data.background.trim());
  }
  if(data.mode==='link'){if(typeof data.url!=='string')throw new Error('请提供有效链接。');engine.parseUrl(data.url);input.url=engine.redact(data.url);}
  if(data.image!==undefined) {
    if(purpose!=='transcription')throw new Error('请先识别并确认截图文字，再提交文字分析。');
    if(data.mode!=='image'||data.imageConsent!==true)throw new Error('截图云端识别需要单独授权。');
    if(typeof data.image!=='string'||data.image.length>4.2*1024*1024||!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(data.image))throw new Error('截图格式或大小无效。');
    const buffer=Buffer.from(data.image.slice(data.image.indexOf(',')+1),'base64');
    const valid=buffer.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff]))||buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||(buffer.subarray(0,4).toString()==='RIFF'&&buffer.subarray(8,12).toString()==='WEBP');
    if(!valid||buffer.length>3*1024*1024)throw new Error('截图文件无效或超过 3 MB。');
    input.image=data.image;
  }
  if(purpose==='transcription'&&(input.mode!=='image'||!input.image))throw new Error('请选择待识别的截图。');
  if(purpose==='analysis'&&input.mode==='image') {
    if(data.imageTextConfirmed!==true||!input.text)throw new Error('请填写并确认截图文字。');
    input.imageTextConfirmed=true;
  }
  if(!input.text&&!input.url&&!input.image&&!input.background)throw new Error('请提供待分析内容。');
  return input;
}
async function readBody(req) {
  let size=0;const parts=[];
  for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY){const error=new Error('请求内容过大。');error.status=413;throw error;}parts.push(chunk);}
  try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new Error('请求必须为有效 JSON。');}
}
function createServer(config=getConfig(),options={}) {
  const searchConfig=options.searchConfig||getSearchConfig();
  const rate=new Map();let active=0;
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    const localHosts=new Set(['127.0.0.1','localhost','[::1]']);
    let host;try{host=new URL(`http://${req.headers.host}`).hostname;}catch{return json(res,400,{error:'无效主机。'});}
    if(!localHosts.has(host))return json(res,403,{error:'该服务仅接受本机访问。'});
    let pathname;
    try{pathname=new URL(req.url,`http://${req.headers.host}`).pathname;}catch{return json(res,400,{error:'请求地址无效。'});}
    if(pathname==='/api/status'&&req.method==='GET')return json(res,200,{version:engine.VERSION,configured:config.configured,model:config.configured?config.model:null,vision:config.vision,searchConfigured:searchConfig.configured,searchProvider:searchConfig.configured?'Tavily':null});
    if(pathname==='/api/analyze'||pathname==='/api/transcribe') {
      const transcription=pathname==='/api/transcribe';
      if(req.method!=='POST')return json(res,405,{error:'请使用 POST 请求。'});
      if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return json(res,403,{error:'拒绝跨来源请求。'});
      if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))return json(res,415,{error:'请发送 application/json。'});
      const key=req.socket.remoteAddress;const now=Date.now();
      if(rate.size>1000)for(const [ip,item]of rate)if(now-item.start>60000)rate.delete(ip);
      let quota=rate.get(key);if(!quota||now-quota.start>60000){quota={start:now,count:0};rate.set(key,quota);}
      if(++quota.count>20)return json(res,429,{error:'请求较多，请一分钟后再试。'});
      if(active>=3)return json(res,429,{error:'当前分析任务较多，请稍后再试。'});
      const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
      active++;
      try {
        const data=await readBody(req);const input=validateInput(data,config.vision,transcription?'transcription':'analysis');
        const modelOptions={...options,signal:controller.signal};
        const [report,attribution]=await Promise.all([
          transcription?transcribeImage(input,config,modelOptions):analyzeWithModel(input,config,modelOptions),
          !transcription&&input.mode==='link'&&input.searchConsent===true?searchAttribution(engine.parseUrl(input.url).host,searchConfig,modelOptions):null
        ]);
        if(attribution&&report.linkAnalysis){report.linkAnalysis.attribution=attribution;engine.finalizeReport(report);}
        if(!res.destroyed)json(res,200,report);
      }catch(error){
        const messages={not_configured:'尚未配置模型，请手动填写截图文字。',vision_disabled:'模型未启用识图，请手动填写截图文字。',timeout:'识别超时，请重试或手动填写文字。',unreadable_image:'未识别到可读文字，请换清晰图片或手动填写。',truncated_output:'识别结果未完整返回，请裁剪图片后重试。',oversize_output:'图片文字过长，请裁剪图片后重试。',invalid_output:'识别结果格式无效，请重试或手动填写。',provider_error:'识别服务返回错误，请稍后重试。',unavailable:'识别服务暂不可用，请重试或手动填写。'};
        if(!res.destroyed)json(res,error.status||(error.code?503:400),{error:controller.signal.aborted?'请求已取消':messages[error.code]|| (error.message==='请求内容过大。'?error.message:'输入无效，请检查内容、链接、图片授权与文字确认。')});
      }
      finally{active--;}
      return;
    }
    if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'不支持的请求方法。'});
    const file=PUBLIC_FILES.get(pathname);if(!file)return json(res,404,{error:'未找到资源。'});
    const content=await fs.promises.readFile(path.join(ROOT,file)).catch(()=>null);if(!content)return json(res,404,{error:'未找到资源。'});
    res.writeHead(200,{'Content-Type':TYPES[path.extname(file)],'Content-Length':content.length});res.end(req.method==='HEAD'?undefined:content);
  });
  server.requestTimeout=35000;server.headersTimeout=10000;
  return server;
}
if(require.main===module) {
  if(fs.existsSync(path.join(ROOT,'.env')))process.loadEnvFile(path.join(ROOT,'.env'));
  let config;try{config=getConfig();}catch(error){console.error(error.message);process.exit(1);}
  const requested=Number(process.env.PORT||process.argv[2]||5173);
  if(!Number.isInteger(requested)||requested<1024||requested>65535){console.error('端口须为 1024 到 65535 的整数。');process.exit(1);}
  let port=requested;
  const server=createServer(config);
  server.on('error',error=>{if(error.code==='EADDRINUSE'&&port<requested+10){port++;server.listen(port,'127.0.0.1');}else{console.error('服务启动失败：'+error.code);process.exitCode=1;}});
  server.on('listening',()=>console.log(`CrediLens ${engine.VERSION}: http://127.0.0.1:${port} (${config.configured?'模型已配置':'本地模式'})`));
  server.listen(port,'127.0.0.1');
}
module.exports={createServer,validateInput};
