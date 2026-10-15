export function normalizeWord(word,language='und'){try{return word.normalize('NFKC').toLocaleLowerCase(language==='unknown'?'und':language)}catch{return word.normalize('NFKC').toLowerCase()}}
export const wordList=s=>new Set(String(s||'').split(/[,;\n]+/u).map(w=>normalizeWord(w.trim())).filter(Boolean));
export class WordBuffer{
 constructor({getSettings,onWord}){Object.assign(this,{getSettings,onWord});this.text='';this.context='';}
 reset(){this.text=''}
 commit(language){if(!this.text)return;const text=this.text;this.text='';let segments;try{segments=new Intl.Segmenter(language==='unknown'?'und':language,{granularity:'word'}).segment(text)}catch{segments=new Intl.Segmenter('und',{granularity:'word'}).segment(text)}const excluded=wordList(this.getSettings().excludedWords);for(const s of segments){if(!s.isWordLike||!/[\p{L}]/u.test(s.segment))continue;const word=normalizeWord(s.segment,language);if(word.length<=64&&!excluded.has(normalizeWord(word)))this.onWord({word,language,count:1});}}
 accept(e){const s=this.getSettings();if(!s.recordWords){this.reset();return;}const language=e.language||'unknown',context=JSON.stringify([e.focus||'',language]);if(context!==this.context){this.reset();this.context=context;}if(e.command||e.navigation){this.reset();return;}if(e.backspace){this.text=Array.from(this.text).slice(0,-1).join('');return;}for(const ch of e.text||''){if(/[\p{L}\p{M}\p{N}'’]/u.test(ch)){this.text+=ch;if(this.text.length>128)this.reset();}else this.commit(language);}}
}
