/* ============================================================
   KOREAN 3B — app logic
   ============================================================ */
const D = APP_DATA;
const IG_URL = "https://instagram.com/sawwaty";

/* ---------- STATE ---------- */
const state = {
  lang: null,            // 'ru' | 'en'
  tab: 'words',
  wordLesson: 0,         // 0 = all
  wordIndex: 0,
  wordFlipped: false,
  grammarLesson: 0,
  grammarOpen: null,
  readingOpen: null,
  writingLevel: null,    // level object or 'random'
  writingTasks: [],
  writingPos: 0,
  writingAnswered: false,
};

/* ---------- STORAGE (persistent dictionary) ---------- */
// dictionary entries: {ko, ru, en, src}  src: 'words'|'listening'|'reading'
const DICT_KEY = 'k3b_dict_v1';
const LANG_KEY = 'k3b_lang_v1';

async function storGet(key){
  try{ const r = await window.storage.get(key); return r ? JSON.parse(r.value) : null; }
  catch(e){ return null; }
}
async function storSet(key,val){
  try{ await window.storage.set(key, JSON.stringify(val)); }catch(e){}
}
// fallback in-memory if storage unavailable
let _dictCache = [];
async function loadDict(){
  const d = await storGet(DICT_KEY);
  _dictCache = Array.isArray(d) ? d : [];
  return _dictCache;
}
async function saveDict(){ await storSet(DICT_KEY, _dictCache); }
function dictHas(ko){ return _dictCache.some(e=>e.ko===ko); }
async function dictAdd(entry){
  if(dictHas(entry.ko)) return;
  _dictCache.push(entry);
  await saveDict();
}
async function dictRemove(ko){
  _dictCache = _dictCache.filter(e=>e.ko!==ko);
  await saveDict();
}

/* ---------- i18n ---------- */
function t(key){
  const u = D.ui[key];
  if(!u) return key;
  return u[state.lang] || u.ru || key;
}
// pick translation for a word object by current lang
function tr(obj){ return obj[state.lang] || obj.ru || obj.en || ''; }

/* ---------- GLOBAL WORD TRANSLATION LOOKUP ----------
   Used by reading tab: any clicked Korean word.
   Search order: text glossary -> full words db -> all reading glossaries -> null
*/
const WORD_INDEX = (()=>{
  const idx = {};
  // base frequency vocab first (lowest priority, so lesson words can override)
  Object.entries(D.base||{}).forEach(([ko,v])=>{ idx[ko]=v; });
  D.words.forEach(w=>{ idx[w.ko] = {ru:w.ru, en:w.en}; });
  D.reading.forEach(r=>{
    Object.entries(r.gloss||{}).forEach(([ko,v])=>{ if(!idx[ko]) idx[ko]=v; });
  });
  return idx;
})();
function lookupWord(ko, localGloss){
  const tryKeys = (k)=>{
    if(localGloss && localGloss[k]) return localGloss[k];
    if(WORD_INDEX[k]) return WORD_INDEX[k];
    return null;
  };
  let hit = tryKeys(ko);
  if(hit) return hit;
  // strip trailing particles (single + double-char)
  const particles = ['으로부터','에서는','에게서','에서','에게','한테','으로','까지','부터','이나','라도','처럼','만큼','밖에',
                     '을','를','이','가','은','는','에','의','로','과','와','도','만','께','나','랑','고','요'];
  for(const p of particles){
    if(ko.length>p.length && ko.endsWith(p)){
      const base=ko.slice(0,-p.length);
      hit = tryKeys(base);
      if(hit) return hit;
    }
  }
  // try verb/adjective dictionary form: replace ending with 다
  const stem = ko.replace(/(았|었|였|해요|해서|하고|하는|합니다|어요|아요|어서|아서|으면|면|고|는|은|을|ㄴ다|는다|다가|지만|네요|더니|거나)+$/,'');
  if(stem && stem!==ko){
    hit = tryKeys(stem) || tryKeys(stem+'다') || tryKeys(stem+'하다');
    if(hit) return hit;
  }
  return null;
}

/* ---------- HELPERS ---------- */
const $ = sel => document.querySelector(sel);
const app = ()=>document.getElementById('app');
function esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function lessonsList(items){
  const s = new Set(items.map(i=>i.lesson));
  return [...s].sort((a,b)=>a-b);
}

/* ============================================================
   LANGUAGE SELECTION
   ============================================================ */
