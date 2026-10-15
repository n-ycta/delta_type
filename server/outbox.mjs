import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';import {dirname} from 'node:path';
export class Outbox{
 constructor(path){this.path=path;this.records=[];this.seen=[];this.tail=Promise.resolve();}
 async load(){await mkdir(dirname(this.path),{recursive:true,mode:0o700});try{const d=JSON.parse(await readFile(this.path,'utf8'));this.records=d.records;this.seen=d.seen;}catch(e){if(e.code!=='ENOENT')throw e}}
 serial(fn){const p=this.tail.then(fn);this.tail=p.catch(()=>{});return p;}
 async persist(){await writeFile(this.path+'.tmp',JSON.stringify({records:this.records,seen:this.seen}),{mode:0o600});await rename(this.path+'.tmp',this.path)}
 add(sessionId,records){return this.serial(async()=>{if(this.seen.includes(sessionId))return false;if(this.records.length+records.length>10000)throw new Error('Outbox full');const beforeRecords=this.records.slice(),beforeSeen=this.seen.slice();this.records.push(...records);this.seen=[...this.seen.slice(-9999),sessionId];try{await this.persist()}catch(e){this.records=beforeRecords;this.seen=beforeSeen;throw e}return true})}
 flush(client,component,node){return this.serial(async()=>{let sent=0;while(this.records.length){const batch=this.records.slice(0,500);await client.call(component+'.write',{records:batch},node||undefined);this.records.splice(0,batch.length);await this.persist();sent+=batch.length;}return {sent,pending:this.records.length}})}
}
