require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { readJsonSafe, writeJsonSafe, USERS_FILE, READINGS_FILE } = require('./utils');
const { generateToken, verifyTokenMiddleware } = require('./auth');
const { generatePlantRecommendations } = require('./ai');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'secret-dev';
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const OWM_KEY = process.env.OWM_API_KEY;

// Print ai provider and key presence at startup (do not print keys)
const START_AI_PROVIDER = 'gemini';
console.log(`Starting backend — AI_PROVIDER=${START_AI_PROVIDER}. GEMINI_KEY=${process.env.GEMINI_API_KEY ? 'yes' : 'no'}`);

// --- Signup ---
app.post('/api/signup', async (req, res) => {
  const { name, email, password } = req.body || {};
  if(!name || !email || !password) return res.status(400).json({ error: 'name,email,password required' });
  const users = await readJsonSafe(USERS_FILE);
  const exists = users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if(exists) return res.status(400).json({ error: 'User already exists' });
  const hash = await bcrypt.hash(password, 10);
  const user = { id: Date.now(), name, email: email.toLowerCase(), passwordHash: hash };
  users.push(user);
  await writeJsonSafe(USERS_FILE, users);
  console.log(`signup: created user ${email.toLowerCase()} id=${user.id}`);
  return res.json({ success: true });
});

