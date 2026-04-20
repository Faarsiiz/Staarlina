/* ============================================================
   STAARLINA — app.js
   Galaxy-themed light pollution platform
   ============================================================ */

'use strict';

// ===================== STATE =====================
const state = {
  currentPage: 'home',
  currentLens: 'none',
  lensActive: false,
  cameraActive: false,
  cameraStream: null,
  user: null,
  snapshots: [],
  customSettings: { blue: 60, contrast: 40, warm: 50 },
  compareMode: false,
  mapInitialised: false,
  userLocation: null,
  researchFeed: [],
};

// ===================== STAR API =====================
// ⚠️  SECURITY NOTE — read before deploying to GitHub:
//
//  API keys placed directly in JavaScript are readable by anyone
//  who opens DevTools or views your source. For a static site like
//  this one the safest approach is:
//
//    1. Create a Supabase Edge Function (serverless proxy) that holds
//       the real key server-side and forwards requests.  Your JS then
//       calls YOUR Supabase function URL, never the third-party API
//       directly, so the key never reaches the browser.
//       → See the step-by-step guide in STAR_API_SETUP.md
//
//    2. OR add the key to a .env file and a build tool (Vite / Parcel)
//       so it is injected at build time and excluded from git via
//       .gitignore.
//
//  For local development and testing the key below is fine.
//  For production, replace the direct fetch calls with your proxy URL.

const STAR_API_KEY      = '2bGdqzaqYjV0OEx7GWgol7G1fhspDZzPfKAqUKHp'; // ← paste your key here ONLY for local testing
const STAR_API_BASE_URL = 'https://lngtgjsxpsmqbaxudmmw.supabase.co/functions/v1/smart-api'; // adjust to match your Star API's actual base URL

/**
 * Generic Star API fetcher.
 * Centralising the fetch here means you only change one place
 * if the base URL or auth method changes.
 *
 * @param {string} endpoint  - e.g. '/bodies/star' or '/search?q=Sirius'
 * @returns {Promise<object>} - parsed JSON response
 */
async function starAPIFetch(endpoint) {
  try {
    const res = await fetch(`${STAR_API_BASE_URL}${endpoint}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${STAR_API_KEY}`,
        'Content-Type':  'application/json',
      },
    });

    if (!res.ok) {
      throw new Error(`Star API error ${res.status}: ${res.statusText}`);
    }
    return await res.json();
  } catch (err) {
    console.error('Star API fetch failed:', err);
    showToast('Could not load star data — check your API connection.', 'error');
    return null;
  }
}

/**
 * Fetch data for a specific star by name.
 * Called when a user searches in the Sky Lab star panel.
 *
 * @param {string} starName - e.g. 'Sirius', 'Betelgeuse'
 */
async function fetchStarData(starName) {
  showToast(`Loading data for ${starName}…`);
  const data = await starAPIFetch(`/bodies/star?name=${encodeURIComponent(starName)}`);
  if (data) renderStarPanel(data);
}

/**
 * Fetch a list of visible stars for the user's current location.
 * Called when the user grants location access and loads Sky Lab.
 *
 * @param {number} lat
 * @param {number} lng
 */
async function fetchVisibleStars(lat, lng) {
  const now   = new Date().toISOString();
  const data  = await starAPIFetch(
    `/bodies/positions?latitude=${lat}&longitude=${lng}&from_date=${now}&to_date=${now}&elevation=0`
  );
  if (data) renderStarList(data);
}

/**
 * Render the fetched star statistics into the Star Data panel
 * inside Sky Lab. Creates the panel if it doesn't exist yet.
 *
 * @param {object} data - raw API response
 */
function renderStarPanel(data) {
  const panel = document.getElementById('starDataPanel');
  if (!panel) return;

  // Adapt these property names to match your Star API's actual response shape.
  // The names below follow the AstronomyAPI.com schema as a reference.
  const body = data?.data?.bodies?.[0] || data?.body || data || {};
  const name        = body.name        || body.id         || 'Unknown Star';
  const distance    = body.distance    || {};
  const distVal     = distance.fromEarth?.au  ?? distance.au ?? '—';
  const magnitude   = body.magnitude   ?? body.apparentMagnitude ?? '—';
  const constellation = body.constellation?.name ?? body.constellation ?? '—';
  const type        = body.type        || body.bodyType   || '—';
  const ra          = body.position?.equatorial?.rightAscension?.string
                   || body.ra         || '—';
  const dec         = body.position?.equatorial?.declination?.string
                   || body.dec        || '—';
  const altitude    = body.position?.horizontal?.altitude?.string
                   || body.altitude   || '—';
  const azimuth     = body.position?.horizontal?.azimuth?.string
                   || body.azimuth    || '—';

  panel.innerHTML = `
    <div class="star-data-header">
      <span class="star-data-icon">✦</span>
      <h4 class="star-data-name">${name}</h4>
      <span class="star-data-type">${type}</span>
    </div>
    <div class="star-data-grid">
      <div class="sds"><span class="sds-label">Distance</span><span class="sds-val">${distVal} AU</span></div>
      <div class="sds"><span class="sds-label">Magnitude</span><span class="sds-val">${magnitude}</span></div>
      <div class="sds"><span class="sds-label">Constellation</span><span class="sds-val">${constellation}</span></div>
      <div class="sds"><span class="sds-label">Right Ascension</span><span class="sds-val">${ra}</span></div>
      <div class="sds"><span class="sds-label">Declination</span><span class="sds-val">${dec}</span></div>
      <div class="sds"><span class="sds-label">Altitude</span><span class="sds-val">${altitude}</span></div>
      <div class="sds"><span class="sds-label">Azimuth</span><span class="sds-val">${azimuth}</span></div>
    </div>
  `;
  panel.classList.add('has-data');
}

/**
 * Render a short list of visible stars returned by the positions endpoint.
 *
 * @param {object} data - raw API response
 */
function renderStarList(data) {
  const panel = document.getElementById('starDataPanel');
  if (!panel) return;

  const bodies = data?.data?.rows ?? data?.bodies ?? [];
  if (!bodies.length) {
    panel.innerHTML = '<p class="star-data-empty">No visible stars found for this location right now.</p>';
    return;
  }

  const rows = bodies
    .filter(b => b.name || b.id)
    .slice(0, 8) // show up to 8 results
    .map(b => {
      const alt = b.position?.horizontal?.altitude?.string ?? b.altitude ?? '—';
      return `
        <div class="star-list-row" onclick="fetchStarData('${b.name || b.id}')">
          <span class="slr-name">✦ ${b.name || b.id}</span>
          <span class="slr-alt">Alt: ${alt}</span>
        </div>`;
    }).join('');

  panel.innerHTML = `
    <div class="star-data-header">
      <h4 class="star-data-name">Visible Stars Near You</h4>
    </div>
    <div class="star-list">${rows}</div>
    <p class="star-data-hint">Click a star to see its statistics.</p>
  `;
  panel.classList.add('has-data');
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
  if (pageId === 'sky-lab') initSkyCanvas();
  if (pageId === 'education') renderArticles('all');
  if (pageId === 'research') renderFeed('recent');
  if (pageId === 'map') initMapCanvas();
  updateHudTime();
}

// Nav link click handlers
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    const page = link.getAttribute('data-page');
    navigateTo(page);
    document.getElementById('navLinks').classList.remove('open');
  });
});

// Hamburger
document.getElementById('hamburger').addEventListener('click', () => {
  document.getElementById('navLinks').classList.toggle('open');
});

