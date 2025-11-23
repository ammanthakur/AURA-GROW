// AURA GROW - script.js
// Shared script for multi-page frontend: auth (signup/login), dashboard polling, UI rendering, redirects.

// Use the current origin when available (works in production). Fall back to localhost for local dev.
const BASE = (function(){
  try{ const o = window.location.origin || ''; if(o && o !== 'null') return o.replace(/:\d+$/, ':3000') || o; }catch(e){}
  return 'http://localhost:3000';
})();
const API_BASE = `${BASE}/api`;
const ENDPOINT_LATEST = `${API_BASE}/latest`;
const ENDPOINT_HISTORY = `${API_BASE}/history?per=10&page=1`;

const el = id => document.getElementById(id);

/* ----------------------------- Helpers ------------------------------ */
function escapeHtml(s){
  if(s === null || s === undefined) return '';
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#039;");
}

function formatNumber(n, decimals=0){
  if(n === null || n === undefined || n === '') return '--';
  return (Number(n)).toFixed(decimals);
}

function formatTime(t){
  if(!t) return '';
  const d = new Date(t);
  if(isNaN(d)) return String(t);
  return d.toLocaleString();
}

/* ----------------------------- Auth Utils --------------------------- */
const USER_KEY = 'aura_user';
const TOKEN_KEY = 'aura_token';
function saveToken(t){ localStorage.setItem(TOKEN_KEY, t); }
function getToken(){ return localStorage.getItem(TOKEN_KEY); }
function clearAuth(){ localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); localStorage.removeItem('aura_logged_in'); }
function saveUser(obj){ localStorage.setItem(USER_KEY, JSON.stringify(obj)); }
function loadUser(){ try{ return JSON.parse(localStorage.getItem(USER_KEY)); }catch(e){return null} }

/* ----------------------------- Back-button logout ----------------- */
function setupBackLogout(){
  // When the user navigates using the browser back/forward controls,
  // aggressively clear authentication and send them to the login page.
  // This ensures a back-navigation acts like a logout.
  window.addEventListener('popstate', (evt)=>{
    if(getToken()){ clearAuth(); /* small defer to allow native nav */ setTimeout(()=> window.location.href = 'login.html', 50); }
  });

  // Some browsers (Safari) restore pages from bfcache — detect pageshow persisted
  window.addEventListener('pageshow', (ev)=>{
    if(ev.persisted && getToken()){
      clearAuth(); window.location.href = 'login.html';
    }
  });
}

/* ----------------------------- Page: Signup ------------------------- */
function initSignup(){
  const form = document.getElementById('signup-form');
  if(!form) return;
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const name = form.querySelector('[name="name"]').value.trim();
    const email = form.querySelector('[name="email"]').value.trim().toLowerCase();
    const pw = form.querySelector('[name="password"]').value;
    const pw2 = form.querySelector('[name="confirm"]')?.value || '';
    if(!name || !email || !pw) return alert('Please fill all fields');
    if(pw !== pw2) return alert('Passwords do not match');
    try{
      const res = await fetch(`${API_BASE}/signup`, {method:'POST',headers:{'Content-Type':'application/json'},body: JSON.stringify({name,email,password:pw})});
      if(!res.ok){ const j = await res.json().catch(()=>({error:'Signup failed'})); return alert(j.error||'Signup failed'); }
      alert('Account created. Please login.');
      window.location.href = 'login.html';
    }catch(err){ console.error('Signup error',err); alert('Signup error'); }
  });
}

