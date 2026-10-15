import {z} from 'zod';
import {DeltaError} from './delta-sdk.mjs';
export const defaultSettings={enabled:true,backgroundEnabled:true,language:'unknown',recordKeys:false,retentionDays:7};
const schema=z.object({enabled:z.boolean(),backgroundEnabled:z.boolean(),language:z.enum(['unknown','ru','en']),recordKeys:z.boolean(),retentionDays:z.number().int().min(1).max(30)}).strict();
export function parseSettings(values,current=defaultSettings){
 const {_confirmations=[],...changes}=values||{};const result=schema.safeParse({...current,...changes});
 if(!result.success)throw new DeltaError('bad_request','Invalid typing settings');
 if(result.data.recordKeys&&!current.recordKeys&&(!Array.isArray(_confirmations)||!_confirmations.includes('type.record-keys.v1')))throw new DeltaError('forbidden','Explicit acknowledgement required: type.record-keys.v1. Keyboard history may contain passwords and private information.');
 return result.data;
}
export function noticesFor(status,settings){
 const notes=[];
 if(status.reason==='permission_denied'||status.state==='unavailable'||status.state==='unsupported'||status.state==='error'){
  const reasons={permission_denied:['Нет доступа к клавиатуре. Нажмите «Разрешить доступ к клавиатуре» и подтвердите системное окно на этом узле. Type получит чтение текущих клавиатур /dev/input/event* до переподключения или перезагрузки. Веб-панель не запускается от root.','Keyboard access denied. Click ‘Allow keyboard access’ and approve the system dialog on this node. Type receives read access to current /dev/input/event* keyboards until reconnect or reboot. Do not run the web console as root.'],no_devices:['Клавиатуры evdev не найдены. В контейнере нужны явно переданные устройства ввода.','No evdev keyboards found. A container requires explicitly passed input devices.'],unsupported_platform:['Фоновый сбор поддержан только на Linux evdev. Тренажёр доступен отдельно.','Background collection supports Linux evdev only. The trainer is available separately.'],collector_error:['Ошибка фонового сборщика. Проверьте журнал плагина Type.','Background collector error. Check the Type plugin log.']};
  const [ru,en]=reasons[status.reason]||reasons.collector_error;notes.push({id:'type.background',severity:'warn',message:en,localizations:{ru,en},...(status.reason==='permission_denied'?{actionId:'request_input_access'}:{})});
 }
 if(settings.language==='unknown')notes.push({id:'type.layout',severity:'info',message:'evdev cannot determine the active layout. Language is unknown until selected in Type settings; WPM is estimated from physical keys.',localizations:{ru:'evdev не определяет активную раскладку. До её выбора в настройках Type язык отмечен как неизвестный; скорость — оценка по физическим нажатиям.'}});
 if(settings.recordKeys)notes.push({id:'type.recording',severity:'warn',message:'Keyboard sequence recording is enabled. Passwords and private input may be included. History is stored locally by Type.',localizations:{ru:'Запись последовательности клавиш включена. В историю могут попасть пароли и личный ввод. История хранится локально плагином Type.'}});
 return notes;
}
