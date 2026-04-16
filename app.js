/* ============================================================
   STAARLINA — app.js  (Supabase Edition)
   ============================================================
   SETUP: Replace the two values below with your own project
   credentials from https://supabase.com/dashboard → Settings
   → API.  Leave everything else as-is.
   ============================================================ */

// ─────────────────────────────────────────────────────────────
//  ★  PASTE YOUR SUPABASE CREDENTIALS HERE  ★
// ─────────────────────────────────────────────────────────────
const SUPABASE_URL  = 'https://lngtgjsxpsmqbaxudmmw.supabase.co';  // e.g. https://abcdefghij.supabase.co
const SUPABASE_ANON = 'sb_publishable_-rWV5BTBjx8eXL4vuCFPmg_PyQt5wBl';                   // long string starting with "eyJ..."
// ─────────────────────────────────────────────────────────────

'use strict';

// ===================== SUPABASE CLIENT =====================
// Loaded via <script> tag in index.html (CDN, no build tool needed).
// The global `supabase` object is created here and used throughout.
//
// persistSession:true   → stores the JWT + refresh token in localStorage
//                         so it survives page refreshes.
// autoRefreshToken:true → silently renews the token before it expires
//                         so users stay logged in during long sessions.
// detectSessionInUrl:true → picks up the session from the URL hash on
//                         password-reset and email-confirmation redirects.
const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession:     true,
    autoRefreshToken:   true,
    detectSessionInUrl: true,
  },
});

// ===================== STATE =====================
const state = {
  currentPage: 'home',
  currentLens: 'none',
  lensActive: false,
  cameraActive: false,
  cameraStream: null,
  user: null,           // Supabase User object (null when signed out)
  profile: null,        // Row from public.profiles table
  snapshots: [],
  customSettings: { blue: 60, contrast: 40, warm: 50 },
  compareMode: false,
  mapInitialised: false,
  userLocation: null,   // { lat, lng } saved to DB after login
  researchFeed: [],
};

// ===================== SESSION BOOTSTRAP =====================
// Explicitly calls getSession() on every page load to pull the
// stored JWT from localStorage and hydrate state BEFORE any
// user interaction.  This is the primary fix for the
// "logged out on refresh" bug — onAuthStateChange alone fires
// asynchronously and too late for the initial nav render.
(async function bootstrapSession() {
  const { data: { session } } = await db.auth.getSession();
  if (session?.user) {
    state.user = session.user;
    await loadOrCreateProfile(session.user);
    updateNavForUser();
  }
})();

// ===================== AUTH LISTENER =====================
// Handles all subsequent auth events after bootstrap.
// INITIAL_SESSION is deliberately skipped — bootstrapSession
// already handled it, and acting on it twice causes the nav
// button to briefly show "Sign In" before re-rendering.
db.auth.onAuthStateChange(async (event, session) => {
  if (event === 'INITIAL_SESSION') return;

  if (session?.user) {
    state.user = session.user;
    await loadOrCreateProfile(session.user);
    updateNavForUser();

    if (state.userLocation) {
      await saveLocationToDB(state.userLocation.lat, state.userLocation.lng);
    }

    await loadResearchFeed('recent');

    if (event === 'SIGNED_IN') {
      const name = state.profile?.display_name || session.user.email.split('@')[0];
      showToast(`Welcome back, ${name}! 🌌`, 'success');
      closeAuth();
    }
  } else {
    state.user    = null;
    state.profile = null;
    updateNavForUser();
    if (event === 'SIGNED_OUT') showToast('Signed out successfully.');
  }
});

// ===================== PROFILE HELPERS =====================
async function loadOrCreateProfile(user) {
  // Try to load existing profile
  const { data, error } = await db
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (data) {
    state.profile = data;
    return;
  }

  // Profile doesn't exist yet — create one
  const displayName = user.user_metadata?.full_name
    || user.user_metadata?.name
    || user.email.split('@')[0];

  const { data: newProfile } = await db
    .from('profiles')
    .insert({
      id:           user.id,
      display_name: displayName,
      email:        user.email,
      role:         'Amateur Astronomer',
      created_at:   new Date().toISOString(),
    })
    .select()
    .single();

  state.profile = newProfile;
}

function updateNavForUser() {
  const btn = document.getElementById('loginBtn');
  if (!btn) return;
  if (state.user) {
    const name = state.profile?.display_name || state.user.email.split('@')[0];
    btn.textContent = `👤 ${name.split(' ')[0]}`;
  } else {
    btn.textContent = 'Sign In';
  }
}

// ===================== NAVIGATION =====================
function navigateTo(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const page = document.getElementById(pageId);
  const link = document.querySelector(`[data-page="${pageId}"]`);
  if (page) page.classList.add('active');
  if (link) link.classList.add('active');
  state.currentPage = pageId;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (pageId === 'sky-lab')   initSkyCanvas();
  if (pageId === 'education') renderArticles('all');
  if (pageId === 'research')  loadResearchFeed('recent');
  if (pageId === 'map')       initMapCanvas();
  updateHudTime();
}

document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    navigateTo(link.getAttribute('data-page'));
    document.getElementById('navLinks').classList.remove('open');
  });
});

document.getElementById('hamburger').addEventListener('click', () => {
  document.getElementById('navLinks').classList.toggle('open');
});