/* ----------------------------- Page: Login -------------------------- */
function initLogin(){
  const form = document.getElementById('login-form');
  if(!form) return;
  // If already logged in, redirect to dashboard
  if(getToken()){ window.location.href = 'dashboard.html'; return; }
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const email = form.querySelector('[name="email"]').value.trim().toLowerCase();
    const pw = form.querySelector('[name="password"]').value;
    try{
      const res = await fetch(`${API_BASE}/login`, {method:'POST',headers:{'Content-Type':'application/json'},body: JSON.stringify({email,password:pw})});
      if(!res.ok){ const j = await res.json().catch(()=>({error:'Login failed'})); return alert(j.error||'Login failed'); }
      const j = await res.json(); saveToken(j.token); saveUser(j.user); localStorage.setItem('aura_logged_in', JSON.stringify({email,ts:Date.now()}));
      window.location.href = 'dashboard.html';
    }catch(err){ console.error('Login error',err); alert('Login error'); }
  });
}

/* ----------------------------- API Fetching ------------------------ */
async function fetchLatest(){
  try{
    const token = getToken() || '';
    const res = await fetch(ENDPOINT_LATEST, {cache: 'no-store', headers: { 'Authorization': `Bearer ${token}` }});
    if(!res.ok) throw new Error('Network response not ok');
    const j = await res.json();
    // keep a copy for recommendation flows
    window.__lastLatest = j;
    return j;
  }catch(err){
    console.warn('Failed to fetch latest:', err.message);
    return null;
  }
}

async function fetchHistory(){
  try{
    const token = getToken() || '';
    const res = await fetch(ENDPOINT_HISTORY, {cache: 'no-store', headers: { 'Authorization': `Bearer ${token}` }});
    if(!res.ok) throw new Error('Network response not ok');
    const data = await res.json();
    if(Array.isArray(data)) return data;
    if(data.history && Array.isArray(data.history)) return data.history;
    if(data.readings && Array.isArray(data.readings)) return data.readings;
    return [];
  }catch(err){
    console.warn('Failed to fetch history:', err.message);
    return [];
  }
}

function mapCategoryToClass(cat){
  if(!cat) return 'aqi-good';
  const s = String(cat).toLowerCase();
  if(s.includes('good')) return 'aqi-good';
  if(s.includes('moderate')) return 'aqi-moderate';
  if(s.includes('hazard') || s.includes('hazardous')) return 'aqi-hazardous';
  if(s.includes('very') || s.includes('very unhealthy')) return 'aqi-very-unhealthy';
  if(s.includes('unhealthy')) return 'aqi-unhealthy';
  return 'aqi-moderate';
}

/* ----------------------------- Rendering --------------------------- */
function renderLatestToCards(data){
  if(!data) return;
  const aqi = data.aqi ?? data.AQI ?? data.index ?? null;
  const category = data.category ?? data.pollutionCategory ?? data.status ?? data.Category ?? '--';
  const pm25 = data.pm25 ?? data.pm2_5 ?? data.pm_2_5 ?? data.PM25 ?? null;
  const pm10 = data.pm10 ?? data.PM10 ?? null;
  const humidity = data.humidity ?? data.hum ?? null;
  const soil = data.soilMoisture ?? data.soil ?? data.soil_moisture ?? null;
  const recs = data.recommendations ?? data.recs ?? data.aiRecommendations ?? [];

  const mapEl = id => document.getElementById(id);
  if(mapEl('aqi-value')) mapEl('aqi-value').textContent = aqi !== null ? formatNumber(aqi,0) : '--';
  if(mapEl('aqi-category')) mapEl('aqi-category').textContent = category ?? '--';
  if(mapEl('pm25-value')) mapEl('pm25-value').textContent = pm25 !== null ? formatNumber(pm25,1) : '--';
  if(mapEl('pm10-value')) mapEl('pm10-value').textContent = pm10 !== null ? formatNumber(pm10,1) : '--';
  if(mapEl('humidity-value')) mapEl('humidity-value').textContent = humidity !== null ? formatNumber(humidity,0) : '--';
  if(mapEl('soil-value')) mapEl('soil-value').textContent = soil !== null ? formatNumber(soil,0) : '--';
  if(mapEl('category-value')) mapEl('category-value').textContent = category ?? '--';

  const cardsGrid = document.querySelector('.cards-grid');
  if(cardsGrid){
    const cls = mapCategoryToClass(category);
    cardsGrid.classList.remove('aqi-good','aqi-moderate','aqi-unhealthy','aqi-very-unhealthy','aqi-hazardous');
    cardsGrid.classList.add(cls);
  }

  renderRecommendations(recs);
}