function renderLangOverlay(){
  const ov = document.getElementById('langOverlay');
  ov.style.display='flex';
  ov.innerHTML = `
    <div class="brand">KOREAN 3B</div>
    <div class="brandsub">서울대 한국어+ · 10–18</div>
    <div class="ltitle up">${D.ui.choose_lang.ru} / ${D.ui.choose_lang.en}</div>
    <button class="lopt" data-l="ru"><span class="flag">🇷🇺</span> Русский</button>
    <button class="lopt" data-l="en"><span class="flag">🇬🇧</span> English</button>
  `;
  ov.querySelectorAll('.lopt').forEach(b=>{
    b.onclick=async()=>{
      state.lang = b.dataset.l;
      await storSet(LANG_KEY, state.lang);
      ov.style.display='none';
      boot();
    };
  });
}

/* ============================================================
   TAB BAR
   ============================================================ */
const TABS = [
  ['words','단어','tab_words'],
  ['grammar','문법','tab_grammar'],
  ['listening','듣기','tab_listening'],
  ['reading','읽기','tab_reading'],
  ['writing','쓰기','tab_writing'],
  ['dict','사전','tab_dict'],
  ['info','정보','tab_info'],
];
function renderTabbar(){
  const bar = document.getElementById('tabbar');
  bar.innerHTML = TABS.map(([id,ko,key])=>`
    <button class="tabbtn ${state.tab===id?'on':''}" data-tab="${id}">
      <span class="ic">${ko}</span>
      <span class="lb up">${t(key)}</span>
    </button>`).join('');
  bar.querySelectorAll('.tabbtn').forEach(b=>{
    b.onclick=()=>{ go(b.dataset.tab); };
  });
}

function go(tab){
  state.tab = tab;
  state.grammarOpen=null; state.readingOpen=null;
  if(tab!=='writing'){ state.writingLevel=null; }
  renderTabbar();
  render();
  window.scrollTo(0,0);
}

/* ============================================================
   HEADER
   ============================================================ */
function header(){
  return `<div class="top">
    <div>
      <h1>KOREAN 3B</h1>
      <div class="sub up">SNU KOREAN+ · L10–18</div>
    </div>
    <button class="langbtn up" id="langToggle">${state.lang==='ru'?'RU':'EN'}</button>
  </div>`;
}
function bindHeader(){
  const lt = $('#langToggle');
  if(lt) lt.onclick=async()=>{
    state.lang = state.lang==='ru'?'en':'ru';
    await storSet(LANG_KEY, state.lang);
    renderTabbar(); render();
  };
}

/* ============================================================
   MAIN RENDER DISPATCH
   ============================================================ */
function render(){
  let html = header();
  switch(state.tab){
    case 'words': html+=viewWords(); break;
    case 'grammar': html+= state.grammarOpen!=null ? viewGrammarDetail() : viewGrammar(); break;
    case 'listening': html+=viewListening(); break;
    case 'reading': html+= state.readingOpen!=null ? viewReadingDetail() : viewReading(); break;
    case 'writing': html+= state.writingLevel!=null ? viewWritingTask() : viewWritingLevels(); break;
    case 'dict': html+=viewDict(); break;
    case 'info': html+=viewInfo(); break;
  }
  app().innerHTML = `<div class="view active">${html}</div>`;
  bindHeader();
  // bind tab-specific handlers
  if(state.tab==='words') bindWords();
  if(state.tab==='grammar') state.grammarOpen!=null ? bindGrammarDetail() : bindGrammar();
  if(state.tab==='listening') bindListening();
  if(state.tab==='reading') state.readingOpen!=null ? bindReadingDetail() : bindReading();
  if(state.tab==='writing') state.writingLevel!=null ? bindWritingTask() : bindWritingLevels();
  if(state.tab==='dict') bindDict();
  if(state.tab==='info') bindInfo();
}

/* ============================================================
   WORDS (flashcards + lesson filter + know/don't-know)
   ============================================================ */
