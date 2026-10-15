import {spawn} from 'node:child_process';import {createInterface} from 'node:readline';import {fileURLToPath} from 'node:url';
export class NativeInput{
 constructor({getSettings,onEvent,platform=process.platform}){Object.assign(this,{getSettings,onEvent,platform});this.child=null;this.state={state:'starting'};this.lastTry=0;}
 status(){return {...this.state};}
 start(){if(this.child||Date.now()-this.lastTry<5000)return;this.lastTry=Date.now();const words=this.getSettings().recordWords;
 const command=this.platform==='linux'?'/usr/bin/python3':this.platform==='win32'?'powershell.exe':null;
 if(!command){this.state={state:'unsupported',reason:'unsupported_platform'};return;}
 const args=this.platform==='linux'?['-I','-u',fileURLToPath(new URL('./linux-layout.py',import.meta.url)),...(words?['--words']:[])]:['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./windows-input.ps1',import.meta.url)),...(words?['-CaptureWords']:[])];
 const child=spawn(command,args,{stdio:['pipe','pipe','pipe'],windowsHide:true});this.child=child;this.words=words;this.state={state:'starting'};
 const lines=createInterface({input:child.stdout});lines.on('line',line=>{if(this.child!==child||line.length>8192)return;try{const e=JSON.parse(line);if(e.language&&e.language!=='unknown')try{e.language=Intl.getCanonicalLocales(e.language)[0]}catch{e.language='unknown'}this.state={state:e.decoderState||'ready',reason:e.decoderReason,provider:e.provider,language:e.language};if(e.type===1)this.onEvent(e);}catch{this.state={state:'error',reason:'decoder_protocol'}}});
 child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});child.on('error',()=>{this.state={state:'unavailable',reason:'native_helper_missing'};if(this.child===child)this.child=null;lines.close()});child.on('close',()=>{if(this.child===child){this.child=null;this.state={state:'unavailable',reason:'native_helper_exited'}}lines.close()});
 }
 decode(event){if(!this.child||this.child.stdin.destroyed)return false;if(this.child.stdin.writableLength>1024*1024){this.close();this.close();this.state={state:'error',reason:'decoder_backpressure'};return false;}this.child.stdin.write(JSON.stringify(event)+'\n');return true;}
 close(){const child=this.child;this.child=null;child?.stdin.end();child?.kill();this.state={state:'paused'};}
}