function renderRecommendations(list){
  const panel = document.getElementById('rec-panel');
  if(!panel) return;
  panel.innerHTML = '';
  if(!list || !list.length){
    panel.innerHTML = '<div class="rec-empty">No recommendations available</div>';
    return;
  }
  list.forEach(item =>{
    let name;
    if (typeof item === 'string') name = item;
    else if (item && (item.name || item.plant || item.title)) name = item.name || item.plant || item.title;
    else name = 'Unknown plant';

    let type = 'Unknown';
    if (item && (item.type || item.plantType)) type = item.type || item.plantType;

    let notes = '';
    if (item && (item.notes || item.reason || item.description)) notes = item.notes || item.reason || item.description;

    const card = document.createElement('div');
    card.className = 'rec-card';
    card.innerHTML = `
      <div class="rec-title">${escapeHtml(name)}</div>
      <div class="rec-type">${escapeHtml(type)}</div>
      <div class="rec-notes">${escapeHtml(notes)}</div>
    `;
    panel.appendChild(card);
  });
}

function renderHistory(list){
  const wrap = document.getElementById('history-list');
  if(!wrap) return;
  wrap.innerHTML = '';
  if(!list || !list.length){
    wrap.innerHTML = '<div class="history-empty">No history available</div>';
    return;
  }
  list.slice(0,10).forEach(item =>{
    const time = item.time ?? item.timestamp ?? item.ts ?? item.createdAt ?? '';
    const aqi = item.aqi ?? item.AQI ?? item.index ?? '--';
    const pm25 = item.pm25 ?? item.pm2_5 ?? item.pm_2_5 ?? '--';
    const humidity = item.humidity ?? '--';
    const node = document.createElement('div');
    node.className = 'history-item';
    node.innerHTML = `
      <div>
        <div class="summary">AQI ${escapeHtml(aqi)} • PM2.5 ${escapeHtml(pm25)}</div>
        <div class="time">${escapeHtml(formatTime(time))}</div>
      </div>
      <div class="meta muted">${escapeHtml(humidity)}% RH</div>
    `;
    wrap.appendChild(node);
  });
}

/* ----------------------------- Dashboard Polling ------------------- */
let dashStopped = false;
async function dashboardUpdateAll(){
  const latest = await fetchLatest();
  if(latest) renderLatestToCards(latest);
  const history = await fetchHistory();
  renderHistory(history);
}

function dashboardSchedulePolling(){
  const rand = 5000 + Math.floor(Math.random()*3000); // 5-8s
  setTimeout(async ()=>{
    if(dashStopped) return;
    await dashboardUpdateAll();
    dashboardSchedulePolling();
  }, rand);
}

/* ----------------------------- Page Init Router -------------------- */
function initPage(){
  // ensure back-button logout behavior is active on every page
  setupBackLogout();
  const page = document.body?.dataset?.page || window.location.pathname.split('/').pop() || 'index.html';
  if(page.endsWith('signup.html') || page === 'signup'){
    initSignup();
  }else if(page.endsWith('login.html') || page === 'login'){
    initLogin();
  }else if(page.endsWith('dashboard.html') || page === 'dashboard'){
    // require token for dashboard access
    if(!getToken()){ window.location.href = 'login.html'; return; }
    // Run initial render and polling
    dashboardUpdateAll();
    dashboardSchedulePolling();
  }
}


// Initialize page on DOMContentLoaded
window.addEventListener('DOMContentLoaded', initPage);

// Expose a small API for debugging in console
window.AURAGROW = {fetchLatest, fetchHistory, dashboardUpdateAll, renderRecommendations, renderHistory};