function wordsFiltered(){
  return state.wordLesson===0 ? D.words : D.words.filter(w=>w.lesson===state.wordLesson);
}
function viewWords(){
  const lessons = lessonsList(D.words);
  const chips = `<div class="chiprow">
    <button class="chip ${state.wordLesson===0?'on':''}" data-l="0">${t('all_lessons')}</button>
    ${lessons.map(l=>`<button class="chip ${state.wordLesson===l?'on':''}" data-l="${l}">${l}단원</button>`).join('')}
  </div>`;
  const list = wordsFiltered();
  if(state.wordIndex>=list.length) state.wordIndex=0;
  const w = list[state.wordIndex];
  if(!w) return chips+`<div class="empty">—</div>`;
  const face = state.wordFlipped
    ? `<div class="tr">${esc(tr(w))}</div>`
    : `<div class="ko">${esc(w.ko)}</div>`;
  return chips + `
    <div class="counter mono">${state.wordIndex+1} / ${list.length}</div>
    <div class="card-wrap">
      <div class="flash" id="flash">
        <div class="les up">${w.lesson}단원</div>
        ${face}
        <div class="tap up">${t('flip')}</div>
      </div>
    </div>
    <div class="wbtns">
      <button class="wbtn no up" id="dontknow">${t('dont_know')}</button>
      <button class="wbtn up" id="know">${t('know')}</button>
    </div>
    <div class="navrow">
      <button id="wprev" class="up">← ${t('back')}</button>
      <button id="wnext" class="up">${t('next')} →</button>
    </div>`;
}
function bindWords(){
  document.querySelectorAll('.chiprow .chip').forEach(c=>{
    c.onclick=()=>{ state.wordLesson=+c.dataset.l; state.wordIndex=0; state.wordFlipped=false; render(); };
  });
  const flash=$('#flash');
  if(flash) flash.onclick=()=>{ state.wordFlipped=!state.wordFlipped; render(); };
  const list=wordsFiltered();
  const w=list[state.wordIndex];
  const adv=()=>{ state.wordFlipped=false; state.wordIndex=(state.wordIndex+1)%list.length; render(); };
  const kn=$('#know'); if(kn) kn.onclick=adv;
  const dk=$('#dontknow'); if(dk) dk.onclick=async()=>{
    if(w) await dictAdd({ko:w.ko, ru:w.ru, en:w.en, src:'words'});
    adv();
  };
  const pv=$('#wprev'); if(pv) pv.onclick=()=>{ state.wordFlipped=false; state.wordIndex=(state.wordIndex-1+list.length)%list.length; render(); };
  const nx=$('#wnext'); if(nx) nx.onclick=()=>{ state.wordFlipped=false; state.wordIndex=(state.wordIndex+1)%list.length; render(); };
}

/* ============================================================
   GRAMMAR
   ============================================================ */
function grammarFiltered(){
  return state.grammarLesson===0 ? D.grammar : D.grammar.filter(g=>g.lesson===state.grammarLesson);
}
function viewGrammar(){
  const lessons = lessonsList(D.grammar);
  const chips = `<div class="chiprow">
    <button class="chip ${state.grammarLesson===0?'on':''}" data-l="0">${t('all_lessons')}</button>
    ${lessons.map(l=>`<button class="chip ${state.grammarLesson===l?'on':''}" data-l="${l}">${l}단원</button>`).join('')}
  </div>`;
  const list = grammarFiltered();
  const items = list.map(g=>`
    <button class="gitem" data-id="${g.id}" style="width:100%;text-align:left">
      <span class="gt">${esc(g.title)}</span>
      <span class="gl up">${g.lesson}단원</span>
    </button>`).join('');
  return chips + `<div class="glist">${items}</div>`;
}
function bindGrammar(){
  document.querySelectorAll('.chiprow .chip').forEach(c=>{
    c.onclick=()=>{ state.grammarLesson=+c.dataset.l; render(); };
  });
  document.querySelectorAll('.gitem').forEach(b=>{
    b.onclick=()=>{ state.grammarOpen=b.dataset.id; render(); window.scrollTo(0,0); };
  });
}
function viewGrammarDetail(){
  const g = D.grammar.find(x=>x.id===state.grammarOpen);
  if(!g) return '';
  const expl = state.lang==='en' ? g.ex_en : g.ex_ru;
  const ex = g.examples.map(e=>`
    <div class="dlg">
      <div class="line">
        <span class="spk up">A</span>
        <span class="lko">${esc(e.a_ko)}</span>
        <div class="ltr">${esc(state.lang==='en'?e.a_en:e.a_ru)}</div>
      </div>
      <div class="line">
        <span class="spk up">B</span>
        <span class="lko">${esc(e.b_ko)}</span>
        <div class="ltr">${esc(state.lang==='en'?e.b_en:e.b_ru)}</div>
      </div>
    </div>`).join('');
  return `<div class="g-detail">
    <button class="backbtn up" id="gback">← ${t('back')}</button>
    <h2>${esc(g.title)}</h2>
    <div class="lesbadge up">${g.lesson}단원 · ${t('explanation')}</div>
    <div class="explain-box">${esc(expl)}</div>
    <div class="ex-label up">${t('example')}</div>
    ${ex}
  </div>`;
}
function bindGrammarDetail(){
  const b=$('#gback'); if(b) b.onclick=()=>{ state.grammarOpen=null; render(); };
}

