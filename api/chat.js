// Vercel serverless function. Keys live in Vercel Environment Variables, never in the page.
// Models are discovered live from each provider, so retired model names don't break it.
const KEYS = { gemini: 'GEMINI_API_KEY', groq: 'GROQ_API_KEY', openrouter: 'OPENROUTER_API_KEY' };
const post = (url, headers, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const bad = async (r, m) => { throw { status: r.status, detail: (m ? m + ': ' : '') + (await r.text()).slice(0, 150) }; };

async function tryModels(models, call) {
  let last;
  for (const m of [...new Set(models)]) { try { const t = await call(m); if (t) return t; } catch (e) { last = e; } }
  throw last || { status: 0, detail: 'no usable model found' };
}

async function gemini(prompt) {
  const h = { 'x-goog-api-key': process.env.GEMINI_API_KEY };
  const base = 'https://generativelanguage.googleapis.com/v1beta/';
  const names = process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : [];
  const lr = await fetch(base + 'models?pageSize=200', { headers: h });
  if (!lr.ok) await bad(lr, 'list');
  const c = ((await lr.json()).models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini-[\d.]+-flash/.test(m.name) && !/image|tts|live|audio|embed|robotics|computer|thinking|latest/.test(m.name))
    .map(m => m.name.replace('models/', ''));
  const rank = n => (/lite/.test(n) ? 0 : 2) + (/preview|exp/.test(n) ? 1 : 0);
  c.sort((a, b) => rank(a) - rank(b) || b.localeCompare(a, undefined, { numeric: true }));
  return tryModels([...names, ...c.slice(0, 5)], async m => {
    const r = await post(`${base}models/${m}:generateContent`, h, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } });
    if (!r.ok) await bad(r, m);
    const d = await r.json();
    return d.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
  });
}

async function oai(url, key, models, prompt, json) {
  return tryModels(models, async m => {
    const body = { model: m, messages: [{ role: 'user', content: prompt }] };
    if (json) body.response_format = { type: 'json_object' };
    const r = await post(url, { Authorization: 'Bearer ' + key }, body);
    if (!r.ok) await bad(r, m);
    const d = await r.json();
    return d.choices?.[0]?.message?.content || '';
  });
}

async function groq(prompt) {
  const key = process.env.GROQ_API_KEY;
  const names = process.env.GROQ_MODEL ? [process.env.GROQ_MODEL] : [];
  const lr = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: 'Bearer ' + key } });
  if (!lr.ok) await bad(lr, 'list');
  const c = ((await lr.json()).data || []).map(m => m.id)
    .filter(id => !/whisper|guard|tts|orpheus|embed|safeguard|playai/.test(id));
  c.sort((a, b) => (/instant|8b|20b/.test(a) ? 0 : 1) - (/instant|8b|20b/.test(b) ? 0 : 1));
  return oai('https://api.groq.com/openai/v1/chat/completions', key, [...names, ...c.slice(0, 4)], prompt, true);
}

async function openrouter(prompt) {
  const key = process.env.OPENROUTER_API_KEY;
  const names = process.env.OPENROUTER_MODEL ? [process.env.OPENROUTER_MODEL] : [];
  let c = [];
  try {
    const lr = await fetch('https://openrouter.ai/api/v1/models');
    c = ((await lr.json()).data || []).filter(m => /:free$/.test(m.id) && !/image|vision|audio/.test(m.id)).map(m => m.id);
    c.sort((a, b) => (/deepseek/.test(a) ? 0 : 1) - (/deepseek/.test(b) ? 0 : 1));
  } catch (e) {}
  return oai('https://openrouter.ai/api/v1/chat/completions', key, [...names, ...c.slice(0, 5)], prompt, false);
}

const P = { gemini, groq, openrouter };

module.exports = async (req, res) => {
  if (req.method === 'GET') return res.status(200).json({ keys_detected: Object.fromEntries(Object.keys(KEYS).map(k => [k, !!process.env[KEYS[k]]])) });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const { prompt, provider } = req.body || {};
  if (!prompt || prompt.length > 12000) return res.status(400).json({ error: 'bad', message: 'Bad request' });
  const configured = Object.keys(P).filter(k => process.env[KEYS[k]]);
  const order = provider && provider !== 'auto' ? [provider].filter(k => configured.includes(k)) : configured;
  if (!order.length) return res.status(500).json({ error: 'nokey', message: 'No key found for ' + (provider || 'any provider') + '. Check the variable name and redeploy.' });
  let limited = false; const errs = [];
  for (const name of order) {
    try {
      const text = await P[name](prompt);
      if (text) return res.status(200).json({ text, provider: name });
    } catch (e) { if (e.status === 429) limited = true; errs.push(name + ' ' + (e.status || 'network') + ' ' + (e.detail || '')); }
  }
  res.status(limited ? 429 : 502).json({ error: limited ? 'rate' : 'fail', message: errs.join(' | ') || 'All providers failed' });
};
