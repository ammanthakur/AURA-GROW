const axios = require('axios');

// Gemini-only implementation
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if(!GEMINI_API_KEY) console.warn('GEMINI_API_KEY not set - AI features will not work');
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'text-bison-001';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta2/models/${GEMINI_MODEL}:generateText`;

const LOCAL_FALLBACK = {
  total_plants: 2,
  plants: [
    { name: 'Spider Plant', type: 'indoor', why: 'Tolerant and filters light pollutants', how_many: 1, placement: 'indoor', care: ['moderate light','keep soil slightly moist'], confidence: 0.6 }
  ],
  notes: 'Using local fallback due to AI unavailability.'
};

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object') return 'payload missing or not an object';
  if (payload.pollution_value == null && payload.aqi == null) return 'missing pollution_value or aqi';
  return null;
}

async function callAiForPlantRecommendation(payload) {
  const v = validatePayload(payload);
  if (v) return { ok: false, aiError: 'invalid_payload', message: v, fallback: LOCAL_FALLBACK };
  if (!GEMINI_API_KEY) return { ok: false, aiError: 'no_api_key', message: 'GEMINI_API_KEY not configured', fallback: LOCAL_FALLBACK };

  const promptUser = `ENVIRONMENT: ${JSON.stringify(payload)}\n\nReturn ONLY valid JSON with: { "total_plants": int, "plants": [ { "name","type","why","how_many","placement","care?","confidence" } ], "notes?" }. No extra text.`;

  try{
    const gemBody = {
      prompt: { text: promptUser },
      temperature: 0.5,
      maxOutputTokens: 600
    };
    const resp = await axios.post(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, gemBody, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 20000
    });
    const gdata = resp.data || {};
    const contentCandidate = (gdata && gdata.candidates && gdata.candidates[0] && (gdata.candidates[0].content || gdata.candidates[0].output)) || gdata['result'] || null;
    const text = typeof contentCandidate === 'string' ? contentCandidate : (contentCandidate && contentCandidate.text) || JSON.stringify(contentCandidate || {});
    if(!text) return { ok: false, aiError: 'no_content', message: 'No textual content in Gemini response', details: gdata, fallback: LOCAL_FALLBACK };
    try{
      const parsed = JSON.parse(text);
      return { ok: true, result: parsed };
    }catch(pe){
      const m = String(text).match(/(\{[\s\S]*\})/m);
      if(m && m[0]){
        try{ return { ok: true, result: JSON.parse(m[0]) }; }catch(_){}
      }
      return { ok: false, aiError: 'parse_failed', message: 'Could not parse JSON from Gemini response', raw: text, details: gdata, fallback: LOCAL_FALLBACK };
    }
  }catch(e){
    const status = e?.response?.status || null;
    const respData = e?.response?.data || e.message || 'no response data';
    console.error('Gemini AI request failed. status=', status, 'body=', JSON.stringify(respData));
    const aiError = status === 400 ? 'bad_request' : (status === 401 ? 'auth_error' : 'request_failed');
    return { ok: false, aiError, message: 'AI request failed', status, details: respData, fallback: LOCAL_FALLBACK };
  }
}

module.exports = { generatePlantRecommendations: callAiForPlantRecommendation, callAiForPlantRecommendation };
