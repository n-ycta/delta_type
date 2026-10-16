import {test} from 'node:test';import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';
import {InputAccess,accessNotice} from '../server/input-access.mjs';
import {readFile} from 'node:fs/promises';import {spawnSync} from 'node:child_process';
function fake(){const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};return child;}
test('permission request is explicit, OS-owned, isolated Python, single prompt, nonblocking',async()=>{
 const child=fake();let args,calls=0,granted=0;const a=new InputAccess({check:async()=>{},readHelper:async()=> 'fixed helper source',launch:(...v)=>{args=v;calls++;return child},onGranted:()=>granted++});
 assert.equal(a.status().state,'idle');assert.equal(calls,0);
 assert.deepEqual(await a.request(),{pending:true,operation:'grant'});assert.equal(a.status().state,'pending');await assert.rejects(a.request(),e=>e.code==='conflict');assert.equal(calls,1);
 assert.equal(args[0],'/usr/bin/pkexec');assert.deepEqual(args[1],['--disable-internal-agent','/usr/bin/python3','-I','-c','fixed helper source','grant']);assert.equal(args[2].env.LD_PRELOAD,undefined);assert(accessNotice(a)[0].localizations.ru.includes('системном'));assert(accessNotice(a)[0].localizations.ru.includes('после перезагрузки'));
 child.stdout.write('{"ok":true,"changed":1}');child.emit('close',0);assert.equal(granted,1);assert.equal(a.status().state,'granted');assert.equal(a.status().persistent,true);assert.equal(a.status().until,'revoked');assert.deepEqual(accessNotice(a),[]);
});
test('missing tools, unsupported platform and invalid operation never launch root process',async()=>{
 let launches=0;const opts={launch:()=>{launches++},check:async()=>{throw Object.assign(Error(),{code:'ENOENT'})}};
 const a=new InputAccess(opts);await assert.rejects(a.request(),e=>e.code==='unavailable');assert.equal(a.status().reason,'missing_tools');assert(accessNotice(a)[0].message.includes('acl'));
 await assert.rejects(new InputAccess({...opts,platform:'win32'}).request(),e=>e.code==='unsupported');await assert.rejects(a.request('shell'),e=>e.code==='bad_request');assert.equal(launches,0);
});
test('cancel and unavailable system auth agent are visible and retryable',async()=>{
 for(const [code,reason] of [[126,'cancelled'],[127,'authorization_unavailable'],[1,'authorization_failed']]){
 const child=fake(),a=new InputAccess({check:async()=>{},readHelper:async()=>'',launch:()=>child});await a.request();child.emit('close',code);assert.equal(a.status().reason,reason);assert.equal(accessNotice(a)[0].actionId,'request_input_access');}
});
test('revoke finishes separately and triggers descriptor closure',async()=>{let revoked=0;const child=fake(),a=new InputAccess({check:async()=>{},readHelper:async()=>'',launch:()=>child,onRevoked:()=>revoked++});await a.request('revoke');assert(accessNotice(a)[0].localizations.ru.includes('отзыв'));child.stdout.write('{"ok":true}');child.emit('close',0);assert.equal(a.status().state,'revoked');assert.equal(revoked,1);});
test('privileged helper rejects malformed devices and requires PKEXEC_UID, never chmod or broad groups',async()=>{
 const source=await readFile(new URL('../server/input-access-helper.py',import.meta.url),'utf8');assert(!source.includes('chmod 666'));assert(!source.includes('usermod'));assert(source.includes("'PKEXEC_UID'"));assert(source.includes("'-n', '-m'"));assert(source.includes("info.st_ino == record['ino']"));
 const script=`import runpy,unittest\nm=runpy.run_path(${JSON.stringify(new URL('../server/input-access-helper.py',import.meta.url).pathname)})\nclass T(unittest.TestCase):\n def test_acl(self):\n  self.assertEqual(m['acl_entry']('user:1000:r--\\nmask::rw-\\n',1000),'r--')\n  self.assertIsNone(m['acl_entry']('user:1001:rw-\\n',1000))\n def test_paths(self):\n  for name in ['../event1','/tmp/x','event1/../x','event1;sh','mouse0','event']:\n   with self.assertRaises(ValueError): m['checked_device'](name)\n def test_unprivileged(self):\n  m['main'].__globals__['os'].geteuid=lambda:1000\n  with self.assertRaises(ValueError):m['main']()\nunittest.main()\n`;
 const r=spawnSync('/usr/bin/python3',['-I','-c',script],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});
test('root helper grant/regrant/revoke simulation preserves prior ACL without changing the mask',()=>{const r=spawnSync('/usr/bin/python3',['-I',new URL('./input-access-helper.test.py',import.meta.url).pathname],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);});
