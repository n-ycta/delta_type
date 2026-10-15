import {metricsQuery} from './query.mjs';
import {wordList,normalizeWord} from './words.mjs';
import {InputAccess,accessNotice} from './input-access.mjs';
import {BackgroundCollector} from './background.mjs';
import {defaultSettings,parseSettings,noticesFor} from './settings.mjs';
import {createServer} from 'node:http';import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';import {resolve} from 'node:path';import {DeltaClient,DeltaError,servePlugin} from './delta-sdk.mjs';import {Session,aggregate,recordsFor} from './aggregate.mjs';import {Outbox} from './outbox.mjs';
const client=new DeltaClient(),dir=resolve(process.env.DATA_DIR||process.env.DELTA_DATA||'data');await mkdir(dir,{recursive:true,mode:0o700});
const outbox=new Outbox(resolve(dir,'outbox.json'));await outbox.load();let settings={...defaultSettings,storageComponent:process.env.STORAGE_COMPONENT||defaultSettings.storageComponent,storageNode:process.env.STORAGE_NODE||''};try{const stored=JSON.parse(await readFile(resolve(dir,'settings.json'),'utf8'));settings={...settings,...stored};if(stored.recordWords===undefined&&stored.language==='unknown')settings.language='auto'}catch(e){if(e.code!=='ENOENT')throw e}
let trainerState='starting',changingSettings=false,storageState={state:'starting'},lastRetention=0;
const flushStorage=async()=>{try{await client.call(settings.storageComponent+'.health',{},settings.storageNode||undefined);const sent=await outbox.flush(client,settings.storageComponent,settings.storageNode||undefined);storageState={state:'connected',lastSyncAt:sent.sent?Date.now():storageState.lastSyncAt};}catch(e){storageState={state:'unavailable',reason:e.code||e.name};throw e;}};
async function maintainWords(){if(Date.now()-lastRetention<3600000)return;await client.call(settings.storageComponent+'.delete',{source:'dev.delta.type',metric:'word_frequency',from:0,to:Date.now()-settings.wordRetentionDays*86400000},settings.storageNode||undefined);lastRetention=Date.now();}
const manifest=JSON.parse(await readFile(new URL('../manifest.json',import.meta.url),'utf8'));
async function acceptSession(session){const parsed=Session.safeParse(session);if(!parsed.success)throw new DeltaError('bad_request','Expected an aggregate session, never text');if(parsed.data.words?.length&&!settings.recordWords)throw new DeltaError('forbidden','Word collection is disabled');
 const excluded=wordList(settings.excludedWords);if(parsed.data.words)parsed.data.words=parsed.data.words.filter(w=>!excluded.has(normalizeWord(w.word)));const accepted=await outbox.add(parsed.data.id,recordsFor(parsed.data).map(r=>({...r,node:process.env.DELTA_NODE_ID||r.node,dimensions:{...r.dimensions,node:process.env.DELTA_NODE_ID||r.node}})));return {accepted,metrics:aggregate(parsed.data),pending:outbox.records.length}}
