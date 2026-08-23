(() => {
  // ─── Canvas & input setup ─────────────────────────────────────────────────
  const c = document.querySelector('#game');
  const x = c.getContext('2d');
  const W = 960, H = 576;
  const K = new Set();
  x.imageSmoothingEnabled = false;

  // ─── OpenRouter config (key loaded from config.js, which is gitignored) ──
  const OR_KEY   = window.OPENROUTER_KEY || '';
  const OR_MODEL = 'google/gemma-3-27b-it:free';

  // ─── Character sprite (flood-fill white -> transparent) ──────────────────
  const characterSheet = new Image();
  let characterReady = false;
  characterSheet.onload = () => {
    const o = document.createElement('canvas');
    const q = o.getContext('2d');
    o.width  = characterSheet.width;
    o.height = characterSheet.height;
    q.drawImage(characterSheet, 0, 0);
    const d    = q.getImageData(0, 0, o.width, o.height);
    const seen = new Uint8Array(o.width * o.height);
    const stack = [];
    for (let i = 0; i < o.width; i++)      stack.push(i, (o.height - 1) * o.width + i);
    for (let j = 0; j < o.height; j++)     stack.push(j * o.width, j * o.width + o.width - 1);
    while (stack.length) {
      const n = stack.pop();
      if (seen[n]) continue;
      seen[n] = 1;
      const k = n * 4;
      if (d.data[k] < 248 || d.data[k + 1] < 248 || d.data[k + 2] < 248) continue;
      d.data[k + 3] = 0;
      const px = n % o.width, py = (n / o.width) | 0;
      if (px)               stack.push(n - 1);
      if (px < o.width - 1) stack.push(n + 1);
      if (py)               stack.push(n - o.width);
      if (py < o.height-1)  stack.push(n + o.width);
    }
    q.putImageData(d, 0, 0);
    characterSheet.onload = null;
    characterSheet.src = o.toDataURL();
    characterReady = true;
  };
  characterSheet.src = 'assets/character-sprites.png';

  // ─── Default classrooms ───────────────────────────────────────────────────
  const base = [
    ['Photosynthesis','Maya', 'curious', '#d86865','Explain how plants turn light into food.',    ['sunlight','chlorophyll','glucose']],
    ['Algebra',       'Theo', 'careful', '#4b7bbd','Explain how to solve a simple equation.',     ['variable','balance','inverse operation']],
    ['Storytelling',  'Iris', 'creative','#9b71ae','Explain how stories hold attention.',         ['character','conflict','setting']],
  ];

  let topics = (
    JSON.parse(localStorage.getItem('teachback-topics') || 'null') ||
    base.map(([name,persona,style,color,goal,ideas]) => ({name,persona,style,color,goal,ideas}))
  ).map(t => ({...t, goal: t.goal||`Teach the main ideas of ${t.name}.`, ideas: t.ideas||[]}));

  let progress = JSON.parse(localStorage.getItem('teachback-progress') || '{}');
  let conversationHistory = {};
  let room = 'hub', topic, last = performance.now();
  let p = {x:480, y:470, dir:'down', step:0};

  const $ = s => document.querySelector(s);
  const dlg   = $('#topic-dialog');
  const teach = $('#teach-dialog');
  const report= $('#report-dialog');
  const loc   = $('#location-label');

  // ─── Draw helpers ─────────────────────────────────────────────────────────
  const R = (a,b,d,e,f) => { x.fillStyle=f; x.fillRect(a,b,d,e); };
  const T = (s,a,b,z=14,col='#fff8d5',al='left') => {
    x.fillStyle=col; x.font=`900 ${z}px "Trebuchet MS",monospace`;
    x.textAlign=al; x.fillText(s,a,b);
  };

  // ─── Save / stats ─────────────────────────────────────────────────────────
  function save() {
    localStorage.setItem('teachback-topics',   JSON.stringify(topics));
    localStorage.setItem('teachback-progress', JSON.stringify(progress));
    stats();
  }
  function stats() {
    const vals = Object.values(progress);
    const n = vals.reduce((v,o) => v+(o.xp||0), 0);
    $('#xp-value').textContent    = n;
    $('#streak-value').textContent= vals.length ? 1 : 0;
  }

  // ─── Pixel-art scene primitives ───────────────────────────────────────────
  function grass(a,b,d,e){
    R(a,b,d,e,'#5cb86b');
    for(let j=b+6;j<b+e;j+=17)
      for(let i=a+(j%34?4:12);i<a+d;i+=19){
        R(i,j,2,4,'#3d8050'); R(i+3,j+2,2,2,'#82c86e');
      }
  }
  function path(a,b,d,e){
    R(a,b,d,e,'#c9a85a');
    for(let j=b+7;j<b+e;j+=15)
      for(let i=a+5;i<a+d;i+=19) R(i,j,3,2,'#a07843');
  }
  function tree(a,b){
    R(a-16,b+17,32, 5,'#2e5a52');
    R(a- 8,b+ 8,16,19,'#7a4f32');
    R(a-20,b-13,40,32,'#1e6b48');
    R(a-14,b-22,28,40,'#2a7a4e');
    R(a-23,b- 4,46,15,'#38956a');
    R(a-10,b-13, 5, 5,'#6ab86a');
    R(a- 6,b-18, 2, 2,'#98e888');
  }
  function roof(a,b,d){
    R(a,b,d,16,'#b04848');
    R(a+5,b+3,d-10,5,'#e87050');
    for(let i=a+7;i<a+d-7;i+=13) R(i,b+9,8,3,'#7a3040');
  }
  function house(a,b,d,e,col){
    R(a+6,     b+e+4, d-12, 5,'#284d4b');
    R(a,       b+14,  d,    e-14,'#eecf7e');
    roof(a,b,d);
    R(a+8,     b+25,  d-16, 8,'#c89658');
    R(a+d/2-22,b+e-35,44,  35,col);
    R(a+d/2-16,b+e-29,32,  29,'#3a5e6a');
    R(a+d/2+11,b+e-15, 3,   3,'#f0c860');
  }
  function sprite(t,a,b,player=false){
    R(a-18,b+18,36,5,'#2a4a4a88');
    if(characterReady){
      x.drawImage(characterSheet,0,player?0:94,94,94,a-37,b-57,74,74);
      if(!player) T(t.persona[0],a,b-43,10,'#fffbe2','center');
      return;
    }
    R(a-12,b-20,24,35,player?'#466db0':'#d86865');
    R(a-10,b-34,20,18,'#f1c49a');
  }
  function desk(a,b){
    R(a+3,b+34,62, 5,'#654033');
    R(a,  b+ 8,68,29,'#6e4030');
    R(a+5,b+ 4,58,18,'#b87a46');
    R(a+8,b+ 7,52,12,'#ddb86e');
  }

  // ─── Hub scene ────────────────────────────────────────────────────────────
  function hub(){
    grass(0,0,W,H);
    path(374,0,212,H); path(0,373,W,110);
    house(55, 60,220,145,'#4d7985');
    house(370,45,220,160,'#876eab');
    house(685,60,220,145,'#c66757');
    tree(40,255);tree(920,250);tree(95,530);tree(865,530);
    // title with pixel drop shadow
    T('TEACHBACK ACADEMY',482,33,14,'#000000a0','center');
    T('TEACHBACK ACADEMY',480,31,14,'#fff8d3',  'center');
    T('COURTYARD',        480,225,9,'#2e5a48',  'center');
    topics.slice(0,6).forEach((t,i) => {
      const ax=[165,480,795,165,480,795][i], ay=i<3?200:430;
      R(ax-56,ay,   112,23,'#102d3fcc');
      R(ax-54,ay,   110, 2,'#1e5870aa');
      T(t.name.toUpperCase(),ax,ay+16,8,'#fff6d1','center');
      if(Math.hypot(p.x-ax,p.y-(ay+30))<94){
        R(ax-80,ay+36,160,23,'#122e40ee');
        T(`E -> ENTER ${t.name.toUpperCase()}`,ax,ay+52,7,'#ffe89a','center');
      }
    });
  }

  // ─── Classroom scene ──────────────────────────────────────────────────────
  function classroom(){
    R(0,0,W,H,'#a0c09a');
    R(32,40,W-64,H-80,'#d8b860');
    for(let j=65;j<H-50;j+=32)
      for(let i=50;i<W-50;i+=32) R(i,j,2,2,'#c09840');
    R(32, 40,W-64,15,'#6a4035');
    R(32, 40,  15,H-80,'#6a4035');
    R(913,40,  15,H-80,'#6a4035');
    R(32, 521,390,15,'#6a4035');
    R(538,521,390,15,'#6a4035');
    R(410,519,140,17,'#3a6070');
    R(300, 98,360,46,'#2a4a3a');
    R(302,100,356,42,'#2e5a48');
    T(topic.name.toUpperCase(),480,82, 16,'#4a2e38','center');
    T(topic.goal,              480,127, 9,'#d0ead8','center');
    [[105,205],[265,205],[625,205],[785,205],[185,365],[705,365]].forEach(d=>desk(...d));
    tree(78,475); tree(882,475);
    sprite(topic,480,310);
    T('EXIT v',480,548,8,'#fff7d3','center');
  }

  function near(){ return room==='room' && Math.hypot(p.x-480,p.y-320)<74; }

  function draw(){
    room==='hub'?hub():classroom();
    sprite({},p.x,p.y,true);
    if(near()&&!teach.open){
      R(310,158,340,26,'#102e40de');
      T(`E -> TALK TO ${topic.persona.toUpperCase()}`,480,176,8,'#ffe89a','center');
    }
  }

  function hit(a,b){
    if(room==='hub') return a<25||a>935||b<25||b>550;
    if(a<60||a>900||b<65||(b>540&&!(a>420&&a<540))) return true;
    return [[105,205],[265,205],[625,205],[785,205],[185,365],[705,365]]
      .some(([i,j])=>a>i&&a<i+68&&b>j&&b<j+38);
  }

  function leave(){
    room='hub'; topic=null;
    p={x:480,y:338,dir:'up',step:0};
    loc.textContent='COURTYARD · Choose a classroom';
  }

  function move(dt){
    if(dlg.open||teach.open||report.open) return;
    let a=0,b=0;
    if(K.has('arrowleft') ||K.has('a')){a=-1;p.dir='left';}
    if(K.has('arrowright')||K.has('d')){a= 1;p.dir='right';}
    if(K.has('arrowup')   ||K.has('w')){b=-1;p.dir='up';}
    if(K.has('arrowdown') ||K.has('s')){b= 1;p.dir='down';}
    if(a||b){
      const q=Math.hypot(a,b);
      const ni=p.x+a/q*180*dt, nj=p.y+b/q*180*dt;
      if(!hit(ni,nj)){p.x=ni;p.y=nj;}
      p.step+=dt*15;
    }
    if(room==='room'&&p.y>548&&p.x>420&&p.x<540) leave();
  }

  // ─── Conversation UI ──────────────────────────────────────────────────────
  function bubble(m,who){
    const e=document.createElement('div');
    e.className=`bubble ${who}`;
    e.textContent=m;
    $('#conversation').append(e);
    e.scrollIntoView({block:'end',behavior:'smooth'});
  }
  function setInputLocked(locked){
    $('#teach-input').disabled=locked;
    $('#teach-form').querySelector('button').disabled=locked;
  }
  function showTyping(){
    const e=document.createElement('div');
    e.className='bubble student typing-bubble';
    e.id='typing-indicator';
    e.innerHTML='<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
    $('#conversation').append(e);
    e.scrollIntoView({block:'end',behavior:'smooth'});
  }
  function removeTyping(){
    const el=$('#typing-indicator');
    if(el) el.remove();
  }

  // ─── Open lesson dialog ───────────────────────────────────────────────────
  function openLesson(){
    $('#lesson-topic').textContent   =topic.name.toUpperCase();
    $('#lesson-title').textContent   =`Teach ${topic.persona}`;
    $('#lesson-subtitle').textContent=`Goal: ${topic.goal}`;
    $('#portrait').textContent       =topic.persona[0];
    $('#portrait').style.background  =topic.color;
    $('#conversation').innerHTML     ='';

    const ideasList=topic.ideas.join(', ');
    const personalityDesc={
      curious: 'curious and enthusiastic — you love asking "why?" and "what if?"',
      careful: 'careful and analytical — you like step-by-step logic and often ask "how do we know?"',
      creative:'creative and imaginative — you enjoy analogies, metaphors, and unusual connections',
    }[topic.style]||'curious';

    conversationHistory[topic.name]=[{
      role:'system',
      content:
        `You are ${topic.persona}, a ${personalityDesc} student. `+
        `Your teacher is explaining "${topic.goal}" on the topic: ${topic.name}. `+
        `Key concepts you must understand: ${ideasList}.\n\n`+
        `Rules:\n`+
        `- Ask ONE focused question per reply (never multiple at once)\n`+
        `- Keep replies to 1-3 sentences maximum\n`+
        `- React to what the teacher JUST said — show you were listening\n`+
        `- Vary your approach: ask for examples, analogies, real-world uses, common mistakes, "what if" scenarios, or deeper clarifications\n`+
        `- If a key concept (${ideasList}) has not been mentioned, steer toward it\n`+
        `- Never give the answer yourself — you are here to learn\n`+
        `- Embody your personality: ${personalityDesc}\n`+
        `- No filler phrases like "Great!" or "That's interesting!" — get straight to your question`,
    }];

    bubble(`Hi! Our goal is: ${topic.goal} — can you walk me through it in your own words?`,'student');
    teach.showModal();
    setTimeout(()=>$('#teach-input').focus(),20);
  }

  // ─── AI answer via OpenRouter ─────────────────────────────────────────────
  async function aiAnswer(teacherMessage){
    const hist=conversationHistory[topic.name];
    hist.push({role:'user',content:teacherMessage});

    const q=progress[topic.name]||{xp:0,lessons:0,covered:{},turn:0};
    topic.ideas.forEach(idea=>{
      if(teacherMessage.toLowerCase().includes(idea.toLowerCase())) q.covered[idea]=true;
    });
    q.xp+=10; q.lessons++; q.turn=(q.turn||0)+1;
    progress[topic.name]=q;
    save();

    setInputLocked(true);
    showTyping();

    let reply;
    try{
      const res=await fetch('https://openrouter.ai/api/v1/chat/completions',{
        method:'POST',
        headers:{
          'Authorization':`Bearer ${OR_KEY}`,
          'Content-Type':'application/json',
          'HTTP-Referer':'https://teachback.academy',
          'X-Title':'TeachBack Academy',
        },
        body:JSON.stringify({
          model:OR_MODEL,
          messages:hist,
          max_tokens:160,
          temperature:0.85,
        }),
      });
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const data=await res.json();
      reply=data.choices?.[0]?.message?.content?.trim();
      if(!reply) throw new Error('Empty response');
      hist.push({role:'assistant',content:reply});
    }catch(err){
      console.error('OpenRouter error:',err);
      const miss=topic.ideas.find(i=>!q.covered[i]);
      const fallbacks=[
        `How does "${miss||topic.ideas[0]}" connect to what you just said?`,
        `Can you give me a real-world example of that?`,
        `What would happen if that part was missing?`,
        `How would you explain this to someone who had never heard of ${topic.name}?`,
        `What is the most common mistake people make when thinking about this?`,
      ];
      reply=fallbacks[(q.turn-1)%fallbacks.length];
    }

    removeTyping();
    bubble(reply,'student');
    setInputLocked(false);
    setTimeout(()=>$('#teach-input').focus(),20);
  }

  // ─── Act on E ─────────────────────────────────────────────────────────────
  function act(){
    if(teach.open) return;
    if(room==='room'&&near()){openLesson();return;}
    if(room==='hub'){
      topics.slice(0,6).some((t,i)=>{
        const ax=[165,480,795,165,480,795][i], ay=i<3?225:455;
        if(Math.hypot(p.x-ax,p.y-ay)<100){
          topic=t; room='room';
          p={x:480,y:480,dir:'up',step:0};
          loc.textContent=`${t.name.toUpperCase()} · Find ${t.persona}`;
          return true;
        }
      });
    }
  }

  // ─── Events ───────────────────────────────────────────────────────────────
  document.addEventListener('keydown',e=>{
    if(e.key.startsWith('Arrow')) e.preventDefault();
    K.add(e.key.toLowerCase());
    if(e.key.toLowerCase()==='e') act();
  });
  document.addEventListener('keyup',e=>K.delete(e.key.toLowerCase()));

  $('#topic-button').onclick=()=>dlg.showModal();
  $('#topic-form').onsubmit=e=>{
    e.preventDefault();
    const v=id=>$(id).value.trim();
    topics.push({
      name:   v('#topic-name'),
      persona:v('#persona-name'),
      style:  $('#persona-style').value,
      goal:   v('#topic-goal'),
      ideas:  v('#topic-ideas').split(',').map(s=>s.trim()).filter(Boolean),
      color:  ['#d86865','#4b7bbd','#9b71ae','#4a9d79'][topics.length%4],
    });
    save(); dlg.close(); e.target.reset();
  };

  $('#teach-form').onsubmit=e=>{
    e.preventDefault();
    const inp=$('#teach-input');
    const val=inp.value.trim();
    if(!val) return;
    bubble(val,'player');
    inp.value='';
    aiAnswer(val);
  };

  $('#end-lesson').onclick=()=>teach.close();

  $('#report-button').onclick=()=>{
    let all=0;
    $('#report-list').innerHTML=topics.map(t=>{
      const q=progress[t.name]||{xp:0,lessons:0,covered:{}};
      all+=q.xp||0;
      const covered=Object.keys(q.covered||{}).length;
      return `<div class="report-row"><span>${t.name}<small>${covered}/${t.ideas.length} key ideas</small></span><span>${q.lessons} lessons &middot; ${q.xp||0} XP</span></div>`;
    }).join('');
    $('#report-xp').textContent=all;
    report.showModal();
  };
  $('#close-report').onclick=()=>report.close();

  // ─── Loop ─────────────────────────────────────────────────────────────────
  function loop(n){
    const d=Math.min(0.04,(n-last)/1000);
    last=n; move(d); draw();
    requestAnimationFrame(loop);
  }
  stats();
  requestAnimationFrame(loop);
})();
