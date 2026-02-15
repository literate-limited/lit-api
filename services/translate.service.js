import OpenAI from 'openai';

let client = null;

function getClient() {
  if (client) return client;
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  client = new OpenAI({ apiKey: key });
  return client;
}

/**
 * Best-effort translation.
 * If OpenAI is not configured, returns { text: null }.
 */
export async function translateText({ text, from, to }) {
  const openai = getClient();
  if (!openai) return { text: null, provider: null };

  const src = from ? String(from).trim().toLowerCase() : 'auto';
  const dst = String(to).trim().toLowerCase();

  if (!dst) return { text: null, provider: null };

  const prompt =
    src === 'auto'
      ? `Translate the following text to ${dst}.`
      : `Translate the following text from ${src} to ${dst}.`;

  const resp = await openai.chat.completions.create({
    model: process.env.LIT_TRANSLATE_MODEL || 'gpt-4o-mini',
    temperature: 0,
    messages: [
      {
        role: 'system',
        content:
          'You are a translation engine. Output ONLY the translated text. No quotes, no explanations.'
      },
      { role: 'user', content: `${prompt}\n\nTEXT:\n${text}` }
    ]
  });

  const out = resp.choices?.[0]?.message?.content ?? '';
  const cleaned = String(out).trim();
  return { text: cleaned || null, provider: 'openai' };
}