/* ============================================================
   LISTENING
   ============================================================ */
// audio file path helper: audio/{id}_{i}_{spk}.mp3
function audioPath(dId, i, spk){ return `audio/${dId}_${i}_${spk}.mp3`; }

let _currentAudio = null;
function stopAudio(){
  if(_currentAudio){ try{_currentAudio.pause();}catch(e){} _currentAudio=null; }
  if(window.speechSynthesis) window.speechSynthesis.cancel();
  document.querySelectorAll('.playbtn.playing').forEach(el=>el.classList.remove('playing'));
}
function playLine(dId, i, spk, koText, btnEl){
  stopAudio();
  btnEl.classList.add('playing');
  const path = audioPath(dId,i,spk);
  const a = new Audio(path);
  _currentAudio = a;
  a.onended = ()=>{ btnEl.classList.remove('playing'); _currentAudio=null; };
  a.onerror = ()=>{
    // fallback: browser TTS in Korean
    _currentAudio=null;
    if(window.speechSynthesis){
      const u = new SpeechSynthesisUtterance(koText);
      u.lang='ko-KR'; u.rate=0.92;
      u.onend=()=>btnEl.classList.remove('playing');
      const voices = speechSynthesis.getVoices();
      const kv = voices.find(v=>v.lang && v.lang.startsWith('ko'));
      if(kv) u.voice=kv;
      speechSynthesis.speak(u);
    } else {
      btnEl.classList.remove('playing');
    }
  };
  a.play().catch(()=>{ if(a.onerror) a.onerror(); });
}

function viewListening(){
  const lessons = lessonsList(D.listening);
  const items = D.listening.map((d,di)=>{
    const scriptId=`sc_${d.id}`;
    const lines = d.lines.map((ln,i)=>`
      <div class="audio-line" data-line="${d.id}_${i}">
        <button class="playbtn" data-play="${d.id}|${i}|${ln.spk}" data-ko="${esc(ln.ko)}">▶</button>
        <div class="txt">
          <div class="who up">${ln.spk==='F'?'여자 · F':'남자 · M'}</div>
          <div class="lko">${esc(ln.ko)}</div>
          <div class="tr">${esc(state.lang==='en'?ln.en:ln.ru)}</div>
        </div>
      </div>`).join('');
    const qs = d.questions.map((q,qi)=>renderQuestion(d.id,qi,q)).join('');
    return `<div class="litem">
      <div class="lt">${esc(d.title.ko)}</div>
      <div class="lmeta up">${d.lesson}단원 · ${esc(d.title[state.lang]||d.title.ru)}</div>
      <div class="toolbar">
        <button class="tool up" data-playall="${d.id}">${t('play')} ▶</button>
        <button class="tool up" data-script="${d.id}">${t('show_script')}</button>
      </div>
      <div class="lines" data-lines="${d.id}">${lines}</div>
      <div class="qs">${qs}</div>
    </div>`;
  }).join('');
  return `<div class="chiprow" style="border-bottom:1px solid var(--line)">
      <span class="chip on" style="pointer-events:none">${D.listening.length} 듣기</span>
    </div>
    <div class="llist">${items}</div>`;
}
function bindListening(){
  // play single line
  document.querySelectorAll('[data-play]').forEach(b=>{
    b.onclick=()=>{
      const [id,i,spk]=b.dataset.play.split('|');
      playLine(id,+i,spk,b.dataset.ko,b);
    };
  });
  // toggle script visibility for a dialogue
  document.querySelectorAll('[data-script]').forEach(b=>{
    b.onclick=()=>{
      const id=b.dataset.script;
      const cont=document.querySelector(`[data-lines="${id}"]`);
      const showing = cont.querySelector('.audio-line.show');
      cont.querySelectorAll('.audio-line').forEach(l=>l.classList.toggle('show', !showing));
      b.textContent = showing ? t('show_script') : t('hide_script');
      b.classList.toggle('on', !showing);
    };
  });
  // play all lines sequentially
  document.querySelectorAll('[data-playall]').forEach(b=>{
    b.onclick=async()=>{
      const id=b.dataset.playall;
      const d=D.listening.find(x=>x.id===id);
      const btns=[...document.querySelectorAll(`[data-lines="${id}"] .playbtn`)];
      stopAudio();
      for(let i=0;i<d.lines.length;i++){
        await new Promise(res=>{
          const ln=d.lines[i];
          const btn=btns[i];
          stopAudio(); btn.classList.add('playing');
          const a=new Audio(audioPath(id,i,ln.spk));
          _currentAudio=a;
          const done=()=>{ btn.classList.remove('playing'); res(); };
          a.onended=done;
          a.onerror=()=>{
            if(window.speechSynthesis){
              const u=new SpeechSynthesisUtterance(ln.ko); u.lang='ko-KR'; u.rate=0.92;
              u.onend=done; u.onerror=done;
              const kv=speechSynthesis.getVoices().find(v=>v.lang&&v.lang.startsWith('ko'));
              if(kv)u.voice=kv; speechSynthesis.speak(u);
            } else done();
          };
          a.play().catch(()=>{ if(a.onerror)a.onerror(); });
        });
      }
    };
  });
  bindQuestions();
}

