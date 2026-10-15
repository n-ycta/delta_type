// Type owns OS permissions. The web UI is only a generic action/notice renderer.
import {access,readFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {spawn} from 'node:child_process';
import {DeltaError} from './delta-sdk.mjs';
const tools=['/usr/bin/pkexec','/usr/bin/python3','/usr/bin/getfacl','/usr/bin/setfacl'];
export class InputAccess {
 constructor({platform=process.platform,launch=spawn,check=async()=>{for(const tool of tools)await access(tool,constants.X_OK)},readHelper=()=>readFile(new URL('./input-access-helper.py',import.meta.url),'utf8'),onGranted=()=>{},onRevoked=()=>{}}={}){Object.assign(this,{platform,launch,check,readHelper,onGranted,onRevoked});this.state={state:'idle'};this.child=null;}
 status(){return {...this.state};}
 async request(operation='grant',locale='en'){
  if(this.platform!=='linux')throw new DeltaError('unsupported','This keyboard permission request is for Linux. Windows collectors run in the signed-in desktop user session.');
  if(!['grant','revoke'].includes(operation))throw new DeltaError('bad_request','Invalid permission operation');
  if(this.state.state==='pending')throw new DeltaError('conflict','System authorization already pending');
  // Set pending before asynchronous work so repeated web clicks cannot start multiple root prompts.
  this.state={state:'pending',operation};
  try{await this.check();const helper=await this.readHelper();
   const child=this.launch('/usr/bin/pkexec',['--disable-internal-agent','/usr/bin/python3','-I','-c',helper,operation],{stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',...(process.env.LANG?{LANG:process.env.LANG}:{})}});this.child=child;
   let stdout='',finished=false;
   const finish=(state,reason)=>{if(finished)return;finished=true;clearTimeout(timer);this.child=null;this.state={state,operation,...(reason?{reason}:{})};if(state==='granted')this.onGranted();if(state==='revoked')this.onRevoked();};
   const timer=setTimeout(()=>{child.kill('SIGTERM');finish('failed','timeout')},120000);timer.unref();
   child.stdout.on('data',b=>{stdout=(stdout+b).slice(-8192)});child.stderr.on('data',()=>{});
   child.on('error',()=>finish('failed','launch_failed'));
   child.on('close',code=>{let result;try{result=JSON.parse(stdout.trim())}catch{}if(code===0&&result?.ok)finish(operation==='grant'?'granted':'revoked');else finish('failed',code===126?'cancelled':code===127?'authorization_unavailable':result?.error?.includes('No keyboard')?'no_devices':result?.error?.includes('mask')?'system_policy':'authorization_failed');});
   return {pending:true,operation};
  }catch(e){this.state={state:'failed',operation,reason:e.code==='ENOENT'||e.code==='EACCES'?'missing_tools':'launch_failed'};throw new DeltaError('unavailable',locale==='ru'?'Для системного запроса доступа на Linux-узле нужны polkit (pkexec), Python 3 и пакет acl (getfacl/setfacl).':'Keyboard permission request needs polkit (pkexec), Python 3 and acl (getfacl/setfacl) on the target Linux desktop.');}
 }
 close(){this.child?.kill('SIGTERM');this.child=null;}
}
export function accessNotice(access){
 const s=access.status();if(s.state==='idle'||s.state==='granted')return [];
 const text=s.state==='pending'?['Подтвердите запрос Delta Type в системном окне на компьютере, где запущен плагин. Веб-панель не получает root-доступ.','Approve Delta Type in the system authorization dialog on the computer running the plugin. The web console does not gain root access.']:s.state==='revoked'?['Доступ Type к клавиатуре отозван. Чтобы возобновить сбор, разрешите доступ снова.','Type keyboard access was revoked. Grant access again to resume collection.']:({cancelled:['Запрос доступа отменён. Можно повторить его кнопкой ниже.','Authorization was cancelled. You can retry below.'],missing_tools:['Для системного окна нужны polkit (pkexec), Python 3 и пакет acl на узле. После их установки повторите запрос.','The node needs polkit (pkexec), Python 3 and acl. Install these system dependencies, then retry.'],no_devices:['Клавиатуры не найдены. Проверьте подключение; в контейнере устройства должны быть переданы явно.','No keyboards found. Check the connection; containers require explicitly passed devices.'],system_policy:['Системные правила ACL запрещают безопасно выдать доступ. Нужна помощь администратора; общие права устройств не изменены.','Restrictive ACL policy prevents a safe grant. Ask a system administrator; broad device permissions were not changed.'],timeout:['Время подтверждения истекло. Повторите запрос и подтвердите системное окно на узле.','Authorization timed out. Retry and approve the system dialog on the node.']})[s.reason]||['Не удалось получить системное разрешение. На узле должен быть запущен графический агент polkit в пользовательском сеансе. В удалённом или headless-сеансе подтвердить запрос через браузер нельзя.','OS authorization failed. A graphical polkit agent must be running in the node’s user session. A remote or headless browser cannot replace this system dialog.'];
 return [{id:'type.input-access',severity:s.state==='pending'?'info':'warn',message:text[1],localizations:{ru:text[0],en:text[1]},...(s.state==='pending'?{}:{actionId:'request_input_access'})}];
}