const collector=new BackgroundCollector({getSettings:()=>settings,dir,onSession:acceptSession});
const inputAccess=new InputAccess({onGranted:()=>{collector.lastScan=0},onRevoked:()=>{collector.lastScan=0;collector.native.close();collector.words.reset();void collector.closeDevices().catch(()=>{})}});
const handlers={
 'typing.ingest':async({session})=>{if(!settings.enabled)throw new DeltaError('conflict','Collection paused');return acceptSession(session)},
 'typing.status':async()=>({enabled:settings.enabled,pending:outbox.records.length,settings,storage:{...storageState,component:settings.storageComponent,node:settings.storageNode||null},activity:{eventsPerMin:collector.activity.inputTimes.filter(t=>t>Date.now()-60000).length,rateLabel:{ru:'нажатий/мин',en:'keystrokes/min'},lastInputAt:collector.activity.lastAt,lastSyncAt:storageState.lastSyncAt},inputAccess:inputAccess.status(),collector:collector.status(),trainer:trainerState,notices:[...accessNotice(inputAccess),...(storageState.state==='unavailable'?[{id:'type.storage',severity:'warn',message:'Storage unavailable; queued statistics will be retried.',localizations:{ru:'Хранилище недоступно. Статистика остаётся в очереди и будет отправлена повторно.'}}]:[]),...noticesFor(collector.status(),settings).filter(n=>inputAccess.status().state!=='pending'||n.id!=='type.background'),...(trainerState==='unavailable'?[{id:'type.trainer',severity:'warn',message:'Trainer HTTP server unavailable. Check Type logs; background collection is independent.',localizations:{ru:'HTTP-сервер тренажёра недоступен. Проверьте журнал Type; фоновый сбор работает независимо.'}}]:[])]}),
 'typing.settings':async({values})=>{if(values===undefined)return settings;if(changingSettings)throw new DeltaError('conflict','Settings update in progress');changingSettings=true;try{const next=parseSettings(values,settings);if(next.storageComponent!==settings.storageComponent||next.storageNode!==settings.storageNode){await collector.flush();await flushStorage();const health=await client.call(next.storageComponent+'.health',{},next.storageNode||undefined);if(!String(health.contract).startsWith('1.'))throw new DeltaError('bad_request','Compatible storage contract 1.x required');await client.call(next.storageComponent+'.aggregate',{source:'dev.delta.type',metric:'keystrokes',from:0,to:Date.now(),limit:1},next.storageNode||undefined);}
 await collector.flush();await writeFile(resolve(dir,'settings.json.tmp'),JSON.stringify(next),{mode:0o600});await rename(resolve(dir,'settings.json.tmp'),resolve(dir,'settings.json'));if(settings.recordWords&&!next.recordWords){collector.words.reset();collector.native.close();}settings=next;lastRetention=0;return settings}finally{changingSettings=false;}},
 'typing.flush':async()=>flushStorage(),
 'typing.metrics_query':async({query})=>metricsQuery(client,settings,query),
 'typing.clear_words':async()=>{collector.words.reset();await collector.flush();await flushStorage();return client.call(settings.storageComponent+'.delete',{source:'dev.delta.type',metric:'word_frequency',from:0,to:Date.now()+1},settings.storageNode||undefined)},
 'typing.request_input_access':async({_locale})=>inputAccess.request('grant',_locale),
 'typing.revoke_input_access':async({_locale})=>inputAccess.request('revoke',_locale),
 'typing.clear_history':async()=>{await collector.clearHistory();return {cleared:true}}
};
const interval=setInterval(()=>flushStorage().then(maintainWords).catch(e=>console.error('Storage unavailable; durable queue retained:',e.code||e.name)),10000);interval.unref();
const controller=new AbortController();for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>controller.abort());
// Local opt-in trainer. POST requests still authenticate through Delta using the user's token.
const server=createServer(async(req,res)=>{
 try{
  if(req.method==='GET'&&req.url==='/options'){res.setHeader('content-type','application/json');res.end(JSON.stringify({recordWords:settings.recordWords,idleThresholdMs:settings.idleThresholdMs,excludeIdle:settings.excludeIdle}));return}
  if(req.method==='GET'&&req.url==='/'){res.setHeader('content-type','text/html; charset=utf-8');res.end(await readFile(new URL('../public/index.html',import.meta.url)));return}
  if(req.method==='GET'&&['/ru.json','/en.json'].includes(req.url)){res.setHeader('content-type','application/json');res.end(await readFile(new URL('../locales/'+req.url.slice(1),import.meta.url)));return}
  if(req.method!=='POST'||req.url!=='/sessions'){res.writeHead(404);res.end();return}
  if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)throw new DeltaError('forbidden','Origin rejected');
  const token=req.headers.authorization?.replace(/^Bearer /,'');if(!token)throw new DeltaError('unauthorized','User token required');let body='',size=0;for await(const chunk of req){size+=chunk.length;if(size>65536)throw new DeltaError('bad_request','Body too large');body+=chunk;}
  const user=new DeltaClient(client.url,token);const result=await user.call('typing.ingest',{session:JSON.parse(body)});res.setHeader('content-type','application/json');res.end(JSON.stringify(result));
 }catch(e){res.writeHead(e.code==='forbidden'?403:e.code==='unauthorized'?401:e.code==='bad_request'?400:503,{'content-type':'application/json'});res.end(JSON.stringify({error:e.code||'unavailable'}))}
});server.on('error',e=>{trainerState='unavailable';console.error('Trainer unavailable:',e.code||e.name)});server.on('listening',()=>{trainerState='listening'});server.listen(Number(process.env.PORT||7720),'127.0.0.1');
await collector.start();
await servePlugin(client,manifest,handlers,{signal:controller.signal});clearInterval(interval);inputAccess.close();await collector.close();await flushStorage().catch(()=>{});server.close();
