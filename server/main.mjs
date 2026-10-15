import {createServer} from 'node:http';import {readFile,mkdir,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';import {DeltaClient,DeltaError,servePlugin} from './delta-sdk.mjs';import {Session,aggregate,recordsFor} from './aggregate.mjs';import {Outbox} from './outbox.mjs';
const client=new DeltaClient(),storage=process.env.STORAGE_COMPONENT||'storage',dir=resolve(process.env.DATA_DIR||'data');await mkdir(dir,{recursive:true,mode:0o700});
const outbox=new Outbox(resolve(dir,'outbox.json'));await outbox.load();let settings={enabled:true};try{settings=JSON.parse(await readFile(resolve(dir,'settings.json'),'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
const manifest=JSON.parse(await readFile(new URL('../manifest.json',import.meta.url),'utf8'));
const handlers={
 'typing.ingest':async({session})=>{if(!settings.enabled)throw new DeltaError('conflict','Collection paused');const parsed=Session.safeParse(session);if(!parsed.success)throw new DeltaError('bad_request','Expected an aggregate session, never text');const accepted=await outbox.add(parsed.data.id,recordsFor(parsed.data));return {accepted,metrics:aggregate(parsed.data),pending:outbox.records.length}},
 'typing.status':async()=>({enabled:settings.enabled,pending:outbox.records.length,collection:'opt-in-aggregate-only'}),
 'typing.settings':async({values})=>{if(typeof values?.enabled!=='boolean')throw new DeltaError('bad_request','enabled must be boolean');settings={enabled:values.enabled};await writeFile(resolve(dir,'settings.json'),JSON.stringify(settings),{mode:0o600});return settings},
 'typing.flush':async()=>outbox.flush(client,storage)
};
const interval=setInterval(()=>outbox.flush(client,storage).catch(e=>console.error('Storage unavailable; durable queue retained:',e.code||e.name)),10000);interval.unref();
const controller=new AbortController();for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>controller.abort());
// Local opt-in trainer. POST requests still authenticate through Delta using the user's token.
const server=createServer(async(req,res)=>{
 try{
  if(req.method==='GET'&&req.url==='/'){res.setHeader('content-type','text/html; charset=utf-8');res.end(await readFile(new URL('../public/index.html',import.meta.url)));return}
  if(req.method==='GET'&&req.url==='/ru.json'){res.setHeader('content-type','application/json');res.end(await readFile(new URL('../locales/ru.json',import.meta.url)));return}
  if(req.method!=='POST'||req.url!=='/sessions'){res.writeHead(404);res.end();return}
  if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)throw new DeltaError('forbidden','Origin rejected');
  const token=req.headers.authorization?.replace(/^Bearer /,'');if(!token)throw new DeltaError('unauthorized','User token required');let body='',size=0;for await(const chunk of req){size+=chunk.length;if(size>8192)throw new DeltaError('bad_request','Body too large');body+=chunk;}
  const user=new DeltaClient(client.url,token);const result=await user.call('typing.ingest',{session:JSON.parse(body)});res.setHeader('content-type','application/json');res.end(JSON.stringify(result));
 }catch(e){res.writeHead(e.code==='forbidden'?403:e.code==='unauthorized'?401:e.code==='bad_request'?400:503,{'content-type':'application/json'});res.end(JSON.stringify({error:e.code||'unavailable'}))}
});server.listen(Number(process.env.PORT||7720),'127.0.0.1');
await servePlugin(client,manifest,handlers,{signal:controller.signal});clearInterval(interval);server.close();
