// Vercel serverless function. Keys live in Vercel Environment Variables, never in the page.
const P = {
  gemini: async (prompt) => {
    const m = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } })
    });
    if (!r.ok) throw { status: r.status };
    const d = await r.json();
    return d.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
  },
  groq: (prompt) => oai('https://api.groq.com/openai/v1/chat/completions', process.env.GROQ_API_KEY,
    process.env.GROQ_MODEL || 'llama-3.3-70b-versatile', prompt, true),
  openrouter: (prompt) => oai('https://openrouter.ai/api/v1/chat/completions', process.env.OPENROUTER_API_KEY,
    process.env.OPENROUTER_MODEL || 'openrouter/free', prompt, false)
};
const KEYS = { gemini: 'GEMINI_API_KEY', groq: 'GROQ_API_KEY', openrouter: 'OPENROUTER_API_KEY' };

async function oai(url, key, model, prompt, json) {
  const body = { model, messages: [{ role: 'user', content: prompt }] };
  if (json) body.response_format = { type: 'json_object' };
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(body) });
  if (!r.ok) throw { status: r.status };
  const d = await r.json();
  return d.choices?.[0]?.message?.content || '';
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const { prompt, provider } = req.body || {};
  if (!prompt || prompt.length > 12000) return res.status(400).json({ error: 'bad', message: 'Bad request' });
  const configured = Object.keys(P).filter(k => process.env[KEYS[k]]);
  const order = provider && provider !== 'auto' ? [provider].filter(k => configured.includes(k)) : configured;
  if (!order.length) return res.status(500).json({ error: 'nokey', message: 'No API key set for that provider' });
  let limited = false;
  for (const name of order) {
    try {
      const text = await P[name](prompt);
      if (text) return res.status(200).json({ text, provider: name });
    } catch (e) { if (e.status === 429) limited = true; }
  }
  res.status(limited ? 429 : 502).json({ error: limited ? 'rate' : 'fail', message: 'All providers failed' });
};
