(() => {
  'use strict';
  const M = KalimbaMusic, song = M.song, $ = id => document.getElementById(id);
  const canvas = $('roll'), ctx = canvas.getContext('2d');
  const defaults = {speed:100, lead:5, guide:true, metronome:false, countIn:true, volume:45, loop:false, loopStart:1, loopEnd:8};
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('komorebi-settings-v1')) || {}; } catch (_) {}
  const settings = {...defaults};
  for (const key of ['guide','metronome','countIn','loop']) if (typeof saved[key] === 'boolean') settings[key] = saved[key];
  for (const [key,min,max] of [['speed',25,125],['lead',2,8],['volume',0,100],['loopStart',1,38],['loopEnd',1,38]]) {
    if (Number.isFinite(saved[key])) settings[key] = M.clamp(saved[key],min,max);
  }
  const state = {playing:false, position:0, anchorBeat:0, anchorTime:0, fresh:true, ended:false, countTarget:0, countingEnabled:false, startToken:0};
  let audio, master, scheduler, nextIndex = 0, nextClick = 0;
  let width = 0, height = 0, noticeTimer, previousFrame = 0;
  const voices = new Set(), previewFlashes = new Map();
  const ranges = [...document.querySelectorAll('input[type=range]')];
  const beatDots = [...document.querySelectorAll('.beat-indicator i')];
  const compactLayout = matchMedia('(max-width: 900px), (orientation: landscape) and (max-height: 600px), (pointer: coarse) and (max-width: 1400px)');
  const settingsPanel = document.querySelector('.settings');
  const settingsHome = settingsPanel.parentElement;
  let seeking = false, seekWasPlaying = false;
  function save() { try { localStorage.setItem('komorebi-settings-v1', JSON.stringify(settings)); } catch (_) {} }
  function bounds() { return settings.loop ? M.loopRange(settings.loopStart,settings.loopEnd) : {start:0,end:song.totalBeats}; }
  function rate() { return settings.speed / 100; }
  function currentBeat() { return state.playing ? M.beatAt(state.anchorBeat,state.anchorTime,audio.currentTime,song.bpm,rate()) : state.position; }
  function secondsFor(beat) { return beat * 60 / (song.bpm * rate()); }
  function formatTime(seconds) { const t = Math.max(0,Math.round(seconds)); return Math.floor(t/60) + ':' + String(t%60).padStart(2,'0'); }
  function showNotice(message) { $('notice').textContent=message; $('notice').hidden=false; clearTimeout(noticeTimer); noticeTimer=setTimeout(()=>{$('notice').hidden=true;},4500); }
  function updateSlider(el) { const value = (Number(el.value)-Number(el.min))/(Number(el.max)-Number(el.min))*100; el.style.setProperty('--progress',value+'%'); }
  async function ensureAudio() {
    if (!audio) {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) throw new Error('このブラウザーでは音声機能を利用できません。Safari・Chrome・Edgeのいずれかで開いてください。');
      audio = new Audio({latencyHint:'interactive'});
      master=audio.createGain(); master.gain.value=settings.volume/100; master.connect(audio.destination);
      audio.addEventListener('statechange',()=>{
        if (state.playing && audio.state !== 'running') { pause(); showNotice('音声が中断されたため一時停止しました。再生ボタンで再開できます。'); }
      });
    }
    await audio.resume();
  }
  function sound(midi, when, duration, kind='note') {
    if (!audio || audio.state !== 'running') return;
    const start = Math.max(when,audio.currentTime);
    const voice = {kind, nodes:[], gains:[]};
    const harmonics = kind === 'click' ? [[1,1]] : [[1,1],[2.76,.12],[5.4,.035]];
    const length = kind === 'click' ? .07 : Math.max(.2,Math.min(duration,2.8));
    harmonics.forEach(([multiple,weight],i)=>{
      const oscillator=audio.createOscillator(), gain=audio.createGain();
      oscillator.type='sine';
      oscillator.frequency.value=(kind==='click' ? midi : 440*Math.pow(2,(midi-69)/12))*multiple;
      gain.gain.setValueAtTime(0,start);
      gain.gain.linearRampToValueAtTime((kind==='click' ? .16 : .38)*weight,start+.006);
      gain.gain.exponentialRampToValueAtTime(.0001,start+length/(i+1)+.025);
      oscillator.connect(gain); gain.connect(master); oscillator.start(start); oscillator.stop(start+length/(i+1)+.04);
      voice.nodes.push(oscillator); voice.gains.push(gain);
    });
    voices.add(voice);
    let remaining=voice.nodes.length;
    voice.nodes.forEach((node,i)=>node.onended=()=>{node.disconnect();voice.gains[i].disconnect();if(--remaining===0) voices.delete(voice);});
  }
  function stopSounds(kind) {
    if (!audio) return;
    for (const voice of voices) if (!kind || voice.kind===kind) {
      voice.gains.forEach(g=>{g.gain.cancelScheduledValues(audio.currentTime);g.gain.setValueAtTime(0,audio.currentTime);});
      voice.nodes.forEach(n=>{try {n.stop(audio.currentTime+.005);} catch (_) {}});
    }
  }
  function setAnchor(beat, withCount, startTime=audio.currentTime+.045) {
    const anchor=withCount ? beat-3 : beat;
    state.position=beat;state.anchorBeat=anchor;state.anchorTime=startTime;state.countTarget=beat;state.countingEnabled=withCount;
    nextIndex=song.notes.findIndex(n=>n.beat>=beat-1e-7);
    if(nextIndex<0) nextIndex=song.notes.length;
    nextClick=Math.ceil(anchor-1e-7);
  }
  function schedule() {
    if(!state.playing || audio.state!=='running') return;
    const beat=currentBeat(), range=bounds();
    if(beat>=range.end) {
      if(settings.loop) {
        const boundaryTime=M.timeAt(range.end,state.anchorBeat,state.anchorTime,song.bpm,rate());
        stopSounds();setAnchor(range.start,settings.countIn,boundaryTime);
      }
      else {finish();return;}
    }
    const horizon=audio.currentTime+.12;
    while(nextIndex<song.notes.length) {
      const n=song.notes[nextIndex];
      if(n.beat>=range.end) break;
      const when=M.timeAt(n.beat,state.anchorBeat,state.anchorTime,song.bpm,rate());
      if(when>horizon) break;
      if(settings.guide && when>=audio.currentTime-.04) sound(n.midi,when,secondsFor(n.duration));
      nextIndex++;
    }
    while(nextClick<range.end) {
      const when=M.timeAt(nextClick,state.anchorBeat,state.anchorTime,song.bpm,rate());
      if(when>horizon) break;
      const counting=nextClick<state.countTarget;
      if(when>=audio.currentTime-.04 && (settings.metronome || counting)) sound(((nextClick%3)+3)%3===0?1250:900,when,.07,'click');
      nextClick++;
    }
  }
  async function play() {
    if(state.playing) {pause();return;}
    const token=++state.startToken;
    try {
      await ensureAudio();
      if(token!==state.startToken) return;
      const range=bounds();
      let beat=state.position;
      if(beat<range.start || beat>=range.end-.001) beat=range.start;
      state.playing=true;state.fresh=false;state.ended=false;
      setAnchor(beat,settings.countIn);
      clearInterval(scheduler);scheduler=setInterval(schedule,25);schedule();updateControls();
    } catch(error) { showNotice(error.message || '音を開始できませんでした。もう一度再生してください。'); }
  }
  function pause() {
    ++state.startToken;
    if(state.playing) state.position=M.clamp(Math.max(state.countTarget,currentBeat()),0,song.totalBeats);
    state.playing=false;clearInterval(scheduler);stopSounds();updateControls();
  }
  function finish() { pause();state.position=song.totalBeats;state.ended=true;updateControls(); }
  function seek(beat, count=true) {
    state.position=M.clamp(beat,0,song.totalBeats);state.fresh=false;state.ended=false;
    if(settings.loop) {const range=bounds();state.position=M.clamp(state.position,range.start,range.end-.001);}
    state.countTarget=state.position;
    if(state.playing) {stopSounds();setAnchor(state.position,count&&settings.countIn);schedule();}
    updateControls();
  }
  function setSpeed(value) {
    const before=currentBeat(), counting=state.playing && state.countingEnabled && before<state.countTarget;
    const target=state.countTarget;
    settings.speed=M.clamp(Number(value)||100,25,125);
    if(state.playing) {
      stopSounds();
      // Re-anchor against the old position, preserving elapsed music and the countdown.
      setAnchor(Math.max(before,target),false,audio.currentTime);
      if(counting) {state.anchorBeat=before;state.countTarget=target;state.countingEnabled=true;nextClick=Math.ceil(before);}
      schedule();
    }
    save();syncSettings();
  }
  function syncSettings() {
    $('speed').value=settings.speed;$('lead').value=settings.lead;$('volume').value=settings.volume;
    $('speed-value').textContent=settings.speed;$('lead-value').textContent=settings.lead;$('bpm-value').textContent=(song.bpm*rate()).toFixed(1).replace('.0','')+' BPM';
    $('mobile-speed').textContent=settings.speed+'%';
    for(const [id,key] of [['guide','guide'],['metronome','metronome'],['count-in','countIn'],['loop','loop']]) $(id).checked=settings[key];
    const range=M.loopRange(settings.loopStart,settings.loopEnd);
    settings.loopStart=range.first;settings.loopEnd=range.last;
    $('loop-start').value=range.first;$('loop-end').value=range.last;
    $('loop-hint').textContent=settings.loop ? range.first+'〜'+range.last+'小節をくり返します。' : '指定した小節をくり返し練習できます。';
    document.querySelectorAll('[data-speed]').forEach(b=>{b.classList.toggle('selected',Number(b.dataset.speed)===settings.speed);b.setAttribute('aria-pressed',String(Number(b.dataset.speed)===settings.speed));});
    ranges.forEach(updateSlider);$('duration').textContent=formatTime(secondsFor(song.totalBeats));
  }
  function updateControls() {
    const label=state.playing?'一時停止':state.ended?'もう一度練習':state.fresh?'練習をはじめる':'再生する';
    $('play').querySelector('span').textContent=label;
    $('play-icon').innerHTML=state.playing?'<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>':'<path d="m9 5 11 7-11 7z"/>';
    $('play').setAttribute('aria-label',label);
  }
  function geometry() {
    return KalimbaLayout.geometry(width, height);
  }
  function roundRect(x,y,w,h,r,fill,stroke) {
    ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke();}
  }
  function text(value,x,y,size,color,weight='400',font='"Yu Gothic UI", Meiryo, sans-serif') {
    ctx.font=weight+' '+size+'px '+font;ctx.fillStyle=color;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(value,x,y);
  }
  function noteColor(lane) { return lane<8?'#628e80':lane===8?'#9a7e50':'#c3955f'; }
  function draw(beat, now) {
    if(!width || !height) return;
    const {padding,laneWidth:lw,top,line,boardTop,boardBottom,compact}=geometry();
    ctx.clearRect(0,0,width,height);
    ctx.fillStyle='#fafbf6';ctx.fillRect(0,0,width,height);
    // One continuous grid: notes and tines share exactly the same x coordinates.
    for(let lane=0;lane<17;lane++) {
      const x=padding+lane*lw;
      ctx.fillStyle=lane===8?'#ebece0':lane%2===0?'#f0f3eb':'#f7f8f2';ctx.fillRect(x,0,lw,line+2);
      ctx.strokeStyle='#e4e9de';ctx.lineWidth=.6;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,line+6);ctx.stroke();
    }
    const beatSpan=settings.lead*song.bpm*rate()/60;
    for(let b=Math.ceil(beat);b<=beat+beatSpan;b++) {
      const y=M.noteY(b,beat,song.bpm,rate(),settings.lead,top,line);
      if(y<top-10 || y>line) continue;
      const major=((b%3)+3)%3===0;
      ctx.strokeStyle=major?'#dce3d4':'#e9ede3';ctx.lineWidth=major?1:.6;ctx.beginPath();ctx.moveTo(padding,y);ctx.lineTo(width-padding,y);ctx.stroke();
      if(major && b>=0 && b<song.totalBeats) text(String(Math.floor(b/3)+1),padding/2,y,8,'#a3af99');
    }
    const hitLanes=new Set();
    if(state.playing && beat>=state.countTarget) {
      for(let i=0;i<song.notes.length;i++) {
        const n=song.notes[i], since=secondsFor(beat-n.beat);
        if(since>=0 && since<.18) hitLanes.add(n.lane);
      }
    }
    for(const [lane,until] of previewFlashes) {if(now<until)hitLanes.add(lane);else previewFlashes.delete(lane);}
    for(const lane of hitLanes) {
      const gradient=ctx.createLinearGradient(0,line-90,0,line);
      gradient.addColorStop(0,'#c6d8b800');gradient.addColorStop(1,lane<8?'#aacaba88':'#e2c79999');
      ctx.fillStyle=gradient;ctx.fillRect(padding+lane*lw,line-90,lw,90);
    }
    const range=bounds();
    for(const n of song.notes) {
      if(settings.loop && (n.beat<range.start || n.beat>=range.end)) continue;
      if(state.playing && n.beat<state.countTarget-1e-7) continue;
      const y=M.noteY(n.beat,beat,song.bpm,rate(),settings.lead,top,line);
      if(y<top-15 || y>line+10 || n.beat<beat-.035) continue;
      const x=padding+(n.lane+.5)*lw,nw=Math.min(lw*.76,39),nh=width<500?18:23;
      roundRect(x-nw/2,y-nh/2+2,nw,nh,5,'#243e2512');
      roundRect(x-nw/2,y-nh/2,nw,nh,5,noteColor(n.lane));
      text(String(n.degree),x,y+.5,Math.min(13,lw*.48),'#fffef7','600');
      if(n.dots) text('•'.repeat(n.dots),x,y-nh/2-6,8,noteColor(n.lane));
    }
    // Fixed strike line, independent of the physical tine lengths below.
    ctx.strokeStyle='#8caa82';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(padding-5,line);ctx.lineTo(width-padding+5,line);ctx.stroke();
    for(const x of [padding-6,width-padding+6]) {ctx.beginPath();ctx.arc(x,line,3,0,Math.PI*2);ctx.fillStyle='#8caa82';ctx.fill();}
    text('弾くタイミング',width/2,line+(compact?9:13),8,'#66765b');
    // Stylized wooden body; no remote image or font is required.
    const wood=ctx.createLinearGradient(padding,boardTop,width-padding,boardBottom);
    wood.addColorStop(0,'#b77a40');wood.addColorStop(.28,'#d6a46b');wood.addColorStop(.52,'#c99457');wood.addColorStop(1,'#aa713e');
    roundRect(padding-11,boardTop,width-padding*2+22,boardBottom-boardTop,13,wood,'#ae7c48');
    ctx.save();ctx.beginPath();ctx.roundRect(padding-10,boardTop+1,width-padding*2+20,boardBottom-boardTop-2,12);ctx.clip();
    for(let i=0;i<35;i++) {const y=boardTop+7+i*5;ctx.beginPath();ctx.moveTo(padding-12,y);ctx.bezierCurveTo(width*.3,y+5,width*.7,y-6,width-padding+11,y+3);ctx.strokeStyle=i%3===0?'#83522518':'#f3d5aa19';ctx.lineWidth=.7;ctx.stroke();}
    ctx.restore();
    const centerX=padding+8.5*lw;
    ctx.beginPath();ctx.ellipse(centerX,boardBottom-27,Math.min(30,lw*1.35),18,0,0,Math.PI*2);ctx.fillStyle='#6f472f';ctx.fill();
    ctx.beginPath();ctx.ellipse(centerX,boardBottom-27,Math.min(25,lw*1.15),14,0,0,Math.PI*2);ctx.fillStyle='#4d3527';ctx.fill();
    for(const key of M.keys) {
      const bounds=KalimbaLayout.keyBounds(key.lane,width,height);
      const x=bounds.x,kw=bounds.width,bottom=bounds.bottom,topY=bounds.top,kh=bottom-topY;
      roundRect(x+2,topY+3,kw,kh,4,'#65441e35');
      const metal=ctx.createLinearGradient(x,0,x+kw,0);metal.addColorStop(0,'#c9cfc6');metal.addColorStop(.2,'#f0f0e6');metal.addColorStop(.8,'#e6e8dc');metal.addColorStop(1,'#b7c0b3');
      roundRect(x,topY,kw,kh,4,hitLanes.has(key.lane)?(key.lane<8?'#b7d8c7':'#f2d29f'):metal,'#f6f4e188');
      if(key.lane===8) roundRect(x+kw*.25,topY+15,kw*.5,3,1,'#b59054');
      const fs=Math.min(16,lw*.51);
      text(String(key.degree),x+kw/2,bottom-(compact?11:18),fs,hitLanes.has(key.lane)?'#355642':'#52614c','600');
      text(key.name[0],x+kw/2,bottom-(compact?26:34),Math.min(10,lw*.36),'#6f7c62');
      if(key.dots) text('•'.repeat(key.dots),x+kw/2,bottom-(compact?37:47),Math.min(9,lw*.34),'#52654a');
      text(key.solfege,padding+(key.lane+.5)*lw,height-7,Math.min(8,lw*.29),'#939a87');
    }
    roundRect(padding-6,boardTop+4,width-padding*2+12,8,3,'#aab2a2','#dce1d2');
    ctx.fillStyle='#f5f8ec88';ctx.fillRect(padding-3,boardTop+5,width-padding*2+6,1);
    // Soft top fade keeps the next notes readable beneath the caption.
    const fadeHeight=compact?15:43;
    const fade=ctx.createLinearGradient(0,0,0,fadeHeight);fade.addColorStop(0,'#fafbf6');fade.addColorStop(.5,'#fafbf6ef');fade.addColorStop(1,'#fafbf600');ctx.fillStyle=fade;ctx.fillRect(0,0,width,fadeHeight);
  }
  function updateReadout(beat) {
    const position=M.clamp(Math.max(state.countTarget,beat),0,song.totalBeats);
    const counting=state.playing && state.countingEnabled && beat<state.countTarget;
    $('countdown').hidden=!counting;
    if(counting) $('countdown').querySelector('strong').textContent=Math.min(3,Math.max(1,Math.ceil(state.countTarget-beat)));
    $('status').textContent=counting?'3拍カウント中':state.playing?'演奏中 · 自分のペースで':state.ended?'おつかれさまでした':state.fresh?'準備できました':'一時停止中';
    const measure=Math.min(song.bars,Math.floor(position/3)+1);
    $('measure-label').textContent=measure+' / '+song.bars+' 小節';
    $('elapsed').textContent=formatTime(secondsFor(position));
    if(!seeking) {$('seek').value=position;updateSlider($('seek'));}
    const active=state.playing?((Math.floor(beat)%3)+3)%3:-1;
    beatDots.forEach((dot,i)=>dot.classList.toggle('active',i===active));
    const end=bounds().end;
    const next=song.notes.find(n=>n.beat>=position-.035 && n.beat<end);
    if(next) {
      const dots='•'.repeat(next.dots);
      $('next-note').innerHTML='次の音 <b>'+next.degree+dots+' '+next.solfege+'</b>';
      const distance=Math.abs(next.lane-8);
      $('next-detail').textContent=distance===0?'中央の鍵盤':('中央から'+(next.lane<8?'左':'右')+'へ'+distance+'本目');
    } else {$('next-note').innerHTML=state.ended?'最後まで演奏しました':'余韻を聴きましょう';$('next-detail').textContent=state.ended?'もう一度、好きな速さで。':'次のマーカーまで弾き直さなくて大丈夫です。';}
  }
  function frame(now) {
    const beat=currentBeat();
    const displayBeat=state.fresh?bounds().start-3:beat;
    draw(displayBeat,now);
    if(now-previousFrame>45) {updateReadout(beat);previousFrame=now;}
    requestAnimationFrame(frame);
  }
  function resize() {
    const rect=canvas.getBoundingClientRect();width=rect.width;height=rect.height;
    const dpr=Math.min(window.devicePixelRatio||1,2);
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  $('play').addEventListener('click',play);
  $('restart').addEventListener('click',()=>{seek(bounds().start);if(!state.playing){state.fresh=true;updateControls();}});
  $('back').addEventListener('click',()=>{const beat=Math.max(state.countTarget,currentBeat());seek(Math.max(bounds().start,(Math.floor((beat+1e-7)/3)-1)*3));});
  function beginSeek() {
    if(seeking) return;
    seeking=true;seekWasPlaying=state.playing;pause();
  }
  function endSeek() {
    if(!seeking) return;
    seeking=false;
    if(seekWasPlaying && !$('settings-dialog').open && !$('help-dialog').open) play();
    seekWasPlaying=false;
  }
  $('seek').addEventListener('pointerdown',beginSeek);
  $('seek').addEventListener('input',e=>{beginSeek();seek(Number(e.target.value),false);updateSlider(e.target);});
  $('seek').addEventListener('change',endSeek);
  $('seek').addEventListener('blur',endSeek);
  window.addEventListener('pointerup',endSeek);
  window.addEventListener('pointercancel',()=>{seekWasPlaying=false;endSeek();});
  $('speed').addEventListener('input',e=>setSpeed(e.target.value));
  document.querySelectorAll('[data-speed]').forEach(b=>b.addEventListener('click',()=>setSpeed(b.dataset.speed)));
  $('lead').addEventListener('input',e=>{settings.lead=Number(e.target.value);save();syncSettings();});
  $('volume').addEventListener('input',e=>{settings.volume=Number(e.target.value);if(master)master.gain.setTargetAtTime(settings.volume/100,audio.currentTime,.015);save();updateSlider(e.target);});
  for(const [id,key] of [['guide','guide'],['metronome','metronome'],['count-in','countIn']]) $(id).addEventListener('change',e=>{
    settings[key]=e.target.checked;
    if(key==='guide'&&!settings.guide)stopSounds('note');
    if(key==='metronome'&&!settings.metronome)stopSounds('click');
    save();
  });
  function changeLoop() {
    const wasPlaying=state.playing;
    if(wasPlaying)pause();
    settings.loop=$('loop').checked;
    const range=M.loopRange($('loop-start').value,$('loop-end').value);
    settings.loopStart=range.first;settings.loopEnd=range.last;
    if(settings.loop)seek(range.start);else state.countTarget=state.position;
    save();syncSettings();if(wasPlaying)play();
  }
  $('loop').addEventListener('change',changeLoop);$('loop-start').addEventListener('change',changeLoop);$('loop-end').addEventListener('change',changeLoop);
  canvas.addEventListener('click',async e=>{
    const rect=canvas.getBoundingClientRect(),{padding,laneWidth,boardTop,boardBottom}=geometry();
    const x=e.clientX-rect.left,y=e.clientY-rect.top,lane=Math.floor((x-padding)/laneWidth);
    if(y<boardTop-5 || y>boardBottom || lane<0 || lane>=17) return;
    try{await ensureAudio();sound(M.keys[lane].midi,audio.currentTime,1.8);previewFlashes.set(lane,performance.now()+220);}catch(error){showNotice(error.message);}
  });
  document.addEventListener('keydown',e=>{
    if(e.code==='Space'&&!e.repeat&&!$('help-dialog').open&&!$('settings-dialog').open&&!/INPUT|BUTTON|SELECT|TEXTAREA/.test(e.target.tagName)){e.preventDefault();play();}
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden && state.playing){pause();showNotice('画面を離れたため、一時停止しました。');}});
  const openHelp=()=>{pause();$('help-dialog').showModal();};
  $('help').addEventListener('click',openHelp);
  $('mobile-help').addEventListener('click',openHelp);
  $('close-help').addEventListener('click',()=>$('help-dialog').close());
  $('help-dialog').addEventListener('click',e=>{if(e.target===$('help-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
  window.addEventListener('pagehide',()=>{if(state.playing)pause();});
  function syncLayout() {
    document.body.classList.toggle('compact-ui',compactLayout.matches);
    if(compactLayout.matches) $('settings-mount').append(settingsPanel);
    else {
      if($('settings-dialog').open) $('settings-dialog').close();
      settingsHome.append(settingsPanel);
    }
  }
  $('open-settings').addEventListener('click',()=>{
    pause();$('settings-dialog').showModal();$('open-settings').setAttribute('aria-expanded','true');
  });
  $('close-settings').addEventListener('click',()=>$('settings-dialog').close());
  $('settings-dialog').addEventListener('close',()=>$('open-settings').setAttribute('aria-expanded','false'));
  $('settings-dialog').addEventListener('click',e=>{
    if(e.target!==$('settings-dialog')) return;
    const r=e.target.getBoundingClientRect();
    if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();
  });
  compactLayout.addEventListener('change',syncLayout);
  $('fullscreen').hidden=!document.fullscreenEnabled;
  $('fullscreen').addEventListener('click',async()=>{
    try {
      if(document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (_) {showNotice('全画面にできませんでした。横向きのまま練習できます。');}
  });
  document.addEventListener('fullscreenchange',()=>{
    const label=document.fullscreenElement?'全画面を終了':'全画面にする';
    $('fullscreen').setAttribute('aria-label',label);$('fullscreen').title=label;
  });
  syncLayout();
  syncSettings();
  if(settings.loop){state.position=bounds().start;state.countTarget=state.position;}
  new ResizeObserver(resize).observe(canvas);resize();updateControls();updateReadout(state.position);requestAnimationFrame(frame);
})();
