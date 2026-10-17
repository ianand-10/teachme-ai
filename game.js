  /* game.js - hallway view layered on top of the existing app.
     Reads classrooms from the (hidden) card grid that app.js renders, and drives
     every action by triggering the controls app.js already created. app.js and
     styles.css are untouched. */
  (() => {
    const $  = s => document.querySelector(s);
    const $$ = s => Array.from(document.querySelectorAll(s));
    const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

    // --- Inject all hallway styles so styles.css stays untouched ---------------
    const CSS = `
    .hero,.classrooms{display:none !important;}
    #stage{position:relative;width:100%;height:min(74vh,640px);overflow:hidden;background:linear-gradient(#0e1530,#0b102
  0);}
    #world{position:absolute;top:0;left:0;height:100%;width:1200px;will-change:transform;}
    .bg-ceiling{position:absolute;left:0;top:0;width:100%;height:16%;background:linear-gradient(#2a3566,#1c2448);border-
  bottom:3px solid #121a38;}
    .bg-ceiling:after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(90deg,transparent 0
  90px,rgba(255,247,214,.9) 90px 150px,transparent 150px 240px);opacity:.25;}
    .bg-wall{position:absolute;left:0;top:16%;width:100%;height:50%;background:linear-gradient(#f5f3ec,#e3dfd0);box-shad
  ow:inset 0 -18px 0 rgba(0,0,0,.05);}
    .bg-wall:after{content:"";position:absolute;left:0;bottom:0;width:100%;height:30px;background:#cdbf9d;}
    .bg-floor{position:absolute;left:0;top:66%;width:100%;height:34%;background:repeating-linear-gradient(90deg,rgba(0,0
  ,0,.06) 0 2px,transparent 2px 130px),linear-gradient(#c4946a,#9c6f45);}
    .door{position:absolute;bottom:22%;height:46%;width:150px;z-index:2;cursor:pointer;transition:transform .15s;}
    .door .door-panel{position:absolute;inset:0;border-radius:12px 12px 4px
  4px;background:var(--c,#4f46e5);background-image:linear-gradient(rgba(255,255,255,.18),rgba(0,0,0,.4));border:4px
  solid rgba(0,0,0,.28);box-shadow:0 12px 26px rgba(0,0,0,.4),inset 0 0 0 3px rgba(255,255,255,.14);}
    .door .win{position:absolute;top:14px;left:50%;transform:translateX(-50%);width:62px;height:70px;border-radius:7px;b
  ackground:linear-gradient(#cfe6ff,#9ec2ea);border:3px solid rgba(0,0,0,.3);box-shadow:inset 0 0 0 2px
  rgba(255,255,255,.3);}
    .door
  .knob{position:absolute;top:52%;right:14px;width:11px;height:11px;border-radius:50%;background:#f6d365;box-shadow:0 0
  0 2px rgba(0,0,0,.3);}
    .door.create-door .door-panel{background:none;background-image:none;border:3px dashed
  #a6b0d8;box-shadow:none;display:flex;align-items:center;justify-content:center;}
    .door.create-door .door-panel span{font-size:54px;font-weight:300;color:#cfd6f5;line-height:1;}
    .door .plate{position:absolute;top:-58px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px
  ;background:#fff;border:1px solid #e3e3ec;border-radius:12px;padding:6px 10px;box-shadow:0 6px 18px
  rgba(0,0,0,.18);white-space:nowrap;cursor:pointer;}
    .door .pav{width:28px;height:28px;border-radius:8px;display:grid;place-items:center;color:#fff;font-weight:800;font-
  size:14px;flex-shrink:0;}
    .door .ptx{display:flex;flex-direction:column;line-height:1.15;color:#10131c;}
    .door .ptx b{font-size:13px;}
    .door .ptx small{font-size:11px;color:#6b7280;}
    .door .door-actions{position:absolute;top:-96px;left:50%;transform:translateX(-50%);display:none;gap:6px;z-index:4;}
    .door .dbtn{border:1px solid #d6d9e4;background:#fff;color:#10131c;font:600 11px system-ui,sans-serif;padding:5px
  10px;border-radius:8px;cursor:pointer;box-shadow:0 3px 10px rgba(0,0,0,.14);}
    .door .dbtn.danger{color:#b91c1c;border-color:#e6b7b7;}
    .door .prompt{position:absolute;bottom:-34px;left:50%;transform:translateX(-50%);display:none;background:rgba(16,19,
  28,.85);color:#ffe89a;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;white-space:nowrap;}
    .door .prompt b{color:#fff;}
    .door.near{transform:translateY(-8px);}
    .door.near .door-panel{box-shadow:0 0 0 4px rgba(99,102,241,.55),0 16px 30px rgba(0,0,0,.45),inset 0 0 0 3px
  rgba(255,255,255,.14);}
    .door.near .prompt,.door.near .door-actions{display:flex;}
    .player{position:absolute;bottom:8%;left:170px;width:62px;height:130px;z-index:6;}
    .player .char{position:absolute;inset:0;}
    .player[data-dir="left"] .char{transform:scaleX(-1);}
    .player
  .ava{position:absolute;top:0;left:11px;width:40px;height:40px;border-radius:50%;background:#ffe0bd;border:3px solid
  #10131c;}
    .player .ava:before{content:"";position:absolute;top:16px;left:10px;width:5px;height:5px;border-radius:50%;backgroun
  d:#10131c;box-shadow:13px 0 #10131c;}
    .player .torso{position:absolute;top:34px;left:5px;width:52px;height:74px;border-radius:26px 26px 12px
  12px;background:linear-gradient(#5b7cf0,#4f46e5);border:3px solid #10131c;}
    .player:after{content:"";position:absolute;bottom:-8px;left:9px;width:44px;height:10px;border-radius:50%;background:
  rgba(0,0,0,.28);filter:blur(2px);}
    .player.walk{animation:ply-bob .3s infinite ease-in-out;}
    @keyframes ply-bob{50%{transform:translateY(-4px);}}
    .stage-top{position:absolute;top:10px;left:0;right:0;text-align:center;pointer-events:none;z-index:7;}
    .hall-title{display:inline-block;background:rgba(16,19,28,.55);color:#fff7db;font-weight:800;letter-spacing:.3em;fon
  t-size:12px;padding:4px 14px;border-radius:999px;}
    .hall-sub{display:block;margin:8px auto 0;max-width:90%;color:#fff;font-size:12.5px;text-shadow:0 1px 2px #000;}
    .hud-hint{position:absolute;left:0;right:0;bottom:12px;text-align:center;color:#fff;font-size:12px;letter-spacing:.0
  3em;text-shadow:0 1px 2px #000;pointer-events:none;z-index:7;}
    .touch{display:none;position:absolute;left:0;right:0;bottom:14px;justify-content:space-between;padding:0
  16px;pointer-events:none;z-index:8;}
    .touch .tc{pointer-events:auto;width:62px;height:62px;border-radius:50%;border:2px solid
  #fff;background:rgba(16,19,28,.5);color:#fff;font-size:22px;font-weight:800;cursor:pointer;touch-action:none;-webkit-u
  ser-select:none;user-select:none;}
    @media (pointer:coarse){.touch{display:flex;}.hud-hint{display:none;}}
    `;
    const styleTag = document.createElement('style');
    styleTag.textContent = CSS;
    document.head.append(styleTag);

    // --- Elements -------------------------------------------------------------
    const stage = $('#stage'), world = $('#world'), wall = $('#wall'), player = $('#player');
    if (!stage || !world || !wall || !player) { console.error('[game] stage markup missing in index.html'); return; }

    // --- Config / state -------------------------------------------------------
    let doors = [], px = 180, worldW = 1200, pending = false;
    const keys = new Set();
    const SPEED = 4.4, START = 300, GAP = 250, DOOR_W = 150, NEAR = 120;
    const dialogOpen = () => !!document.querySelector('dialog[open]');
    const clampPlayer = () => { px = Math.max(70, Math.min(px, worldW - 70)); };

    // --- Read classrooms from the hidden card grid app.js renders -------------
    function readRooms() {
      return $$('#classroom-grid .room-card').map(card => {
        const h3 = card.querySelector('h3');
        const av = card.querySelector('.avatar');
        const meta = card.querySelector('.room-meta');
        return {
          card,
          name:   h3 ? h3.textContent : 'Classroom',
          color:  (av && av.style.background) || '#4f46e5',
          avatar: (av ? av.textContent : '?').trim() || '?',
          xp:     ((meta ? meta.textContent : '').match(/(\d+)\s*XP/) || [])[1] || '0',
        };
      });
    }
    const clickIn = (card, sel) => { const el = card && card.querySelector(sel); if (el) el.click(); };
    function enterRoom(i) { const r = readRooms()[i]; if (r) clickIn(r.card, '.start-btn'); }
    function openCreate() {
      const c = $('#classroom-grid .create-card'); if (c) return c.click();
      const b = $('#new-classroom-btn'); if (b) b.click();
    }

    // --- Build the hallway ----------------------------------------------------
    function render() {
      const rooms = readRooms();
      wall.innerHTML = '';
      doors = [];
      rooms.forEach((r, i) => {
        const x = START + i * GAP;
        const d = document.createElement('div');
        d.className = 'door';
        d.style.left = x + 'px';
        d.innerHTML =
          '<div class="door-actions">' +
            '<button class="dbtn" data-act="edit">Edit</button>' +
            '<button class="dbtn danger" data-act="del">Delete</button>' +
          '</div>' +
          '<div class="door-panel" style="--c:' + r.color + '"><span class="win"></span><span
  class="knob"></span></div>' +
          '<div class="plate"><span class="pav" style="background:' + r.color + '">' + escapeHtml(r.avatar) + '</span>'
  +
          '<span class="ptx"><b>' + escapeHtml(r.name) + '</b><small>' + r.xp + ' XP</small></span></div>' +
          '<div class="prompt">Press <b>E</b> to enter</div>';
        d.querySelector('.door-panel').onclick = () => enterRoom(i);
        d.querySelector('.plate').onclick = () => enterRoom(i);
        d.querySelector('[data-act=edit]').onclick = e => { e.stopPropagation(); clickIn(readRooms()[i].card,
  '[data-act=edit]'); };
        d.querySelector('[data-act=del]').onclick  = e => { e.stopPropagation(); clickIn(readRooms()[i].card,
  '[data-act=del]'); };
        wall.append(d);
        doors.push({ cx: x + DOOR_W / 2, kind: 'room', index: i });
      });

      const cx = START + rooms.length * GAP;
      const cd = document.createElement('div');
      cd.className = 'door create-door';
      cd.style.left = cx + 'px';
      cd.innerHTML =
        '<div class="door-panel"><span>+</span></div>' +
        '<div class="plate"><span class="ptx"><b>New classroom</b><small>Create</small></span></div>' +
        '<div class="prompt">Press <b>E</b> to create</div>';
      cd.querySelector('.door-panel').onclick = openCreate;
      cd.querySelector('.plate').onclick = openCreate;
      wall.append(cd);
      doors.push({ cx: cx + DOOR_W / 2, kind: 'create' });

      worldW = cx + 440;
      world.style.width = worldW + 'px';
      const hint = $('#empty-hint');
      if (hint) hint.style.display = rooms.length ? 'none' : '';
      clampPlayer();
    }
    function scheduleRender() { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false;
  render(); }); }

    // --- Interaction ----------------------------------------------------------
    function nearestDoor() {
      let best = null, bd = 1e9;
      for (const d of doors) { const dist = Math.abs(d.cx - px); if (dist < bd) { bd = dist; best = d; } }
      return (best && bd < NEAR) ? best : null;
    }
    function interact() {
      if (dialogOpen()) return;
      const n = nearestDoor();
      if (!n) return;
      if (n.kind === 'create') openCreate(); else enterRoom(n.index);
    }

    // --- Main loop ------------------------------------------------------------
    function loop() {
      if (!dialogOpen()) {
        let dx = 0;
        if (keys.has('a') || keys.has('arrowleft'))  dx -= 1;
        if (keys.has('d') || keys.has('arrowright')) dx += 1;
        if (dx) { px += dx * SPEED; clampPlayer(); player.classList.add('walk'); player.dataset.dir = dx < 0 ? 'left' :
  'right'; }
        else player.classList.remove('walk');
      } else {
        player.classList.remove('walk');
      }
      const stageW = stage.clientWidth;
      const camX = Math.max(0, Math.min(px - stageW / 2, Math.max(0, worldW - stageW)));
      world.style.transform = 'translateX(' + (-camX) + 'px)';
      }
      const stageW = stage.clientWidth;
      const camX = Math.max(0, Math.min(px - stageW / 2, Math.max(0, worldW - stageW)));
      world.style.transform = 'translateX(' + (-camX) + 'px)';
      player.style.left = px + 'px';

      const n = dialogOpen() ? null : nearestDoor();
      const els = wall.querySelectorAll('.door');
      els.forEach((el, idx) => el.classList.toggle('near', !!n && doors[idx] === n));
      requestAnimationFrame(loop);
    }

    // --- Input ----------------------------------------------------------------
    const isTyping = e => /^(input|textarea|select)$/i.test((e.target && e.target.tagName) || '');
    window.addEventListener('keydown', e => {
      if (isTyping(e)) return;
      const k = (e.key || '').toLowerCase();
      if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(k)) e.preventDefault();
      keys.add(k);
      if (k === 'e' || k === 'arrowup') interact();
    });
    window.addEventListener('keyup', e => keys.delete((e.key || '').toLowerCase()));

    function hold(id, key) {
      const el = $(id); if (!el) return;
      const dn = e => { e.preventDefault(); keys.add(key); };
      const up = e => { e.preventDefault(); keys.delete(key); };
      el.addEventListener('pointerdown', dn);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointerleave', up);
      el.addEventListener('pointercancel', up);
    }
    hold('#tc-left', 'arrowleft');
    hold('#tc-right', 'arrowright');
    const te = $('#tc-enter');
    if (te) te.addEventListener('pointerdown', e => { e.preventDefault(); interact(); });

      const camX = Math.max(0, Math.min(px - stageW / 2, Math.max(0, worldW - stageW)));
      world.style.transform = 'translateX(' + (-camX) + 'px)';
      player.style.left = px + 'px';

      const n = dialogOpen() ? null : nearestDoor();
      const els = wall.querySelectorAll('.door');
      els.forEach((el, idx) => el.classList.toggle('near', !!n && doors[idx] === n));
      requestAnimationFrame(loop);
    }

    // --- Input ----------------------------------------------------------------
    const isTyping = e => /^(input|textarea|select)$/i.test((e.target && e.target.tagName) || '');
    window.addEventListener('keydown', e => {
      if (isTyping(e)) return;
      const k = (e.key || '').toLowerCase();
      if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(k)) e.preventDefault();
      keys.add(k);
      if (k === 'e' || k === 'arrowup') interact();
    });
    window.addEventListener('keyup', e => keys.delete((e.key || '').toLowerCase()));

    function hold(id, key) {
      const el = $(id); if (!el) return;
      const dn = e => { e.preventDefault(); keys.add(key); };
      const up = e => { e.preventDefault(); keys.delete(key); };
      el.addEventListener('pointerdown', dn);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointerleave', up);
      el.addEventListener('pointercancel', up);
    }
    hold('#tc-left', 'arrowleft');
    hold('#tc-right', 'arrowright');
    const te = $('#tc-enter');
    if (te) te.addEventListener('pointerdown', e => { e.preventDefault(); interact(); });

    // --- Keep hallway in sync when app.js re-renders the grid ------------------
    const grid = $('#classroom-grid');
    if (grid) new MutationObserver(scheduleRender).observe(grid, { childList: true, subtree: true });

    render();
    requestAnimationFrame(loop);
  })();
