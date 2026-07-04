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
  writingLevel: null,    // level object or 'random'
  writingTasks: [],
  writingPos: 0,
  writingAnswered: false,
};

/* ---------- STORAGE (persistent dictionary) ---------- */
// dictionary entries: {ko, ru, en, src}  src: 'words'|'listening'|'reading'
const DICT_KEY = 'k3b_dict_v1';
const LANG_KEY = 'k3b_lang_v1';

// Use localStorage — available in every browser and on GitHub Pages / iOS.
function storGet(key){
  try{ const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; }
  catch(e){ return null; }
}
function storSet(key,val){
  try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){}
}
let _dictCache = [];
function loadDict(){
  const d = storGet(DICT_KEY);
  _dictCache = Array.isArray(d) ? d : [];
  return _dictCache;
}
function saveDict(){ storSet(DICT_KEY, _dictCache); }
function dictHas(ko){ return _dictCache.some(e=>e.ko===ko); }
function dictAdd(entry){
  if(dictHas(entry.ko)) return;
  _dictCache.push(entry);
  saveDict();
}
function dictRemove(ko){
  _dictCache = _dictCache.filter(e=>e.ko!==ko);
  saveDict();
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
    <img class="coverlogo" src="icons/logo.png" alt="">
    <div class="brand">KOREAN 3B</div>
    <div class="brandsub">서울대 한국어+ · 10–18</div>
    <div class="ltitle up">${D.ui.choose_lang.ru} / ${D.ui.choose_lang.en}</div>
    <button class="lopt" data-l="ru"><span class="flag">🇷🇺</span> Русский</button>
    <button class="lopt" data-l="en"><span class="flag">🇬🇧</span> English</button>
    <div class="madeby up" style="margin-top:32px">MADE BY KILF</div>
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
  if(state.tab==='listening' && tab!=='listening'){ resetListening(); }
  if(state.tab==='reading' && tab!=='reading'){ RS.stage='cover'; RS.order=[]; RS.idx=0; RS.qidx=0; }
  state.tab = tab;
  state.grammarOpen=null;
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
    case 'reading': html+=viewReading(); break;
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
  if(state.tab==='reading') bindReading();
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
   LISTENING — session flow (random dialogues, listen then answer)
   ============================================================ */
function audioPath(dId, i, spk){ return `audio/${dId}_${i}_${spk}.mp3`; }

let _currentAudio = null;
function stopAudio(){
  if(_currentAudio){ try{_currentAudio.pause();}catch(e){} try{_currentAudio.onended=null;_currentAudio.onerror=null;}catch(e){} _currentAudio=null; }
  if(window.speechSynthesis){ try{ window.speechSynthesis.cancel(); }catch(e){} }
  if(typeof LS!=='undefined') LS.playing=false;
}
function resetListening(){
  stopAudio();
  LS.stage='cover'; LS.order=[]; LS.idx=0; LS.qidx=0; LS.played=false; LS.score=0; LS.wrong=[]; LS.playing=false;
}

// ---- session state ----
const LS = { order:[], idx:0, qidx:0, played:false, score:0, wrong:[], stage:'cover', playing:false };

function viewListening(){
  if(LS.stage==='cover') return listenCover();
  if(LS.stage==='done')  return listenDone();
  const d = LS.order[LS.idx];
  if(!d){ LS.stage='cover'; return listenCover(); }
  if(LS.stage==='dialogue') return listenDialogue(d);
  if(LS.stage==='question') return listenQuestion(d);
  return listenCover();
}
function listenCover(){
  return `<div class="sess-cover">
    <div class="kicker up">서울대 한국어+ · 3B</div>
    <div class="bigko">듣기</div>
    <div class="desc">${state.lang==='en'?'Listen to a dialogue between two people, then answer. Same format as the real test.':'Слушай диалог двух людей и отвечай на вопросы. Формат как на реальном тесте.'}</div>
    <button class="wstartbtn up" id="lsStart">${state.lang==='en'?'START':'СТАРТ'}</button>
  </div>`;
}
function listenDialogue(d){
  const lines = d.lines.map((ln,i)=>{
    const side = ln.spk==='F' ? 'right' : 'left';
    const who = ln.spk==='F' ? '여자' : '남자';
    return `<div class="bubble ${side}" data-line="${i}">
      <div class="who up">${who}</div>
      <div class="lko">${esc(ln.ko)}</div>
      <div class="ltr">${esc(state.lang==='en'?ln.en:ln.ru)}</div>
    </div>`;
  }).join('');
  return `<div class="sess-top">
      <span>듣기 <b>${LS.idx+1}</b>/${LS.order.length}</span>
      <span>${state.lang==='en'?'SCORE':'СЧЁТ'} <b>${LS.score}</b></span>
    </div>
    <div class="litem-head">
      <div class="lmeta up">${d.lesson}단원</div>
      <div class="lt">${esc(d.title.ko)}</div>
    </div>
    <div class="playwrap">
      <div class="playlabel up" id="lsHint">${state.lang==='en'?'PLAY':'ПРОИГРАТЬ'}</div>
      <button class="bigplay" id="lsPlay" aria-label="play">▶</button>
    </div>
    <div class="chat revealed">${lines}</div>
    <div class="continue-bar" id="lsToQ" style="display:none">
      <button class="continue-btn up">${state.lang==='en'?'TO QUESTIONS →':'К ВОПРОСАМ →'}</button>
    </div>`;
}
function listenQuestion(d){
  const q = d.questions[LS.qidx];
  const opts = q.options.map((o,i)=>`
    <button class="opt" data-i="${i}"><span class="num mono">${i+1}</span><span>${esc(o)}</span></button>`).join('');
  const typeLabel = q.type ? ({continue:state.lang==='en'?'CONTINUE':'ПРОДОЛЖЕНИЕ',correct:state.lang==='en'?'TRUE':'ЧТО ВЕРНО',main:state.lang==='en'?'MAIN IDEA':'ГЛАВНАЯ МЫСЛЬ'})[q.type] : '';
  const qtr = q.q ? (state.lang==='en'?q.q.en:q.q.ru) : '';
  return `<div class="sess-top">
      <span>듣기 <b>${LS.idx+1}</b>/${LS.order.length}</span>
      <span>${state.lang==='en'?'SCORE':'СЧЁТ'} <b>${LS.score}</b></span>
    </div>
    <div class="q-wrap">
      <div class="q-prog up">${esc(d.title.ko)} · ${LS.qidx+1}/${d.questions.length}</div>
      ${typeLabel?`<div class="q-type up">${typeLabel}</div>`:''}
      <div class="q-text">${esc(q.q.ko)}<div style="font-size:11px;color:var(--dim);font-weight:400;margin-top:4px">${esc(qtr)}</div></div>
      <div id="lsOpts">${opts}</div>
      <div class="explain-wrong" id="lsExplain" style="display:none"></div>
    </div>`;
}
function listenDone(){
  const wrong = LS.wrong;
  let wrongHtml='';
  if(wrong.length){
    wrongHtml = `<div class="review-title up">${state.lang==='en'?'MISTAKES':'ОШИБКИ'} — ${wrong.length}</div>`+
      wrong.map(h=>`<div class="review-item">
        <div class="review-q">${esc(h.title)} — ${esc(h.q)}</div>
        <div class="review-a bad">${state.lang==='en'?'You':'Ваш'}: ${esc(h.chosen)}</div>
        <div class="review-a ok">${state.lang==='en'?'Correct':'Верно'}: ${esc(h.correct)}</div>
      </div>`).join('');
  }
  return `<div class="sess-done">
    <div class="brand">듣기 완료</div>
    <div class="done-score mono">${LS.score} / ${LS.total}</div>
    <button class="wstartbtn up" id="lsRestart">${state.lang==='en'?'AGAIN':'ЗАНОВО'}</button>
    ${wrongHtml}
  </div>`;
}

function lsStartSession(){
  LS.order = shuffle(D.listening);
  LS.idx=0; LS.qidx=0; LS.played=false; LS.score=0; LS.wrong=[]; LS.stage='dialogue';
  LS.total = LS.order.reduce((s,d)=>s+d.questions.length,0);
  LS.playing=false;
  render(); window.scrollTo(0,0);
}

// Play a single line, resolve when finished OR after a safety timeout.
// iOS-safe: uses one Audio element, hard fallback so the loop never hangs.
function lsPlayLine(dId, i, spk, koText){
  return new Promise(resolve=>{
    let settled=false;
    const finish=()=>{ if(settled) return; settled=true; resolve(); };
    // estimate a max duration so we never get stuck (Korean ~ 0.13s per char + base)
    const estMs = Math.min(12000, 1800 + koText.length*140);
    const guard = setTimeout(finish, estMs+4000);

    let a;
    try{ a = new Audio(audioPath(dId,i,spk)); }
    catch(e){ clearTimeout(guard); return speakFallback(koText, finish); }
    _currentAudio = a;
    a.preload='auto';
    a.onended = ()=>{ clearTimeout(guard); finish(); };
    a.onerror = ()=>{ clearTimeout(guard); speakFallback(koText, finish); };
    const p = a.play();
    if(p && p.catch){ p.catch(()=>{ clearTimeout(guard); speakFallback(koText, finish); }); }
  });
}
function speakFallback(text, done){
  // Browser TTS. On iOS this only works if triggered within the original gesture chain,
  // which our play loop preserves. If speech is unavailable, resolve after a short pause.
  if(window.speechSynthesis && typeof SpeechSynthesisUtterance!=='undefined'){
    try{
      window.speechSynthesis.cancel();
      const u=new SpeechSynthesisUtterance(text);
      u.lang='ko-KR'; u.rate=0.92;
      let ended=false; const fin=()=>{ if(ended)return; ended=true; done(); };
      u.onend=fin; u.onerror=fin;
      const voices=window.speechSynthesis.getVoices();
      const kv=voices.find(v=>v.lang && v.lang.toLowerCase().startsWith('ko'));
      if(kv) u.voice=kv;
      // safety: if speech never fires onend (iOS quirk), resolve anyway
      setTimeout(fin, Math.min(9000, 1500 + text.length*140));
      window.speechSynthesis.speak(u);
    }catch(e){ setTimeout(done, 900); }
  } else {
    setTimeout(done, 900);
  }
}

async function lsPlayDialogue(d){
  if(LS.playing) return;            // guard against double-tap / re-entry
  LS.playing=true;
  const btn=$('#lsPlay'); const hint=$('#lsHint');
  const bubbles=[...document.querySelectorAll('.chat .bubble')];
  stopAudio();
  if(btn){ btn.style.pointerEvents='none'; btn.classList.add('playing'); }
  // warm up speech engine on iOS (must be inside the tap handler)
  if(window.speechSynthesis){ try{ window.speechSynthesis.resume(); }catch(e){} }
  for(let i=0;i<d.lines.length;i++){
    if(LS.stage!=='dialogue' || state.tab!=='listening'){ break; }   // aborted (tab switch)
    const ln=d.lines[i];
    if(hint) hint.textContent = `${i+1} / ${d.lines.length}`;
    bubbles.forEach(x=>x.classList.remove('active'));
    if(bubbles[i]){ bubbles[i].classList.add('active'); bubbles[i].scrollIntoView({behavior:'smooth',block:'center'}); }
    await lsPlayLine(d.id, i, ln.spk, ln.ko);
    await new Promise(r=>setTimeout(r,180));
  }
  bubbles.forEach(x=>x.classList.remove('active'));
  if(btn){ btn.style.pointerEvents=''; btn.classList.remove('playing'); }
  if(hint) hint.textContent = state.lang==='en'?'PLAY AGAIN':'СЛУШАТЬ СНОВА';
  LS.playing=false;
  if(!LS.played){ LS.played=true; const toQ=$('#lsToQ'); if(toQ) toQ.style.display='block'; }
}
function lsAnswer(d, pick){
  const q=d.questions[LS.qidx];
  const opts=document.querySelectorAll('#lsOpts .opt');
  opts.forEach((b,i)=>{
    if(i===q.answer) b.classList.add('correct');
    else if(i===pick) b.classList.add('wrong');
    else b.classList.add('dim');
    b.style.pointerEvents='none';
  });
  const correct = pick===q.answer;
  let delay=1000;
  if(correct){ LS.score++; }
  else {
    LS.wrong.push({title:d.title.ko, q:q.q.ko, chosen:q.options[pick], correct:q.options[q.answer]});
    // listening mistakes DO go to dictionary (per earlier spec: 단어/듣기 mistakes)
    dictAdd({ko:q.options[q.answer], ru:(state.lang==='ru'?(q.options_ru?q.options_ru[q.answer]:q.options[q.answer]):q.options[q.answer]), en:(q.options_en?q.options_en[q.answer]:q.options[q.answer]), src:'listening'});
    const box=$('#lsExplain');
    if(box && q.explain!==undefined || box){
      const proof = q.explain || buildProof(q, d.lines);
      if(proof){
        const head=state.lang==='en'?'WHY WRONG?':'왜 틀렸을까요?';
        box.innerHTML=`<div class="ew-head up">${head}</div><div class="ew-body">${esc(proof)}</div>`;
        box.style.display='block'; delay=3000;
      }
    }
  }
  // update score display
  const sc=document.querySelector('.sess-top b:last-child'); if(sc) sc.textContent=LS.score;
  setTimeout(()=>{
    LS.qidx++;
    if(LS.qidx < d.questions.length){ render(); window.scrollTo(0,0); }
    else { LS.qidx=0; LS.idx++; LS.played=false;
      if(LS.idx>=LS.order.length){ LS.stage='done'; }
      else { LS.stage='dialogue'; }
      render(); window.scrollTo(0,0);
    }
  }, delay);
}
function buildProof(q, lines){
  const correctText=q.options[q.answer];
  const kws=correctText.replace(/[.,!?"'”’]/g,'').split(/\s+/).filter(w=>w.length>=2);
  let best=null,bs=0;
  lines.forEach(ln=>{ let sc=0; kws.forEach(k=>{if(ln.ko.includes(k))sc++;}); if(sc>bs){bs=sc;best=ln;} });
  if(!best) return '';
  const who = best.spk==='F'?'여자':'남자';
  return `${who}가 “${best.ko}”라고 말했어요.`;
}

function bindListening(){
  if(LS.stage==='cover'){ const b=$('#lsStart'); if(b) b.onclick=lsStartSession; return; }
  if(LS.stage==='done'){ const b=$('#lsRestart'); if(b) b.onclick=lsStartSession; return; }
  const d=LS.order[LS.idx];
  if(!d){ LS.stage='cover'; render(); return; }
  if(LS.stage==='dialogue'){
    const pb=$('#lsPlay'); if(pb) pb.onclick=()=>lsPlayDialogue(d);
    const toQ=$('#lsToQ'); if(toQ){ const cb=toQ.querySelector('.continue-btn'); if(cb) cb.onclick=()=>{ stopAudio(); LS.stage='question'; LS.qidx=0; render(); window.scrollTo(0,0); }; }
  }
  if(LS.stage==='question'){
    document.querySelectorAll('#lsOpts .opt').forEach(o=>{ o.onclick=()=>lsAnswer(d,+o.dataset.i); });
  }
}

/* ============================================================
   READING — session flow (random texts, read then answer)
   any Korean word is clickable & translatable
   ============================================================ */
function tokenizeBody(body){
  return body.split(/(\s+)/).map(tok=>{
    if(/^\s+$/.test(tok)) return tok;
    const m = tok.match(/^(.*?)([.,!?"'”’)\]]*)$/su);
    const core = m ? m[1] : tok;
    const punct = m ? m[2] : '';
    if(!core) return esc(tok);
    return `<span class="w" data-w="${esc(core)}">${esc(core)}</span>${esc(punct)}`;
  }).join('');
}

const RS = { order:[], idx:0, qidx:0, score:0, wrong:[], stage:'cover', total:0 };

function viewReading(){
  if(RS.stage==='cover') return readCover();
  if(RS.stage==='done')  return readDone();
  const r = RS.order[RS.idx];
  if(!r) return readCover();
  if(RS.stage==='text') return readText(r);
  if(RS.stage==='question') return readQuestion(r);
  return readCover();
}
function readCover(){
  return `<div class="sess-cover">
    <div class="kicker up">서울대 한국어+ · 3B</div>
    <div class="bigko">읽기</div>
    <div class="desc">${state.lang==='en'?'Read a short text and tap any word you don\'t know. Then answer the questions.':'Читай короткий текст и нажимай на любое незнакомое слово. Потом отвечай на вопросы.'}</div>
    <button class="wstartbtn up" id="rsStart">${state.lang==='en'?'START':'СТАРТ'}</button>
  </div>`;
}
function readText(r){
  return `<div class="sess-top">
      <span>읽기 <b>${RS.idx+1}</b>/${RS.order.length}</span>
      <span>${state.lang==='en'?'SCORE':'СЧЁТ'} <b>${RS.score}</b></span>
    </div>
    <div class="r-detail">
      <div class="lmeta up">${r.lesson}단원</div>
      <h2>${esc(r.title.ko)}</h2>
      <div class="rtr2">${esc(r.title[state.lang]||r.title.ru)}</div>
      <div class="r-body" id="rbody">${tokenizeBody(r.body)}</div>
      <div class="hint up">${t('tap_word_hint')}</div>
    </div>
    <div class="continue-bar" id="rsToQ">
      <button class="continue-btn up">${state.lang==='en'?'TO QUESTIONS →':'К ВОПРОСАМ →'}</button>
    </div>
    <div id="glossPop" style="display:none"></div>`;
}
function readQuestion(r){
  const q=r.questions[RS.qidx];
  const opts=q.options.map((o,i)=>`
    <button class="opt" data-i="${i}"><span class="num mono">${i+1}</span><span>${esc(o)}</span></button>`).join('');
  const qtr = state.lang==='en'?q.q.en:q.q.ru;
  return `<div class="sess-top">
      <span>읽기 <b>${RS.idx+1}</b>/${RS.order.length}</span>
      <span>${state.lang==='en'?'SCORE':'СЧЁТ'} <b>${RS.score}</b></span>
    </div>
    <div class="q-wrap">
      <div class="q-prog up">${esc(r.title.ko)} · ${RS.qidx+1}/${r.questions.length}</div>
      <div class="q-text">${esc(q.q.ko)}<div style="font-size:11px;color:var(--dim);font-weight:400;margin-top:4px">${esc(qtr)}</div></div>
      <div id="rsOpts">${opts}</div>
      <div class="explain-wrong" id="rsExplain" style="display:none"></div>
    </div>`;
}
function readDone(){
  const wrong=RS.wrong;
  let wrongHtml='';
  if(wrong.length){
    wrongHtml=`<div class="review-title up">${state.lang==='en'?'MISTAKES':'ОШИБКИ'} — ${wrong.length}</div>`+
      wrong.map(h=>`<div class="review-item">
        <div class="review-q">${esc(h.title)} — ${esc(h.q)}</div>
        <div class="review-a bad">${state.lang==='en'?'You':'Ваш'}: ${esc(h.chosen)}</div>
        <div class="review-a ok">${state.lang==='en'?'Correct':'Верно'}: ${esc(h.correct)}</div>
      </div>`).join('');
  }
  return `<div class="sess-done">
    <div class="brand">읽기 완료</div>
    <div class="done-score mono">${RS.score} / ${RS.total}</div>
    <button class="wstartbtn up" id="rsRestart">${state.lang==='en'?'AGAIN':'ЗАНОВО'}</button>
    ${wrongHtml}
  </div>`;
}

function rsStartSession(){
  RS.order = shuffle(D.reading);
  RS.idx=0; RS.qidx=0; RS.score=0; RS.wrong=[]; RS.stage='text';
  RS.total = RS.order.reduce((s,r)=>s+r.questions.length,0);
  render(); window.scrollTo(0,0);
}
function rsBindWords(r){
  const gloss = r.gloss||{};
  document.querySelectorAll('#rbody .w').forEach(w=>{
    w.onclick=async(e)=>{
      e.stopPropagation();
      const ko=w.dataset.w;
      const found=lookupWord(ko,gloss);
      const label=found?tr(found):t('no_translation');
      showGlossPop(w,ko,label,!!found);
      if(found){ await dictAdd({ko:ko,ru:found.ru||label,en:found.en||label,src:'reading'}); }
    };
  });
}
function rsAnswer(r, pick){
  const q=r.questions[RS.qidx];
  const opts=document.querySelectorAll('#rsOpts .opt');
  opts.forEach((b,i)=>{
    if(i===q.answer) b.classList.add('correct');
    else if(i===pick) b.classList.add('wrong');
    else b.classList.add('dim');
    b.style.pointerEvents='none';
  });
  const correct=pick===q.answer;
  let delay=1000;
  if(correct){ RS.score++; }
  else {
    RS.wrong.push({title:r.title.ko,q:q.q.ko,chosen:q.options[pick],correct:q.options[q.answer]});
    // reading QUESTION mistakes are NOT added to dictionary (only clicked words are)
    const proof = buildReadProof(q, r.body);
    const box=$('#rsExplain');
    if(box && proof){
      const head=state.lang==='en'?'WHY WRONG?':'왜 틀렸을까요?';
      box.innerHTML=`<div class="ew-head up">${head}</div><div class="ew-body">${esc(proof)}</div>`;
      box.style.display='block'; delay=3000;
    }
  }
  const sc=document.querySelector('.sess-top b:last-child'); if(sc) sc.textContent=RS.score;
  setTimeout(()=>{
    RS.qidx++;
    if(RS.qidx<r.questions.length){ render(); window.scrollTo(0,0); }
    else { RS.qidx=0; RS.idx++;
      if(RS.idx>=RS.order.length){ RS.stage='done'; } else { RS.stage='text'; }
      render(); window.scrollTo(0,0);
    }
  }, delay);
}
function buildReadProof(q, body){
  const correctText=q.options[q.answer];
  const sentences=body.split(/(?<=[.!?])\s+/);
  const kws=correctText.replace(/[.,!?"'”’]/g,'').split(/\s+/).filter(w=>w.length>=2);
  let best=null,bs=0;
  sentences.forEach(s=>{ let sc=0; kws.forEach(k=>{if(s.includes(k))sc++;}); if(sc>bs){bs=sc;best=s;} });
  return best?`“${best.trim()}”`:'';
}

function bindReading(){
  if(RS.stage==='cover'){ const b=$('#rsStart'); if(b) b.onclick=rsStartSession; return; }
  if(RS.stage==='done'){ const b=$('#rsRestart'); if(b) b.onclick=rsStartSession; return; }
  const r=RS.order[RS.idx];
  if(RS.stage==='text'){
    rsBindWords(r);
    const toQ=$('#rsToQ'); if(toQ) toQ.querySelector('.continue-btn').onclick=()=>{
      const pop=$('#glossPop'); if(pop) pop.style.display='none';
      RS.stage='question'; RS.qidx=0; render(); window.scrollTo(0,0);
    };
  }
  if(RS.stage==='question'){
    document.querySelectorAll('#rsOpts .opt').forEach(o=>{ o.onclick=()=>rsAnswer(r,+o.dataset.i); });
  }
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
  // shuffle each task's options ONCE so the correct answer isn't always first
  state.writingShuffled = state.writingTasks.map(tk=>{
    const opts = shuffle(tk.options);
    return { sentence:tk.sentence, answer:tk.answer, options:opts, ansIdx:opts.indexOf(tk.answer) };
  });
  state.writingPos=0; state.writingAnswered=false; state.writingScore=0;
  render(); window.scrollTo(0,0);
}
function viewWritingTask(){
  const tasks=state.writingShuffled;
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
    <button class="opt" data-i="${i}" data-ans="${task.ansIdx}">
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
  const task=state.writingShuffled[state.writingPos];
  if(!task) return;
  const ansIdx=task.ansIdx;
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
  const isRu = state.lang==='ru';
  const audioTitle = isRu ? '🔊 Озвучка диалогов' : '🔊 Dialogue audio';
  const audioSteps = isRu
    ? `Чтобы звук работал одинаково везде (в том числе на iPhone), сгенерируй аудио один раз:\n1. Вставь ключ ElevenLabs (профиль → API Keys).\n2. Нажми «Сгенерировать» — скачается audio.zip.\n3. Распакуй и положи папку audio/ в репозиторий рядом с index.html, запушь.\nБез этого диалоги читает голос браузера (на iPhone он часто молчит).`
    : `So sound works everywhere (including iPhone), generate the audio once:\n1. Paste your ElevenLabs key (profile → API Keys).\n2. Tap "Generate" — audio.zip downloads.\n3. Unzip and put the audio/ folder in your repo next to index.html, then push.\nWithout it, dialogues use the browser voice (often silent on iPhone).`;
  return `<div class="info">
    <h2>정보</h2>
    <p>${esc(t('info_body'))}</p>
    <a class="iglink up" href="${IG_URL}" target="_blank" rel="noopener">Instagram: @sawwaty</a>
    <div class="madeby up">MADE BY KILF</div>

    <div class="devbox" id="devbox">
      <div class="dev-title up">${audioTitle}</div>
      <div class="devnote">${esc(audioSteps)}</div>
      <input class="devinput" id="elKey" type="password" placeholder="ElevenLabs API key (sk_...)" autocomplete="off">
      <div class="devrow">
        <input class="devinput half" id="voiceF" type="text" placeholder="${isRu?'ID женского голоса':'Female voice ID'}" value="21m00Tcm4TlvDq8ikWAM">
        <input class="devinput half" id="voiceM" type="text" placeholder="${isRu?'ID мужского голоса':'Male voice ID'}" value="onwK4e9ZLuTAKqWW03F9">
      </div>
      <button class="wbtn up devgen" id="genBtn">${isRu?'Сгенерировать и скачать':'Generate & download'}</button>
      <div class="devprog" id="genProg"></div>
    </div>
  </div>`;
}
function bindInfo(){
  const gb=$('#genBtn');
  if(gb) gb.onclick=async()=>{
    const key=($('#elKey').value||'').trim();
    const vF=($('#voiceF').value||'').trim();
    const vM=($('#voiceM').value||'').trim();
    const prog=$('#genProg');
    const isRu=state.lang==='ru';
    if(!key){ prog.textContent=isRu?'Сначала вставь ключ.':'Enter your API key first.'; return; }
    if(!vF||!vM){ prog.textContent=isRu?'Укажи оба ID голосов.':'Enter both voice IDs.'; return; }
    gb.disabled=true; gb.style.opacity='.5';
    const setP=(txt)=>{ prog.textContent=txt; };
    try{
      await generateAllAudio({
        apiKey:key, voiceF:vF, voiceM:vM,
        onProgress:(done,total,label)=>{ setP(done<total?`${done}/${total} · ${label}`:(isRu?'Собираю ZIP…':'Packaging ZIP…')); },
        onError:(msg)=>{ setP((isRu?'Ошибка: ':'Error: ')+msg); gb.disabled=false; gb.style.opacity='1'; },
        onDone:(zipBytes)=>{ downloadBytes(zipBytes,'audio.zip'); setP(isRu?'Готово! Скачан audio.zip':'Done! Downloaded audio.zip'); gb.disabled=false; gb.style.opacity='1'; }
      });
    }catch(e){ setP((isRu?'Ошибка: ':'Error: ')+e.message); gb.disabled=false; gb.style.opacity='1'; }
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
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){ stopAudio(); }
});
init();
