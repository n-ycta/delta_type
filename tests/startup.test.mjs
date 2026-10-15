import {test} from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {spawn} from 'node:child_process';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';
test('occupied trainer port does not prevent Type registration or background status',async()=>{
 const dir=await mkdtemp(tmpdir()+'/delta-type-startup-');const occupied=createServer();await new Promise(r=>occupied.listen(0,'127.0.0.1',r));
 let resolveStatus,registered=false,delivered=false;const status=new Promise(r=>{resolveStatus=r});
 const core=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;let result={};
  if(req.method==='POST'&&req.url==='/v1/components'){registered=true;result={session:'test-session'};}
  else if(req.url.includes('/next?')){await new Promise(r=>setTimeout(r,100));if(!delivered){delivered=true;result={invocation:{id:'test-status',capability:'typing.status',args:{},caller:{scopes:['admin']}}};}else result={invocation:null};}
  else if(req.url.endsWith('/result'))resolveStatus(JSON.parse(body).result);
  res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,result}));
 });await new Promise(r=>core.listen(0,'127.0.0.1',r));
 const child=spawn(process.execPath,[new URL('../server/main.mjs',import.meta.url).pathname],{env:{...process.env,DATA_DIR:dir,DELTA_URL:'http://127.0.0.1:'+core.address().port,DELTA_TOKEN:'test-only-token',PORT:String(occupied.address().port)},stdio:'ignore'});
 const timeout=setTimeout(()=>resolveStatus(null),5000);
 try{const result=await status;assert(registered);assert(result,'Plugin must remain running');assert.equal(result.trainer,'unavailable');assert(result.notices.some(n=>n.id==='type.trainer'));assert.notEqual(result.collector.state,'starting');}
 finally{clearTimeout(timeout);const exit=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');const kill=setTimeout(()=>child.kill('SIGKILL'),1500);await exit;clearTimeout(kill);core.closeAllConnections();await new Promise(r=>core.close(r));await new Promise(r=>occupied.close(r));await rm(dir,{recursive:true,force:true});}
});
