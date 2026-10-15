import {readFileSync} from 'node:fs';
const ru=JSON.parse(readFileSync(new URL('./locales/en.json',import.meta.url)));
// Delta v1 external-component SDK. No dependency on the core source tree.
export class DeltaError extends Error {
 constructor(code, message) { super(message); this.code = code; }
}
export class DeltaClient {
 constructor(url = process.env.DELTA_URL || 'http://127.0.0.1:7700', token = process.env.DELTA_TOKEN) {
  this.url = url.replace(/\/$/, '').replace(/\/v1$/, ''); this.token = token;
  if (!token) throw new Error(ru.sdkMissingToken);
 }
 async request(method, path, body, timeout = 35000) {
  const response = await fetch(this.url + '/v1' + path, { method, headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  const envelope = await response.json();
  if (!response.ok || !envelope.ok) throw new DeltaError(envelope.error?.code || 'unavailable', envelope.error?.message || `HTTP ${response.status}`);
  return envelope.result;
 }
 call(capability, args = {}, node) { return this.request('POST', '/call', { capability, args, ...(node ? {node} : {}) }); }
}
export function allowed(caller, capability) {
 if (caller?.scopes?.includes('admin')) return true;
 return (caller?.scopes || []).some(s => (s.startsWith('call:') || s.startsWith('admin:')) && new RegExp('^'+s.slice(s.startsWith('admin:')?6:5).split('*').map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*')+'$').test(capability));
}
export async function servePlugin(client, manifest, handlers, {signal} = {}) {
 let session;
 while (!signal?.aborted) {
  try {
   if (!session) session = (await client.request('POST', '/components', manifest)).session;
   const { invocation } = await client.request('GET', `/components/${manifest.id}/next?session=${encodeURIComponent(session)}&timeout=20`);
   if (!invocation) continue;
   // Do not serialize invocations: handlers may issue further Delta calls.
   void (async () => {
    let result;
    try {
     const handler = handlers[invocation.capability];
     if (!handler) throw new DeltaError('not_found', ru.sdkUnknownCapability);
     result = {ok:true, result:await handler(invocation.args, invocation.caller)};
    } catch(e) { result = {ok:false, error:{code:e.code || 'handler_error', message:e.code ? e.message : ru.sdkHandlerFailure}}; if (!e.code) console.error('Plugin handler failed:', e.message); }
    try { await client.request('POST', `/components/${manifest.id}/result`, {session,id:invocation.id,...result}); } catch(e) { console.error('Result delivery failed:',e.code || e.name); }
   })();
  } catch(e) { console.error('Delta reconnect:', e.code || e.name); session = undefined; await new Promise(r=>setTimeout(r,2000)); }
 }
 if (session) await client.request('DELETE',`/components/${manifest.id}?session=${encodeURIComponent(session)}`).catch(()=>{});
}