// ===================== STARFIELD BACKGROUND =====================
(function initStarfield() {
  const canvas = document.getElementById('starfield');
  const ctx = canvas.getContext('2d');
  let stars = [];
  let shootingStars = [];
  let W, H;

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
        x: Math.random() * W,
        y: Math.random() * H,
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
        x: Math.random() * W * 0.6,
        y: Math.random() * H * 0.4,
        len: Math.random() * 120 + 80,
        speed: Math.random() * 8 + 6,
        alpha: 1,
        angle: Math.PI / 4 + (Math.random() - 0.5) * 0.3,
      });
    }
  }

  function drawFrame() {
    ctx.clearRect(0, 0, W, H);
    stars.forEach(s => {
      s.alpha += s.twinkleSpeed * s.twinkleDir;
      if (s.alpha >= 1 || s.alpha <= 0.15) s.twinkleDir *= -1;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = s.hue;
      ctx.globalAlpha = s.alpha;
      ctx.fill();
    });
    spawnShootingStar();
    shootingStars = shootingStars.filter(ss => ss.alpha > 0);
    shootingStars.forEach(ss => {
      ctx.save();
      const grad = ctx.createLinearGradient(ss.x, ss.y, ss.x - Math.cos(ss.angle)*ss.len, ss.y - Math.sin(ss.angle)*ss.len);
      grad.addColorStop(0, `rgba(255,255,255,${ss.alpha})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.globalAlpha = ss.alpha;
      ctx.beginPath();
      ctx.moveTo(ss.x, ss.y);
      ctx.lineTo(ss.x + Math.cos(ss.angle)*ss.len, ss.y + Math.sin(ss.angle)*ss.len);
      ctx.stroke();
      ctx.restore();
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
  const w = skyCanvas.width;
  const h = skyCanvas.height;
  const count = 320;
  for (let i = 0; i < count; i++) {
    skyStars.push({
      x: Math.random() * w, y: Math.random() * h,
      r: Math.random() * 2.5 + 0.5,
      brightness: Math.random() * 0.8 + 0.2,
      twinkle: Math.random() * 0.03 + 0.005,
      dir: Math.random() > 0.5 ? 1 : -1,
      type: Math.random() > 0.95 ? 'bright' : 'normal',
    });
  }
  // Add a few named celestial objects
  const celestials = [
    { x: w*0.2, y: h*0.25, label: 'Polaris',  r: 3.5, color: '#fffae0' },
    { x: w*0.6, y: h*0.3,  label: 'Sirius',   r: 4,   color: '#e0eeff' },
    { x: w*0.4, y: h*0.6,  label: 'Orion Neb',r: 5,   color: 'rgba(180,80,255,0.5)', isNebula: true },
    { x: w*0.8, y: h*0.55, label: 'Jupiter',  r: 4.5, color: '#ffe8b0' },
    { x: w*0.15,y: h*0.65, label: 'Mars',     r: 3.5, color: '#ff8060' },
  ];
  celestials.forEach(c => skyStars.push({ ...c, bright: true, brightness: 1, twinkle: 0.005, dir: 1 }));
}

function drawSkyFrame() {
  if (!skyCtx) return;
  const w = skyCanvas.width, h = skyCanvas.height;
  const lens = state.lensActive ? state.currentLens : 'none';

  // Sky gradient based on lens
  const bgGrad = skyCtx.createLinearGradient(0, 0, 0, h);
  if (lens === 'city') {
    bgGrad.addColorStop(0, '#120608'); bgGrad.addColorStop(1, '#1a0a0a');
  } else if (lens === 'brightness') {
    bgGrad.addColorStop(0, '#040210'); bgGrad.addColorStop(1, '#050315');
  } else if (lens === 'astronomy') {
    bgGrad.addColorStop(0, '#000005'); bgGrad.addColorStop(1, '#020010');
  } else {
    bgGrad.addColorStop(0, '#01000a'); bgGrad.addColorStop(1, '#080420');
  }
  skyCtx.fillStyle = bgGrad;
  skyCtx.fillRect(0, 0, w, h);

  // Milky Way band
  const milkyGrad = skyCtx.createLinearGradient(w*0.1, 0, w*0.9, h);
  milkyGrad.addColorStop(0, 'transparent');
  milkyGrad.addColorStop(0.3, lens === 'astronomy' ? 'rgba(140,100,255,0.12)' : 'rgba(100,60,180,0.05)');
  milkyGrad.addColorStop(0.7, lens === 'astronomy' ? 'rgba(180,120,255,0.1)' : 'rgba(80,40,140,0.04)');
  milkyGrad.addColorStop(1, 'transparent');
  skyCtx.fillStyle = milkyGrad;
  skyCtx.fillRect(0, 0, w, h);

  // Simulate glow/pollution in non-filtered view
  if (!state.lensActive) {
    const pollGrad = skyCtx.createRadialGradient(w/2, h, 0, w/2, h, h*0.8);
    pollGrad.addColorStop(0, 'rgba(100,140,255,0.18)');
    pollGrad.addColorStop(1, 'transparent');
    skyCtx.fillStyle = pollGrad;
    skyCtx.fillRect(0, 0, w, h);
  }

  // Stars
  skyStars.forEach(s => {
    if (s.bright) {
      // Celestial objects
      if (s.isNebula) {
        const ng = skyCtx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 6);
        const vis = state.lensActive && lens === 'astronomy' ? 0.8 : 0.3;
        ng.addColorStop(0, s.color.replace('0.5', `${vis}`));
        ng.addColorStop(1, 'transparent');
        skyCtx.fillStyle = ng;
        skyCtx.beginPath();
        skyCtx.arc(s.x, s.y, s.r * 6, 0, Math.PI * 2);
        skyCtx.fill();
      }
      // Halo
      const halo = skyCtx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 3);
      halo.addColorStop(0, s.color || '#fff');
      halo.addColorStop(1, 'transparent');
      skyCtx.fillStyle = halo;
      skyCtx.beginPath();
      skyCtx.arc(s.x, s.y, s.r * 3, 0, Math.PI * 2);
      skyCtx.fill();
      // Core
      skyCtx.beginPath();
      skyCtx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      skyCtx.fillStyle = s.color || '#fff';
      skyCtx.fill();
      // Label
      const labelVis = state.lensActive ? 1 : 0.4;
      skyCtx.fillStyle = `rgba(180,160,255,${labelVis})`;
      skyCtx.font = '10px Space Mono, monospace';
      skyCtx.fillText(s.label, s.x + s.r + 5, s.y + 4);
      return;
    }
    // Twinkle
    s.brightness += s.twinkle * s.dir;
    if (s.brightness >= 1 || s.brightness <= 0.1) s.dir *= -1;

    // Lens adjustments
    let alpha = s.brightness;
    let starR = s.r;
    if (lens === 'astronomy' && state.lensActive) { alpha = Math.min(1, alpha * 1.5); starR *= 1.2; }
    if (lens === 'city'      && state.lensActive) { alpha *= 1.1; }
    if (lens === 'antiglare' && state.lensActive) { alpha = Math.min(1, alpha * 1.3); }
    if (lens === 'brightness'&& state.lensActive) { alpha *= 0.95; }
    if (!state.lensActive) { alpha *= 0.5; starR *= 0.85; } // pollution effect

    skyCtx.beginPath();
    skyCtx.arc(s.x, s.y, starR, 0, Math.PI * 2);
    skyCtx.fillStyle = '#fff';
    skyCtx.globalAlpha = alpha;
    skyCtx.fill();
    skyCtx.globalAlpha = 1;
  });

  // Lens-specific colour overlays
  applyLensOverlayToCanvas(skyCtx, w, h, lens);
  skyAnimId = requestAnimationFrame(drawSkyFrame);
}

function applyLensOverlayToCanvas(ctx, w, h, lens) {
  if (!state.lensActive) return;
  ctx.save();
  if (lens === 'city') {
    ctx.fillStyle = 'rgba(180, 100, 10, 0.08)';
    ctx.fillRect(0, 0, w, h);
  } else if (lens === 'astronomy') {
    ctx.fillStyle = 'rgba(20, 0, 60, 0.1)';
    ctx.fillRect(0, 0, w, h);
  } else if (lens === 'antiglare') {
    ctx.fillStyle = 'rgba(0, 20, 40, 0.07)';
    ctx.fillRect(0, 0, w, h);
  } else if (lens === 'brightness') {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(0, 0, w, h);
  } else if (lens === 'custom') {
    const { blue, warm } = state.customSettings;
    ctx.fillStyle = `rgba(${warm*1.5}, ${60}, ${255 - blue*2}, ${blue * 0.001})`;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

// ===================== LENS CONTROL =====================
function selectLens(lensId, el) {
  state.currentLens = lensId;
  document.querySelectorAll('.lens-card').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');
  else { const card = document.querySelector(`[data-lens="${lensId}"]`); if (card) card.classList.add('active'); }

  document.getElementById('hudLens').textContent = `🔬 Lens: ${lensId === 'none' ? 'None' : getLensName(lensId)}`;
  document.getElementById('customBuilder').style.display = (lensId === 'custom') ? 'flex' : 'none';
  if (document.getElementById('customBuilder').style.display === 'flex') {
    document.getElementById('customBuilder').style.flexDirection = 'column';
  }

  // Apply CSS filter to lens overlay
  applyLensOverlay(lensId);
  if (state.cameraActive) applyFilterToCamera();
}

function getLensName(id) {
  const names = { city:'City', astronomy:'Astronomy', antiglare:'Anti-Glare', brightness:'Brightness', custom:'Custom' };
  return names[id] || id;
}

function toggleLens(el) {
  state.lensActive = el.checked;
  document.getElementById('intensityGroup').style.display = el.checked ? 'flex' : 'none';
  if (document.getElementById('intensityGroup').style.display === 'flex') {
    document.getElementById('intensityGroup').style.flexDirection = 'column';
  }
  applyLensOverlay(state.currentLens);
  if (state.cameraActive) applyFilterToCamera();
  showToast(state.lensActive ? `${getLensName(state.currentLens)} Lens activated` : 'Lens deactivated');
}

function applyLensOverlay(lensId) {
  const overlay = document.getElementById('lensOverlay');
  if (!overlay) return;
  overlay.style.background = 'none';
  overlay.style.mixBlendMode = 'normal';
  if (!state.lensActive || lensId === 'none') return;

  const configs = {
    city:       { bg: 'rgba(200,130,30,0.12)',   blend: 'multiply' },
    astronomy:  { bg: 'rgba(40, 10,120,0.15)',   blend: 'multiply' },
    antiglare:  { bg: 'rgba(0,  30, 60,0.1)',    blend: 'multiply' },
    brightness: { bg: 'rgba(0,   0,  0,0.22)',   blend: 'normal'   },
    custom: {
      bg: `rgba(${state.customSettings.warm*1.5},60,${255 - state.customSettings.blue*2},${state.customSettings.blue*0.001})`,
      blend: 'multiply'
    },
  };
  const cfg = configs[lensId];
  if (cfg) { overlay.style.background = cfg.bg; overlay.style.mixBlendMode = cfg.blend; }
}

function updateIntensity(el) {
  document.getElementById('intensityVal').textContent = el.value;
  applyLensOverlay(state.currentLens);
}

function updateCustom(type, el) {
  state.customSettings[type] = parseInt(el.value);
  document.getElementById(`${type}Val`).textContent = el.value;
  applyLensOverlay('custom');
}

// ===================== CAMERA =====================
function toggleSimMode() {
  if (state.cameraActive) {
    stopCamera();
    document.getElementById('simModeBtn').classList.add('active');
    document.getElementById('cameraBtn').classList.remove('active');
    document.getElementById('skyCanvas').style.display = 'block';
    document.getElementById('cameraFeed').style.display = 'none';
    showToast('Switched to simulation mode');
  }
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('Camera not supported in this browser', 'error'); return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    state.cameraStream = stream;
    state.cameraActive = true;
    const video = document.getElementById('cameraFeed');
    video.srcObject = stream;
    video.style.display = 'block';
    document.getElementById('skyCanvas').style.display = 'none';
    document.getElementById('cameraBtn').classList.add('active');
    document.getElementById('simModeBtn').classList.remove('active');
    document.getElementById('hudLocation').textContent = '📍 Camera: Live';
    showToast('Camera activated — AI filter applied');
    applyFilterToCamera();
  } catch (err) {
    showToast(`Camera error: ${err.message}`, 'error');
  }
}

function stopCamera() {
  if (state.cameraStream) { state.cameraStream.getTracks().forEach(t => t.stop()); state.cameraStream = null; }
  state.cameraActive = false;
  document.getElementById('cameraFeed').style.display = 'none';
}

function applyFilterToCamera() {
  const video = document.getElementById('cameraFeed');
  if (!video) return;
  const filters = {
    none:       'none',
    city:       'sepia(0.4) hue-rotate(20deg) saturate(0.7)',
    astronomy:  'contrast(1.6) brightness(1.15) saturate(0.8)',
    antiglare:  'brightness(0.85) contrast(1.1)',
    brightness: 'brightness(0.65) contrast(1.05)',
    custom: () => {
      const { blue, contrast, warm } = state.customSettings;
      return `sepia(${warm/150}) contrast(${1 + contrast/200}) saturate(${1 - blue/250}) brightness(0.9)`;
    }
  };
  const f = filters[state.lensActive ? state.currentLens : 'none'];
  video.style.filter = typeof f === 'function' ? f() : (state.lensActive ? f : 'none');
}

// ===================== SNAPSHOT =====================
function captureSnapshot() {
  const ts = new Date().toLocaleTimeString();
  const lensName = state.lensActive ? getLensName(state.currentLens) : 'Raw';
  let dataURL;

  if (state.cameraActive) {
    const video = document.getElementById('cameraFeed');
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = video.videoWidth || 640;
    tmpCanvas.height = video.videoHeight || 360;
    const tmpCtx = tmpCanvas.getContext('2d');
    tmpCtx.filter = video.style.filter || 'none';
    tmpCtx.drawImage(video, 0, 0);
    dataURL = tmpCanvas.toDataURL('image/jpeg', 0.9);
  } else {
    dataURL = skyCanvas.toDataURL('image/jpeg', 0.9);
  }

  state.snapshots.push({ dataURL, lens: lensName, time: ts });
  renderGallery();
  showToast(`Snapshot saved — ${lensName} lens`, 'success');
}

function renderGallery() {
  const grid = document.getElementById('galleryGrid');
  if (!grid) return;
  if (state.snapshots.length === 0) {
    grid.innerHTML = '<div class="gallery-empty">Take a snapshot to see it here.</div>';
    return;
  }
  grid.innerHTML = state.snapshots.map((s, i) => `
    <div class="gallery-item" onclick="viewSnapshot(${i})">
      <img src="${s.dataURL}" alt="Snapshot ${i+1}" />
      <div class="gallery-item-label">${s.lens} · ${s.time}</div>
    </div>
  `).join('');
}

function viewSnapshot(idx) {
  const snap = state.snapshots[idx];
  document.getElementById('modalContent').innerHTML = `
    <h2>Snapshot — ${snap.lens}</h2>
    <p style="font-family:var(--font-mono);font-size:0.75rem;color:var(--muted)">${snap.time}</p>
    <img src="${snap.dataURL}" style="width:100%;border-radius:10px;margin-top:16px;" />
    <button onclick="downloadSnapshot(${idx})" style="margin-top:16px;" class="btn-primary small">⬇ Download</button>
  `;
  document.getElementById('articleModal').classList.add('open');
}

function downloadSnapshot(idx) {
  const a = document.createElement('a');
  a.href = state.snapshots[idx].dataURL;
  a.download = `staarlina_snapshot_${idx+1}.jpg`;
  a.click();
}

// ===================== COMPARE MODE =====================
function toggleLensCompare() {
  state.compareMode = !state.compareMode;
  document.getElementById('comparePanel').style.display = state.compareMode ? 'flex' : 'none';
  if (state.compareMode) document.getElementById('comparePanel').style.flexDirection = 'column';
}

function runComparison() {
  const a = document.getElementById('compareA').value;
  const b = document.getElementById('compareB').value;
  const aName = getLensName(a) || 'No Lens';
  const bName = getLensName(b) || 'No Lens';
  showToast(`Comparing ${aName} vs ${bName}`);

  // Visual split on canvas — left half lens A, right half lens B
  if (skyCtx) {
    const w = skyCanvas.width, h = skyCanvas.height;
    // Draw comparison overlay
    skyCtx.save();
    skyCtx.fillStyle = 'rgba(255,255,255,0.08)';
    skyCtx.fillRect(w/2, 0, 1, h);
    skyCtx.fillStyle = 'rgba(200,160,255,0.8)';
    skyCtx.font = '11px Space Mono, monospace';
    skyCtx.fillText(aName, 12, h - 12);
    skyCtx.fillText(bName, w/2 + 8, h - 12);
    skyCtx.restore();
  }
}

// ===================== LOCATION =====================
function requestLocation() {
  if (!navigator.geolocation) { showToast('Geolocation not supported', 'error'); return; }
  navigator.geolocation.getCurrentPosition(
    pos => {
      state.userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const lat = pos.coords.latitude.toFixed(3);
      const lng = pos.coords.longitude.toFixed(3);
      document.getElementById('hudLocation').textContent = `📍 ${lat}, ${lng}`;
      showToast(`Location acquired: ${lat}, ${lng}`, 'success');

      // Fetch visible stars for this location from the Star API
      fetchVisibleStars(pos.coords.latitude, pos.coords.longitude);
    },
    err => showToast('Location access denied', 'error')
  );
}

function autofillLocation() {
  if (!navigator.geolocation) { showToast('Geolocation not supported', 'error'); return; }
  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = pos.coords.latitude.toFixed(4);
      const lng = pos.coords.longitude.toFixed(4);
      document.getElementById('resLocation').value = `${lat}, ${lng}`;
      showToast('Location filled', 'success');
    },
    () => showToast('Could not get location', 'error')
  );
}

// ===================== HUD CLOCK =====================
function updateHudTime() {
  const el = document.getElementById('hudTime');
  if (!el) return;
  const now = new Date();
  el.textContent = `🕐 ${now.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}`;
}
setInterval(updateHudTime, 30000);
updateHudTime();

// ===================== MAP =====================
function initMap() {
  document.getElementById('mapPlaceholder').classList.add('hidden');
  state.mapInitialised = true;
  requestLocation();
  initMapCanvas();
}

function initMapCanvas() {
  const canvas = document.getElementById('mapCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width  = canvas.offsetWidth  || 800;
  const H = canvas.height = canvas.offsetHeight || 500;

  // Background — ocean-like dark
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#040214'); bg.addColorStop(1, '#0a0430');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  // Grid lines
  ctx.strokeStyle = 'rgba(80,40,140,0.2)'; ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 60) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for (let y = 0; y < H; y += 60) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

  // Simulated continents (rough shapes)
  const continents = [
    { x: W*0.15, y: H*0.25, rX: 80, rY: 60, color: 'rgba(40,20,80,0.9)' },
    { x: W*0.38, y: H*0.3,  rX: 130, rY: 80, color: 'rgba(40,20,80,0.9)' },
    { x: W*0.62, y: H*0.35, rX: 110, rY: 90, color: 'rgba(40,20,80,0.9)' },
    { x: W*0.75, y: H*0.5,  rX: 70,  rY: 55, color: 'rgba(40,20,80,0.9)' },
    { x: W*0.5,  y: H*0.65, rX: 50,  rY: 40, color: 'rgba(40,20,80,0.9)' },
    { x: W*0.22, y: H*0.6,  rX: 90,  rY: 60, color: 'rgba(40,20,80,0.9)' },
  ];
  continents.forEach(c => {
    ctx.beginPath(); ctx.ellipse(c.x, c.y, c.rX, c.rY, 0, 0, Math.PI*2);
    ctx.fillStyle = c.color; ctx.fill();
    ctx.strokeStyle = 'rgba(100,60,180,0.3)'; ctx.lineWidth = 1; ctx.stroke();
  });

  // Pollution hotspots (radial gradients simulating city glow)
  const hotspots = [
    { x:W*0.41, y:H*0.25, r:45, bortle:9, label:'London' },
    { x:W*0.22, y:H*0.32, r:55, bortle:9, label:'New York' },
    { x:W*0.71, y:H*0.32, r:50, bortle:9, label:'Tokyo' },
    { x:W*0.65, y:H*0.28, r:40, bortle:8, label:'Beijing' },
    { x:W*0.18, y:H*0.38, r:35, bortle:8, label:'L.A.' },
    { x:W*0.43, y:H*0.29, r:30, bortle:7, label:'Paris' },
    { x:W*0.38, y:H*0.62, r:30, bortle:5, label:'São Paulo' },
    { x:W*0.12, y:H*0.2,  r:18, bortle:2, label:'Cherry Springs' },
    { x:W*0.6,  y:H*0.72, r:12, bortle:1, label:'Atacama' },
    { x:W*0.73, y:H*0.65, r:14, bortle:1, label:'Mauna Kea' },
  ];

  hotspots.forEach(h => {
    const col = bortleColor(h.bortle);
    const grad = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, h.r);
    grad.addColorStop(0, col.replace(')', ',0.9)').replace('rgb','rgba'));
    grad.addColorStop(0.5, col.replace(')', ',0.4)').replace('rgb','rgba'));
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = 'rgba(220,200,255,0.8)';
    ctx.font = '9px Space Mono, monospace';
    ctx.fillText(h.label, h.x - 16, h.y + h.r + 12);
  });

  // Click handler
  canvas.onclick = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (W / rect.width);
    const my = (e.clientY - rect.top)  * (H / rect.height);
    let nearest = null, minDist = Infinity;
    hotspots.forEach(h => {
      const d = Math.hypot(mx-h.x, my-h.y);
      if (d < minDist) { minDist = d; nearest = h; }
    });
    if (nearest) showBortleCard(nearest);
  };
}

function bortleColor(b) {
  const colors = ['','rgb(13,13,43)','rgb(26,26,110)','rgb(44,20,130)','rgb(70,30,160)','rgb(100,40,180)','rgb(140,60,200)','rgb(123,63,190)','rgb(192,132,252)','rgb(240,171,252)'];
  return colors[b] || 'rgb(80,30,150)';
}

function showBortleCard(site) {
  const descs = {
    1: 'Pristine dark sky. Zodiacal light, gegenschein, and Milky Way structure visible.',
    2: 'Truly dark sky. Airglow faintly visible on horizon.',
    3: 'Rural sky. Some light pollution near horizon.',
    4: 'Rural/Suburban. Milky Way still impressive, some loss of detail.',
    5: 'Suburban sky. Milky Way washed out near horizon.',
    6: 'Bright suburban. Only hints of Milky Way visible.',
    7: 'Suburban/Urban. Background sky is light grey.',
    8: 'City sky. Sky is orange/grey. Only 5th magnitude stars visible.',
    9: 'Inner city. Sky is brilliant grey or orange. Only brightest stars visible.',
  };
  const labels = {1:'Pristine Dark',2:'Truly Dark',3:'Rural',4:'Rural/Suburban',5:'Suburban',6:'Bright Suburban',7:'Suburban/Urban',8:'City',9:'Inner City'};
  document.getElementById('bortleScore').textContent = site.bortle;
  document.getElementById('bortleLabel').textContent = `${site.label} — ${labels[site.bortle]}`;
  document.getElementById('bortleDesc').textContent  = descs[site.bortle];
}

function showDarkSite(el) {
  const bortle = parseInt(el.dataset.bortle);
  const name   = el.dataset.name;
  showBortleCard({ bortle, label: name });
  showToast(`Showing: ${name}`);
}

function searchLocation() {
  const q = document.getElementById('mapSearch').value;
  if (!q) return;
  showToast(`Searching for "${q}"...`);
  // Simulate a result
  setTimeout(() => {
    const fakeData = { bortle: Math.floor(Math.random()*8)+1, label: q };
    showBortleCard(fakeData);
    showToast(`Results for "${q}" loaded`, 'success');
  }, 800);
}

// ===================== EDUCATION ARTICLES =====================
const articles = [
  { id:1, cat:'basics', icon:'🌃', title:'What is Light Pollution?', excerpt:'An introduction to the brightening of the night sky caused by artificial light sources.', content:`<h2>What is Light Pollution?</h2><p>Light pollution refers to the excessive, misdirected, or obtrusive artificial light produced by human activity. It is a significant environmental issue that affects billions of people worldwide and disrupts natural ecosystems.</p><h3>Types of Light Pollution</h3><p>There are four main types: skyglow (the brightening of the night sky over populated areas), light trespass (light falling where it is not needed), glare (excessive brightness that causes visual discomfort), and clutter (bright, confusing, and excessive groupings of light sources).</p><h3>The Bortle Scale</h3><p>The Bortle Dark-Sky Scale is a nine-level numeric scale that measures the night sky's brightness at any given location. It was developed by John E. Bortle in 2001 to help amateur astronomers evaluate the darkness of an observing site.</p>`, date:'Mar 2025', readTime:'5 min' },
  { id:2, cat:'science', icon:'🔵', title:'Blue Light & The Night Sky', excerpt:'Why blue-light wavelengths from LEDs are the most damaging contributors to light pollution.', content:`<h2>Blue Light & The Night Sky</h2><p>Modern LED lighting, while energy-efficient, emits a disproportionate amount of blue-wavelength light (450–490nm). This blue light scatters more easily in the atmosphere than longer wavelengths, significantly increasing skyglow.</p><h3>The Rayleigh Scattering Effect</h3><p>Rayleigh scattering causes shorter wavelengths (blue light) to scatter far more than longer ones. This is why the sky appears blue during the day — and it's the same mechanism that amplifies the effect of LED-based lighting on night sky brightness.</p><h3>How Staarlina Helps</h3><p>The City Lens specifically targets these 450–490nm wavelengths, attenuating blue-spectrum light while preserving visibility of warmer stellar colours. This dramatically reduces the perceived skyglow when observed through the lens.</p>`, date:'Feb 2025', readTime:'7 min' },
  { id:3, cat:'impact', icon:'🐦', title:'Ecological Impact', excerpt:'How artificial light disrupts wildlife, migration patterns, and biological rhythms.', content:`<h2>Ecological Impact of Light Pollution</h2><p>Light pollution affects virtually every ecosystem on Earth. Many species — from fireflies to sea turtles — rely on natural darkness for survival, reproduction, and navigation.</p><h3>Wildlife Disruption</h3><p>Migratory birds use starlight for navigation; artificial lighting causes disorientation and collisions. Sea turtle hatchlings instinctively head toward the brightest horizon (the ocean) but are often led inland by artificial lights. Insects are drawn into fatal spirals around light sources.</p><h3>Human Health Effects</h3><p>Exposure to artificial light at night suppresses melatonin production, disrupting circadian rhythms. Research links light pollution to increased rates of sleep disorders, depression, and certain cancers.</p>`, date:'Jan 2025', readTime:'6 min' },
  { id:4, cat:'solutions', icon:'🛡', title:'Reducing Light Pollution', excerpt:'Practical steps individuals, cities, and policymakers can take to reduce light pollution.', content:`<h2>Reducing Light Pollution</h2><p>Tackling light pollution requires action at individual, community, and policy levels. Encouragingly, unlike most forms of pollution, light pollution is almost immediately reversible — turn off the light, and the darkness returns.</p><h3>Individual Actions</h3><p>Use directional lighting that points downward; install motion sensors; choose warm-spectrum (2700K or below) bulbs; draw curtains at night; use the minimum light necessary.</p><h3>Community & Policy</h3><p>Dark Sky Reserves and International Dark Sky Parks establish protected areas with strict lighting ordinances. Cities like Tucson, Arizona, and Flagstaff have pioneered city-wide lighting codes that dramatically reduce skyglow.</p>`, date:'Dec 2024', readTime:'8 min' },
  { id:5, cat:'astronomy', icon:'🌌', title:'Deep Sky Objects', excerpt:'A guide to the most spectacular objects visible from dark skies: nebulae, galaxies, and clusters.', content:`<h2>Deep Sky Objects</h2><p>Beyond individual stars, the night sky contains thousands of breathtaking deep sky objects (DSOs) — but most require dark skies or quality optical filters to observe.</p><h3>Nebulae</h3><p>Clouds of gas and dust, often sites of star formation. The Orion Nebula (M42) is one of the most observed objects in the sky, visible to the naked eye from dark sites. Light pollution reduces its visibility to nearly nothing from cities.</p><h3>Galaxies</h3><p>The Andromeda Galaxy (M31), our nearest large galactic neighbour, spans six times the width of the full Moon. From dark skies it is unmistakable; from cities, invisible. The Astronomy Lens significantly improves contrast for these objects.</p>`, date:'Nov 2024', readTime:'10 min' },
  { id:6, cat:'astronomy', icon:'🔭', title:'Observational Astronomy for Beginners', excerpt:'How to get started with stargazing, equipment choices, and best practices.', content:`<h2>Observational Astronomy for Beginners</h2><p>Astronomy is one of the most accessible sciences — at its most basic level, it requires nothing more than your eyes, a dark location, and patience. Here's how to begin.</p><h3>Start with Your Eyes</h3><p>Before investing in equipment, spend time learning the naked-eye sky. Learn to identify key constellations, bright planets, and the Milky Way. Use apps like Stellarium to help orient yourself.</p><h3>First Equipment</h3><p>Binoculars (7×50 or 10×50) reveal far more than the naked eye and are highly portable. A small refractor telescope (80–100mm aperture) opens up planetary detail, double stars, and bright deep sky objects.</p><h3>Using AI Lenses</h3><p>Staarlina's Astronomy Lens and Anti-Glare Lens can significantly improve observation quality even from suburban locations, making astronomy accessible to more people than ever before.</p>`, date:'Oct 2024', readTime:'9 min' },
  { id:7, cat:'science',  icon:'💡', title:'The Science of Contrast', excerpt:'How the brain perceives celestial objects and why contrast matters more than brightness.', content:`<h2>The Science of Contrast</h2><p>When observing celestial objects, what matters is not absolute brightness but contrast — the difference in luminance between the object and the background sky. Even a bright star can be invisible against a light-polluted sky because the contrast ratio collapses.</p><h3>Weber's Law</h3><p>The human visual system detects differences relative to background levels (Weber's Law). When background sky brightness doubles, you need the object to be proportionally brighter to remain perceptible.</p><h3>How Filters Help</h3><p>Narrowband optical filters (like the nebular emission filters built into our Astronomy Lens) work by transmitting specific wavelengths where celestial objects emit light, while blocking the broader spectrum of artificial light pollution. The result is a dramatically improved contrast ratio.</p>`, date:'Sep 2024', readTime:'6 min' },
  { id:8, cat:'basics',   icon:'🌏', title:'Global Light Pollution Statistics', excerpt:'Data and maps showing the worldwide spread of light pollution and its trends.', content:`<h2>Global Light Pollution Statistics</h2><p>Light pollution has grown dramatically since the electrification of society. Today, 83% of the world's population and more than 99% of people in Europe and the United States live under light-polluted skies.</p><h3>Key Statistics</h3><p>One-third of humanity cannot see the Milky Way from where they live. Night sky brightness is increasing at approximately 2% per year globally. Europe and North America show the highest saturation of light-polluted areas.</p><h3>Trends</h3><p>Despite growing awareness, the transition to LED lighting has paradoxically worsened skyglow in many regions, as the efficiency gains have led to more lights being installed rather than energy savings being taken.</p>`, date:'Aug 2024', readTime:'5 min' },
];

function renderArticles(cat) {
  const grid = document.getElementById('articlesGrid');
  if (!grid) return;
  const filtered = cat === 'all' ? articles : articles.filter(a => a.cat === cat);
  grid.innerHTML = filtered.map(a => `
    <div class="article-card" onclick="openArticle(${a.id})">
      <div class="article-thumb" style="background:linear-gradient(135deg,var(--bg-card2),var(--bg-card))">
        <span style="position:relative;z-index:1;font-size:3rem">${a.icon}</span>
      </div>
      <div class="article-body">
        <div class="article-tag">${a.cat}</div>
        <h4>${a.title}</h4>
        <p>${a.excerpt}</p>
        <div class="article-meta">${a.date} · ${a.readTime} read</div>
      </div>
    </div>
  `).join('');
}

function filterArticles(cat, btn) {
  document.querySelectorAll('.topic-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderArticles(cat);
}

function openArticle(id) {
  const art = articles.find(a => a.id === id);
  if (!art) return;
  document.getElementById('modalContent').innerHTML = art.content;
  document.getElementById('articleModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeArticle() {
  document.getElementById('articleModal').classList.remove('open');
  document.body.style.overflow = '';
}

// ===================== RESEARCH FEED =====================
let currentFeedFilter = 'recent';

async function renderFeed(filter) {
  currentFeedFilter = filter;
  const list = document.getElementById('feedList');
  if (!list) return;

  list.innerHTML = '<div class="feed-loading">Loading observations...</div>';

  let query = supabaseDB
    .from('observations_with_votes')
    .select('*');

  if (filter === 'popular') {
    query = query.order('score', { ascending: false });
  } else if (filter === 'dark') {
    query = query.order('bortle', { ascending: true });
  } else {
    query = query.order('created_at', { ascending: false });
  }

  const { data, error } = await query;

  if (error) {
    list.innerHTML = '<div class="feed-loading">Failed to load observations.</div>';
    showToast('Could not load observations', 'error');
    return;
  }

  if (!data || data.length === 0) {
    list.innerHTML = '<div class="feed-loading">No observations yet. Be the first to submit one!</div>';
    return;
  }

  // Fetch current user's votes so we can highlight active vote buttons
  let userVotes = {};
  if (state.user) {
    const { data: votes } = await supabaseDB
      .from('observation_votes')
      .select('observation_id, vote')
      .eq('user_id', state.user.id);
    if (votes) votes.forEach(v => { userVotes[v.observation_id] = v.vote; });
  }

  list.innerHTML = data.map(f => {
    const uv = userVotes[f.id] ?? 0;
    const date = new Date(f.created_at).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
    const username = '@' + (f.display_name || 'observer').replace(/\s/g, '_').toLowerCase();
    const imageHtml = f.image_url
      ? `<img src="${f.image_url}" class="feed-entry-img" alt="Observation image" onclick="openLightbox(event, '${f.image_url}')" />`
      : '';
    return `
      <div class="feed-entry" data-id="${f.id}">
        ${imageHtml}
        <div class="feed-entry-body">
          <div class="feed-entry-header">
            <h4>${escapeHtml(f.title)}</h4>
            <span class="feed-bortle">Bortle ${f.bortle}</span>
          </div>
          <p>${escapeHtml(f.notes || '')}</p>
          <div class="feed-meta">
            <span>📍 ${escapeHtml(f.location)}</span>
            <span>🔬 ${escapeHtml(f.lens)}</span>
            <span>👤 ${escapeHtml(username)}</span>
            <span>🕐 ${date}</span>
          </div>
          <div class="feed-votes">
            <button class="vote-btn upvote ${uv === 1 ? 'active' : ''}" onclick="castVote('${f.id}', 1)" aria-label="Upvote">▲</button>
            <span class="vote-score">${f.score}</span>
            <button class="vote-btn downvote ${uv === -1 ? 'active' : ''}" onclick="castVote('${f.id}', -1)" aria-label="Downvote">▼</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function filterFeed(filter, btn) {
  document.querySelectorAll('.feed-filter').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderFeed(filter);
}

async function castVote(observationId, value) {
  if (!state.user) { showToast('Sign in to vote', 'error'); openAuth(); return; }

  // Check existing vote
  const { data: existing } = await supabaseDB
    .from('observation_votes')
    .select('vote')
    .eq('observation_id', observationId)
    .eq('user_id', state.user.id)
    .maybeSingle();

  if (existing?.vote === value) {
    // Clicking the same button again removes the vote
    await supabaseDB
      .from('observation_votes')
      .delete()
      .eq('observation_id', observationId)
      .eq('user_id', state.user.id);
  } else {
    // Upsert handles both new vote and switching between up/down
    await supabaseDB
      .from('observation_votes')
      .upsert({ observation_id: observationId, user_id: state.user.id, vote: value });
  }

  renderFeed(currentFeedFilter);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function openLightbox(e, url) {
  e.stopPropagation();
  document.getElementById('lightboxImg').src = url;
  document.getElementById('imgLightbox').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  document.getElementById('imgLightbox').classList.remove('open');
  document.getElementById('lightboxImg').src = '';
  document.body.style.overflow = '';
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeLightbox();
    closeArticle();
    closeAuth();
  }
});

// ===================== RESEARCH FORM =====================
function previewImage(input) {
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = e => {
      document.getElementById('imagePreview').src = e.target.result;
      document.getElementById('dropZonePrompt').style.display = 'none';
      document.getElementById('dropZonePreview').style.display = 'flex';
    };
    reader.readAsDataURL(input.files[0]);
  }
}

function removeImage(e) {
  e.stopPropagation(); // prevent drop zone click opening file picker
  document.getElementById('resImage').value = '';
  document.getElementById('imagePreview').src = '';
  document.getElementById('dropZonePreview').style.display = 'none';
  document.getElementById('dropZonePrompt').style.display = 'flex';
}

async function submitResearch() {
  const title    = document.getElementById('resTitle').value.trim();
  const location = document.getElementById('resLocation').value.trim();
  const notes    = document.getElementById('resNotes').value.trim();
  const datetime = document.getElementById('resDatetime').value;
  const bortle   = parseInt(document.getElementById('resBortle').value);
  const lens     = document.getElementById('resLens').value;
  const imageFile = document.getElementById('resImage').files[0];

  if (!title || !location) { showToast('Please fill in title and location', 'error'); return; }
  if (!state.user) { showToast('Please sign in to submit research', 'error'); openAuth(); return; }

  const submitBtn = document.querySelector('#research .btn-primary[onclick="submitResearch()"]');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting…'; }

  let image_url = null;

  if (imageFile) {
    const ext = imageFile.name.split('.').pop();
    const path = `${state.user.id}/${Date.now()}.${ext}`;
    const { error: uploadError } = await supabaseDB.storage
      .from('observation-images')
      .upload(path, imageFile, { contentType: imageFile.type });

    if (uploadError) {
      showToast('Image upload failed: ' + uploadError.message, 'error');
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit Observation'; }
      return;
    }

    const { data: urlData } = supabaseDB.storage
      .from('observation-images')
      .getPublicUrl(path);
    image_url = urlData.publicUrl;
  }

  const { error } = await supabaseDB.from('observations').insert({
    user_id:     state.user.id,
    title,
    location,
    observed_at: datetime ? new Date(datetime).toISOString() : new Date().toISOString(),
    lens,
    bortle,
    notes:       notes || null,
    image_url,
  });

  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit Observation'; }

  if (error) {
    showToast('Submission failed: ' + error.message, 'error');
    return;
  }

  showToast('Observation submitted! Thank you for contributing.', 'success');
  document.getElementById('resTitle').value = '';
  document.getElementById('resLocation').value = '';
  document.getElementById('resNotes').value = '';
  document.getElementById('resImage').value = '';
  document.getElementById('imagePreview').src = '';
  document.getElementById('dropZonePreview').style.display = 'none';
  document.getElementById('dropZonePrompt').style.display = 'flex';
  renderFeed('recent');
}

// ===================== SUPABASE =====================
const SUPABASE_URL  = 'https://lngtgjsxpsmqbaxudmmw.supabase.co';
const SUPABASE_ANON = 'sb_publishable_-rWV5BTBjx8eXL4vuCFPmg_PyQt5wBl';
const supabaseDB = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// Sync Supabase auth state into local state and update UI
function syncAuthState(supabaseUser) {
  if (supabaseUser) {
    const displayName = supabaseUser.user_metadata?.full_name
      || supabaseUser.email.split('@')[0];
    state.user = {
      id:    supabaseUser.id,
      name:  displayName,
      email: supabaseUser.email,
    };
    document.getElementById('loginBtn').textContent = `👤 ${displayName.split(' ')[0]}`;
  } else {
    state.user = null;
    document.getElementById('loginBtn').textContent = 'Sign In';
  }
}

// Listen for auth changes (login, logout, token refresh, page reload)
supabaseDB.auth.onAuthStateChange((_event, session) => {
  syncAuthState(session?.user ?? null);
});

// Restore session on page load
(async () => {
  const { data: { session } } = await supabaseDB.auth.getSession();
  syncAuthState(session?.user ?? null);
})();

// ===================== AUTH =====================
function openAuth() {
  document.getElementById('authModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeAuth() {
  document.getElementById('authModal').classList.remove('open');
  document.body.style.overflow = '';
}

document.getElementById('loginBtn').addEventListener('click', () => {
  if (state.user) { logoutUser(); } else { openAuth(); }
});

function switchAuthTab(tab, btn) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('loginForm').style.display    = tab === 'login' ? 'flex' : 'none';
  document.getElementById('registerForm').style.display = tab === 'register' ? 'flex' : 'none';
}

async function manualLogin() {
  const email = document.getElementById('authEmail').value.trim();
  const pass  = document.getElementById('authPassword').value;
  if (!email || !pass) { showToast('Please fill in all fields', 'error'); return; }

  const { error } = await supabaseDB.auth.signInWithPassword({ email, password: pass });
  if (error) {
    showToast(error.message, 'error');
  } else {
    closeAuth();
    showToast(`Welcome back!`, 'success');
  }
}

async function registerUser() {
  const name  = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const pass  = document.getElementById('regPassword').value;
  const role  = document.getElementById('regRole').value;
  if (!name || !email || !pass) { showToast('Please fill in all fields', 'error'); return; }

  const { error } = await supabaseDB.auth.signUp({
    email,
    password: pass,
    options: { data: { full_name: name, role } },
  });
  if (error) {
    showToast(error.message, 'error');
  } else {
    closeAuth();
    showToast(`Account created! Check your email to confirm.`, 'success');
  }
}

async function logoutUser() {
  await supabaseDB.auth.signOut();
  showToast('Signed out');
}

// ===================== LANGUAGE =====================
const translations = {
  en: { nav_home:'Home', nav_skylab:'Sky Lab', nav_lenses:'AI Lenses', nav_map:'Pollution Map', nav_learn:'Learn', nav_research:'Research', nav_goggles:'Luminova' },
  es: { nav_home:'Inicio', nav_skylab:'Lab del Cielo', nav_lenses:'Lentes IA', nav_map:'Mapa de Contaminación', nav_learn:'Aprender', nav_research:'Investigación', nav_goggles:'Gafas Galácticas' },
  fr: { nav_home:'Accueil', nav_skylab:'Labo Ciel', nav_lenses:'Lentilles IA', nav_map:'Carte de Pollution', nav_learn:'Apprendre', nav_research:'Recherche', nav_goggles:'Lunettes Galactiques' },
  de: { nav_home:'Startseite', nav_skylab:'Himmelslabor', nav_lenses:'KI-Linsen', nav_map:'Verschmutzungskarte', nav_learn:'Lernen', nav_research:'Forschung', nav_goggles:'Galaktische Brillen' },
  zh: { nav_home:'首页', nav_skylab:'天空实验室', nav_lenses:'AI镜头', nav_map:'污染地图', nav_learn:'学习', nav_research:'研究', nav_goggles:'银河眼镜' },
  ar: { nav_home:'الرئيسية', nav_skylab:'مختبر السماء', nav_lenses:'عدسات الذكاء', nav_map:'خريطة التلوث', nav_learn:'تعلم', nav_research:'بحث', nav_goggles:'نظارات المجرة' },
  ja: { nav_home:'ホーム', nav_skylab:'スカイラボ', nav_lenses:'AIレンズ', nav_map:'汚染マップ', nav_learn:'学ぶ', nav_research:'研究', nav_goggles:'銀河ゴーグル' },
};

document.getElementById('langSelect').addEventListener('change', function() {
  const lang = this.value;
  const t = translations[lang] || translations.en;
  const pages = ['home','sky-lab','lenses','map','education','research','goggles'];
  const keys  = ['nav_home','nav_skylab','nav_lenses','nav_map','nav_learn','nav_research','nav_goggles'];
  document.querySelectorAll('.nav-link').forEach((link, i) => { link.textContent = t[keys[i]]; });
  showToast(`Language changed`);
});

// ===================== GOGGLES PAGE =====================
function scrollToSpecs() {
  document.getElementById('specs').scrollIntoView({ behavior: 'smooth' });
}

// Lens glow animation on goggles vis
setInterval(() => {
  const lensL = document.getElementById('goggleLensL');
  const lensR = document.getElementById('goggleLensR');
  if (!lensL || !lensR) return;
  const lenses = [
    'radial-gradient(ellipse at 30% 30%, rgba(124,58,237,0.4), rgba(4,2,15,0.7))',
    'radial-gradient(ellipse at 30% 30%, rgba(236,72,153,0.4), rgba(4,2,15,0.7))',
    'radial-gradient(ellipse at 30% 30%, rgba(234,179,8,0.3), rgba(4,2,15,0.7))',
    'radial-gradient(ellipse at 30% 30%, rgba(20,184,166,0.35), rgba(4,2,15,0.7))',
    'radial-gradient(ellipse at 30% 30%, rgba(96,165,250,0.35), rgba(4,2,15,0.7))',
  ];
  const choice = lenses[Math.floor(Math.random() * lenses.length)];
  lensL.style.background = choice;
  lensR.style.background = choice;
}, 2500);

// ===================== TOAST =====================
let toastTimer;
function showToast(msg, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.classList.remove('show'); }, 3000);
}

// ===================== FILE DROP =====================
const dropZone = document.getElementById('fileDropZone');
if (dropZone) {
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.style.borderColor = 'var(--purple-lt)'; });
  dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = ''; });
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.style.borderColor = '';
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      const fakeInput = { files: [file] };
      previewImage(fakeInput);
    }
  });
}

// ===================== INIT =====================
window.addEventListener('DOMContentLoaded', () => {
  navigateTo('home');
  // Set datetime default
  const dtInput = document.getElementById('resDatetime');
  if (dtInput) dtInput.value = new Date().toISOString().slice(0,16);
  // Initial sky canvas
  setTimeout(initSkyCanvas, 100);
});

// Resize sky canvas on window resize
window.addEventListener('resize', () => {
  if (state.currentPage === 'sky-lab') {
    setTimeout(initSkyCanvas, 200);
  }
  if (state.currentPage === 'map') {
    setTimeout(initMapCanvas, 200);
  }
});

// ===================== LUMINOVA INTERACTIVE PAGE =====================

// Hotspot info panel switcher
function selectHotspot(infoId, btn) {
  // Reset all hotspots
  document.querySelectorAll('.lum-hotspot').forEach(h => h.classList.remove('active'));
  // Hide all detail panels
  document.querySelectorAll('.lum-info-detail').forEach(d => d.style.display = 'none');
  document.getElementById('lum-info-default').style.display = 'none';

  // Activate clicked hotspot
  btn.classList.add('active');

  // Show matching detail panel
  const panel = document.getElementById('info-' + infoId);
  if (panel) {
    panel.style.display = 'block';
    panel.style.animation = 'fadeInUp 0.35s ease';
  }

  // Animate image glow based on hotspot
  const img = document.getElementById('lumProductImg');
  const glowMap = {
    'ai-chip':  'brightness(1.1) saturate(1.2) hue-rotate(20deg)',
    'lens-r':   'brightness(1.15) saturate(1.3) hue-rotate(-10deg)',
    'lens-l':   'brightness(1.1) saturate(1.1) hue-rotate(30deg)',
    'battery':  'brightness(1.05) saturate(1.0)',
    'camera':   'brightness(1.2) saturate(1.15) hue-rotate(-5deg)',
  };
  if (img) img.style.filter = glowMap[infoId] || 'brightness(1.05)';
}

// Lens color preview in hotspot panel
function previewLensColor(lens, btn) {
  document.querySelectorAll('.lum-swatch').forEach(s => s.classList.remove('active'));
  btn.classList.add('active');

  const bar = document.getElementById('lumLensPreviewBar');
  const label = document.getElementById('lumLensPreviewLabel');
  const descriptions = {
    city:     'Warm amber tint — LED blue-light filtered. Streets glow amber, stars pop.',
    astro:    'Deep violet contrast mode — maximum star visibility, Milky Way enhanced.',
    antiglare:'Teal-tinted glare suppression — halos eliminated, natural background preserved.',
    bright:   'Rose-tinted luminance reduction — ideal for bright suburban environments.',
    custom:   'Multi-spectrum blend — fully customisable for your observation site.',
  };
  const colors = {
    city:     'linear-gradient(90deg,rgba(245,158,11,0.25),rgba(180,83,9,0.15))',
    astro:    'linear-gradient(90deg,rgba(124,58,237,0.3),rgba(76,29,149,0.2))',
    antiglare:'linear-gradient(90deg,rgba(20,184,166,0.25),rgba(13,148,136,0.15))',
    bright:   'linear-gradient(90deg,rgba(236,72,153,0.25),rgba(157,23,77,0.15))',
    custom:   'linear-gradient(90deg,rgba(234,179,8,0.2),rgba(124,58,237,0.2))',
  };
  if (bar) {
    bar.style.background = colors[lens] || '';
    bar.style.borderColor = 'var(--border-glow)';
    bar.style.color = 'var(--white)';
  }
  if (label) label.textContent = descriptions[lens] || '';
}

// Blue-light slider demo on lens-l hotspot
function updateLumBlDemo(input) {
  const val = input.value;
  const display = document.getElementById('lumBlVal');
  if (display) display.textContent = val;

  const warmSky = document.getElementById('warmSky');
  if (warmSky) {
    // As blue light reduction increases, sky shifts warmer/darker
    const warmth = Math.round(val * 0.8);
    warmSky.style.background = `linear-gradient(135deg, hsl(${20 - val*0.15},${60 + warmth*0.3}%,${15 + (100-val)*0.12}%), hsl(${35 - val*0.2},${70}%,${25 + (100-val)*0.15}%))`;
  }
}

// Battery mode switcher
function setBattMode(mode, btn) {
  document.querySelectorAll('.lum-batt-mode').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const bar = document.getElementById('lumBattBar');
  const label = document.getElementById('lumBattLabel');
  const configs = {
    observe:   { pct: 100, label: '18 hrs remaining', color: 'linear-gradient(90deg,var(--purple),var(--purple-lt))' },
    camera:    { pct: 50,  label: '9 hrs remaining',  color: 'linear-gradient(90deg,var(--teal),#34d399)' },
    streaming: { pct: 33,  label: '6 hrs remaining',  color: 'linear-gradient(90deg,var(--amber),#fbbf24)' },
  };
  const cfg = configs[mode];
  if (bar)   { bar.style.width = cfg.pct + '%'; bar.style.background = cfg.color; }
  if (label) label.textContent = cfg.label;
}

// Lens tab switcher for main lens section
const lumLensData = {
  city: {
    title: 'City Lens',
    desc:  'Engineered for urban environments. Selectively attenuates LED blue-light frequencies (450–490nm) — the primary contributor to city sky glow — replacing harsh cold tones with warm amber hues. Perfect for city rooftops and suburban gardens.',
    blue: '90%', contrast: '40%', glare: '65%',
    visClass: 'city-vis',
    barColor: ['var(--amber)', 'var(--violet)', 'var(--teal)'],
  },
  astronomy: {
    title: 'Astronomy Lens',
    desc:  'Maximises contrast ratio for deep-sky observation. Sharpens the luminance differential between celestial bodies and the surrounding sky, making faint nebulae, star clusters, and galaxies dramatically more visible.',
    blue: '55%', contrast: '95%', glare: '40%',
    visClass: 'astro-vis',
    barColor: ['var(--purple)', 'var(--purple-lt)', 'var(--violet)'],
  },
  antiglare: {
    title: 'Anti-Glare Lens',
    desc:  'Neutralises point sources of artificial light — street lamps, billboards, illuminated windows — without darkening the entire visual field. Preserves the natural sky background while eliminating distracting halos.',
    blue: '60%', contrast: '65%', glare: '95%',
    visClass: 'antiglare-vis',
    barColor: ['var(--teal)', 'var(--teal)', 'var(--teal)'],
  },
  brightness: {
    title: 'Brightness Lens',
    desc:  'Adapts to excessively bright environments by dynamically attenuating overall luminance while preserving colour accuracy. Useful in transition hours (dusk/dawn) or in areas with overwhelming sky-glow.',
    blue: '35%', contrast: '45%', glare: '70%',
    visClass: 'brightness-vis',
    barColor: ['var(--rose)', 'var(--pink)', 'var(--rose)'],
  },
  custom: {
    title: 'Custom Lens',
    desc:  'Build your own personalised filter profile. Dial in precise blue-light attenuation, contrast enhancement, and warm-tint intensity. Save multiple profiles for different observation sites and share with the research community.',
    blue: '100%', contrast: '100%', glare: '100%',
    visClass: 'custom-vis',
    barColor: ['var(--gold)', 'var(--gold)', 'var(--gold)'],
  },
};

function switchLumLens(lens, btn) {
  document.querySelectorAll('.lum-lens-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');

  const data = lumLensData[lens];
  if (!data) return;

  const titleEl = document.getElementById('lumLensTitle');
  const descEl  = document.getElementById('lumLensDesc');
  const visual  = document.getElementById('llcVisual');
  const bar1    = document.getElementById('llcBar1');
  const bar2    = document.getElementById('llcBar2');
  const bar3    = document.getElementById('llcBar3');

  if (titleEl) titleEl.textContent = data.title;
  if (descEl)  descEl.textContent  = data.desc;
  if (visual) {
    visual.className = 'llc-visual ' + data.visClass;
  }
  if (bar1) { bar1.style.width = data.blue;     bar1.style.background = data.barColor[0]; }
  if (bar2) { bar2.style.width = data.contrast; bar2.style.background = data.barColor[1]; }
  if (bar3) { bar3.style.width = data.glare;    bar3.style.background = data.barColor[2]; }
}

// Init battery bar on page load
window.addEventListener('DOMContentLoaded', () => {
  const bar = document.getElementById('lumBattBar');
  if (bar) bar.style.width = '100%';
});
