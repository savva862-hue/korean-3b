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
  wordTime: 5200,        // ms per question
  wordQuiz: false,
  wordQuizList: [],
  wordQuizPos: 0,
  wordScore: 0,
  wordAnswered: false,
  wordChoices: null,
  wordChoiceFor: -1,
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
  stopAudio();
  clearWordTimers();
  if(state.tab==='words' && tab!=='words'){ state.wordQuiz=false; }
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
   WORDS — timed quiz (like reference)
   start screen: choose lesson + time limit -> quiz -> wrong answers to dict
   ============================================================ */
function wordsPool(){
  return state.wordLesson===0 ? D.words : D.words.filter(w=>w.lesson===state.wordLesson);
}
function shuffle(a){ a=a.slice(); for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }

function viewWords(){
  if(state.wordQuiz){
    return viewWordsQuiz();
  }
  // start screen
  const lessons = lessonsList(D.words);
  const lchips = `<button class="lchip ${state.wordLesson===0?'on':''}" data-l="0">${t('all_lessons')}</button>`+
    lessons.map(l=>`<button class="lchip ${state.wordLesson===l?'on':''}" data-l="${l}">${l}단원</button>`).join('');
  const secs = (state.wordTime/1000).toFixed(1);
  return `<div class="wstart">
    <div class="kicker up">서울대 한국어+ · 3B</div>
    <div class="bigko">단어</div>
    <div class="desc">${wordsPool().length}${state.lang==='en'?' words. 4 choices. Pick before the time runs out.':' слов. 4 варианта. Выбери, пока не вышло время.'}</div>
    <div class="lessonsel">${lchips}</div>
    <div class="slabel up"><span>${state.lang==='en'?'TIME LIMIT':'ВРЕМЯ НА ОТВЕТ'}</span><b>${secs}${state.lang==='en'?'s':'с'}</b></div>
    <input type="range" class="wslider" id="wtime" min="2000" max="10000" step="200" value="${state.wordTime}">
    <button class="wstartbtn up" id="wstartbtn">${state.lang==='en'?'START':'СТАРТ'}</button>
  </div>`;
}

function startWordQuiz(){
  const pool = wordsPool();
  state.wordQuizList = shuffle(pool);
  state.wordQuizPos = 0;
  state.wordScore = 0;
  state.wordQuiz = true;
  state.wordAnswered = false;
  state.wordChoices = null;
  render();  // bindWords will start the timer
}

function buildWordChoices(word){
  const others = shuffle(D.words.filter(w=>w.ko!==word.ko)).slice(0,3);
  const opts = shuffle([word, ...others]);
  return opts.map(o=>({ text: tr(o), correct: o.ko===word.ko, ref:o }));
}

function viewWordsQuiz(){
  const list = state.wordQuizList;
  if(state.wordQuizPos>=list.length){
    return `<div class="qz-done">
      <div class="big">${state.lang==='en'?'Done':'Готово'}</div>
      <div class="sc mono">${state.wordScore} / ${list.length}</div>
      <button class="again up" id="wagain">${state.lang==='en'?'AGAIN':'ЗАНОВО'}</button>
    </div>`;
  }
  const w = list[state.wordQuizPos];
  if(!state.wordChoices || state.wordChoiceFor!==state.wordQuizPos){
    state.wordChoices = buildWordChoices(w);
    state.wordChoiceFor = state.wordQuizPos;
  }
  const cells = state.wordChoices.map((c,i)=>`
    <div class="qz-cell" data-i="${i}" data-correct="${c.correct?1:0}">${esc(c.text)}</div>`).join('');
  return `<div class="qz">
    <div class="qz-top">
      <span>단어 <b>${state.wordQuizPos+1}</b>/${list.length}</span>
      <span>${state.lang==='en'?'SCORE':'СЧЁТ'} <b>${state.wordScore}</b></span>
    </div>
    <div class="qz-timerbar"><div class="qz-timerfill" id="qzfill"></div></div>
    <div class="qz-word"><div class="k">${esc(w.ko)}</div></div>
    <div class="qz-grid">${cells}</div>
  </div>`;
}

