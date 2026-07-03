/* ============================================================
   audiogen.js — генерация озвучки диалогов прямо в браузере
   через ElevenLabs, упаковка в ZIP (без внешних библиотек).
   ============================================================ */

/* ---------- Минимальный ZIP-энкодер (метод STORE, без сжатия) ---------- */
const ZipStore = (()=>{
  // CRC32
  const crcTable = (()=>{
    let c, table=[];
    for(let n=0;n<256;n++){ c=n; for(let k=0;k<8;k++){ c = (c&1)?(0xEDB88320^(c>>>1)):(c>>>1); } table[n]=c>>>0; }
    return table;
  })();
  function crc32(bytes){
    let c=0xFFFFFFFF;
    for(let i=0;i<bytes.length;i++){ c = crcTable[(c^bytes[i])&0xFF]^(c>>>8); }
    return (c^0xFFFFFFFF)>>>0;
  }
  function strBytes(s){ return new TextEncoder().encode(s); }
  function u16(n){ return [n&0xFF,(n>>>8)&0xFF]; }
  function u32(n){ return [n&0xFF,(n>>>8)&0xFF,(n>>>16)&0xFF,(n>>>24)&0xFF]; }

  // build zip from [{name, data:Uint8Array}]
  function build(files){
    const chunks=[]; const central=[]; let offset=0;
    for(const f of files){
      const nameB = strBytes(f.name);
      const crc = crc32(f.data);
      const size = f.data.length;
      // local file header
      const local = [].concat(
        u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(size), u32(size), u16(nameB.length), u16(0)
      );
      const localHeader = new Uint8Array(local);
      chunks.push(localHeader, nameB, f.data);
      const localLen = localHeader.length + nameB.length + f.data.length;
      // central directory record
      const cen = [].concat(
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(size), u32(size), u16(nameB.length), u16(0), u16(0),
        u16(0), u16(0), u32(0), u32(offset)
      );
      central.push(new Uint8Array(cen), nameB);
      offset += localLen;
    }
    let centralSize=0; central.forEach(c=>centralSize+=c.length);
    const centralOffset=offset;
    const end = new Uint8Array([].concat(
      u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
      u32(centralSize), u32(centralOffset), u16(0)
    ));
    const all=[...chunks, ...central, end];
    let total=0; all.forEach(a=>total+=a.length);
    const out=new Uint8Array(total); let p=0;
    all.forEach(a=>{ out.set(a,p); p+=a.length; });
    return out;
  }
  return { build };
})();

/* ---------- ElevenLabs TTS ---------- */
async function elevenTTS(text, voiceId, apiKey){
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  const res = await fetch(url, {
    method:'POST',
    headers:{ 'xi-api-key':apiKey, 'Content-Type':'application/json', 'Accept':'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id:'eleven_multilingual_v2',
      voice_settings:{ stability:0.5, similarity_boost:0.75, style:0.0 }
    })
  });
  if(!res.ok){
    let msg=res.status+'';
    try{ const j=await res.json(); msg += ' '+(j.detail?.message||j.detail||JSON.stringify(j)); }catch(e){}
    throw new Error(msg);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

/* ---------- Главная функция генерации ---------- */
// opts: {apiKey, voiceF, voiceM, onProgress(done,total,label), onDone(zipBytes), onError(msg)}
async function generateAllAudio(opts){
  const dialogues = APP_DATA.listening;
  const jobs=[];
  dialogues.forEach(d=>{
    d.lines.forEach((ln,i)=>{
      jobs.push({ name:`${d.id}_${i}_${ln.spk}.mp3`, text:ln.ko, spk:ln.spk });
    });
  });
  const total=jobs.length;
  const files=[];
  for(let k=0;k<jobs.length;k++){
    const job=jobs[k];
    const voice = job.spk==='F' ? opts.voiceF : opts.voiceM;
    opts.onProgress && opts.onProgress(k, total, job.name);
    try{
      const data = await elevenTTS(job.text, voice, opts.apiKey);
      files.push({ name:'audio/'+job.name, data });
    }catch(e){
      opts.onError && opts.onError(`${job.name}: ${e.message}`);
      return; // stop on error (usually bad key or quota)
    }
    // gentle pause to respect rate limits
    await new Promise(r=>setTimeout(r,350));
  }
  opts.onProgress && opts.onProgress(total, total, '');
  const zip = ZipStore.build(files);
  opts.onDone && opts.onDone(zip);
}

/* ---------- Скачивание ---------- */
function downloadBytes(bytes, filename){
  const blob = new Blob([bytes], {type:'application/zip'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download=filename; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 1000);
}