// ===================== STARFIELD BACKGROUND =====================
(function initStarfield() {
  const canvas = document.getElementById('starfield');
  const ctx    = canvas.getContext('2d');
  let stars = [], shootingStars = [], W, H;

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
    createStars();
  }

  function createStars() {
    stars = [];
    const count = Math.floor((W * H) / 3000);
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * W, y: Math.random() * H,
        r: Math.random() * 1.5 + 0.3,
        alpha: Math.random() * 0.7 + 0.3,
        twinkleSpeed: Math.random() * 0.02 + 0.005,
        twinkleDir: Math.random() > 0.5 ? 1 : -1,
        hue: Math.random() > 0.9 ? `hsl(${Math.random()*60+200},80%,90%)` : '#fff',
      });
    }
  }

  function spawnShootingStar() {
    if (Math.random() < 0.003) {
      shootingStars.push({
        x: Math.random() * W * 0.6, y: Math.random() * H * 0.4,
        len: Math.random() * 120 + 80, speed: Math.random() * 8 + 6,
        alpha: 1, angle: Math.PI / 4 + (Math.random() - 0.5) * 0.3,
      });
    }
  }

  function drawFrame() {
    ctx.clearRect(0, 0, W, H);
    stars.forEach(s => {
      s.alpha += s.twinkleSpeed * s.twinkleDir;
      if (s.alpha >= 1 || s.alpha <= 0.15) s.twinkleDir *= -1;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = s.hue; ctx.globalAlpha = s.alpha; ctx.fill();
    });
    spawnShootingStar();
    shootingStars = shootingStars.filter(ss => ss.alpha > 0);
    shootingStars.forEach(ss => {
      ctx.save();
      const grad = ctx.createLinearGradient(ss.x, ss.y, ss.x - Math.cos(ss.angle)*ss.len, ss.y - Math.sin(ss.angle)*ss.len);
      grad.addColorStop(0, `rgba(255,255,255,${ss.alpha})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = grad; ctx.lineWidth = 2; ctx.globalAlpha = ss.alpha;
      ctx.beginPath(); ctx.moveTo(ss.x, ss.y);
      ctx.lineTo(ss.x + Math.cos(ss.angle)*ss.len, ss.y + Math.sin(ss.angle)*ss.len);
      ctx.stroke(); ctx.restore();
      ss.x += Math.cos(ss.angle) * ss.speed;
      ss.y += Math.sin(ss.angle) * ss.speed;
      ss.alpha -= 0.02;
    });
    ctx.globalAlpha = 1;
    requestAnimationFrame(drawFrame);
  }

  window.addEventListener('resize', resize);
  resize();
  drawFrame();
})();

// ===================== SKY CANVAS SIMULATION =====================
let skyCtx, skyCanvas, skyStars = [], skyAnimId;

function initSkyCanvas() {
  skyCanvas = document.getElementById('skyCanvas');
  if (!skyCanvas) return;
  skyCtx = skyCanvas.getContext('2d');
  skyCanvas.width  = skyCanvas.offsetWidth  || 800;
  skyCanvas.height = skyCanvas.offsetHeight || 450;
  createSkyStars();
  if (skyAnimId) cancelAnimationFrame(skyAnimId);
  drawSkyFrame();
}

function createSkyStars() {
  skyStars = [];
  const w = skyCanvas.width, h = skyCanvas.height;
  for (let i = 0; i < 320; i++) {
    skyStars.push({
      x: Math.random()*w, y: Math.random()*h,
      r: Math.random()*2.5+0.5,
      brightness: Math.random()*0.8+0.2,
      twinkle: Math.random()*0.03+0.005,
      dir: Math.random()>0.5?1:-1,
      type: Math.random()>0.95?'bright':'normal',
    });
  }
  [
    { x:w*0.2,  y:h*0.25, label:'Polaris',   r:3.5, color:'#fffae0' },
    { x:w*0.6,  y:h*0.3,  label:'Sirius',    r:4,   color:'#e0eeff' },
    { x:w*0.4,  y:h*0.6,  label:'Orion Neb', r:5,   color:'rgba(180,80,255,0.5)', isNebula:true },
    { x:w*0.8,  y:h*0.55, label:'Jupiter',   r:4.5, color:'#ffe8b0' },
    { x:w*0.15, y:h*0.65, label:'Mars',      r:3.5, color:'#ff8060' },
  ].forEach(c => skyStars.push({ ...c, bright:true, brightness:1, twinkle:0.005, dir:1 }));
}

function drawSkyFrame() {
  if (!skyCtx) return;
  const w = skyCanvas.width, h = skyCanvas.height;
  const lens = state.lensActive ? state.currentLens : 'none';
  const bgGrad = skyCtx.createLinearGradient(0,0,0,h);
  if      (lens==='city')       { bgGrad.addColorStop(0,'#120608'); bgGrad.addColorStop(1,'#1a0a0a'); }
  else if (lens==='brightness') { bgGrad.addColorStop(0,'#040210'); bgGrad.addColorStop(1,'#050315'); }
  else if (lens==='astronomy')  { bgGrad.addColorStop(0,'#000005'); bgGrad.addColorStop(1,'#020010'); }
  else                          { bgGrad.addColorStop(0,'#01000a'); bgGrad.addColorStop(1,'#080420'); }
  skyCtx.fillStyle = bgGrad; skyCtx.fillRect(0,0,w,h);

  if (!state.lensActive) {
    const pg = skyCtx.createRadialGradient(w/2,h,0,w/2,h,h*0.8);
    pg.addColorStop(0,'rgba(100,140,255,0.18)'); pg.addColorStop(1,'transparent');
    skyCtx.fillStyle = pg; skyCtx.fillRect(0,0,w,h);
  }

  skyStars.forEach(s => {
    if (s.bright) {
      if (s.isNebula) {
        const ng = skyCtx.createRadialGradient(s.x,s.y,0,s.x,s.y,s.r*6);
        const vis = state.lensActive&&lens==='astronomy'?0.8:0.3;
        ng.addColorStop(0,s.color.replace('0.5',`${vis}`)); ng.addColorStop(1,'transparent');
        skyCtx.fillStyle=ng; skyCtx.beginPath(); skyCtx.arc(s.x,s.y,s.r*6,0,Math.PI*2); skyCtx.fill();
      }
      const halo = skyCtx.createRadialGradient(s.x,s.y,0,s.x,s.y,s.r*3);
      halo.addColorStop(0,s.color||'#fff'); halo.addColorStop(1,'transparent');
      skyCtx.fillStyle=halo; skyCtx.beginPath(); skyCtx.arc(s.x,s.y,s.r*3,0,Math.PI*2); skyCtx.fill();
      skyCtx.beginPath(); skyCtx.arc(s.x,s.y,s.r,0,Math.PI*2);
      skyCtx.fillStyle=s.color||'#fff'; skyCtx.fill();
      const lv = state.lensActive?1:0.4;
      skyCtx.fillStyle=`rgba(180,160,255,${lv})`;
      skyCtx.font='10px Space Mono,monospace'; skyCtx.fillText(s.label,s.x+s.r+5,s.y+4);
      return;
    }
    s.brightness += s.twinkle*s.dir;
    if (s.brightness>=1||s.brightness<=0.1) s.dir*=-1;
    let alpha=s.brightness, starR=s.r;
    if (lens==='astronomy'&&state.lensActive) { alpha=Math.min(1,alpha*1.5); starR*=1.2; }
    if (!state.lensActive) { alpha*=0.5; starR*=0.85; }
    skyCtx.beginPath(); skyCtx.arc(s.x,s.y,starR,0,Math.PI*2);
    skyCtx.fillStyle='#fff'; skyCtx.globalAlpha=alpha; skyCtx.fill();
    skyCtx.globalAlpha=1;
  });

  applyLensOverlayToCanvas(skyCtx,w,h,lens);
  skyAnimId = requestAnimationFrame(drawSkyFrame);
}

function applyLensOverlayToCanvas(ctx,w,h,lens) {
  if (!state.lensActive) return;
  ctx.save();
  const overlays = {
    city:      'rgba(180,100,10,0.08)', astronomy:'rgba(20,0,60,0.1)',
    antiglare: 'rgba(0,20,40,0.07)',    brightness:'rgba(0,0,0,0.2)',
    custom:    `rgba(${state.customSettings.warm*1.5},60,${255-state.customSettings.blue*2},0.001)`
  };
  if (overlays[lens]) { ctx.fillStyle=overlays[lens]; ctx.fillRect(0,0,w,h); }
  ctx.restore();
}

// ===================== LENS CONTROL =====================
function selectLens(lensId, el) {
  state.currentLens = lensId;
  document.querySelectorAll('.lens-card').forEach(c=>c.classList.remove('active'));
  if (el) el.classList.add('active');
  else { const c=document.querySelector(`[data-lens="${lensId}"]`); if(c) c.classList.add('active'); }
  document.getElementById('hudLens').textContent = `🔬 Lens: ${lensId==='none'?'None':getLensName(lensId)}`;
  const cb = document.getElementById('customBuilder');
  if (cb) cb.style.display = lensId==='custom'?'flex':'none';
  applyLensOverlay(lensId);
  if (state.cameraActive) applyFilterToCamera();
}

function getLensName(id) {
  return {city:'City',astronomy:'Astronomy',antiglare:'Anti-Glare',brightness:'Brightness',custom:'Custom'}[id]||id;
}

function toggleLens(el) {
  state.lensActive = el.checked;
  const ig = document.getElementById('intensityGroup');
  if (ig) ig.style.display = el.checked?'flex':'none';
  applyLensOverlay(state.currentLens);
  if (state.cameraActive) applyFilterToCamera();
  showToast(state.lensActive?`${getLensName(state.currentLens)} Lens activated`:'Lens deactivated');
}

function applyLensOverlay(lensId) {
  const overlay = document.getElementById('lensOverlay');
  if (!overlay) return;
  overlay.style.background='none';
  if (!state.lensActive||lensId==='none') return;
  const cfgs = {
    city:{bg:'rgba(200,130,30,0.12)',blend:'multiply'},
    astronomy:{bg:'rgba(40,10,120,0.15)',blend:'multiply'},
    antiglare:{bg:'rgba(0,30,60,0.1)',blend:'multiply'},
    brightness:{bg:'rgba(0,0,0,0.22)',blend:'normal'},
    custom:{bg:`rgba(${state.customSettings.warm*1.5},60,${255-state.customSettings.blue*2},${state.customSettings.blue*0.001})`,blend:'multiply'}
  };
  const c=cfgs[lensId];
  if (c) { overlay.style.background=c.bg; overlay.style.mixBlendMode=c.blend; }
}

function updateIntensity(el) {
  document.getElementById('intensityVal').textContent=el.value;
  applyLensOverlay(state.currentLens);
}

function updateCustom(type,el) {
  state.customSettings[type]=parseInt(el.value);
  document.getElementById(`${type}Val`).textContent=el.value;
  applyLensOverlay('custom');
}

// ===================== CAMERA =====================
function toggleSimMode() {
  if (state.cameraActive) {
    stopCamera();
    document.getElementById('simModeBtn').classList.add('active');
    document.getElementById('cameraBtn').classList.remove('active');
    document.getElementById('skyCanvas').style.display='block';
    document.getElementById('cameraFeed').style.display='none';
    showToast('Switched to simulation mode');
  }
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) { showToast('Camera not supported','error'); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
    state.cameraStream=stream; state.cameraActive=true;
    const video=document.getElementById('cameraFeed');
    video.srcObject=stream; video.style.display='block';
    document.getElementById('skyCanvas').style.display='none';
    document.getElementById('cameraBtn').classList.add('active');
    document.getElementById('simModeBtn').classList.remove('active');
    document.getElementById('hudLocation').textContent='📍 Camera: Live';
    showToast('Camera activated — AI filter applied');
    applyFilterToCamera();
  } catch(err) { showToast(`Camera error: ${err.message}`,'error'); }
}

function stopCamera() {
  if (state.cameraStream) { state.cameraStream.getTracks().forEach(t=>t.stop()); state.cameraStream=null; }
  state.cameraActive=false;
  document.getElementById('cameraFeed').style.display='none';
}

function applyFilterToCamera() {
  const video=document.getElementById('cameraFeed');
  if (!video) return;
  const filters = {
    none:'none', city:'sepia(0.4) hue-rotate(20deg) saturate(0.7)',
    astronomy:'contrast(1.6) brightness(1.15) saturate(0.8)',
    antiglare:'brightness(0.85) contrast(1.1)', brightness:'brightness(0.65) contrast(1.05)',
    custom:()=>{const{blue,contrast,warm}=state.customSettings;return`sepia(${warm/150}) contrast(${1+contrast/200}) saturate(${1-blue/250}) brightness(0.9)`;}
  };
  const f=filters[state.lensActive?state.currentLens:'none'];
  video.style.filter=typeof f==='function'?f():(state.lensActive?f:'none');
}

// ===================== SNAPSHOT =====================
function captureSnapshot() {
  const ts=new Date().toLocaleTimeString();
  const lensName=state.lensActive?getLensName(state.currentLens):'Raw';
  let dataURL;
  if (state.cameraActive) {
    const video=document.getElementById('cameraFeed');
    const tmp=document.createElement('canvas');
    tmp.width=video.videoWidth||640; tmp.height=video.videoHeight||360;
    const tc=tmp.getContext('2d'); tc.filter=video.style.filter||'none';
    tc.drawImage(video,0,0); dataURL=tmp.toDataURL('image/jpeg',0.9);
  } else { dataURL=skyCanvas.toDataURL('image/jpeg',0.9); }
  state.snapshots.push({dataURL,lens:lensName,time:ts});
  renderGallery();
  showToast(`Snapshot saved — ${lensName} lens`,'success');
}

function renderGallery() {
  const grid=document.getElementById('galleryGrid');
  if (!grid) return;
  if (!state.snapshots.length) { grid.innerHTML='<div class="gallery-empty">Take a snapshot to see it here.</div>'; return; }
  grid.innerHTML=state.snapshots.map((s,i)=>`
    <div class="gallery-item" onclick="viewSnapshot(${i})">
      <img src="${s.dataURL}" alt="Snapshot ${i+1}"/>
      <div class="gallery-item-label">${s.lens} · ${s.time}</div>
    </div>`).join('');
}

function viewSnapshot(idx) {
  const snap=state.snapshots[idx];
  document.getElementById('modalContent').innerHTML=`
    <h2>Snapshot — ${snap.lens}</h2>
    <p style="font-family:var(--font-mono);font-size:0.75rem;color:var(--muted)">${snap.time}</p>
    <img src="${snap.dataURL}" style="width:100%;border-radius:10px;margin-top:16px;"/>
    <button onclick="downloadSnapshot(${idx})" style="margin-top:16px;" class="btn-primary small">⬇ Download</button>`;
  document.getElementById('articleModal').classList.add('open');
}

function downloadSnapshot(idx) {
  const a=document.createElement('a'); a.href=state.snapshots[idx].dataURL;
  a.download=`staarlina_snapshot_${idx+1}.jpg`; a.click();
}

// ===================== COMPARE MODE =====================
function toggleLensCompare() {
  state.compareMode=!state.compareMode;
  const cp=document.getElementById('comparePanel');
  if (cp) cp.style.display=state.compareMode?'flex':'none';
}

function runComparison() {
  const a=document.getElementById('compareA').value;
  const b=document.getElementById('compareB').value;
  showToast(`Comparing ${getLensName(a)||'No Lens'} vs ${getLensName(b)||'No Lens'}`);
}

// ===================== LOCATION (with Supabase save) =====================
function requestLocation() {
  if (!navigator.geolocation) { showToast('Geolocation not supported','error'); return; }
  navigator.geolocation.getCurrentPosition(
    async pos => {
      const lat=pos.coords.latitude, lng=pos.coords.longitude;
      state.userLocation={lat,lng};
      document.getElementById('hudLocation').textContent=`📍 ${lat.toFixed(3)}, ${lng.toFixed(3)}`;
      showToast(`Location acquired: ${lat.toFixed(3)}, ${lng.toFixed(3)}`,'success');
      // Save to Supabase if signed in
      if (state.user) await saveLocationToDB(lat, lng);
    },
    () => showToast('Location access denied','error')
  );
}

/**
 * Upserts the user's location into the `user_locations` table.
 * Creates a new row if none exists for this user; updates it otherwise.
 */
async function saveLocationToDB(lat, lng) {
  const { error } = await db
    .from('user_locations')
    .upsert({
      user_id:    state.user.id,
      latitude:   lat,
      longitude:  lng,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

  if (error) {
    console.error('Location save error:', error.message);
  } else {
    showToast('Location saved to your account ✓','success');
  }
}

function autofillLocation() {
  if (!navigator.geolocation) { showToast('Geolocation not supported','error'); return; }
  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat=pos.coords.latitude.toFixed(4), lng=pos.coords.longitude.toFixed(4);
      document.getElementById('resLocation').value=`${lat}, ${lng}`;
      showToast('Location filled','success');
    },
    ()=>showToast('Could not get location','error')
  );
}

// ===================== HUD CLOCK =====================
function updateHudTime() {
  const el=document.getElementById('hudTime');
  if (!el) return;
  const now=new Date();
  el.textContent=`🕐 ${now.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`;
}
setInterval(updateHudTime,30000);
updateHudTime();

// ===================== MAP =====================
function initMap() {
  document.getElementById('mapPlaceholder').classList.add('hidden');
  state.mapInitialised=true;
  requestLocation();
  initMapCanvas();
}

function initMapCanvas() {
  const canvas=document.getElementById('mapCanvas');
  if (!canvas) return;
  const ctx=canvas.getContext('2d');
  const W=canvas.width=canvas.offsetWidth||800, H=canvas.height=canvas.offsetHeight||500;
  const bg=ctx.createLinearGradient(0,0,W,H);
  bg.addColorStop(0,'#040214'); bg.addColorStop(1,'#0a0430');
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);
  ctx.strokeStyle='rgba(80,40,140,0.2)'; ctx.lineWidth=1;
  for(let x=0;x<W;x+=60){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
  for(let y=0;y<H;y+=60){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
  [
    {x:W*0.15,y:H*0.25,rX:80,rY:60},{x:W*0.38,y:H*0.3,rX:130,rY:80},
    {x:W*0.62,y:H*0.35,rX:110,rY:90},{x:W*0.75,y:H*0.5,rX:70,rY:55},
    {x:W*0.5,y:H*0.65,rX:50,rY:40},{x:W*0.22,y:H*0.6,rX:90,rY:60},
  ].forEach(c=>{
    ctx.beginPath(); ctx.ellipse(c.x,c.y,c.rX,c.rY,0,0,Math.PI*2);
    ctx.fillStyle='rgba(40,20,80,0.9)'; ctx.fill();
    ctx.strokeStyle='rgba(100,60,180,0.3)'; ctx.lineWidth=1; ctx.stroke();
  });
  const hotspots=[
    {x:W*0.41,y:H*0.25,r:45,bortle:9,label:'London'},
    {x:W*0.22,y:H*0.32,r:55,bortle:9,label:'New York'},
    {x:W*0.71,y:H*0.32,r:50,bortle:9,label:'Tokyo'},
    {x:W*0.65,y:H*0.28,r:40,bortle:8,label:'Beijing'},
    {x:W*0.18,y:H*0.38,r:35,bortle:8,label:'L.A.'},
    {x:W*0.43,y:H*0.29,r:30,bortle:7,label:'Paris'},
    {x:W*0.38,y:H*0.62,r:30,bortle:5,label:'São Paulo'},
    {x:W*0.12,y:H*0.2,r:18,bortle:2,label:'Cherry Springs'},
    {x:W*0.6,y:H*0.72,r:12,bortle:1,label:'Atacama'},
    {x:W*0.73,y:H*0.65,r:14,bortle:1,label:'Mauna Kea'},
  ];
  hotspots.forEach(h=>{
    const col=bortleColor(h.bortle);
    const grad=ctx.createRadialGradient(h.x,h.y,0,h.x,h.y,h.r);
    grad.addColorStop(0,col.replace(')',',.9)').replace('rgb','rgba'));
    grad.addColorStop(0.5,col.replace(')',',.4)').replace('rgb','rgba'));
    grad.addColorStop(1,'transparent');
    ctx.fillStyle=grad; ctx.beginPath(); ctx.arc(h.x,h.y,h.r,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='rgba(220,200,255,0.8)';
    ctx.font='9px Space Mono,monospace'; ctx.fillText(h.label,h.x-16,h.y+h.r+12);
  });

  // Mark user's saved location on the map if available
  if (state.userLocation) {
    const ux = W * ((state.userLocation.lng + 180) / 360);
    const uy = H * ((90 - state.userLocation.lat) / 180);
    ctx.beginPath(); ctx.arc(ux,uy,7,0,Math.PI*2);
    ctx.fillStyle='rgba(245,158,11,0.9)'; ctx.fill();
    ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke();
    ctx.fillStyle='#fff'; ctx.font='10px Space Mono,monospace';
    ctx.fillText('📍 You',ux+9,uy+4);
  }

  canvas.onclick=(e)=>{
    const rect=canvas.getBoundingClientRect();
    const mx=(e.clientX-rect.left)*(W/rect.width), my=(e.clientY-rect.top)*(H/rect.height);
    let nearest=null, minDist=Infinity;
    hotspots.forEach(h=>{const d=Math.hypot(mx-h.x,my-h.y);if(d<minDist){minDist=d;nearest=h;}});
    if (nearest) showBortleCard(nearest);
  };
}

function bortleColor(b) {
  return ['','rgb(13,13,43)','rgb(26,26,110)','rgb(44,20,130)','rgb(70,30,160)','rgb(100,40,180)','rgb(140,60,200)','rgb(123,63,190)','rgb(192,132,252)','rgb(240,171,252)'][b]||'rgb(80,30,150)';
}

function showBortleCard(site) {
  const descs={1:'Pristine dark sky. Zodiacal light, gegenschein visible.',2:'Truly dark. Airglow faint on horizon.',3:'Rural sky. Some pollution near horizon.',4:'Rural/Suburban. Milky Way still impressive.',5:'Suburban. Milky Way washed near horizon.',6:'Bright suburban. Only hints of Milky Way.',7:'Suburban/Urban. Background is light grey.',8:'City sky. Only 5th magnitude stars visible.',9:'Inner city. Only brightest stars visible.'};
  const labels={1:'Pristine Dark',2:'Truly Dark',3:'Rural',4:'Rural/Suburban',5:'Suburban',6:'Bright Suburban',7:'Suburban/Urban',8:'City',9:'Inner City'};
  document.getElementById('bortleScore').textContent=site.bortle;
  document.getElementById('bortleLabel').textContent=`${site.label} — ${labels[site.bortle]}`;
  document.getElementById('bortleDesc').textContent=descs[site.bortle];
}

function showDarkSite(el) { showBortleCard({bortle:parseInt(el.dataset.bortle),label:el.dataset.name}); showToast(`Showing: ${el.dataset.name}`); }
function searchLocation() {
  const q=document.getElementById('mapSearch').value; if(!q) return;
  showToast(`Searching for "${q}"...`);
  setTimeout(()=>{ showBortleCard({bortle:Math.floor(Math.random()*8)+1,label:q}); showToast(`Results for "${q}" loaded`,'success'); },800);
}

// ===================== EDUCATION ARTICLES =====================
const articles = [
  {id:1,cat:'basics',icon:'🌃',title:'What is Light Pollution?',excerpt:'An introduction to the brightening of the night sky caused by artificial light sources.',content:`<h2>What is Light Pollution?</h2><p>Light pollution refers to the excessive, misdirected, or obtrusive artificial light produced by human activity. It affects billions worldwide and disrupts natural ecosystems.</p><h3>Types of Light Pollution</h3><p>There are four main types: skyglow, light trespass, glare, and clutter.</p><h3>The Bortle Scale</h3><p>The Bortle Dark-Sky Scale is a nine-level numeric scale measuring night sky brightness at any given location.</p>`,date:'Mar 2025',readTime:'5 min'},
  {id:2,cat:'science',icon:'🔵',title:'Blue Light & The Night Sky',excerpt:'Why blue-light wavelengths from LEDs are the most damaging contributors to light pollution.',content:`<h2>Blue Light & The Night Sky</h2><p>Modern LED lighting emits a disproportionate amount of blue-wavelength light (450–490nm). This blue light scatters more easily in the atmosphere, significantly increasing skyglow.</p><h3>Rayleigh Scattering</h3><p>Shorter wavelengths scatter far more — the same mechanism that makes the sky appear blue amplifies LED-based light pollution at night.</p>`,date:'Feb 2025',readTime:'7 min'},
  {id:3,cat:'impact',icon:'🐦',title:'Ecological Impact',excerpt:'How artificial light disrupts wildlife, migration patterns, and biological rhythms.',content:`<h2>Ecological Impact</h2><p>Light pollution affects virtually every ecosystem on Earth. Migratory birds, sea turtles, and insects are among the most affected species.</p><h3>Human Health</h3><p>Exposure to artificial light at night suppresses melatonin production, disrupting circadian rhythms.</p>`,date:'Jan 2025',readTime:'6 min'},
  {id:4,cat:'solutions',icon:'🛡',title:'Reducing Light Pollution',excerpt:'Practical steps individuals, cities, and policymakers can take.',content:`<h2>Reducing Light Pollution</h2><p>Unlike most pollution, light pollution is almost immediately reversible. Turn off the light, and darkness returns.</p><h3>Individual Actions</h3><p>Use directional lighting, install motion sensors, choose warm-spectrum (2700K) bulbs.</p>`,date:'Dec 2024',readTime:'8 min'},
  {id:5,cat:'astronomy',icon:'🌌',title:'Deep Sky Objects',excerpt:'A guide to spectacular objects visible from dark skies: nebulae, galaxies, and clusters.',content:`<h2>Deep Sky Objects</h2><p>The Orion Nebula (M42) is visible to the naked eye from dark sites; from cities it is nearly invisible. The Astronomy Lens significantly improves its contrast.</p>`,date:'Nov 2024',readTime:'10 min'},
  {id:6,cat:'astronomy',icon:'🔭',title:'Observational Astronomy for Beginners',excerpt:'How to get started with stargazing, equipment, and best practices.',content:`<h2>Observational Astronomy for Beginners</h2><p>Astronomy requires nothing more than your eyes, a dark location, and patience. Binoculars (7×50 or 10×50) reveal far more than the naked eye.</p>`,date:'Oct 2024',readTime:'9 min'},
];

function renderArticles(cat) {
  const grid=document.getElementById('articlesGrid');
  if (!grid) return;
  const filtered=cat==='all'?articles:articles.filter(a=>a.cat===cat);
  grid.innerHTML=filtered.map(a=>`
    <div class="article-card" onclick="openArticle(${a.id})">
      <div class="article-thumb"><span style="position:relative;z-index:1;font-size:3rem">${a.icon}</span></div>
      <div class="article-body">
        <div class="article-tag">${a.cat}</div>
        <h4>${a.title}</h4><p>${a.excerpt}</p>
        <div class="article-meta">${a.date} · ${a.readTime} read</div>
      </div>
    </div>`).join('');
}

function filterArticles(cat,btn) {
  document.querySelectorAll('.topic-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active'); renderArticles(cat);
}

function openArticle(id) {
  const art=articles.find(a=>a.id===id); if(!art) return;
  document.getElementById('modalContent').innerHTML=art.content;
  document.getElementById('articleModal').classList.add('open');
  document.body.style.overflow='hidden';
}
function closeArticle() { document.getElementById('articleModal').classList.remove('open'); document.body.style.overflow=''; }

// ===================== RESEARCH FEED (Supabase) =====================

// Fallback sample data shown before DB loads or if user not signed in
const sampleFeed = [
  {id:'s1',title:'Milky Way Visibility — East Sussex Countryside',location:'East Sussex, UK',bortle:3,lens:'Astronomy Lens',created_at:'2 days ago',display_name:'astro_sarah',notes:'Incredible transparency. M31 visible naked eye.',upvotes:42},
  {id:'s2',title:'Downtown Manchester Observation Test',location:'Manchester, UK',bortle:8,lens:'City Lens',created_at:'5 days ago',display_name:'urbangazer_mcr',notes:'City Lens dramatically reduced LED glare from Piccadilly.',upvotes:31},
  {id:'s3',title:'Atacama Desert Baseline Reading',location:'Atacama, Chile',bortle:1,lens:'No Lens',created_at:'1 week ago',display_name:'chile_observer',notes:'Pristine sky, no lens needed. Milky Way casts a shadow.',upvotes:89},
];

/**
 * Loads research observations from Supabase.
 * Falls back to sampleFeed if DB is unreachable or no rows exist.
 */
async function loadResearchFeed(filter) {
  let query = db
    .from('observations')
    .select(`
      id, title, location, bortle_scale, lens_used,
      notes, upvotes, created_at,
      profiles ( display_name )
    `)
    .limit(20);

  if (filter==='popular') query=query.order('upvotes',{ascending:false});
  else if (filter==='dark') query=query.order('bortle_scale',{ascending:true});
  else query=query.order('created_at',{ascending:false});

  const {data,error}=await query;

  if (error || !data || data.length===0) {
    renderFeedFromData(sampleFeed, filter);
    return;
  }

  // Normalise DB rows to match render format
  const rows = data.map(r=>({
    id:          r.id,
    title:       r.title,
    location:    r.location,
    bortle:      r.bortle_scale,
    lens:        r.lens_used,
    notes:       r.notes,
    upvotes:     r.upvotes||0,
    created_at:  new Date(r.created_at).toLocaleDateString(),
    display_name:r.profiles?.display_name||'Anonymous',
  }));

  state.researchFeed=rows;
  renderFeedFromData(rows, filter);
}

function renderFeedFromData(data, filter) {
  const list=document.getElementById('feedList');
  if (!list) return;
  let rows=[...data];
  if (filter==='popular') rows.sort((a,b)=>b.upvotes-a.upvotes);
  else if (filter==='dark') rows.sort((a,b)=>a.bortle-b.bortle);
  list.innerHTML=rows.map(f=>`
    <div class="feed-entry">
      <div class="feed-entry-header">
        <h4>${f.title}</h4>
        <span class="feed-bortle">Bortle ${f.bortle}</span>
      </div>
      <p>${f.notes}</p>
      <div class="feed-meta">
        <span>📍 ${f.location}</span>
        <span>🔬 ${f.lens}</span>
        <span>👤 @${f.display_name}</span>
        <span>🕐 ${f.created_at}</span>
        <span>▲ ${f.upvotes}</span>
      </div>
    </div>`).join('');
}

function filterFeed(filter,btn) {
  document.querySelectorAll('.feed-filter').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  loadResearchFeed(filter);
}

// ===================== RESEARCH FORM (Supabase) =====================
function previewImage(input) {
  if (input.files?.[0]) {
    const reader=new FileReader();
    reader.onload=e=>{ const img=document.getElementById('imagePreview'); img.src=e.target.result; img.style.display='block'; };
    reader.readAsDataURL(input.files[0]);
  }
}

/**
 * Submits a new observation to the `observations` table in Supabase.
 * Requires the user to be signed in (Row Level Security enforces this).
 */
async function submitResearch() {
  const title    = document.getElementById('resTitle').value.trim();
  const location = document.getElementById('resLocation').value.trim();
  const notes    = document.getElementById('resNotes').value.trim();

  if (!title||!location) { showToast('Please fill in title and location','error'); return; }
  if (!state.user) { showToast('Please sign in to submit research','error'); openAuth(); return; }

  const payload = {
    user_id:      state.user.id,
    title,
    location,
    bortle_scale: parseInt(document.getElementById('resBortle').value)||5,
    lens_used:    document.getElementById('resLens').value,
    notes:        notes||'Observation submitted via Staarlina.',
    upvotes:      0,
    created_at:   new Date().toISOString(),
  };

  const {error}=await db.from('observations').insert(payload);

  if (error) {
    showToast(`Submit failed: ${error.message}`,'error');
    console.error('Research submit error:', error);
    return;
  }

  showToast('Observation submitted! Thank you for contributing. 🌌','success');
  document.getElementById('resTitle').value='';
  document.getElementById('resLocation').value='';
  document.getElementById('resNotes').value='';
  document.getElementById('imagePreview').style.display='none';
  await loadResearchFeed('recent');
}

// ===================== AUTH (Supabase) =====================
function openAuth() {
  document.getElementById('authModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeAuth() {
  document.getElementById('authModal').classList.remove('open');
  document.body.style.overflow = '';
  // Clear any password fields when modal closes for security
  const pwd = document.getElementById('authPassword');
  const rpwd = document.getElementById('regPassword');
  if (pwd)  pwd.value  = '';
  if (rpwd) rpwd.value = '';
}

// The listener reads state.user at click-time, not at parse-time.
// bootstrapSession() above ensures state.user is correctly set
// before the user can ever click this button, so it always
// behaves correctly after a page refresh.
document.getElementById('loginBtn').addEventListener('click', () => {
  if (state.user) {
    logoutUser();
  } else {
    openAuth();
  }
});

function switchAuthTab(tab, btn) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('loginForm').style.display    = tab === 'login'    ? 'block' : 'none';
  document.getElementById('registerForm').style.display = tab === 'register' ? 'block' : 'none';
}

// Sign In with email + password
async function manualLogin() {
  const email = document.getElementById('authEmail').value.trim();
  const pass  = document.getElementById('authPassword').value;
  if (!email || !pass) { showToast('Please fill in all fields', 'error'); return; }

  const btn = document.querySelector('#loginForm .btn-primary.full');
  if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }

  const { error } = await db.auth.signInWithPassword({ email, password: pass });

  if (btn) { btn.disabled = false; btn.textContent = 'Sign In'; }
  if (error) { showToast(`Login failed: ${error.message}`, 'error'); }
  // On success onAuthStateChange (SIGNED_IN) handles the rest
}

// Create a new app-exclusive account
async function registerUser() {
  const name  = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const pass  = document.getElementById('regPassword').value;
  const role  = document.getElementById('regRole').value;

  if (!name || !email || !pass) { showToast('Please fill in all fields', 'error'); return; }
  if (pass.length < 6) { showToast('Password must be at least 6 characters', 'error'); return; }

  const btn = document.querySelector('#registerForm .btn-primary.full');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating account…'; }

  const { data, error } = await db.auth.signUp({
    email,
    password: pass,
    options: { data: { full_name: name, role } },
  });

  if (btn) { btn.disabled = false; btn.textContent = 'Create Account'; }

  if (error) { showToast(`Registration failed: ${error.message}`, 'error'); return; }

  if (data.user && !data.session) {
    // Supabase "Confirm email" is ON — user must click the link first
    showToast('Account created! Check your email to confirm, then sign in. 📧', 'success');
    closeAuth();
    return;
  }
  // If email confirmation is OFF, SIGNED_IN fires and bootstraps the session
}

// Sign out
async function logoutUser() {
  await db.auth.signOut();
  // SIGNED_OUT event in onAuthStateChange resets state and nav
}

// ===================== PASSWORD RESET =====================
// Called by the "Forgot password?" link in the login form
async function sendPasswordReset(e) {
  if (e) e.preventDefault();
  const email = document.getElementById('authEmail').value.trim();
  if (!email) { showToast('Enter your email address above first', 'error'); return; }

  const { error } = await db.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname,
  });
  if (error) {
    showToast(`Reset failed: ${error.message}`, 'error');
  } else {
    showToast('Password reset email sent — check your inbox 📧', 'success');
  }
}

// ===================== LANGUAGE =====================
const translations = {
  en:{nav_home:'Home',nav_skylab:'Sky Lab',nav_lenses:'AI Lenses',nav_map:'Pollution Map',nav_learn:'Learn',nav_research:'Research',nav_goggles:'Luminova'},
  es:{nav_home:'Inicio',nav_skylab:'Lab del Cielo',nav_lenses:'Lentes IA',nav_map:'Mapa de Contaminación',nav_learn:'Aprender',nav_research:'Investigación',nav_goggles:'Gafas Galácticas'},
  fr:{nav_home:'Accueil',nav_skylab:'Labo Ciel',nav_lenses:'Lentilles IA',nav_map:'Carte de Pollution',nav_learn:'Apprendre',nav_research:'Recherche',nav_goggles:'Lunettes Galactiques'},
  de:{nav_home:'Startseite',nav_skylab:'Himmelslabor',nav_lenses:'KI-Linsen',nav_map:'Verschmutzungskarte',nav_learn:'Lernen',nav_research:'Forschung',nav_goggles:'Galaktische Brillen'},
  zh:{nav_home:'首页',nav_skylab:'天空实验室',nav_lenses:'AI镜头',nav_map:'污染地图',nav_learn:'学习',nav_research:'研究',nav_goggles:'银河眼镜'},
  ar:{nav_home:'الرئيسية',nav_skylab:'مختبر السماء',nav_lenses:'عدسات الذكاء',nav_map:'خريطة التلوث',nav_learn:'تعلم',nav_research:'بحث',nav_goggles:'نظارات المجرة'},
  ja:{nav_home:'ホーム',nav_skylab:'スカイラボ',nav_lenses:'AIレンズ',nav_map:'汚染マップ',nav_learn:'学ぶ',nav_research:'研究',nav_goggles:'銀河ゴーグル'},
};

document.getElementById('langSelect').addEventListener('change',function(){
  const t=translations[this.value]||translations.en;
  const keys=['nav_home','nav_skylab','nav_lenses','nav_map','nav_learn','nav_research','nav_goggles'];
  document.querySelectorAll('.nav-link').forEach((link,i)=>{link.textContent=t[keys[i]];});
  showToast('Language changed');
});

// ===================== GOGGLES PAGE =====================
function scrollToSpecs() { document.getElementById('specs').scrollIntoView({behavior:'smooth'}); }

setInterval(()=>{
  const ll=document.getElementById('goggleLensL'), lr=document.getElementById('goggleLensR');
  if(!ll||!lr) return;
  const lenses=['radial-gradient(ellipse at 30% 30%, rgba(124,58,237,0.4), rgba(4,2,15,0.7))','radial-gradient(ellipse at 30% 30%, rgba(236,72,153,0.4), rgba(4,2,15,0.7))','radial-gradient(ellipse at 30% 30%, rgba(234,179,8,0.3), rgba(4,2,15,0.7))'];
  const choice=lenses[Math.floor(Math.random()*lenses.length)];
  ll.style.background=lr.style.background=choice;
},2500);

// ===================== TOAST =====================
let toastTimer;
function showToast(msg, type='') {
  const toast=document.getElementById('toast');
  toast.textContent=msg; toast.className=`toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>toast.classList.remove('show'),3000);
}

// ===================== FILE DROP =====================
const dropZone=document.getElementById('fileDropZone');
if (dropZone) {
  dropZone.addEventListener('dragover',e=>{e.preventDefault();dropZone.style.borderColor='var(--purple-lt)';});
  dropZone.addEventListener('dragleave',()=>{dropZone.style.borderColor='';});
  dropZone.addEventListener('drop',e=>{
    e.preventDefault(); dropZone.style.borderColor='';
    const file=e.dataTransfer.files[0];
    if(file?.type.startsWith('image/')) previewImage({files:[file]});
  });
}

// ===================== INIT =====================
window.addEventListener('DOMContentLoaded',()=>{
  navigateTo('home');
  const dt=document.getElementById('resDatetime');
  if (dt) dt.value=new Date().toISOString().slice(0,16);
  setTimeout(initSkyCanvas,100);
});

window.addEventListener('resize',()=>{
  if (state.currentPage==='sky-lab') setTimeout(initSkyCanvas,200);
  if (state.currentPage==='map')     setTimeout(initMapCanvas,200);
});
