import {randomUUID} from 'node:crypto';
export class Activity{
 constructor(getSettings){this.getSettings=getSettings;this.bucket=null;this.lastAt=null;this.burstStarted=null;this.lastLanguage='unknown';this.inputTimes=[];}
 ensure(now,language){if(!this.bucket)this.bucket={id:randomUUID(),startedAt:now,endedAt:now,characters:0,corrections:0,activeMs:0,speedCharacters:0,bursts:0,pauses:0,longestBurstMs:0,words:[],language,mode:'background',node:process.env.DELTA_NODE_ID||'local'};return this.bucket;}
 accept(kind,now,language){this.inputTimes.push(now);while(this.inputTimes[0]<now-60000)this.inputTimes.shift();const b=this.ensure(now,language),gap=this.lastAt===null?null:Math.max(0,now-this.lastAt),threshold=this.getSettings().idleThresholdMs??2000;const continuous=gap!==null&&gap<=threshold;if(!continuous){b.bursts++;if(gap!==null)b.pauses++;this.burstStarted=now;}else{b.activeMs+=gap;if(kind==='character')b.speedCharacters++;b.longestBurstMs=Math.max(b.longestBurstMs,now-(this.burstStarted??now));}if(kind==='correction')b.corrections++;else b.characters++;b.endedAt=Math.max(b.endedAt,now);this.lastAt=now;this.lastLanguage=language;}
 word(word,now=Date.now()){const b=this.ensure(now,word.language);const existing=b.words.find(w=>w.word===word.word&&w.language===word.language);if(existing)existing.count+=word.count;else if(b.words.length<1000)b.words.push(word);b.endedAt=Math.max(b.endedAt,now);}
 snapshot(){const b=this.bucket;if(!b)return null;const s={...b,words:b.words.map(w=>({...w})),endedAt:Math.max(b.startedAt+1,b.endedAt)};if(this.getSettings().excludeIdle===false){s.activeMs=s.endedAt-s.startedAt;s.speedCharacters=s.characters;}return s;}
 clear(){this.bucket=null;}
 reset(){this.clear();this.lastAt=null;this.burstStarted=null;}
}
