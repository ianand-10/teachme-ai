  (() => {
    // ─── Canvas & input setup ─────────────────────────────────────────────────
    const c = document.querySelector('#game');
    const x = c.getContext('2d');
    const W = 960, H = 576;
    const K = new Set();
    x.imageSmoothingEnabled = false;

    // ─── In-browser AI (WebLLM / WebGPU) ──────────────────────────────────────
    // Runs entirely on the visitor's device. First use downloads the model once
    // (~1 GB) and caches it; afterwards it works offline. No server, no API key.
    const WEBLLM_URL   = 'https://esm.run/@mlc-ai/web-llm';
    const PRIMARY_MODEL = 'Qwen2.5-3B-Instruct-q4f16_1-MLC';   // best quality/size
    const LIGHT_MODEL   = 'Llama-3.2-1B-Instruct-q4f16_1-MLC'; // for weak devices

    let engine = null;
    let enginePromise = null;
    let engineFailed = false;

    function pickModel() {
      const mem = navigator.deviceMemory || 8; // GB; undefined on some browsers
      return mem <= 4 ? LIGHT_MODEL : PRIMARY_MODEL;
    }

    // Lazy singleton. Returns the engine, or null if WebGPU is unavailable / load fails.
    async function ensureEngine(onProgress) {
      if (engine) return engine;
      if (engineFailed) return null;
      if (!('gpu' in navigator)) { engineFailed = true; return null; }
      if (!enginePromise) {
        enginePromise = (async () => {
          const webllm = await import(WEBLLM_URL);
          const eng = await webllm.CreateMLCEngine(pickModel(), {
            initProgressCallback: r => onProgress && onProgress(r),
          });
          engine = eng;
          return eng;
        })().catch(err => {
          console.warn('WebLLM init failed:', err);
          engineFailed = true;
          enginePromise = null;
          return null;
        });
      }
      return enginePromise;
    }

    // Shows/updates a one-time download-progress line inside the conversation.
    let dlBubble = null;
    function updateDownloadProgress(r) {
      if (!r || typeof r.progress !== 'number') return;
      if (r.progress >= 1) { if (dlBubble) { dlBubble.remove(); dlBubble = null; } return; }
      if (!dlBubble) {
        dlBubble = document.createElement('div');
        dlBubble.className = 'bubble student progress-bubble';
        $('#conversation').append(dlBubble);
      }
      const pct = Math.round(r.progress * 100);
      dlBubble.textContent = `Preparing your AI student… ${pct}% (one-time download, then it works offline)`;
      dlBubble.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }

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

    // ─── One-time migration: clear the old seeded classrooms so new users ──────
    // start blank. Only runs if the stored set is entirely the untouched seeds,
    // so anyone who added their own classrooms keeps everything.
    const SEED_NAMES = ['Physics', 'Biology', 'Chemistry'];
    if (!localStorage.getItem('teachback-reset-v2')) {
      const stored = JSON.parse(localStorage.getItem('teachback-topics') || 'null');
      if (stored && stored.length && stored.every(t => SEED_NAMES.includes(t.name))) {
        localStorage.removeItem('teachback-topics');
        localStorage.removeItem('teachback-progress');
      }
      localStorage.setItem('teachback-reset-v2', '1');
    }

    // ─── State ─────────────────────────────────────────────────────────────────
    let topics = (JSON.parse(localStorage.getItem('teachback-topics') || 'null') || [])
      .map(t => ({ ...t, goal: t.goal || `the main ideas of ${t.name}`, ideas: t.ideas || [] }));

    let progress = JSON.parse(localStorage.getItem('teachback-progress') || '{}');
    let conversationHistory = {};
    let room = 'hub', topic, last = performance.now();
    let p = {x:480, y:470, dir:'down', step:0};
    let editingIndex = null; // index into topics when editing, else null

    const $ = s => document.querySelector(s);
    const dlg     = $('#topic-dialog');
    const focusDlg= $('#focus-dialog');
    const manage  = $('#manage-dialog');
    const teach   = $('#teach-dialog');
    const report  = $('#report-dialog');
    const loc     = $('#location-label');

    const anyDialogOpen = () => dlg.open || focusDlg.open || manage.open || teach.open || report.open;
    const courtyardLabel = () => topics.length ? 'COURTYARD · Choose a classroom' : 'COURTYARD · Create your first classroom';

    // ─── Streak tracking (real, date-based) ────────────────────────────────────
    let streak = JSON.parse(localStorage.getItem('teachback-streak') || 'null') || { last: null, count: 0 };
    const dayKey = d => `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
    function bumpStreak() {
      const now = new Date();
      const today = dayKey(now);
      if (streak.last === today) return;            // already counted today
      const y = new Date(now); y.setDate(y.getDate() - 1);
      streak.count = (streak.last === dayKey(y)) ? (streak.count || 0) + 1 : 1;
      streak.last = today;
      localStorage.setItem('teachback-streak', JSON.stringify(streak));
    }

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
      if (room === 'hub') loc.textContent = courtyardLabel();
      stats();
    }
    function stats() {
      const vals = Object.values(progress);
      const n = vals.reduce((v,o) => v+(o.xp||0), 0);
      $('#xp-value').textContent    = n;
      $('#streak-value').textContent= streak.count || 0;
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
      T('TEACHME.AI', 482, 33, 14, '#000000a0', 'center');
      T('TEACHME.AI', 480, 31, 14, '#fff8d3',   'center');
      T('COURTYARD',  480, 225, 9, '#2e5a48',   'center');
      topics.slice(0,6).forEach((t,i) => {
        const ax=[165,480,795,165,480,795][i], ay=i<3?200:430;
        R(ax-56,ay,   112,23,'#102d3fcc');
        R(ax-54,ay,   110, 2,'#1e5870aa');
        T(t.name.toUpperCase().slice(0,16),ax,ay+16,8,'#fff6d1','center');
        if(Math.hypot(p.x-ax,p.y-(ay+30))<94){
          R(ax-80,ay+36,160,23,'#122e40ee');
          T(`E -> ENTER`,ax,ay+52,7,'#ffe89a','center');
        }
      });
      // Empty state: no classrooms yet
      if(!topics.length){
        R(250,255,460,78,'#102d3fe6');
        R(252,257,456, 2,'#1e5870aa');
        T('NO CLASSROOMS YET',480,290,12,'#fff6d1','center');
        T('Tap "+ Create classroom" below to begin',480,312,8,'#ffe89a','center');
      }
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
      if(near()&&!teach.open&&!focusDlg.open){
        R(300,158,360,26,'#102e40de');
        T(`E -> TEACH ${topic.persona.toUpperCase()}`,480,176,8,'#ffe89a','center');
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
      loc.textContent=courtyardLabel();
    }

    function move(dt){
      if(anyDialogOpen()) return;
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

    // ─── Per-lesson focus prompt ────────────────────────────────────────────────
    function openFocusPrompt(){
      $('#focus-heading').textContent = `Teach ${topic.persona} — what's today's topic?`;
      $('#focus-input').value = topic.goal || '';
      focusDlg.showModal();
      setTimeout(()=>{ const el=$('#focus-input'); el.focus(); el.select(); }, 20);
    }

    // ─── Open lesson dialog ───────────────────────────────────────────────────
    function openLesson(focus){
      const goal = (focus && focus.trim()) || topic.goal || `the main ideas of ${topic.name}`;

      $('#lesson-topic').textContent   = topic.name.toUpperCase();
      $('#lesson-title').textContent   = `Teach ${topic.persona}`;
      $('#lesson-subtitle').textContent= `Focus: ${goal}`;
      $('#portrait').textContent       = topic.persona[0];
      $('#portrait').style.background  = topic.color;
      $('#conversation').innerHTML     = '';
      dlBubble = null;

      const ideasList = (topic.ideas && topic.ideas.length)
        ? topic.ideas.join(', ')
        : `the core concepts of ${topic.name}`;
      const personalityMap = {
        curious:  { desc: 'curious and enthusiastic',  voice: 'You ask "why" and "what if", test wild hypotheses, and explore fascinating edge cases.' },
        careful:  { desc: 'careful and analytical',    voice: 'You want logical step-by-step clarity, challenge assumptions, and ask "how does that mechanism actually work?".' },
        creative: { desc: 'creative and imaginative',  voice: 'You love relatable analogies, real-world metaphors, and comparing concepts to unexpected things.' },
      };
      const pm = personalityMap[topic.style] || personalityMap.curious;

      const intro = `Hi! Today you're teaching me about: "${goal}". Can you start explaining it to me in your own words?`;

      conversationHistory[topic.name] = [
        {
          role: 'system',
          content:
            `You are ${topic.persona}, a real high school student having a 1-on-1 tutoring conversation with your teacher.\n` +
            `Today's topic (what the teacher wants to focus on): "${goal}"\n` +
            `Related key concepts to probe for: ${ideasList}\n` +
            `Personality: ${pm.desc} (${pm.voice})\n\n` +
            `CRITICAL RULES FOR ASKING QUESTIONS:\n` +
            `1. YOU ARE THE STUDENT, NOT THE TEACHER. Never lecture, explain the concept back, or give the answer.\n` +
            `2. STAY ON TODAY'S TOPIC: "${goal}". Keep your questions focused on helping the teacher explain this specific thing.\n` +
            `3. MULTI-TURN DIALOGUE: Always pay attention to the entire conversation history. Deepen the discussion with each reply.\n` +
            `4. DIRECT FOLLOW-UP: Directly latch onto the specific idea, term, or claim the teacher just made in their latest message. Quote or refer to their specific point.\n` +
            `5. QUESTION STYLES (ask ONE focused question per turn, max 2-3 sentences):\n` +
            `   - Mechanism probe: "Wait, you said [X causes Y] — what is actually happening behind the scenes to make that happen?"\n` +
            `   - Edge case / counter-example: "What happens if [scenario]? Does [concept] still hold true?"\n` +
            `   - Misconception / wrong guess: "So is it like [relatable analogy]? Or am I misunderstanding?"\n` +
            `   - Connection: "How does [what they just said] connect with [a related concept: ${ideasList}]?"\n` +
            `6. DO NOT use boilerplate filler ("Great explanation!", "Thanks!", "I see!"). Jump right into your thought and question.\n` +
            `7. Stay in character as a curious student trying to truly understand.`
        },
        { role: 'assistant', content: intro }
      ];

      bubble(intro, 'student');
      teach.showModal();
      setTimeout(()=>$('#teach-input').focus(),20);

      // Begin downloading the model in the background so it's ready by send time.
      if ('gpu' in navigator) ensureEngine(updateDownloadProgress);
    }

    // ─── AI answer via in-browser model ───────────────────────────────────────
    async function aiAnswer(teacherMessage){
      const hist = conversationHistory[topic.name];
      hist.push({ role: 'user', content: teacherMessage });

      const q = progress[topic.name] || { xp: 0, lessons: 0, covered: {}, turn: 0 };
      topic.ideas.forEach(idea => {
        if (teacherMessage.toLowerCase().includes(idea.toLowerCase())) q.covered[idea] = true;
      });
      q.xp += 10;
      q.lessons++;
      q.turn = (q.turn || 0) + 1;
      progress[topic.name] = q;
      bumpStreak();
      save();

      setInputLocked(true);

      let reply = null;

      // Try the in-browser model. Shows the one-time download line if needed.
      const eng = await ensureEngine(updateDownloadProgress);
      if (dlBubble) { dlBubble.remove(); dlBubble = null; }

      if (eng) {
        showTyping();
        try {
          const res = await eng.chat.completions.create({
            messages: hist,
            max_tokens: 300,
            temperature: 0.8,
          });
          const content = res?.choices?.[0]?.message?.content?.trim();
          if (content) reply = content;
        } catch (err) {
          console.warn('WebLLM generation failed:', err);
        }
        removeTyping();
      }

      if (!reply) {
        // Fallback: no WebGPU, model load failure, or generation error.
        const anchor = topic.ideas.find(i => !q.covered[i]) || topic.ideas[0] || topic.name;
        const fallbacks = [
          `Wait, based on what you just said, how does "${anchor}" actually connect to that?`,
          `Can you give me a real-world scenario where that happens? What does it look like in action?`,
          `What would happen if that condition wasn't met? Would the whole process stop?`,
          `So is it kind of like a chain reaction? How do we know for sure that happens?`,
          `If someone made a mistake with this, what would be the most common thing they misunderstand?`,
        ];
        reply = fallbacks[(q.turn - 1) % fallbacks.length];
      }

      hist.push({ role: 'assistant', content: reply });
      bubble(reply, 'student');
      setInputLocked(false);
      setTimeout(()=>$('#teach-input').focus(), 20);
    }

    // ─── Act on E ─────────────────────────────────────────────────────────────
    function act(){
      if(anyDialogOpen()) return;
      if(room==='room'&&near()){openFocusPrompt();return;}
      if(room==='hub'){
        topics.slice(0,6).some((t,i)=>{
          const ax=[165,480,795,165,480,795][i], ay=i<3?200:430;
          if(Math.hypot(p.x-ax,p.y-(ay+30))<94){
            topic=t; room='room';
            p={x:480,y:480,dir:'up',step:0};
            loc.textContent=`${t.name.toUpperCase()} · Walk up to ${t.persona}`;
            return true;
          }
        });
      }
    }

    // ─── Create / edit classroom form ──────────────────────────────────────────
    function openCreate(){
      editingIndex = null;
      $('#topic-form').reset();
      $('#topic-eyebrow').textContent = 'NEW CLASSROOM';
      $('#topic-heading').textContent = 'Create a classroom';
      $('#topic-submit').textContent  = 'Create classroom';
      dlg.showModal();
    }
    function openEdit(i){
      editingIndex = i;
      const t = topics[i];
      $('#topic-name').value    = t.name;
      $('#persona-name').value  = t.persona;
      $('#persona-style').value = t.style || 'curious';
      $('#topic-goal').value    = t.goal;
      $('#topic-ideas').value   = (t.ideas || []).join(', ');
      $('#topic-eyebrow').textContent = 'EDIT CLASSROOM';
      $('#topic-heading').textContent = `Edit ${t.name}`;
      $('#topic-submit').textContent  = 'Save changes';
      if (manage.open) manage.close();
      dlg.showModal();
    }

    $('#topic-button').onclick = openCreate;
    $('#topic-cancel').onclick = () => { editingIndex = null; dlg.close(); };

    $('#topic-form').onsubmit=e=>{
      e.preventDefault();
      const v=id=>$(id).value.trim();
      const data = {
        name:   v('#topic-name'),
        persona:v('#persona-name'),
        style:  $('#persona-style').value,
        goal:   v('#topic-goal'),
        ideas:  v('#topic-ideas').split(',').map(s=>s.trim()).filter(Boolean),
      };
      if (editingIndex != null) {
        const prev = topics[editingIndex];
        // On rename, migrate saved progress and drop the stale chat history.
        if (prev.name !== data.name) {
          if (progress[prev.name]) { progress[data.name] = progress[prev.name]; delete progress[prev.name]; }
          delete conversationHistory[prev.name];
        }
        topics[editingIndex] = { ...data, color: prev.color };
        editingIndex = null;
      } else {
        data.color = ['#d86865','#4b7bbd','#9b71ae','#4a9d79'][topics.length%4];
        topics.push(data);
      }
      save(); dlg.close(); e.target.reset();
    };

    // ─── Focus form ──────────────────────────────────────────────────────────────
    $('#focus-form').onsubmit=e=>{
      e.preventDefault();
      const f=$('#focus-input').value.trim();
      if(!f) return;
      focusDlg.close();
      openLesson(f);
    };
    $('#focus-cancel').onclick=()=>focusDlg.close();

    // ─── Manage classrooms (edit / delete) ─────────────────────────────────────
    function renderManage(){
      const list = $('#manage-list');
      list.innerHTML = '';
      if (!topics.length) { list.innerHTML = '<p class="tiny">No classrooms yet. Create one!</p>'; return; }
      topics.forEach((t, i) => {
        const row = document.createElement('div');
        row.className = 'manage-row';

        const label = document.createElement('span');
        label.className = 'manage-name';
        label.textContent = t.name;

        const actions = document.createElement('div');
        actions.className = 'manage-actions';

        const edit = document.createElement('button');
        edit.type = 'button'; edit.className = 'ghost-button'; edit.textContent = 'Edit';
        edit.onclick = () => openEdit(i);

        const del = document.createElement('button');
        del.type = 'button'; del.className = 'ghost-button danger'; del.textContent = 'Delete';
        del.onclick = () => deleteTopic(i);

        actions.append(edit, del);
        row.append(label, actions);
        list.append(row);
      });
    }
    function deleteTopic(i){
      const t = topics[i];
      if (!confirm(`Delete the "${t.name}" classroom and its progress? This can't be undone.`)) return;
      topics.splice(i, 1);
      delete progress[t.name];
      delete conversationHistory[t.name];
      save();
      renderManage();
    }

    $('#manage-button').onclick = () => { renderManage(); manage.showModal(); };
    $('#close-manage').onclick  = () => manage.close();

    // ─── Clear all classrooms ─────────────────────────────────────────────────────
    function clearAll() {
      if (!topics.length) return;
      if (!confirm('Delete ALL classrooms and progress? This cannot be undone.')) return;
      topics = [];
      progress = {};
      conversationHistory = {};
      save();
    }
    $('#clear-button').onclick = clearAll;

    // ─── Teach form ─────────────────────────────────────────────────────────────
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
      $('#report-list').innerHTML = topics.length ? topics.map(t=>{
        const q=progress[t.name]||{xp:0,lessons:0,covered:{}};
        all+=q.xp||0;
        const covered=Object.keys(q.covered||{}).length;
        return `<div class="report-row"><span>${t.name}<small>${covered}/${t.ideas.length} key ideas</small></span><span>${q.lessons} lessons &middot; ${q.xp||0} XP</span></div>`;
      }).join('') : '<p class="tiny">No classrooms yet. Create one and start teaching!</p>';
      $('#report-xp').textContent=all;
      report.showModal();
    };
    $('#close-report').onclick=()=>report.close();

    // ─── Keyboard input ─────────────────────────────────────────────────────────
    document.addEventListener('keydown',e=>{
      if(e.key.startsWith('Arrow')) e.preventDefault();
      K.add(e.key.toLowerCase());
      if(e.key.toLowerCase()==='e') act();
    });
    document.addEventListener('keyup',e=>K.delete(e.key.toLowerCase()));

    // ─── Touch controls (mobile D-pad + action) ────────────────────────────────
    $('#touch-controls').querySelectorAll('.tc-btn').forEach(btn => {
      const key = btn.dataset.key;
      const press   = e => { e.preventDefault(); K.add(key);    btn.classList.add('active'); };
      const release = e => { e.preventDefault(); K.delete(key); btn.classList.remove('active'); };
      btn.addEventListener('pointerdown',  press);
      btn.addEventListener('pointerup',    release);
      btn.addEventListener('pointerleave', release);
      btn.addEventListener('pointercancel',release);
    });
    $('#tc-action').addEventListener('pointerdown', e => { e.preventDefault(); act(); });

    // ─── Loop ─────────────────────────────────────────────────────────────────
    function loop(n){
      const d=Math.min(0.04,(n-last)/1000);
      last=n; move(d); draw();
      requestAnimationFrame(loop);
    }
    loc.textContent = courtyardLabel();
    stats();
    requestAnimationFrame(loop);
  })();

