'use strict';
const {isIP}=require('node:net');
const engine=require('./engine.js');

const ENDPOINT='https://api.tavily.com/search';
function getSearchConfig(env=process.env) {
  const key=env.TAVILY_API_KEY?.trim();
  return {configured:Boolean(key),key};
}
function publicHost(host) {
  const value=host.toLowerCase().replace(/\.$/,'');
  if(isIP(value.replace(/^\[|\]$/g,''))||value.length>253||!value.includes('.'))return false;
  if(!value.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)))return false;
  return !/(?:^|\.)(?:localhost|local|internal|invalid|test|example|onion|home\.arpa|example\.(?:com|org|net))$/i.test(value);
}
function safeSourceUrl(value) {
  if(typeof value!=='string'||value.length>2048)return null;
  try {
    const parsed=new URL(value);
    if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.port||!publicHost(parsed.hostname))return null;
    // Keep page-identifying parameters intact; never turn a query-based source into a different page.
    for(const key of [...parsed.searchParams.keys()]) {
      if(/^(?:utm_.*|gclid|fbclid|msclkid|tracking)$/i.test(key)){parsed.searchParams.delete(key);continue;}
      if(/token|secret|password|auth|session|api[_-]?key|^(?:key|code|email|phone|mobile|idcard)$/i.test(key))return null;
      if(parsed.searchParams.getAll(key).some(value=>engine.redact(value)!==value))return null;
    }
    parsed.hash='';
    const decodedPath=decodeURIComponent(parsed.pathname);
    if(engine.redact(decodedPath)!==decodedPath)return null;
    return parsed.href;
  }catch{return null;}
}
async function readResults(response) {
  if(!response.body)throw new Error('invalid');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try {
    while(true) {
      const {done,value}=await reader.read();if(done)break;
      size+=value.length;
      if(size>256*1024)throw new Error('oversize');
      chunks.push(Buffer.from(value));
    }
    const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!Array.isArray(data.results))throw new Error('invalid');
    return data.results;
  }catch(error){await reader.cancel().catch(()=>{});throw error;}
  finally{reader.releaseLock();}
}
async function searchAttribution(host,config=getSearchConfig(),options={}) {
  const base={status:'not_requested',summary:'未进行联网归属检索；不会凭域名印象认定官网。',sources:[]};
  if(!config.configured)return {...base,status:'not_configured',summary:'联网检索服务未配置，尚未核实网站归属；这不是网站有问题的证据。'};
  if(!publicHost(host))return {...base,status:'unsupported_host',summary:'该地址属于 IP、本地、保留或不支持的主机名，不发送到检索服务；未核实归属。'};
  const normalized=host.toLowerCase().replace(/\.$/,'');
  const controller=new AbortController();
  const signal=options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal;
  const timer=setTimeout(()=>controller.abort(),options.searchTimeoutMs||8000);
  try {
    // Only the hostname leaves this boundary, never the path, query, message or background.
    const response=await (options.searchFetch||fetch)(ENDPOINT,{method:'POST',redirect:'error',signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.key}`},body:JSON.stringify({query:`"${normalized}" 官方网站 机构归属`,topic:'general',search_depth:'basic',max_results:5,include_answer:false,include_raw_content:false})});
    if(!response.ok){await response.body?.cancel();throw new Error('provider');}
    const results=await readResults(response);
    const sources=[],seen=new Set();
    for(const item of results.slice(0,20)) {
      if(!item||typeof item.title!=='string'||typeof item.content!=='string')continue;
      const url=safeSourceUrl(item.url);
      if(!url||seen.has(url))continue;
      // Discard off-topic results; a hostname mention is relevance, not proof of ownership.
      if(![item.url,item.title,item.content].some(value=>String(value).toLowerCase().includes(normalized)))continue;
      seen.add(url);
      sources.push({title:engine.redact(item.title).slice(0,160),url,snippet:engine.redact(item.content).slice(0,700)});
      if(sources.length===5)break;
    }
    return {status:sources.length?'sources_found':'no_results',summary:sources.length?'已找到提及该域名的公开出处线索；检索摘要可能过时或有误，尚未独立确认机构归属，不代表官网认证或安全认证。':'本次未检索到可展示的相关出处；不能据此认定网站是假冒或恶意。',provider:'Tavily',queryHost:normalized,searchedAt:new Date().toISOString(),sources};
  }catch(error) {
    if(options.signal?.aborted)throw error;
    return {...base,status:controller.signal.aborted?'timeout':'failed',summary:controller.signal.aborted?'归属检索超时，未完成核实；结构与消息分析仍可参考。':'归属检索未完成，未核实网站归属；不能把服务失败解释成网站有问题。'};
  }finally{clearTimeout(timer);}
}
module.exports={getSearchConfig,publicHost,safeSourceUrl,searchAttribution};
