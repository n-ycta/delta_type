// Linux evdev collector. Never requests elevated privileges or changes device permissions.
import {open,readdir,readFile,appendFile,stat,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
const printable = code => (code>=2&&code<=13)||(code>=16&&code<=27)||(code>=30&&code<=41)||(code>=43&&code<=53)||code===57||(code>=71&&code<=83)||code===96;
export function decodeEvents(buffer, wordSize=8){
 const size=wordSize*2+8, events=[];
 for(let offset=0;offset+size<=buffer.length;offset+=size){const o=offset+wordSize*2;events.push({type:buffer.readUInt16LE(o),code:buffer.readUInt16LE(o+2),value:buffer.readInt32LE(o+4)});}
 return events;
}
export class BackgroundCollector {
 constructor({getSettings,onSession,dir,platform=process.platform}){Object.assign(this,{getSettings,onSession,dir,platform});this.devices=new Map();this.state={state:'starting',reason:null,devices:0};this.bucket=null;this.busy=false;this.stopped=false;this.lastScan=0;this.lastRetention=0;}
 status(){return {...this.state,devices:this.devices.size};}
 async start(){await this.tick();this.timer=setInterval(()=>void this.tick(),50);this.timer.unref();}
 async close(){this.stopped=true;clearInterval(this.timer);while(this.busy)await new Promise(r=>setTimeout(r,10));try{await this.flush();}finally{await this.closeDevices();}}
 async closeDevices(){for(const fd of this.devices.values())await fd.close().catch(()=>{});this.devices.clear();}
 async scan(){
  this.lastScan=Date.now();let names;
  try{names=await readdir('/sys/class/input');}catch{this.state={state:'unavailable',reason:'no_devices'};return;}
  const wanted=new Set();let denied=false;
  for(const name of names.filter(n=>/^event\d+$/.test(n))){
   try{const key=(await readFile(`/sys/class/input/${name}/device/capabilities/key`,'utf8')).trim().split(/\s+/).at(-1);const bits=BigInt('0x'+key);if(!(bits&(1n<<30n))||!(bits&(1n<<28n)))continue;}catch{continue;}
   const path='/dev/input/'+name;wanted.add(path);if(this.devices.has(path))continue;
   try{this.devices.set(path,await open(path,constants.O_RDONLY|constants.O_NONBLOCK));}catch(e){if(e.code==='EACCES'||e.code==='EPERM')denied=true;}
  }
  for(const [path,fd] of this.devices)if(!wanted.has(path)){await fd.close().catch(()=>{});this.devices.delete(path);}
  this.state={state:this.devices.size?'running':'unavailable',reason:denied?'permission_denied':this.devices.size?null:'no_devices'};
 }
 accept(event,now=Date.now()){
  if(event.type!==1||![1,2].includes(event.value))return;
  if(!printable(event.code)&&event.code!==14&&event.code!==111)return;
  if(!this.bucket)this.bucket={id:randomUUID(),startedAt:now,endedAt:now,characters:0,corrections:0,language:this.getSettings().language||'unknown',mode:'background',node:process.env.DELTA_NODE_ID||'local'};
  if(event.code===14||event.code===111)this.bucket.corrections++;
  else if(printable(event.code))this.bucket.characters++;
  this.bucket.endedAt=now;
 }
 async flush(){
  const bucket=this.bucket;if(!bucket||!bucket.characters){this.bucket=null;return;}
  // Keep a bucket on durable-outbox failure instead of losing it silently.
  await this.onSession({...bucket,corrections:Math.min(bucket.characters,bucket.corrections),endedAt:Math.max(bucket.startedAt+1,Date.now())});
  this.bucket=null;
 }
 async clearHistory(){await unlink(resolve(this.dir,'keys.ndjson')).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 async expireHistory(){const path=resolve(this.dir,'keys.ndjson');try{const s=await stat(path);if(Date.now()-s.birthtimeMs>this.getSettings().retentionDays*86400000||s.size>10*1024*1024)await this.clearHistory();}catch(e){if(e.code!=='ENOENT')throw e;}}
 async tick(){
  if(this.busy||this.stopped)return;this.busy=true;
  try{
   const settings=this.getSettings();
   if(Date.now()-this.lastRetention>5000){await this.expireHistory();this.lastRetention=Date.now();}
   if(!settings.enabled||!settings.backgroundEnabled){try{await this.flush();}finally{await this.closeDevices();}this.state={state:'paused',reason:null};return;}
   if(this.platform!=='linux'){this.state={state:'unsupported',reason:'unsupported_platform'};return;}
   if(this.bucket&&this.bucket.language!==settings.language)await this.flush();
   if(Date.now()-this.lastScan>5000){await this.scan();}
   const sequence=[];
   for(const [path,fd] of this.devices){const buf=Buffer.alloc(24*128);try{const {bytesRead}=await fd.read(buf,0,buf.length,null);if(!bytesRead){await fd.close();this.devices.delete(path);this.lastScan=0;continue;}for(const e of decodeEvents(buf.subarray(0,bytesRead),['ia32','arm'].includes(process.arch)?4:8)){this.accept(e);if(settings.recordKeys&&e.type===1&&[1,2].includes(e.value))sequence.push({time:Date.now(),code:e.code,repeat:e.value===2});}}catch(e){if(!['EAGAIN','EWOULDBLOCK'].includes(e.code)){await fd.close().catch(()=>{});this.devices.delete(path);this.lastScan=0;}}}
   if(sequence.length)await appendFile(resolve(this.dir,'keys.ndjson'),sequence.map(e=>JSON.stringify(e)).join('\n')+'\n',{mode:0o600});
   if(this.bucket&&Date.now()-this.bucket.startedAt>=5000)await this.flush();
  }catch(e){this.state={...this.state,state:'error',reason:'collector_error'};console.error('Background collector:',e.code||e.name);}finally{this.busy=false;}
 }
}