// --- Login ---
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  if(!email || !password) return res.status(400).json({ error: 'email,password required' });
  const users = await readJsonSafe(USERS_FILE);
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if(!user){
    console.warn(`login: user not found for ${email.toLowerCase()}`);
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  try{
    const ok = await bcrypt.compare(password, user.passwordHash);
    if(!ok){
      console.warn(`login: invalid password for ${email.toLowerCase()}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
  }catch(err){
    console.error('login: bcrypt compare error', err && err.message);
    return res.status(500).json({ error: 'Login failed' });
  }
  const token = generateToken({ id: user.id, email: user.email, name: user.name });
  return res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

// --- Fetch weather ---
app.get('/api/weather', async (req, res) => {
  const lat = req.query.lat;
  const lon = req.query.lon;
  if(!lat || !lon) return res.status(400).json({ error: 'lat & lon required' });
  if(!OWM_KEY) return res.status(500).json({ error: 'OpenWeatherMap key not configured' });
  try{
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${OWM_KEY}`;
    const r = await axios.get(url);
    const j = r.data;
    const out = {
      temperature: j.main?.temp,
      humidity: j.main?.humidity,
      condition: j.weather && j.weather[0] && j.weather[0].main ? j.weather[0].main : j.weather && j.weather[0] && j.weather[0].description || '',
      city: j.name || ''
    };
    return res.json(out);
  }catch(e){
    console.error(e?.response?.data || e.message);
    return res.status(500).json({ error: 'Weather fetch failed' });
  }
});

// --- Fetch pollution and save reading ---
app.get('/api/pollution', async (req, res) => {
  const lat = req.query.lat;
  const lon = req.query.lon;
  if(!lat || !lon) return res.status(400).json({ error: 'lat & lon required' });
  if(!OWM_KEY) return res.status(500).json({ error: 'OpenWeatherMap key not configured' });
  try{
    const url = `http://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${OWM_KEY}`;
    const r = await axios.get(url);
    const j = r.data;
    // Example structure: list[0].main.aqi (1-5) and components
    const first = j.list && j.list[0] ? j.list[0] : null;
    const aqi = first && first.main && first.main.aqi ? first.main.aqi : null;
    const components = first && first.components ? first.components : {};
    const mainPollutant = Object.keys(components).sort((a,b)=>components[b]-components[a])[0] || '';

    // Fetch weather to include humidity and city
    const wUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${OWM_KEY}`;
    const wr = await axios.get(wUrl);
    const w = wr.data || {};

    // accept optional soil moisture from query (for devices that POST sensor data)
    const soilQuery = req.query.soil ?? req.query.soil_moisture ?? null;

    const reading = {
      timestamp: Date.now(),
      aqi: aqi,
      main_pollutant: mainPollutant,
      components,
      humidity: w.main?.humidity ?? null,
      // store soil moisture (if provided) as a numeric value
      soil_moisture: soilQuery !== null && soilQuery !== undefined ? (Number(soilQuery) || 0) : null,
      weather: w.weather && w.weather[0] && w.weather[0].main ? w.weather[0].main : '',
      city: w.name || '',
      raw: j
    };
    // If Authorization present, attempt to associate reading with authenticated user
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    if(authHeader){
      const parts = String(authHeader).split(' ');
      if(parts.length === 2 && parts[0].toLowerCase() === 'bearer'){
        const token = parts[1];
        try{
          const decoded = jwt.verify(token, JWT_SECRET);
          if(decoded && decoded.id) reading.userId = decoded.id;
        }catch(e){ /* ignore invalid token */ }
      }
    }

    const readings = await readJsonSafe(READINGS_FILE);
    readings.push(reading);
    // keep last 1000 for example
    while(readings.length > 2000) readings.shift();
    await writeJsonSafe(READINGS_FILE, readings);

    return res.json(reading);
  }catch(e){
    console.error(e?.response?.data || e.message);
    return res.status(500).json({ error: 'Pollution fetch failed' });
  }
});

// --- Latest reading ---
app.post('/api/reading', verifyTokenMiddleware, async (req, res) => {
  try{
    const { lat, lng, aqi, pm25, pm10, co, no2, o3, nh3, soil_moisture } = req.body || {};
    const readings = await readJsonSafe(READINGS_FILE);
    const now = new Date().toISOString();
    const userId = req.user && req.user.id;
    const reading = {
      id: Date.now(),
      timestamp: now,
      userId: userId || null,
      lat: lat || null,
      lng: lng || null,
      aqi: aqi || null,
      pm25: pm25 || null,
      pm10: pm10 || null,
      co: co || null,
      no2: no2 || null,
      o3: o3 || null,
      nh3: nh3 || null,
      soil_moisture: soil_moisture || null
    };
    readings.push(reading);
    await writeJsonSafe(READINGS_FILE, readings);
    return res.json({ ok: true, reading });
  }catch(e){
    console.error('reading post error', e && e.message);
    return res.status(500).json({ ok: false, error: e && e.message });
  }
});


// (testing endpoint removed)

// --- History ---
app.get('/api/history', async (req, res) => {
  const per = parseInt(req.query.per || '10', 10);
  const page = parseInt(req.query.page || '1', 10);
  const readings = await readJsonSafe(READINGS_FILE);
  // If Authorization provided, return history only for that user
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  let filtered = readings || [];
  if(authHeader){
    const parts = String(authHeader).split(' ');
    if(parts.length === 2 && parts[0].toLowerCase() === 'bearer'){
      const token = parts[1];
      try{
        const decoded = jwt.verify(token, JWT_SECRET);
        const userId = decoded && decoded.id;
        if(userId) filtered = filtered.filter(r=> r.userId && String(r.userId) === String(userId));
      }catch(e){ /* ignore invalid token */ }
    }
  }
  const items = filtered.slice(-per * page, filtered.length - per * (page - 1));
  // ensure returned as recent-first
  const out = (items || []).slice().reverse();
  return res.json({ data: out });
});

// --- AI plants recommendation ---
// simple rate limiter for AI endpoints: limit to 6 requests/minute per IP
const aiLimiter = rateLimit({ windowMs: 60 * 1000, max: 6, message: { error: 'Too many AI requests, slow down' } });

app.post('/api/ai-plants', verifyTokenMiddleware, aiLimiter, async (req, res) => {
  const body = req.body || {};
  // Accept either full payload or partial
  // Build payload defensively without mixing && and ?? operators ambiguously
  const payload = {};
  // try fields directly from body, otherwise from body.latest, otherwise from stored latest reading
  const readings = await readJsonSafe(READINGS_FILE);
  const userId = req.user && req.user.id;
  const userReadings = (readings || []).filter(r => r.userId && String(r.userId) === String(userId));
  const storedLatest = userReadings && userReadings.length ? userReadings[userReadings.length - 1] : null;
  payload.aqi = body.aqi ?? body.AQI ?? (body.latest && body.latest.aqi) ?? (storedLatest && storedLatest.aqi) ?? null;
  payload.humidity = body.humidity ?? (body.latest && body.latest.humidity) ?? (storedLatest && storedLatest.humidity) ?? null;
  payload.temp = body.temp ?? (body.latest && body.latest.temp) ?? null;
  payload.category = body.category ?? (body.latest && body.latest.category) ?? (storedLatest && storedLatest.category) ?? null;
  payload.city = body.city ?? (body.latest && body.latest.city) ?? (storedLatest && storedLatest.city) ?? null;
  payload.components = body.components ?? (body.latest && body.latest.components) ?? (storedLatest && storedLatest.components) ?? null;
  payload.main_pollutant = body.main_pollutant ?? (body.latest && body.latest.main_pollutant) ?? (storedLatest && storedLatest.main_pollutant) ?? null;
  payload.soil_moisture = body.soil_moisture ?? body.soil ?? (body.latest && body.latest.soil_moisture) ?? (storedLatest && storedLatest.soil_moisture) ?? null;
  // include coords if available
  payload.coords = (body.latest && body.latest.raw && body.latest.raw.coord) ?? (storedLatest && storedLatest.raw && storedLatest.raw.coord) ?? null;

  // Compute a numeric pollution_value (0-100) using AQI (1-5) if available, otherwise approximate from pm2.5
  function computePollutionValue(p){
    if(!p) return null;
    // Use OWM AQI scale (1-5) if present
    if(p.aqi !== null && p.aqi !== undefined){
      const aq = Number(p.aqi);
      if(!isNaN(aq)){
        // map 1->20, 2->40, 3->60, 4->80, 5->100
        return Math.min(100, Math.max(0, (aq - 1) * 25 + 20));
      }
    }
    // fallback: estimate from pm2.5 in components
    const comps = p.components || {};
    const pm25 = comps.pm2_5 ?? comps.pm25 ?? null;
    if(pm25 !== null && pm25 !== undefined){
      const n = Number(pm25);
      if(!isNaN(n)){
        // rough buckets
        if(n <= 12) return 10;
        if(n <= 35) return 40;
        if(n <= 55) return 70;
        return 90;
      }
    }
    return null;
  }

  payload.pollution_value = computePollutionValue({ aqi: payload.aqi, components: payload.components });
  try{
    const aiResp = await generatePlantRecommendations(payload, body.provider);
    if(aiResp && aiResp.ok){
      return res.json({ success: true, data: aiResp.result });
    }
    // AI produced a controlled failure; log details and return a friendly payload
    console.warn('AI responded with error:', aiResp.aiError, aiResp.message || '', aiResp.status || '', aiResp.details || '');
    return res.status(200).json({ success: false, aiError: aiResp.aiError || 'unknown', message: aiResp.message || 'AI unavailable', fallback: aiResp.fallback || null });
  }catch(e){
    console.error('AI error', e.message || e);
    return res.status(500).json({ error: 'AI recommendation failed', details: String(e.message || e) });
  }
});

// Recommend alias (same behavior as /api/ai-plants) - accept payload or use stored latest
app.post('/api/recommend', verifyTokenMiddleware, async (req, res) => {
  const body = req.body || {};
  const payload = {};
  const readings = await readJsonSafe(READINGS_FILE);
  const userId = req.user && req.user.id;
  const userReadings = (readings || []).filter(r => r.userId && String(r.userId) === String(userId));
  const storedLatest = userReadings && userReadings.length ? userReadings[userReadings.length - 1] : null;
  payload.aqi = body.aqi ?? body.AQI ?? (body.latest && body.latest.aqi) ?? (storedLatest && storedLatest.aqi) ?? null;
  payload.humidity = body.humidity ?? (body.latest && body.latest.humidity) ?? (storedLatest && storedLatest.humidity) ?? null;
  payload.temp = body.temp ?? (body.latest && body.latest.temp) ?? null;
  payload.category = body.category ?? (body.latest && body.latest.category) ?? (storedLatest && storedLatest.category) ?? null;
  payload.city = body.city ?? (body.latest && body.latest.city) ?? (storedLatest && storedLatest.city) ?? null;
  payload.components = body.components ?? (body.latest && body.latest.components) ?? (storedLatest && storedLatest.components) ?? null;
  payload.main_pollutant = body.main_pollutant ?? (body.latest && body.latest.main_pollutant) ?? (storedLatest && storedLatest.main_pollutant) ?? null;
  payload.soil_moisture = body.soil_moisture ?? body.soil ?? (body.latest && body.latest.soil_moisture) ?? (storedLatest && storedLatest.soil_moisture) ?? null;
  payload.coords = (body.latest && body.latest.raw && body.latest.raw.coord) ?? (storedLatest && storedLatest.raw && storedLatest.raw.coord) ?? null;
  function computePollutionValue(p){
    if(!p) return null;
    if(p.aqi !== null && p.aqi !== undefined){
      const aq = Number(p.aqi);
      if(!isNaN(aq)) return Math.min(100, Math.max(0, (aq - 1) * 25 + 20));
    }
    const comps = p.components || {};
    const pm25 = comps.pm2_5 ?? comps.pm25 ?? null;
    if(pm25 !== null && pm25 !== undefined){
      const n = Number(pm25);
      if(!isNaN(n)){
        if(n <= 12) return 10;
        if(n <= 35) return 40;
        if(n <= 55) return 70;
        return 90;
      }
    }
    return null;
  }
  payload.pollution_value = computePollutionValue({ aqi: payload.aqi, components: payload.components });
  try{
    const aiResp = await generatePlantRecommendations(payload, body.provider);
    if(aiResp && aiResp.ok){
      return res.json({ success: true, data: aiResp.result });
    }
    console.warn('AI responded with error:', aiResp.aiError, aiResp.message || '', aiResp.status || '', aiResp.details || '');
    return res.status(200).json({ success: false, aiError: aiResp.aiError || 'unknown', message: aiResp.message || 'AI unavailable', fallback: aiResp.fallback || null });
  }catch(e){
    console.error('AI error', e.message || e);
    return res.status(500).json({ error: 'AI recommendation failed', details: String(e.message || e) });
  }
});

app.listen(PORT, ()=>{
  console.log(`AURA GROW backend listening on port ${PORT}`);
});

// Serve frontend static files so visiting / returns frontend/index.html
try{
  const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
  app.use(express.static(FRONTEND_DIR));
  // For any unknown route (that isn't an API), serve index.html to support client-side nav
  app.get('*', (req, res) => {
    // If the request is for an API route, pass through
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
  });
}catch(e){
  console.warn('Could not mount frontend static files:', e.message);
}
