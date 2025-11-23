/* dashboard.js - Show recent pollution data from /api/latest and /api/history
   Polls /api/latest every 5-8s and fetches history on load.
*/

const API_BASE = (function(){
  try{
    const o = window.location.origin || '';
    if(!o || o === 'null') return 'http://localhost:3000';
    return o.replace(/:\d+$/, ':3000');
  }catch(e){ return 'http://localhost:3000'; }
})();
function $(s){return document.querySelector(s)}

// Device-location button handler: request browser geolocation and fetch pollution for those coords
function setupDeviceLocationButton(){
  const btn = document.getElementById('use-my-location');
  if(!btn) return;
  btn.addEventListener('click', ()=>{
    const locEl = document.getElementById('location');
    if(!navigator.geolocation){ if(locEl) locEl.textContent = 'Location not supported'; return; }
    // geolocation requires secure context (https) except on localhost
    const isSecure = (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    if(!isSecure){ if(locEl) locEl.textContent = 'Geolocation requires HTTPS or localhost'; return; }
    btn.disabled = true; const prev = btn.textContent; btn.textContent = 'Locating…';
    navigator.geolocation.getCurrentPosition(async (pos)=>{
      try{
        const lat = pos.coords.latitude; const lon = pos.coords.longitude;
        if(locEl) locEl.textContent = 'Locating…';
        await fetchPollutionForCity(lat, lon, 'My Location');
      }catch(e){ console.warn('geolocation handler error', e); if(locEl) locEl.textContent = 'Location error'; }
      btn.disabled = false; btn.textContent = prev || 'Use my device location';
    }, (err)=>{
      console.warn('geolocation error', err);
      if(locEl){
        if(err && err.code === 1) locEl.textContent = 'Location permission denied';
        else if(err && err.code === 3) locEl.textContent = 'Location timeout';
        else locEl.textContent = 'Location unavailable';
      }
      btn.disabled = false; btn.textContent = prev || 'Use my device location';
    }, { timeout: 10000, maximumAge: 0 });
  });
}

function requireAuth(){
  const token = localStorage.getItem('aura_token');
  if(!token){ window.location.href = 'login.html'; return null; }
  try{ const usr = JSON.parse(localStorage.getItem('aura_user')||'null'); return usr; }catch(e){ return null; }
}

function setupLogout(){
  const btn = $('#logout-btn'); if(!btn) return; btn.addEventListener('click', ()=>{ localStorage.removeItem('aura_logged_in'); localStorage.removeItem('aura_token'); localStorage.removeItem('aura_user'); window.location.href='login.html'; });
}

function setCard(id, value, sub){
  const v = $(id); if(!v) return; v.textContent = value != null ? value : '—';
  if(sub){ const s = document.getElementById(id.replace('-value','-sub')) || null; if(s) s.textContent = sub; }
}

function mapAqiCategory(raw){
  if(!raw) return 'Unknown';
  const s = String(raw).toLowerCase();
  if(s.includes('good')) return 'Good';
  if(s.includes('moderate')) return 'Moderate';
  if(s.includes('unhealthy')) return 'Unhealthy';
  if(s.includes('very')) return 'Very Unhealthy';
  if(s.includes('hazardous')) return 'Hazardous';
  const n = Number(raw);
  if(!isNaN(n)){
    if(n<=50) return 'Good';
    if(n<=100) return 'Moderate';
    if(n<=150) return 'Unhealthy';
    if(n<=200) return 'Very Unhealthy';
    return 'Hazardous';
  }
  return String(raw);
}

async function fetchLatest(){
  try{
    const token = localStorage.getItem('aura_token') || '';
    const res = await fetch(`${API_BASE}/api/latest`, {cache:'no-store', headers: { 'Authorization': `Bearer ${token}` }});
    if(!res.ok) throw new Error('no latest');
    const d = await res.json();
    // store last latest for recommendation context
    window.__lastLatest = d;
    renderReading(d);
    return d;
  }catch(e){
    console.warn('fetchLatest failed', e);
    return null;
  }
}

// compute a client-side pollution_value (0-100) to display alongside main pollutant
function computePollutionValueLocal(d){
  if(!d) return null;
  // use AQI (OpenWeatherMap uses 1-5) if available
  const aq = d.aqi ?? d.AQI ?? d.index ?? null;
  if(aq !== null && aq !== undefined){
    const n = Number(aq);
    if(!isNaN(n)) return Math.min(100, Math.max(0, (n - 1) * 25 + 20));
  }
  // fallback: use pm2.5
  const comps = d.components || {};
  const pm = d.pm25 ?? d.pm2_5 ?? d.pm_2_5 ?? comps.pm2_5 ?? comps.pm25 ?? null;
  if(pm !== null && pm !== undefined){
    const n = Number(pm);
    if(!isNaN(n)){
      if(n <= 12) return 10;
      if(n <= 35) return 40;
      if(n <= 55) return 70;
      return 90;
    }
  }
  return null;
}

function renderReading(d){
  if(!d) return;
  // map fields defensively
  const aqi = d.aqi ?? d.AQI ?? d.index ?? null;
  const humidity = d.humidity ?? d.rel_humidity ?? null;
  const soil = d.soil_moisture ?? d.soil ?? null;
  const temp = d.temp ?? d.temperature ?? (d.raw && d.raw.main && d.raw.main.temp) ?? null;
  const category = d.category ?? d.status ?? d.quality ?? d.aqiCategory ?? mapAqiCategory(aqi);

  // display numeric values when available; keep qualitative labels in subtags
  setCard('#aqi-value', aqi != null ? (Math.round(Number(aqi))) : '—');
  setCard('#aqi-category', mapAqiCategory(category));
  setCard('#humidity-value', humidity != null ? (Number(humidity).toFixed(0)) : '—');
  setCard('#soil-value', soil != null ? (Number(soil).toFixed(0)) : '—');

  const pollValue = computePollutionValueLocal(d);
  const pb = document.getElementById('m-pollution');
  const ps = document.getElementById('pollution-score');
  const mp = document.getElementById('main-pollutant');
  if(ps){ ps.textContent = pollValue !== null ? `${pollValue}/100` : '—'; }
  if(mp){ const m = d.main_pollutant || (d.components && Object.keys(d.components || {}).sort((a,b)=> (d.components[b]||0)-(d.components[a]||0))[0]) || '—'; mp.innerHTML = `Main pollutant: <span class="muted">${m || '—'}</span>`; }
  if(pb){ pb.classList.remove('high','moderate'); if(pollValue !== null){ if(pollValue >= 70) pb.classList.add('high'); else if(pollValue >= 35) pb.classList.add('moderate'); } }
  // set temperature display
  const elTemp = document.getElementById('temp-value'); if(elTemp) elTemp.textContent = temp != null ? Number(temp).toFixed(1) : '—';
  // set location in header if available — show only city name (strip country/extra info)
  const locEl = document.getElementById('location');
  if(locEl){
    const rawCity = d.city || (d.raw && d.raw.name) || (d.weather && d.weather.city) || '';
    let cityName = '';
    try{
      cityName = String(rawCity).split(',')[0].split('\n')[0].trim();
    }catch(e){ cityName = rawCity; }
    locEl.textContent = cityName ? cityName : '—';
  }

  // If temperature missing but coords exist, try fetching ambient weather (background)
  try{
    const hasTemp = temp != null && temp !== undefined;
    const coords = d && d.raw && d.raw.coord ? d.raw.coord : (d.coord ? d.coord : null);
    if((!hasTemp) && coords && coords.lat && coords.lon){
      (async ()=>{
        try{
          const wres = await fetch(`${API_BASE}/api/weather?lat=${encodeURIComponent(coords.lat)}&lon=${encodeURIComponent(coords.lon)}`);
          if(!wres.ok) return;
          const wj = await wres.json();
          // update temp and humidity if available
          if(wj && (wj.temperature !== undefined || wj.temperature !== null)){
            const elTemp = document.getElementById('temp-value'); if(elTemp) elTemp.textContent = Number(wj.temperature).toFixed(1);
          }
          if(wj && (wj.humidity !== undefined || wj.humidity !== null)){
            const elHum = document.getElementById('humidity-value'); if(elHum) elHum.textContent = Number(wj.humidity).toFixed(0);
          }
          // also update header city if missing
          if(wj && wj.city){ const loc = document.getElementById('location'); if(loc && (!loc.textContent || loc.textContent==='—')) loc.textContent = String(wj.city).split(',')[0]; }
        }catch(e){ /* ignore weather fetch errors */ }
      })();
    }
  }catch(e){ /* ignore */ }
}

// Setup soil setter UI to POST a test reading (requires login)
function setupSoilSetter(){
  // removed to avoid manual soil input
}

// fetch pollution for a given lat/lon (preset city selection)
async function fetchPollutionForCity(lat, lon, label){
  try{
    const token = localStorage.getItem('aura_token') || '';
    const res = await fetch(`${API_BASE}/api/pollution?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`, {cache:'no-store', headers: { 'Authorization': `Bearer ${token}` }});
    if(!res.ok) throw new Error('pollution fetch failed');
    const d = await res.json();
    // if API returned a reading, render it
    window.__lastLatest = d;
    // prefer the provided label if API doesn't include city name
    if(d && !d.city && label) d.city = label;
    renderReading(d);
    // Ensure header no longer shows 'Locating…' — set to city short name or coordinates
    try{
      const locEl = document.getElementById('location');
      if(locEl){
        const rawCity = d && (d.city || (d.raw && d.raw.name) || (d.weather && d.weather.city)) || '';
        const shortCity = rawCity ? String(rawCity).split(',')[0].split('\n')[0].trim() : '';
        if(shortCity) locEl.textContent = shortCity;
        else locEl.textContent = `${Number(lat).toFixed(2)}, ${Number(lon).toFixed(2)}`;
      }
    }catch(e){ /* ignore */ }
    return d;
  }catch(e){ console.warn('fetchPollutionForCity failed', e); return null; }
}

// History and its rendering removed — dashboard shows live snapshot and recommendations only.

// Recommendation flow (calls backend; backend retains keys)
async function requestRecommendations(){
  const btn = $('#rec-btn');
  const out = $('#rec-result');
  if(btn) btn.disabled = true;
  if(out) out.innerHTML = '<div class="muted">Requesting recommendations…</div>';
  try{
    const latest = window.__lastLatest || null;
  const token = localStorage.getItem('aura_token') || '';
  const r = await fetch(`${API_BASE}/api/recommend`, {method:'POST',headers:{'Content-Type':'application/json','Authorization': `Bearer ${token}`},body: JSON.stringify({ latest })});
    if(!r.ok) throw new Error('recommendation failed');
    const payload = await r.json();
    const plants = Array.isArray(payload.plants)?payload.plants:(Array.isArray(payload)?payload:(payload.plants||[]));
    renderRecommendations(plants);
  }catch(e){
    console.warn('recommendation error', e);
    if(out) out.innerHTML = '<div class="muted">Failed to get recommendations.</div>';
  }finally{ if(btn) btn.disabled = false; }
}

function renderRecommendations(plants){
  const out = document.getElementById('rec-result'); if(!out) return;
  if(!plants || plants.length===0){ out.innerHTML = '<div class="muted">No recommendations available.</div>'; return; }
  out.innerHTML = '';
  for(const p of plants){
    const card = document.createElement('div'); card.className='rec-card';
    const name = p.name || p.plant || 'Unknown';
    const reason = p.short_reason || p.reason || '';
    card.innerHTML = `<h4>${escapeHtml(name)}</h4><div class="muted">${escapeHtml(reason)}</div>`;
    if(p.care && Array.isArray(p.care)){
      const ul = document.createElement('ul'); for(const c of p.care){ const li = document.createElement('li'); li.textContent = c; ul.appendChild(li);} card.appendChild(ul);
    }
    out.appendChild(card);
  }
}

// polling
let pollTimer = null;
function schedulePoll(){
  const delay = 5000 + Math.floor(Math.random()*3000);
  pollTimer = setTimeout(async ()=>{ await fetchLatest(); schedulePoll(); }, delay);
}

async function init(){
  const user = requireAuth(); if(!user) return;
  const display = user.name || user.username || user.email || 'User'; const un = document.getElementById('user-name'); if(un) un.textContent = display;
  setupLogout();
  setupDeviceLocationButton();
  // Attach recommendation button handler
  const recBtnEl = document.getElementById('rec-btn');
  if(recBtnEl){ recBtnEl.addEventListener('click', requestRecommendations); }
  await fetchLatest();
  schedulePoll();
}

window.addEventListener('DOMContentLoaded', ()=>{ try{ init(); }catch(e){ console.error(e); } });