let _wordTimer=null, _wordTick=null;
function clearWordTimers(){ if(_wordTimer){clearTimeout(_wordTimer);_wordTimer=null;} if(_wordTick){clearInterval(_wordTick);_wordTick=null;} }
function nextWordTimer(){
  clearWordTimers();
  const fill=$('#qzfill'); if(!fill) return;
  const total=state.wordTime; let elapsed=0;
  fill.style.width='100%';
  _wordTick=setInterval(()=>{
    elapsed+=100;
    const pct=Math.max(0,100-(elapsed/total*100));
    fill.style.width=pct+'%';
  },100);
  _wordTimer=setTimeout(()=>{ resolveWord(-1); }, total);
}
async function resolveWord(pickIdx){
  if(state.wordAnswered) return;
  state.wordAnswered=true;
  clearWordTimers();
  const w=state.wordQuizList[state.wordQuizPos];
  const choices=state.wordChoices;
  const correctIdx=choices.findIndex(c=>c.correct);
  const cells=document.querySelectorAll('.qz-cell');
  cells.forEach((cell,i)=>{
    if(i===correctIdx) cell.classList.add('correct');
    else if(i===pickIdx) cell.classList.add('wrong');
    else cell.classList.add('dim');
    cell.style.pointerEvents='none';
  });
  const correct = pickIdx===correctIdx;
  if(correct){ state.wordScore++; }
  else { await dictAdd({ko:w.ko, ru:w.ru, en:w.en, src:'words'}); }
  // advance after a beat
  setTimeout(()=>{
    state.wordQuizPos++;
    state.wordAnswered=false;
    render();  // bindWords restarts the timer
  }, correct?650:1300);
}

function bindWords(){
  if(state.wordQuiz){
    const list=state.wordQuizList;
    if(state.wordQuizPos>=list.length){
      const ag=$('#wagain'); if(ag) ag.onclick=()=>{ state.wordQuiz=false; clearWordTimers(); render(); };
      return;
    }
    document.querySelectorAll('.qz-cell').forEach(cell=>{
      cell.onclick=()=>resolveWord(+cell.dataset.i);
    });
    // (re)start timer bar for freshly rendered question
    if(!state.wordAnswered) nextWordTimer();
    return;
  }
  // start screen
  document.querySelectorAll('.lessonsel .lchip').forEach(c=>{
    c.onclick=()=>{ state.wordLesson=+c.dataset.l; render(); };
  });
  const sl=$('#wtime');
  if(sl) sl.oninput=()=>{
    state.wordTime=+sl.value;
    const lab=document.querySelector('.slabel b');
    if(lab) lab.textContent=(state.wordTime/1000).toFixed(1)+(state.lang==='en'?'s':'с');
  };
  const sb=$('#wstartbtn'); if(sb) sb.onclick=()=>startWordQuiz();
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
  const items = D.listening.map((d)=>{
    const lines = d.lines.map((ln,i)=>{
      const side = ln.spk==='F' ? 'right' : 'left';
      const who = ln.spk==='F' ? '여자' : '남자';
      return `<div class="bubble ${side}" data-line="${d.id}_${i}">
        <div class="who up">${who}</div>
        <div class="lko">${esc(ln.ko)}</div>
        <div class="ltr">${esc(state.lang==='en'?ln.en:ln.ru)}</div>
      </div>`;
    }).join('');
    const qs = d.questions.map((q,qi)=>renderQuestion(d.id,qi,q,d.lines)).join('');
    return `<div class="litem">
      <div class="lmeta up">${d.lesson}단원</div>
      <div class="lt">${esc(d.title.ko)}</div>
      <div class="lt-tr">${esc(d.title[state.lang]||d.title.ru)}</div>
      <div class="playwrap">
        <button class="bigplay" data-playall="${d.id}" aria-label="play">▶</button>
        <div class="playlabel up" id="pl_${d.id}">${state.lang==='en'?'PLAY DIALOGUE':'ПРОИГРАТЬ ДИАЛОГ'}</div>
      </div>
      <div class="chat" data-lines="${d.id}">${lines}</div>
      <button class="tool up scriptbtn" data-script="${d.id}">${state.lang==='en'?'SHOW TEXT':'ПОКАЗАТЬ ТЕКСТ'}</button>
      <div class="qs">${qs}</div>
    </div>`;
  }).join('');
  return `<div class="llist">${items}</div>`;
}
function bindListening(){
  // play whole dialogue sequentially, highlighting current bubble
  document.querySelectorAll('[data-playall]').forEach(b=>{
    b.onclick=async()=>{
      const id=b.dataset.playall;
      const d=D.listening.find(x=>x.id===id);
      const bubbles=[...document.querySelectorAll(`[data-lines="${id}"] .bubble`)];
      const label=document.getElementById('pl_'+id);
      stopAudio();
      b.classList.add('playing');
      // reveal chat while playing
      const chat=document.querySelector(`[data-lines="${id}"]`);
      chat.classList.add('revealed');
      for(let i=0;i<d.lines.length;i++){
        if(label) label.textContent = `${i+1} / ${d.lines.length}`;
        await new Promise(res=>{
          const ln=d.lines[i];
          bubbles.forEach(x=>x.classList.remove('active'));
          bubbles[i].classList.add('active');
          bubbles[i].scrollIntoView({behavior:'smooth',block:'center'});
          const a=new Audio(audioPath(id,i,ln.spk));
          _currentAudio=a;
          const done=()=>res();
          a.onended=done;
          a.onerror=()=>{
            if(window.speechSynthesis){
              const u=new SpeechSynthesisUtterance(ln.ko); u.lang='ko-KR'; u.rate=0.9;
              u.onend=done; u.onerror=done;
              const kv=speechSynthesis.getVoices().find(v=>v.lang&&v.lang.startsWith('ko'));
              if(kv)u.voice=kv; speechSynthesis.speak(u);
            } else setTimeout(done,700);
          };
          a.play().catch(()=>{ if(a.onerror)a.onerror(); });
        });
      }
      bubbles.forEach(x=>x.classList.remove('active'));
      b.classList.remove('playing');
      if(label) label.textContent = state.lang==='en'?'PLAY AGAIN':'ПРОИГРАТЬ СНОВА';
    };
  });
  // manual show text
  document.querySelectorAll('[data-script]').forEach(b=>{
    b.onclick=()=>{
      const id=b.dataset.script;
      const chat=document.querySelector(`[data-lines="${id}"]`);
      const on=chat.classList.toggle('revealed');
      b.textContent = on ? (state.lang==='en'?'HIDE TEXT':'СКРЫТЬ ТЕКСТ') : (state.lang==='en'?'SHOW TEXT':'ПОКАЗАТЬ ТЕКСТ');
      b.classList.toggle('on',on);
    };
  });
  bindQuestions();
}