/* ---------- shared question renderer ---------- */
function renderQuestion(ownerId,qi,q){
  const opts = q.options.map((o,i)=>{
    const label = state.lang==='en' ? (q.options_en?q.options_en[i]:o) : (q.options_ru?q.options_ru[i]:o);
    return `<button class="opt" data-q="${ownerId}_${qi}" data-i="${i}" data-ans="${q.answer}">
      <span class="num mono">${i+1}</span>
      <span>${esc(o)}<div class="tr" style="font-size:11px;color:var(--dim);margin-top:3px">${esc(label)}</div></span>
    </button>`;
  }).join('');
  const typeLabel = q.type ? ({continue:'CONTINUE',correct:'TRUE',main:'MAIN IDEA'})[q.type] : '';
  const qtext = q.q ? (q.q.ko) : '';
  const qtr = q.q ? (state.lang==='en'?q.q.en:q.q.ru) : '';
  return `<div class="q-block">
    ${typeLabel?`<div class="q-type up">${typeLabel}</div>`:''}
    <div class="q-text">${esc(qtext)}<div style="font-size:11px;color:var(--dim);font-weight:400;margin-top:3px">${esc(qtr)}</div></div>
    ${opts}
  </div>`;
}
function bindQuestions(){
  document.querySelectorAll('.opt').forEach(o=>{
    o.onclick=()=>{
      const grp=o.dataset.q; const ans=+o.dataset.ans; const pick=+o.dataset.i;
      const siblings=document.querySelectorAll(`.opt[data-q="${grp}"]`);
      siblings.forEach(s=>{
        const si=+s.dataset.i;
        s.classList.remove('correct','wrong','dim');
        if(si===ans) s.classList.add('correct');
        else if(si===pick) s.classList.add('wrong');
        else s.classList.add('dim');
        s.style.pointerEvents='none';
      });
    };
  });
}

/* ============================================================
   READING — clickable words, comprehension questions
   ============================================================ */
