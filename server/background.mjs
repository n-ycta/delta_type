import {Activity} from './activity.mjs';
import {WordBuffer} from './words.mjs';
import {NativeInput} from './native-input.mjs';
// Linux evdev collector. Never requests elevated privileges or changes device permissions.
import {open,readdir,readFile,appendFile,stat,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
const printable = code => (code>=2&&code<=13)||(code>=16&&code<=27)||(code>=30&&code<=41)||(code>=43&&code<=53)||code===57||(code>=71&&code<=83)||code===96;
export function decodeEvents(buffer, wordSize=8,withTime=false){
 const size=wordSize*2+8, events=[];
 for(let offset=0;offset+size<=buffer.length;offset+=size){const o=offset+wordSize*2;const e={type:buffer.readUInt16LE(o),code:buffer.readUInt16LE(o+2),value:buffer.readInt32LE(o+4)};if(withTime){const sec=wordSize===8?Number(buffer.readBigInt64LE(offset)):buffer.readInt32LE(offset),us=wordSize===8?Number(buffer.readBigInt64LE(offset+wordSize)):buffer.readInt32LE(offset+wordSize);const t=sec*1000+us/1000;e.time=Math.abs(t-Date.now())<86400000?Math.floor(t):Date.now();}events.push(e);}
 return events;
}
export class BackgroundCollector {
 constructor({getSettings,onSession,dir,platform=process.platform}){Object.assign(this,{getSettings,onSession,dir,platform});this.devices=new Map();this.deviceNames=new Map();this.state={state:'starting',reason:null,devices:0};this.busy=false;this.stopped=false;this.lastScan=0;this.lastRetention=0;this.activity=new Activity(getSettings);this.pending=[];this.held=new Set();this.words=new WordBuffer({getSettings,onWord:w=>this.activity.word(w,this.lastDecodedAt||Date.now())});this.native=new NativeInput({getSettings,platform,onEvent:e=>{this.lastDecodedAt=e.time||Date.now();this.accept(e,this.lastDecodedAt);if(e.value)this.words.accept(e);if(this.platform==='win32'&&getSettings().recordKeys&&[1,2].includes(e.value))void appendFile(resolve(dir,'keys.ndjson'),JSON.stringify({time:this.lastDecodedAt,code:e.code,repeat:e.value===2})+'\n',{mode:0o600}).catch(()=>{this.state={...this.state,state:'error',reason:'history_write_failed'}})}});}
 get bucket(){return this.activity.bucket;}
 set bucket(v){this.activity.bucket=v;}
 status(){return {...this.state,devices:this.platform==='win32'&&this.native.child?1:this.devices.size,decoder:this.native.status()};}
 async start(){await this.tick();this.timer=setInterval(()=>void this.tick(),50);this.timer.unref();}
 async close(){this.native.close();this.words.reset();this.stopped=true;clearInterval(this.timer);while(this.busy)await new Promise(r=>setTimeout(r,10));try{await this.flush();}finally{await this.closeDevices();}}
 async closeDevices(){for(const fd of this.devices.values())await fd.close().catch(()=>{});this.devices.clear();}
 async scan(){
  this.lastScan=Date.now();let names;
  try{names=await readdir('/sys/class/input');}catch{this.state={state:'unavailable',reason:'no_devices'};return;}
  const wanted=new Set();let denied=false;
  for(const name of names.filter(n=>/^event\d+$/.test(n))){
   try{const key=(await readFile(`/sys/class/input/${name}/device/capabilities/key`,'utf8')).trim().split(/\s+/).at(-1);const bits=BigInt('0x'+key);if(!(bits&(1n<<30n))||!(bits&(1n<<28n)))continue;}catch{continue;}
   const path='/dev/input/'+name;wanted.add(path);if(this.devices.has(path))continue;
   try{this.devices.set(path,await open(path,constants.O_RDONLY|constants.O_NONBLOCK));this.deviceNames.set(path,(await readFile('/sys/class/input/'+name+'/device/name','utf8')).trim());}catch(e){if(e.code==='EACCES'||e.code==='EPERM')denied=true;}
  }
  for(const [path,fd] of this.devices)if(!wanted.has(path)){await fd.close().catch(()=>{});this.devices.delete(path);}
  this.state={state:this.devices.size?'running':'unavailable',reason:denied?'permission_denied':this.devices.size?null:'no_devices'};
 }
 accept(event,now=Date.now()){
  if(event.type!==1)return;if(event.value===0){this.held.delete(event.code);return;}if(![1,2].includes(event.value))return;this.held.add(event.code);
  const command=event.command||[29,97,125,126].some(k=>this.held.has(k));if(command)return;
  if(!printable(event.code)&&event.code!==14&&event.code!==111)return;
  let language=this.getSettings().language;if(['auto','unknown'].includes(language))language=event.language||'unknown';
  if(this.bucket&&this.bucket.language!==language){this.pending.push(this.activity.snapshot());this.activity.clear();}
  this.activity.accept(event.code===14||event.code===111?'correction':'character',now,language);
 }
 async flush(){
  while(this.flushing)await new Promise(r=>setTimeout(r,5));this.flushing=true;
  try{const bucket=this.activity.snapshot();if(bucket){this.activity.clear();this.pending.push(bucket);}while(this.pending.length){await this.onSession(this.pending[0]);this.pending.shift();}}
  finally{this.flushing=false;}
 }
 async clearHistory(){await unlink(resolve(this.dir,'keys.ndjson')).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 async expireHistory(){const path=resolve(this.dir,'keys.ndjson');try{const s=await stat(path);if(Date.now()-s.birthtimeMs>this.getSettings().retentionDays*86400000||s.size>10*1024*1024)await this.clearHistory();}catch(e){if(e.code!=='ENOENT')throw e;}}
 async tick(){
  if(this.busy||this.stopped)return;this.busy=true;
  try{
   const settings=this.getSettings();
   if(Date.now()-this.lastRetention>5000){await this.expireHistory();this.lastRetention=Date.now();}
   if(!settings.enabled||!settings.backgroundEnabled){try{await this.flush();}finally{await this.closeDevices();this.native.close();this.words.reset();this.held.clear();this.activity.reset();}this.state={state:'paused',reason:null};return;}
   if(!['linux','win32'].includes(this.platform)){this.state={state:'unsupported',reason:'unsupported_platform'};return;}
   if(this.native.child&&this.native.words!==settings.recordWords){this.native.close();this.words.reset();}
   this.native.start();
   if(this.platform==='win32'){this.state={state:this.native.child?'running':'unavailable',reason:this.native.child?null:'windows_desktop_required'};if(this.pending.length||(this.bucket&&Date.now()-this.bucket.startedAt>=5000))await this.flush();return;}
   if(this.bucket&&Date.now()-this.bucket.startedAt>=5000)await this.flush();
   if(Date.now()-this.lastScan>5000){await this.scan();}
   if(this.pending.length)await this.flush();
   const sequence=[];
   for(const [path,fd] of this.devices){const buf=Buffer.alloc(24*128);try{const {bytesRead}=await fd.read(buf,0,buf.length,null);if(!bytesRead){await fd.close();this.devices.delete(path);this.lastScan=0;continue;}for(const e of decodeEvents(buf.subarray(0,bytesRead),['ia32','arm'].includes(process.arch)?4:8,true)){const device=this.deviceNames.get(path)||'';if(e.type===1&&!this.native.decode({...e,device}))this.accept(e,e.time);if(settings.recordKeys&&e.type===1&&[1,2].includes(e.value))sequence.push({time:Date.now(),code:e.code,repeat:e.value===2});}}catch(e){if(!['EAGAIN','EWOULDBLOCK'].includes(e.code)){await fd.close().catch(()=>{});this.devices.delete(path);this.lastScan=0;}}}
   if(sequence.length)await appendFile(resolve(this.dir,'keys.ndjson'),sequence.map(e=>JSON.stringify(e)).join('\n')+'\n',{mode:0o600});
   if(this.bucket&&Date.now()-this.bucket.startedAt>=5000)await this.flush();
  }catch(e){this.state={...this.state,state:'error',reason:'collector_error'};console.error('Background collector:',e.code||e.name);}finally{this.busy=false;}
 }
}