/* ---------- shared question renderer with explanation ----------
   sourceLines: array of {ko, spk?} to search for a proof quote when wrong.
*/
function findProofQuote(correctText, sourceLines){
  if(!sourceLines) return null;
  // pick keywords from the correct answer (drop very short tokens)
  const kws = correctText.replace(/[.,!?"'”’]/g,'').split(/\s+/).filter(w=>w.length>=2);
  let best=null, bestScore=0;
  sourceLines.forEach(ln=>{
    let score=0;
    kws.forEach(k=>{ if(ln.ko.includes(k)) score++; });
    if(score>bestScore){ bestScore=score; best=ln; }
  });
  return bestScore>0 ? best : null;
}
function renderQuestion(ownerId,qi,q,sourceLines){
  const opts = q.options.map((o,i)=>{
    const label = state.lang==='en' ? (q.options_en?q.options_en[i]:'') : (q.options_ru?q.options_ru[i]:'');
    return `<button class="opt" data-q="${ownerId}_${qi}" data-i="${i}" data-ans="${q.answer}">
      <span class="num mono">${i+1}</span>
      <span>${esc(o)}${label?`<div class="tr" style="font-size:11px;color:var(--dim);margin-top:3px">${esc(label)}</div>`:''}</span>
    </button>`;
  }).join('');
  const typeLabel = q.type ? ({continue:'CONTINUE',correct:'TRUE',main:'MAIN IDEA'})[q.type] : '';
  const qtext = q.q ? (q.q.ko) : '';
  const qtr = q.q ? (state.lang==='en'?q.q.en:q.q.ru) : '';
  // precompute proof quote for the correct option
  const correctOpt = q.options[q.answer];
  const proof = findProofQuote(correctOpt, sourceLines);
  const proofAttr = proof ? ` data-proof="${esc((proof.spk?(proof.spk==='F'?'여자':'남자')+'가 ':'')+'“'+proof.ko+'”'+ (proof.spk?'라고 말했어요.':''))}"` : '';
  return `<div class="q-block" data-qroot="${ownerId}_${qi}"${proofAttr}>
    ${typeLabel?`<div class="q-type up">${typeLabel}</div>`:''}
    <div class="q-text">${esc(qtext)}<div style="font-size:11px;color:var(--dim);font-weight:400;margin-top:3px">${esc(qtr)}</div></div>
    ${opts}
    <div class="explain-wrong" style="display:none"></div>
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
      // show explanation only if the pick was wrong
      const root=document.querySelector(`.q-block[data-qroot="${grp}"]`);
      if(root && pick!==ans){
        const box=root.querySelector('.explain-wrong');
        const proof=root.dataset.proof;
        if(box){
          const head = state.lang==='en'?'WHY WRONG?':'왜 틀렸을까요?';
          box.innerHTML = `<div class="ew-head up">${head}</div>${proof?`<div class="ew-body">${esc(proof)}</div>`:''}`;
          box.style.display='block';
        }
      }
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
  // split body into sentence-lines for proof quotes
  const bodyLines = r.body.split(/(?<=[.!?])\s+/).map(s=>({ko:s.trim()})).filter(x=>x.ko);
  const qs = r.questions.map((q,qi)=>renderQuestion('r_'+r.id,qi,q,bodyLines)).join('');
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
  state.writingPos=0; state.writingAnswered=false; state.writingScore=0;
  render(); window.scrollTo(0,0);
}
function viewWritingTask(){
  const tasks=state.writingTasks;
  const label = state.writingLevel==='random' ? '랜덤' : state.writingLevel.label;
  if(state.writingPos>=tasks.length){
    return `<div class="w-done">
      <div class="big">${t('writing_done')}</div>
      <div class="wd-score mono">${state.writingScore||0} / ${tasks.length}</div>
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
    <div class="qz-top" style="padding:0 0 4px">
      <span>쓰기 <b>${state.writingPos+1}</b>/${tasks.length}</span>
      <span>${state.lang==='en'?'SCORE':'СЧЁТ'} <b>${state.writingScore||0}</b></span>
    </div>
    <button class="backbtn up" id="wexit">← ${label}</button>
    <div class="w-sentence">${sentence}</div>
    <div id="wopts">${opts}</div>
    <div class="explain-wrong" id="wExplain" style="display:none"></div>
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
      if(pick===ansIdx){ state.writingScore=(state.writingScore||0)+1; }
      else {
        // show correct answer (writing mistakes are NOT added to dictionary by design)
        const box=$('#wExplain');
        if(box){
          const head=state.lang==='en'?'CORRECT ANSWER':'정답';
          box.innerHTML=`<div class="ew-head up">${head}</div><div class="ew-body">${esc(task.answer)}</div>`;
          box.style.display='block';
        }
      }
      const nb=$('#wnextTask'); if(nb){ nb.style.display='block'; nb.scrollIntoView({behavior:'smooth',block:'nearest'}); }
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
    <h2>정보</h2>
    <p>${esc(t('info_body'))}</p>
    <a class="iglink up" href="${IG_URL}" target="_blank" rel="noopener">Instagram: @sawwaty</a>
    <div class="madeby up">MADE BY KILF</div>

    <div class="devbox" id="devbox" style="display:none">
      <div class="devpanel" id="devPanel">
        <input class="devinput" id="elKey" type="password" placeholder="ElevenLabs API key (sk_...)" autocomplete="off">
        <div class="devrow">
          <input class="devinput half" id="voiceF" type="text" placeholder="Female voice ID" value="21m00Tcm4TlvDq8ikWAM">
          <input class="devinput half" id="voiceM" type="text" placeholder="Male voice ID" value="onwK4e9ZLuTAKqWW03F9">
        </div>
        <button class="wbtn up devgen" id="genBtn">Generate &amp; download audio</button>
        <div class="devprog" id="genProg"></div>
      </div>
    </div>
    <div class="devunlock" id="devUnlock">·</div>
  </div>`;
}
function bindInfo(){
  // hidden dev unlock: tap the tiny dot 5x to reveal audio generator
  const dot=$('#devUnlock'); let taps=0;
  if(dot) dot.onclick=()=>{
    taps++;
    if(taps>=5){ const box=$('#devbox'); if(box) box.style.display='block'; }
  };
  const gb=$('#genBtn');
  if(gb) gb.onclick=async()=>{
    const key=($('#elKey').value||'').trim();
    const vF=($('#voiceF').value||'').trim();
    const vM=($('#voiceM').value||'').trim();
    const prog=$('#genProg');
    if(!key){ prog.textContent='Enter your API key first.'; return; }
    if(!vF||!vM){ prog.textContent='Enter both voice IDs.'; return; }
    gb.disabled=true; gb.style.opacity='.5';
    const setP=(txt)=>{ prog.textContent=txt; };
    try{
      await generateAllAudio({
        apiKey:key, voiceF:vF, voiceM:vM,
        onProgress:(done,total,label)=>{ setP(done<total?`${done}/${total} · ${label}`:'Packaging ZIP…'); },
        onError:(msg)=>{ setP('Error: '+msg); gb.disabled=false; gb.style.opacity='1'; },
        onDone:(zipBytes)=>{ downloadBytes(zipBytes,'audio.zip'); setP('Done! Downloaded audio.zip'); gb.disabled=false; gb.style.opacity='1'; }
      });
    }catch(e){ setP('Error: '+e.message); gb.disabled=false; gb.style.opacity='1'; }
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
