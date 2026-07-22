(() => {
  const canvas = document.querySelector('#game');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const W = canvas.width, H = canvas.height, T = 48;
  const keys = new Set();
  const saved = JSON.parse(localStorage.getItem('teachback-topics') || 'null');
  const defaultTopics = [{name:'Photosynthesis', persona:'Maya', style:'curious', color:'#e36c65'}, {name:'Algebra', persona:'Theo', style:'careful', color:'#5484be'}, {name:'Storytelling', persona:'Iris', style:'creative', color:'#a278b3'}];
  let topics = saved || defaultTopics;
  let progress = JSON.parse(localStorage.getItem('teachback-progress') || '{}');
  let room = 'hub', activeTopic = null, last = performance.now();
  let player = {x:W/2, y:H-115, dir:'down', step:0};
  const topicDialog = document.querySelector('#topic-dialog'), teachDialog = document.querySelector('#teach-dialog'), reportDialog = document.querySelector('#report-dialog');
  const location = document.querySelector('#location-label');

  function persist(){ localStorage.setItem('teachback-topics', JSON.stringify(topics)); localStorage.setItem('teachback-progress', JSON.stringify(progress)); updateStats(); }
  function updateStats(){const sessions=Object.values(progress); const xp=sessions.reduce((a,b)=>a+b.xp,0); document.querySelector('#xp-value').textContent=xp; document.querySelector('#streak-value').textContent=sessions.length?1:0;}
  function rect(x,y,w,h,c){ctx.fillStyle=c;ctx.fillRect(x,y,w,h)}
  function text(s,x,y,size=14,c='#fff7db',align='left'){ctx.fillStyle=c;ctx.font=`900 ${size}px ui-rounded, Trebuchet MS, sans-serif`;ctx.textAlign=align;ctx.fillText(s,x,y)}
  function tile(x,y,c,detail){rect(x*T,y*T,T,T,c);if(detail){ctx.fillStyle=detail;ctx.fillRect(x*T+5,y*T+5,3,3);ctx.fillRect(x*T+32,y*T+31,3,3)}}
  function drawFloor(color='#d6be91'){for(let y=0;y<12;y++)for(let x=0;x<20;x++)tile(x,y,color,'#c7ad82')}
  function wall(x,y,w=1,h=1){rect(x*T,y*T,w*T,h*T,'#68495a');rect(x*T+4,y*T+4,w*T-8,7,'#e8c07e');rect(x*T+4,y*T+13,w*T-8,h*T-17,'#9a6b57');for(let xx=x;xx<x+w;xx++)rect(xx*T+10,y*T+22,10,3,'#c99565')}
  function plant(x,y){rect(x,y,18,18,'#b56f4d');rect(x+3,y-6,12,9,'#3f8469');rect(x+6,y-11,7,10,'#4b9d72')}
  function drawPlayer(){let {x,y,dir,step}=player;let bob=Math.round(Math.sin(step)*2);rect(x-11,y-14+bob,22,24,'#384462');rect(x-9,y-24+bob,18,14,'#ecc092');rect(x-11,y-29+bob,22,9,'#564455');rect(x-7,y+10+bob,5,6,'#26334e');rect(x+3,y+10+bob,5,6,'#26334e'); if(dir==='left')rect(x-13,y-16+bob,5,11,'#ecc092'); if(dir==='right')rect(x+8,y-16+bob,5,11,'#ecc092')}
  function drawNpc(t,x,y){rect(x-11,y-14,22,24,t.color);rect(x-9,y-24,18,14,'#e9bd91');rect(x-11,y-29,22,9,'#4a3b55');rect(x-7,y+10,5,6,'#4a3650');rect(x+3,y+10,5,6,'#4a3650');text(t.persona[0],x,y-39,11,'#fff9df','center')}
  function drawHub(){drawFloor('#c5d1c7'); wall(0,0,20); wall(0,11,20); wall(0,0,1,12); wall(19,0,1,12); rect(0,230,W,116,'#90bdb9');rect(0,276,W,4,'#678e9b');text('TEACHBACK ACADEMY',W/2,60,26,'#fff3cf','center');text('Choose a classroom',W/2,87,13,'#5b5868','center'); plant(83,190);plant(856,190);
    topics.slice(0,6).forEach((t,i)=>{let col=i%3,row=Math.floor(i/3),x=180+col*280,y=150+row*245; rect(x-86,y-50,172,104,'#896250');rect(x-80,y-45,160,91,'#f1d08d');rect(x-55,y-16,110,48,'#394b66');text(t.name.toUpperCase(),x,y+1,13,'#fff7da','center');text('ENTER',x,y+23,9,'#f1d08d','center');});
  }
  function drawRoom(){drawFloor('#d7bd87');wall(0,0,20);wall(0,11,20);wall(0,0,1,12);wall(19,0,1,12);rect(410,528,140,48,'#38465c');text('← HALLWAY',480,555,11,'#ffefc8','center');text(activeTopic.name.toUpperCase(),480,58,25,'#fff3cf','center'); for(let i=0;i<4;i++){let x=120+i*190;rect(x,150,74,38,'#8e614f');rect(x+5,155,64,25,'#ead5a0');rect(x+10,161,52,4,'#6d7b94')}plant(70,470);plant(865,470);drawNpc(activeTopic,480,285);}
  function nearNpc(){return room==='room' && Math.hypot(player.x-480,player.y-300)<72}
  function draw(){ctx.clearRect(0,0,W,H); room==='hub'?drawHub():drawRoom();drawPlayer();if(nearNpc()&&!teachDialog.open){rect(320,125,320,29,'#26334eee');text(`PRESS E  •  TALK TO ${activeTopic.persona.toUpperCase()}`,480,145,12,'#fff8dc','center')}if(room==='hub'){topics.slice(0,6).forEach((t,i)=>{let col=i%3,row=Math.floor(i/3),x=180+col*280,y=150+row*245;if(Math.hypot(player.x-x,player.y-y)<100){rect(x-74,y+62,148,24,'#26334eee');text(`PRESS E • ENTER ${t.name.toUpperCase()}`,x,y+78,10,'#fff8dc','center')}})} }
  function blocked(x,y){return x<58||x>902||y<70||y>510}
  function move(dt){if(teachDialog.open||topicDialog.open||reportDialog.open)return;let dx=0,dy=0;if(keys.has('arrowleft')||keys.has('a')){dx=-1;player.dir='left'}if(keys.has('arrowright')||keys.has('d')){dx=1;player.dir='right'}if(keys.has('arrowup')||keys.has('w')){dy=-1;player.dir='up'}if(keys.has('arrowdown')||keys.has('s')){dy=1;player.dir='down'}if(dx||dy){let n=Math.hypot(dx,dy);let nx=player.x+dx/n*175*dt,ny=player.y+dy/n*175*dt;if(!blocked(nx,ny)){player.x=nx;player.y=ny}player.step+=dt*15}if(room==='room'&&player.y>515&&player.x>400&&player.x<560){room='hub';player={x:480,y:438,dir:'up',step:0};location.textContent='HALLWAY · Choose a classroom'}}
  function loop(now){let dt=Math.min(.04,(now-last)/1000);last=now;move(dt);draw();requestAnimationFrame(loop)}
  function action(){if(teachDialog.open)return;if(room==='room'&&nearNpc())openLesson();if(room==='hub'){topics.slice(0,6).some((t,i)=>{let x=180+(i%3)*280,y=150+Math.floor(i/3)*245;if(Math.hypot(player.x-x,player.y-y)<100){activeTopic=t;room='room';player={x:480,y:470,dir:'up',step:0};location.textContent=`${t.name.toUpperCase()} · Find ${t.persona}`;return true}})}}
  function addBubble(message, who){const e=document.createElement('div');e.className=`bubble ${who}`;e.textContent=message;document.querySelector('#conversation').append(e);e.scrollIntoView({block:'end'});}
  function openLesson(){document.querySelector('#lesson-topic').textContent=activeTopic.name.toUpperCase();document.querySelector('#lesson-title').textContent=`Teach ${activeTopic.persona}`;document.querySelector('#portrait').textContent=activeTopic.persona[0];document.querySelector('#portrait').style.background=activeTopic.color;document.querySelector('#conversation').innerHTML='';addBubble(`Hi! I’m ${activeTopic.persona}. I want to understand ${activeTopic.name}. Can you explain the main idea in your own words?`,'student');teachDialog.showModal();setTimeout(()=>document.querySelector('#teach-input').focus(),20)}
  function reply(input){let p=progress[activeTopic.name]||{xp:0,lessons:0};p.xp+=10;p.lessons++;progress[activeTopic.name]=p;persist();let q=activeTopic.style==='careful'?'What evidence or example supports that?':activeTopic.style==='creative'?'Could you give me a vivid example so I can picture it?':'Why does that happen?';addBubble(`${q} I’m following your explanation!`,'student');}
  document.addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key))e.preventDefault();keys.add(e.key.toLowerCase());if(e.key.toLowerCase()==='e')action()});document.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));
  document.querySelector('#topic-button').onclick=()=>topicDialog.showModal();document.querySelector('#topic-form').addEventListener('submit',e=>{e.preventDefault();topics.push({name:document.querySelector('#topic-name').value.trim(),persona:document.querySelector('#persona-name').value.trim(),style:document.querySelector('#persona-style').value,color:['#e36c65','#5484be','#a278b3','#599b7d'][topics.length%4]});persist();topicDialog.close();e.target.reset()});
  document.querySelector('#teach-form').addEventListener('submit',e=>{e.preventDefault();let input=document.querySelector('#teach-input');if(!input.value.trim())return;addBubble(input.value.trim(),'player');input.value='';setTimeout(()=>reply(),280)});document.querySelector('#end-lesson').onclick=()=>teachDialog.close();
  document.querySelector('#report-button').onclick=()=>{const list=document.querySelector('#report-list');list.innerHTML='';let total=0;topics.forEach(t=>{let p=progress[t.name]||{xp:0,lessons:0};total+=p.xp;let r=document.createElement('div');r.className='report-row';r.innerHTML=`<span>${t.name}</span><span>${p.lessons} lesson${p.lessons===1?'':'s'} · ${p.xp} XP</span>`;list.append(r)});document.querySelector('#report-xp').textContent=total;reportDialog.showModal()};document.querySelector('#close-report').onclick=()=>reportDialog.close();
  updateStats();requestAnimationFrame(loop);
})();
