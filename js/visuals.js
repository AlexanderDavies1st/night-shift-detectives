// Version 1.0.0
// No dependencies. Adds scene-transition and action feedback without changing game state.
const scene = document.querySelector('#scene');
const hotspots = document.querySelector('#hotspots');
const guardBanner = document.querySelector('#guardBanner');

const ACTIONS = [
  [/desk drawer|file box|evidence locker/i, ['SEARCHING EVIDENCE','Checking the scene…','action-shake']],
  [/radio receiver/i, ['TUNING RADIO','Listening for the transmission…','']],
  [/hide|hiding place/i, ['HIDING','Stay out of sight.','action-hide']],
  [/guard monitor/i, ['CHECKING CAMERAS','Watching the patrol route…','']],
  [/leave building/i, ['EXTRACTING','Getting the team out…','']],
  [/go:/i, ['MOVING','Entering the next area…','']]
];

function ensureOverlay(){
  if(!scene) return null;
  let overlay = scene.querySelector('.action-overlay');
  if(overlay) return overlay;
  overlay = document.createElement('div');
  overlay.className = 'action-overlay';
  overlay.innerHTML = `<div class="action-card"><img src="./assets/action.svg" alt=""><strong id="actionTitle">INVESTIGATING</strong><small id="actionText">Working…</small></div>`;
  scene.appendChild(overlay);
  return overlay;
}

function playAction(title,text,effect=''){
  const overlay = ensureOverlay();
  if(!overlay || !scene) return;
  overlay.querySelector('#actionTitle').textContent = title;
  overlay.querySelector('#actionText').textContent = text;
  overlay.classList.remove('show');
  void overlay.offsetWidth;
  overlay.classList.add('show');
  if(effect){ scene.classList.add(effect); setTimeout(()=>scene.classList.remove(effect),820); }
}

hotspots?.addEventListener('click', (event)=>{
  const button = event.target.closest('.hotspot');
  if(!button) return;
  const label = button.textContent.trim();
  const match = ACTIONS.find(([pattern])=>pattern.test(label));
  if(match) playAction(...match[1]);
});

if(scene){
  let lastRoom = '';
  new MutationObserver(()=>{
    const room = [...scene.classList].find(c=>c.startsWith('room-')) || '';
    if(room && room !== lastRoom){
      lastRoom = room;
      scene.classList.remove('scene-transition');
      void scene.offsetWidth;
      scene.classList.add('scene-transition');
      setTimeout(()=>scene.classList.remove('scene-transition'),500);
    }
  }).observe(scene,{attributes:true,attributeFilter:['class']});
}

if(guardBanner && scene){
  const syncGuard = ()=> scene.classList.toggle('action-alert', !guardBanner.classList.contains('hidden'));
  new MutationObserver(syncGuard).observe(guardBanner,{attributes:true,attributeFilter:['class']});
  syncGuard();
}
