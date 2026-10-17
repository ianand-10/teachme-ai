  (() => {
    const $ = s => document.querySelector(s);
    const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

    // ─── In-browser AI (WebLLM / WebGPU) ──────────────────────────────────────
    const WEBLLM_URL    = 'https://esm.run/@mlc-ai/web-llm';
    const PRIMARY_MODEL = 'Qwen2.5-3B-Instruct-q4f16_1-MLC';
    const LIGHT_MODEL   = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';

    let engine = null, enginePromise = null, engineFailed = false;
    const pickModel = () => (navigator.deviceMemory || 8) <= 4 ? LIGHT_MODEL : PRIMARY_MODEL;

    async function ensureEngine(onProgress) {
      if (engine) return engine;
      if (engineFailed) return null;
      if (!('gpu' in navigator)) { engineFailed = true; return null; }
      if (!enginePromise) {
        enginePromise = (async () => {
          const webllm = await import(WEBLLM_URL);
          engine = await webllm.CreateMLCEngine(pickModel(), { initProgressCallback: r => onProgress && onProgress(r) });
          return engine;
        })().catch(err => { console.warn('WebLLM init failed:', err); engineFailed = true; enginePromise = null; return null; });
      }
      return enginePromise;
    }

    let dlBubble = null;
    function updateDownloadProgress(r) {
      if (!r || typeof r.progress !== 'number') return;
      if (r.progress >= 1) { if (dlBubble) { dlBubble.remove(); dlBubble = null; } return; }
      if (!dlBubble) {
        dlBubble = document.createElement('div');
        dlBubble.className = 'bubble student progress-bubble';
        $('#conversation').append(dlBubble);
      }
      dlBubble.textContent = `Preparing your AI student… ${Math.round(r.progress * 100)}% (one-time download, then it works offline)`;
      dlBubble.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }

    // ─── One-time migration: clear old seeded classrooms so users start blank ──
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
    let topic = null, editingIndex = null;

    let streak = JSON.parse(localStorage.getItem('teachback-streak') || 'null') || { last: null, count: 0 };
    const dayKey = d => `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
    function bumpStreak() {
      const now = new Date(), today = dayKey(now);
      if (streak.last === today) return;
      const y = new Date(now); y.setDate(y.getDate() - 1);
      streak.count = (streak.last === dayKey(y)) ? (streak.count || 0) + 1 : 1;
      streak.last = today;
      localStorage.setItem('teachback-streak', JSON.stringify(streak));
    }

    const dlg = $('#topic-dialog'), focusDlg = $('#focus-dialog'), teach = $('#teach-dialog'), report = $('#report-dialog');
    const COLORS = ['#4f46e5','#0ea5e9','#db2777','#059669','#d97706','#7c3aed'];
    const initials = n => ((n || '?').trim()[0] || '?').toUpperCase();

    function save() {
      localStorage.setItem('teachback-topics', JSON.stringify(topics));
      localStorage.setItem('teachback-progress', JSON.stringify(progress));
      stats(); renderGrid();
    }
    function stats() {
      const vals = Object.values(progress);
      $('#xp-value').textContent     = vals.reduce((v, o) => v + (o.xp || 0), 0);
      $('#streak-value').textContent = streak.count || 0;
    }

    // ─── Classroom grid ─────────────────────────────────────────────────────────
    function renderGrid() {
      const grid = $('#classroom-grid');
      grid.innerHTML = '';

      const create = document.createElement('button');
      create.className = 'card create-card';
      create.innerHTML = '<span class="plus">+</span><span>Create a classroom</span>';
      create.onclick = openCreate;
      grid.append(create);

      topics.forEach((t, i) => {
        const q = progress[t.name] || { xp: 0, lessons: 0 };
        const card = document.createElement('div');
        card.className = 'card room-card';
        card.innerHTML = `
          <div class="room-top">
            <div class="avatar" style="background:${t.color}">${esc(initials(t.persona))}</div>
            <div class="room-menu">
              <button class="iconbtn" data-act="edit" title="Edit">✎</button>
              <button class="iconbtn" data-act="del" title="Delete">🗑</button>
            </div>
          </div>
          <h3>${esc(t.name)}</h3>
          <p class="room-focus">${esc(t.goal)}</p>
          <div class="room-meta"><span>🎓 ${esc(t.persona)}</span><span>⚡ ${q.xp || 0} XP</span></div>
          <button class="btn primary start-btn">Start lesson →</button>`;
        card.querySelector('.start-btn').onclick = () => { topic = t; openFocusPrompt(); };
        card.querySelector('[data-act="edit"]').onclick = () => openEdit(i);
        card.querySelector('[data-act="del"]').onclick  = () => deleteTopic(i);
        grid.append(card);
      });
    }

    // ─── Create / edit ──────────────────────────────────────────────────────────
    function openCreate() {
      editingIndex = null;
      $('#topic-form').reset();
      $('#topic-eyebrow').textContent = 'NEW CLASSROOM';
      $('#topic-heading').textContent = 'Create a classroom';
      $('#topic-submit').textContent  = 'Create classroom';
      dlg.showModal();
    }
    function openEdit(i) {
      editingIndex = i; const t = topics[i];
      $('#topic-name').value    = t.name;
      $('#persona-name').value  = t.persona;
      $('#persona-style').value = t.style || 'curious';
      $('#topic-goal').value    = t.goal;
      $('#topic-ideas').value   = (t.ideas || []).join(', ');
      $('#topic-eyebrow').textContent = 'EDIT CLASSROOM';
      $('#topic-heading').textContent = `Edit ${t.name}`;
      $('#topic-submit').textContent  = 'Save changes';
      dlg.showModal();
    }
    $('#topic-cancel').onclick = () => { editingIndex = null; dlg.close(); };
    $('#topic-form').onsubmit = e => {
      e.preventDefault();
      const v = id => $(id).value.trim();
      const data = {
        name:    v('#topic-name'),
        persona: v('#persona-name'),
        style:   $('#persona-style').value,
        goal:    v('#topic-goal'),
        ideas:   v('#topic-ideas').split(',').map(s => s.trim()).filter(Boolean),
      };
      if (editingIndex != null) {
        const prev = topics[editingIndex];
        if (prev.name !== data.name) {
          if (progress[prev.name]) { progress[data.name] = progress[prev.name]; delete progress[prev.name]; }
          delete conversationHistory[prev.name];
        }
        topics[editingIndex] = { ...data, color: prev.color };
        editingIndex = null;
      } else {
        data.color = COLORS[topics.length % COLORS.length];
        topics.push(data);
      }
      save(); dlg.close(); e.target.reset();
    };
    function deleteTopic(i) {
      const t = topics[i];
      if (!confirm(`Delete "${t.name}" and its progress? This can't be undone.`)) return;
      topics.splice(i, 1);
      delete progress[t.name];
      delete conversationHistory[t.name];
      save();
    }

    // ─── Focus prompt (per-lesson topic) ─────────────────────────────────────────
    function openFocusPrompt() {
      $('#focus-heading').textContent = `Teach ${topic.persona} — what's today's topic?`;
      $('#focus-input').value = topic.goal || '';
      focusDlg.showModal();
      setTimeout(() => { const el = $('#focus-input'); el.focus(); el.select(); }, 20);
    }
    $('#focus-cancel').onclick = () => focusDlg.close();
    $('#focus-form').onsubmit = e => {
      e.preventDefault();
      const f = $('#focus-input').value.trim();
      if (!f) return;
      focusDlg.close();
      openLesson(f);
    };

    // ─── Lesson / chat ──────────────────────────────────────────────────────────
    const PERSONAS = {
      curious:  { desc: 'curious and enthusiastic', voice: 'You get excited, ask "why" and "what if", and love edge cases.' },
      careful:  { desc: 'careful and analytical',   voice: 'You want step-by-step logic and challenge assumptions.' },
      creative: { desc: 'creative and imaginative', voice: 'You love analogies and real-world metaphors.' },
    };

    function systemPrompt(goal) {
      const ideasList = (topic.ideas && topic.ideas.length) ? topic.ideas.join(', ') : `the core concepts of ${topic.name}`;
      const pm = PERSONAS[topic.style] || PERSONAS.curious;
      return (
        `You are ${topic.persona}, a high school student being taught by your teacher (the human).\n` +
        `Today's topic: "${goal}"\n` +
        `Key concepts to probe for: ${ideasList}\n` +
        `Personality: ${pm.desc} (${pm.voice})\n\n` +
        `HOW TO BEHAVE:\n` +
        `1. YOU ARE THE STUDENT. Never lecture or give the full answer yourself — your job is to be taught, question, and assess.\n` +
        `2. START the lesson: greet the teacher in one short line, then ask ONE focused question about today's topic to get them explaining.\n` +
        `3. GRADE EVERY EXPLANATION — never just agree or say "great job". After each thing the teacher says:\n` +
        `   • Say briefly what was correct/clear.\n` +
        `   • Point out what was vague, incomplete, or WRONG — and explain why it's off.\n` +
        `   • Give a quick honest rating on its own line: "Understanding: X/10".\n` +
        `   • Then ask ONE focused follow-up question that targets the biggest gap.\n` +
        `4. If the teacher is clearly wrong, respectfully push back and correct the misconception — don't pretend to be convinced.\n` +
        `5. Keep replies concise (3-6 sentences). No filler. Stay in character as a sharp, engaged student.`
      );
    }

    async function openLesson(focus) {
      const goal = (focus && focus.trim()) || topic.goal || `the main ideas of ${topic.name}`;
      $('#lesson-topic').textContent    = topic.name.toUpperCase();
      $('#lesson-title').textContent    = `Teach ${topic.persona}`;
      $('#lesson-subtitle').textContent = `Focus: ${goal}`;
      $('#portrait').textContent        = initials(topic.persona);
      $('#portrait').style.background   = topic.color;
      $('#conversation').innerHTML      = '';
      dlBubble = null;

      conversationHistory[topic.name] = [
        { role: 'system', content: systemPrompt(goal) },
        { role: 'user',   content: `I'm ready to teach you about "${goal}". Greet me in one short line and ask your first question to get me started.` },
      ];

      teach.showModal();
      await aiTurn(goal);                 // AI speaks first
      $('#teach-input').focus();
    }

    async function aiTurn(goalForFallback) {
      const hist = conversationHistory[topic.name];
      setInputLocked(true);
      let reply = null;

      const eng = await ensureEngine(updateDownloadProgress);
      if (dlBubble) { dlBubble.remove(); dlBubble = null; }

      if (eng) {
        showTyping();
        try {
          const res = await eng.chat.completions.create({ messages: hist, max_tokens: 340, temperature: 0.7 });
          const content = res?.choices?.[0]?.message?.content?.trim();
          if (content) reply = content;
        } catch (err) { console.warn('WebLLM generation failed:', err); }
        removeTyping();
      }

      if (!reply) reply = fallbackReply(goalForFallback);

      hist.push({ role: 'assistant', content: reply });
      bubble(reply, 'student');
      setInputLocked(false);
      $('#teach-input').focus();
    }

    function fallbackReply(goal) {
      const hist = conversationHistory[topic.name];
      const spoken = hist.filter(m => m.role === 'assistant').length;
      if (spoken === 0) {
        return `Hi, I'm ${topic.persona}! To start — can you explain, in your own words, what "${goal || topic.name}" actually is and why it matters?`;
      }
      const q = progress[topic.name] || { turn: 1, covered: {} };
      const anchor = (topic.ideas.find(i => !(q.covered || {})[i])) || topic.ideas[0] || topic.name;
      const graded = [
        `That part was clear, but it felt vague on the "why".\nUnderstanding: 5/10.\nCan you be specific about how "${anchor}" actually fits in?`,
        `Nice — you connected a few ideas there.\nUnderstanding: 7/10.\nWhat happens in an edge case where that doesn't hold?`,
        `Hmm, I'm not convinced that's fully right.\nUnderstanding: 4/10.\nCan you walk me through the mechanism step by step?`,
        `Good, that mostly made sense.\nUnderstanding: 8/10.\nHow does this relate to "${anchor}"?`,
      ];
      return graded[(q.turn || 1) % graded.length];
    }

    // ─── Conversation UI helpers ────────────────────────────────────────────────
    function bubble(m, who) {
      const e = document.createElement('div');
      e.className = `bubble ${who}`;
      e.textContent = m;
      $('#conversation').append(e);
      e.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }
    function setInputLocked(locked) {
      $('#teach-input').disabled = locked;
      $('#teach-form').querySelector('button').disabled = locked;
    }
    function showTyping() {
      const e = document.createElement('div');
      e.className = 'bubble student typing-bubble';
      e.id = 'typing-indicator';
      e.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
      $('#conversation').append(e);
      e.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }
    function removeTyping() { const el = $('#typing-indicator'); if (el) el.remove(); }

    $('#teach-form').onsubmit = e => {
      e.preventDefault();
      const inp = $('#teach-input');
      const val = inp.value.trim();
      if (!val) return;
      bubble(val, 'player');
      inp.value = '';

      const hist = conversationHistory[topic.name];
      hist.push({ role: 'user', content: val });

      const q = progress[topic.name] || { xp: 0, lessons: 0, covered: {}, turn: 0 };
      topic.ideas.forEach(idea => { if (val.toLowerCase().includes(idea.toLowerCase())) q.covered[idea] = true; });
      q.xp += 10; q.lessons++; q.turn = (q.turn || 0) + 1;
      progress[topic.name] = q;
      bumpStreak(); save();

      aiTurn();
    };
    $('#end-lesson').onclick = () => teach.close();

    // ─── Report card ────────────────────────────────────────────────────────────
    $('#report-button').onclick = () => {
      let all = 0;
      $('#report-list').innerHTML = topics.length ? topics.map(t => {
        const q = progress[t.name] || { xp: 0, lessons: 0, covered: {} };
        all += q.xp || 0;
        const covered = Object.keys(q.covered || {}).length;
        return `<div class="report-row"><span>${esc(t.name)}<small>${covered}/${t.ideas.length} key ideas</small></span><span>${q.lessons || 0} sessions · ${q.xp || 0} XP</span></div>`;
      }).join('') : '<p class="muted">No classrooms yet. Create one and start teaching!</p>';
      $('#report-xp').textContent = all;
      report.showModal();
    };
    $('#close-report').onclick = () => report.close();

    // ─── Page wiring ────────────────────────────────────────────────────────────
    $('#new-classroom-btn').onclick = openCreate;
    $('#scroll-cue').onclick = () => $('#classrooms').scrollIntoView({ behavior: 'smooth' });

    stats();
    renderGrid();
  })();
