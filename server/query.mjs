import {DeltaError} from './delta-sdk.mjs';import {wordList,normalizeWord} from './words.mjs';
const spans={'15m':900000,'1h':3600000,'6h':21600000,'24h':86400000,'7d':604800000,'30d':2592000000,'90d':7776000000};
const metrics={wpm:{aggregation:'weighted_avg',weightField:'activeMs'},accuracy:{aggregation:'weighted_avg',weightField:'characters'},keystrokes:{aggregation:'sum'},active_seconds:{aggregation:'sum'},corrections:{aggregation:'sum'},bursts:{aggregation:'sum'},pauses:{aggregation:'sum'},longest_burst:{aggregation:'max'},correction_rate:{aggregation:'weighted_avg',weightField:'attempts'},word_frequency:{aggregation:'sum'}};
export async function metricsQuery(client,settings,query){
 if(query?.pluginId!=='dev.delta.type'||!metrics[query.metricId])throw new DeltaError('bad_request','Invalid Type metric');
 const q=query,to=query.range?.preset?Date.now():query.range?.to,from=query.range?.preset?to-spans[query.range.preset]:query.range?.from;
 if(!Number.isFinite(from)||!Number.isFinite(to)||from<0||to<=from||to-from>366*86400000)throw new DeltaError('bad_request','Invalid metric range');
 if(q.metricId==='word_frequency'&&!settings.recordWords)throw new DeltaError('conflict','Enable word frequency in Type settings and accept the Type-owned privacy notice first.');
 const step=q.stepMs||Math.max(60000,Math.ceil((to-from)/120/60000)*60000);if(step<1000||(to-from)/step>2000)throw new DeltaError('bad_request','Too many buckets');
 const groupBy=q.groupBy|| (q.metricId==='word_frequency'?'word':undefined);if(groupBy&&!['word','word_language','language','mode','node','word_class'].includes(groupBy))throw new DeltaError('bad_request','Unknown Type dimension');
 const base={source:'dev.delta.type',metric:q.metricId,filters:Object.fromEntries(Object.entries(q.filters||{}).filter(([k,v])=>k!=='word_class'&&v.length)),limit:10000,...metrics[q.metricId]};
 const load=async(a,b,groups=[],bucket=false)=>{const result=await client.call(settings.storageComponent+'.aggregate',{...base,from:a,to:b,groupBy:groups,...(bucket?{bucketMs:step}:{})},settings.storageNode||undefined);if(result.truncated)throw new DeltaError('bad_request','Too many Type groups. Narrow the period or filter languages.');return result.rows};
 if(q.metricId==='word_frequency'){
  const excluded=wordList(settings.excludedWords),flagged=wordList(settings.flaggedWords),rows=await load(from,to,['word','language','mode','node']),groups=new Map();
  for(const r of rows){const w=r.dimensions.word,mark=flagged.has(normalizeWord(w));if(excluded.has(normalizeWord(w)))continue;if(q.filters?.word_class?.length&&!q.filters.word_class.includes(mark?'flagged':'normal'))continue;const key=groupBy==='word_language'?JSON.stringify([w,r.dimensions.language]):groupBy==='word_class'?(mark?'flagged':'normal'):r.dimensions[groupBy]||'unknown',label=groupBy==='word_language'?`${w} (${r.dimensions.language})`:key;
   const g=groups.get(key)||{key,label,value:0,flagged:mark};g.value+=r.value||0;groups.set(key,g);}
  const categories=[...groups.values()].sort((a,b)=>b.value-a.value||a.key.localeCompare(b.key));return {query:q,from,to,stepMs:step,series:[],categories,summary:{current:categories.reduce((s,r)=>s+r.value,0),previous:null,min:categories.length?Math.min(...categories.map(c=>c.value)):null,max:categories[0]?.value??null},generatedAt:Date.now()};
 }
 const build=async(a,b,shift=0)=>{const rows=await load(a,b,groupBy?[groupBy]:[],true),groups=new Map();for(const r of rows){const key=groupBy?r.dimensions[groupBy]||'unknown':'all';if(!groups.has(key))groups.set(key,[]);groups.get(key).push({t:r.time+shift,v:r.value});}return [...groups].map(([key,points])=>({key,label:key,points:Array.from({length:Math.ceil(b/step)-Math.floor(a/step)},(_,i)=>{const t=(Math.floor(a/step)+i)*step+shift;return {t,v:points.find(p=>p.t===t)?.v??null}})}))};
 const [series,summaryRows,categoriesRows]=await Promise.all([build(from,to),load(from,to),groupBy?load(from,to,[groupBy]):[]]);
 const previous=q.compare==='previous'?await load(from-(to-from),from):[];const compare=q.compare==='previous'?(await build(from-(to-from),from,to-from)).map(s=>({...s,key:s.key+'__prev'})):undefined;
 return {query:q,from,to,stepMs:step,series,compare,categories:groupBy?categoriesRows.filter(r=>r.value!==null).map(r=>({key:r.dimensions[groupBy],label:r.dimensions[groupBy],value:r.value??0})):undefined,summary:{current:summaryRows[0]?.value??null,previous:previous[0]?.value??null,min:null,max:null},generatedAt:Date.now()};
}