// tokenize Korean body into clickable word spans (split on spaces, keep punctuation)
function tokenizeBody(body){
  // split by whitespace; each token may carry trailing punctuation
  return body.split(/(\s+)/).map(tok=>{
    if(/^\s+$/.test(tok)) return tok;
    // separate trailing punctuation
    const m = tok.match(/^(.*?)([.,!?"'”’)\]]*)$/su);
    const core = m ? m[1] : tok;
    const punct = m ? m[2] : '';
    if(!core) return esc(tok);
    return `<span class="w" data-w="${esc(core)}">${esc(core)}</span>${esc(punct)}`;
  }).join('');
}
function viewReading(){
  const items = D.reading.map(r=>`
    <button class="ritem" data-id="${r.id}" style="width:100%;text-align:left;display:block">
      <div class="rt">${esc(r.title.ko)}</div>
      <div class="rtr">${esc(r.title[state.lang]||r.title.ru)}</div>
      <div class="rmeta up">${r.lesson}단원 · ${esc(r.level||'')}</div>
    </button>`).join('');
  return `<div class="chiprow" style="border-bottom:1px solid var(--line)">
      <span class="chip on" style="pointer-events:none">${D.reading.length} 읽기</span>
    </div>
    <div class="rlist">${items}</div>`;
}
function bindReading(){
  document.querySelectorAll('.ritem').forEach(b=>{
    b.onclick=()=>{ state.readingOpen=b.dataset.id; render(); window.scrollTo(0,0); };
  });
}
function viewReadingDetail(){
  const r = D.reading.find(x=>x.id===state.readingOpen);
  if(!r) return '';
  const qs = r.questions.map((q,qi)=>renderQuestion('r_'+r.id,qi,q)).join('');
  return `<div class="r-detail">
    <button class="backbtn up" id="rback">← ${t('back')}</button>
    <h2>${esc(r.title.ko)}</h2>
    <div class="rtr2">${esc(r.title[state.lang]||r.title.ru)}</div>
    <div class="r-body" id="rbody">${tokenizeBody(r.body)}</div>
    <div class="hint up">${t('tap_word_hint')}</div>
    <div class="q-label ex-label up">${t('questions')}</div>
    ${qs}
  </div>
  <div id="glossPop" style="display:none"></div>`;
}
function bindReadingDetail(){
  const b=$('#rback'); if(b) b.onclick=()=>{ state.readingOpen=null; render(); };
  const r = D.reading.find(x=>x.id===state.readingOpen);
  const gloss = r ? r.gloss : {};
  document.querySelectorAll('#rbody .w').forEach(w=>{
    w.onclick=async(e)=>{
      e.stopPropagation();
      const ko = w.dataset.w;
      const found = lookupWord(ko, gloss);
      const label = found ? tr(found) : t('no_translation');
      showGlossPop(w, ko, label, !!found);
      // only clicked words from reading go to dictionary (and only if we have a translation)
      if(found){
        await dictAdd({ko:ko, ru:found.ru||label, en:found.en||label, src:'reading'});
      }
    };
  });
  bindQuestions();
}
function showGlossPop(anchor, ko, label, found){
  let pop=$('#glossPop');
  if(!pop){ pop=document.createElement('div'); pop.id='glossPop'; document.body.appendChild(pop); }
  pop.style.cssText=`position:fixed;z-index:80;background:#fff;color:#000;padding:12px 14px;max-width:78%;
    border:2px solid #000;font-size:14px;line-height:1.4;box-shadow:0 6px 24px rgba(0,0,0,.5)`;
  pop.innerHTML=`<div style="font-weight:800;font-size:16px;margin-bottom:3px">${esc(ko)}</div>
    <div style="${found?'':'color:#666'}">${esc(label)}</div>`;
  pop.style.display='block';
  const rect=anchor.getBoundingClientRect();
  const pw=Math.min(window.innerWidth*0.78,300);
  let left=rect.left; if(left+pw>window.innerWidth-12) left=window.innerWidth-pw-12;
  if(left<12) left=12;
  let top=rect.bottom+8;
  pop.style.left=left+'px'; pop.style.top=top+'px';
  const close=(ev)=>{ if(ev.target!==anchor && !pop.contains(ev.target)){ pop.style.display='none'; document.removeEventListener('click',close); } };
  setTimeout(()=>document.addEventListener('click',close),10);
}

/* ============================================================
   WRITING — 18 levels + random, sequential unlock
   ============================================================ */
function viewWritingLevels(){
  const cells = D.writing.map(lv=>`
    <button class="wlvl" data-lvl="${lv.level}">
      <div class="n mono">${lv.level}</div>
      <div class="lb up">${lv.label}</div>
    </button>`).join('');
  return `<div class="section-title up">${t('writing_level')} 1–18</div>
    <div class="wlvls">
      <button class="wlvl rnd" data-lvl="random"><div class="n up">${t('writing_random')}</div></button>
      ${cells}
    </div>`;
}
function bindWritingLevels(){
  document.querySelectorAll('.wlvl').forEach(b=>{
    b.onclick=()=>{
      const v=b.dataset.lvl;
      startWriting(v);
    };
  });
}
function startWriting(v){
  if(v==='random'){
    // 10 random tasks from all 180
    const all=[];
    D.writing.forEach(lv=>lv.tasks.forEach(tk=>all.push(tk)));
    for(let i=all.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[all[i],all[j]]=[all[j],all[i]];}
    state.writingTasks=all.slice(0,10);
    state.writingLevel='random';
  } else {
    const lv=D.writing.find(x=>x.level===+v);
    state.writingTasks=lv.tasks.slice();
    state.writingLevel=lv;
  }
  state.writingPos=0; state.writingAnswered=false;
  render(); window.scrollTo(0,0);
}
function viewWritingTask(){
  const tasks=state.writingTasks;
  const label = state.writingLevel==='random' ? t('writing_random') : state.writingLevel.label;
  if(state.writingPos>=tasks.length){
    return `<div class="w-done">
      <div class="big">${t('writing_done')}</div>
      <button class="wbtn up" id="wrestart" style="max-width:220px;margin:0 auto;display:block">${t('writing_restart')}</button>
      <button class="backbtn up" id="wexit" style="margin:20px auto 0;display:block">← ${t('back')}</button>
    </div>`;
  }
  const task=tasks[state.writingPos];
  const sentence = task.sentence.replace('___', `<span class="w-blank"></span>`);
  const opts=task.options.map((o,i)=>`
    <button class="opt" data-i="${i}" data-ans="${task.options.indexOf(task.answer)}">
      <span class="num mono">${i+1}</span><span>${esc(o)}</span>
    </button>`).join('');
  return `<div class="w-task">
    <button class="backbtn up" id="wexit">← ${label}</button>
    <div class="w-progress up">${t('writing_task')} ${state.writingPos+1} / ${tasks.length}</div>
    <div class="w-sentence">${sentence}</div>
    <div id="wopts">${opts}</div>
    <button class="wbtn up" id="wnextTask" style="margin-top:16px;display:none">${t('next')} →</button>
  </div>`;
}
function bindWritingTask(){
  const ex=$('#wexit'); if(ex) ex.onclick=()=>{ state.writingLevel=null; render(); };
  const rs=$('#wrestart'); if(rs) rs.onclick=()=>{ startWriting(state.writingLevel==='random'?'random':state.writingLevel.level); };
  const task=state.writingTasks[state.writingPos];
  if(!task) return;
  const ansIdx=task.options.indexOf(task.answer);
  document.querySelectorAll('#wopts .opt').forEach(o=>{
    o.onclick=()=>{
      if(state.writingAnswered) return;
      state.writingAnswered=true;
      const pick=+o.dataset.i;
      document.querySelectorAll('#wopts .opt').forEach(s=>{
        const si=+s.dataset.i;
        if(si===ansIdx) s.classList.add('correct');
        else if(si===pick) s.classList.add('wrong');
        else s.classList.add('dim');
        s.style.pointerEvents='none';
      });
      // NOTE: writing mistakes are NOT added to dictionary (by design)
      const nb=$('#wnextTask'); if(nb) nb.style.display='block';
      nb.scrollIntoView({behavior:'smooth',block:'nearest'});
    };
  });
  const nb=$('#wnextTask'); if(nb) nb.onclick=()=>{
    state.writingPos++; state.writingAnswered=false; render(); window.scrollTo(0,0);
  };
}

/* ============================================================
   DICTIONARY — only clicked reading words + words/listening mistakes
   swipe-left to delete a learned word
   ============================================================ */
function viewDict(){
  if(!_dictCache.length){
    return `<div class="empty">${t('dict_empty')}</div>`;
  }
  const rows=_dictCache.map((e,i)=>{
    const srcLabel = ({words:'단어',listening:'듣기',reading:'읽기'})[e.src]||'';
    return `<div class="drow" data-ko="${esc(e.ko)}">
      <div class="del up">${t('know')}</div>
      <div class="inner">
        <div>
          <div class="ko">${esc(e.ko)}</div>
          <div class="tr">${esc(e[state.lang]||e.ru||e.en||'')}</div>
        </div>
        <div class="src up">${srcLabel}</div>
      </div>
    </div>`;
  }).join('');
  return `<div class="dhead up">${t('swipe_hint')} · ${_dictCache.length}</div>
    <div class="dlist">${rows}</div>`;
}
function bindDict(){
  document.querySelectorAll('.drow').forEach(row=>{
    const inner=row.querySelector('.inner');
    let startX=0, curX=0, dragging=false;
    const onStart=(x)=>{ startX=x; dragging=true; inner.style.transition='none'; };
    const onMove=(x)=>{
      if(!dragging) return;
      curX=Math.min(0, x-startX);
      inner.style.transform=`translateX(${curX}px)`;
    };
    const onEnd=async()=>{
      if(!dragging) return; dragging=false;
      inner.style.transition='transform .18s ease';
      if(curX < -70){
        inner.style.transform='translateX(-100%)';
        const ko=row.dataset.ko;
        setTimeout(async()=>{ await dictRemove(ko); render(); },160);
      } else {
        inner.style.transform='translateX(0)';
      }
      curX=0;
    };
    inner.addEventListener('touchstart',e=>onStart(e.touches[0].clientX),{passive:true});
    inner.addEventListener('touchmove',e=>onMove(e.touches[0].clientX),{passive:true});
    inner.addEventListener('touchend',onEnd);
    // mouse (desktop)
    inner.addEventListener('mousedown',e=>{onStart(e.clientX); e.preventDefault();});
    window.addEventListener('mousemove',e=>{ if(dragging) onMove(e.clientX); });
    window.addEventListener('mouseup',()=>{ if(dragging) onEnd(); });
  });
}

/* ============================================================
   INFO
   ============================================================ */
function viewInfo(){
  return `<div class="info">
    <h2>${t('info_title')}</h2>
    <p>${esc(t('info_body'))}</p>
    <a class="iglink up" href="${IG_URL}" target="_blank" rel="noopener">Instagram · @sawwaty →</a>

    <div class="devbox">
      <button class="devtoggle up" id="devToggle">⚙ ${state.lang==='en'?'Generate audio (ElevenLabs)':'Генерация аудио (ElevenLabs)'}</button>
      <div class="devpanel" id="devPanel" style="display:none">
        <p class="devnote">${state.lang==='en'
          ? 'Enter your ElevenLabs API key, then generate all 48 dialogue clips and download them as a ZIP. Unzip and put the audio/ folder next to index.html in your repo. Your key is used only to call ElevenLabs and is never sent anywhere else.'
          : 'Введи свой ключ ElevenLabs, сгенерируй все 48 реплик и скачай ZIP. Распакуй и положи папку audio/ рядом с index.html в репозитории. Ключ используется только для запроса к ElevenLabs и никуда больше не отправляется.'}</p>
        <input class="devinput" id="elKey" type="password" placeholder="${state.lang==='en'?'ElevenLabs API key (sk_...)':'Ключ ElevenLabs (sk_...)'}" autocomplete="off">
        <div class="devrow">
          <input class="devinput half" id="voiceF" type="text" placeholder="${state.lang==='en'?'Female voice ID':'ID женского голоса'}" value="21m00Tcm4TlvDq8ikWAM">
          <input class="devinput half" id="voiceM" type="text" placeholder="${state.lang==='en'?'Male voice ID':'ID мужского голоса'}" value="onwK4e9ZLuTAKqWW03F9">
        </div>
        <button class="wbtn up devgen" id="genBtn">${state.lang==='en'?'Generate & download':'Сгенерировать и скачать'}</button>
        <div class="devprog" id="genProg"></div>
      </div>
    </div>
  </div>`;
}
function bindInfo(){
  const dt=$('#devToggle');
  if(dt) dt.onclick=()=>{
    const p=$('#devPanel');
    p.style.display = p.style.display==='none' ? 'block' : 'none';
  };
  const gb=$('#genBtn');
  if(gb) gb.onclick=async()=>{
    const key=($('#elKey').value||'').trim();
    const vF=($('#voiceF').value||'').trim();
    const vM=($('#voiceM').value||'').trim();
    const prog=$('#genProg');
    if(!key){ prog.textContent = state.lang==='en'?'Enter your API key first.':'Сначала введи ключ.'; return; }
    if(!vF||!vM){ prog.textContent = state.lang==='en'?'Enter both voice IDs.':'Укажи оба ID голосов.'; return; }
    gb.disabled=true; gb.style.opacity='.5';
    const setP=(txt)=>{ prog.textContent=txt; };
    try{
      await generateAllAudio({
        apiKey:key, voiceF:vF, voiceM:vM,
        onProgress:(done,total,label)=>{
          if(done<total) setP(`${done}/${total} · ${label}`);
          else setP(state.lang==='en'?'Packaging ZIP…':'Собираю ZIP…');
        },
        onError:(msg)=>{
          setP((state.lang==='en'?'Error: ':'Ошибка: ')+msg);
          gb.disabled=false; gb.style.opacity='1';
        },
        onDone:(zipBytes)=>{
          downloadBytes(zipBytes,'audio.zip');
          setP(state.lang==='en'?'Done! Downloaded audio.zip — unzip into your repo.':'Готово! Скачан audio.zip — распакуй в репозиторий.');
          gb.disabled=false; gb.style.opacity='1';
        }
      });
    }catch(e){
      setP((state.lang==='en'?'Error: ':'Ошибка: ')+e.message);
      gb.disabled=false; gb.style.opacity='1';
    }
  };
}

/* ============================================================
   BOOT
   ============================================================ */
async function boot(){
  await loadDict();
  renderTabbar();
  render();
}
async function init(){
  const savedLang = await storGet(LANG_KEY);
  if(savedLang){ state.lang=savedLang; boot(); }
  else { renderLangOverlay(); }
  // warm up speech voices
  if(window.speechSynthesis){ speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged=()=>{}; }
}
// stop audio when switching tabs
document.addEventListener('visibilitychange',()=>{ if(document.hidden) stopAudio(); });
init();
