// Vercel serverless function — POST /api/lead
// Creates a contact in GoHighLevel for the LEADX optin form.
// Env vars (set in Vercel dashboard):
//   GHL_API_KEY      — Private Integration Token (pit-...)
//   GHL_LOCATION_ID  — sub-account location id

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;

  if (!apiKey || !locationId) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  const { firstName, lastName, email, phone, source, tags } = req.body || {};

  if (!firstName || !lastName || !email) {
    return res.status(400).json({ error: 'firstName, lastName and email required' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  try {
    // Upsert (not plain create): a returning prospect already exists in GHL, and
    // POST /contacts/ would 400 without applying the tags. Upsert merges tags onto
    // the existing contact, so 'whatsapp' lands on the prospect either way.
    const ghlRes = await fetch(`${GHL_API}/contacts/upsert`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Version: GHL_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        locationId,
        firstName: String(firstName).slice(0, 80),
        lastName: String(lastName).slice(0, 80),
        email: String(email).toLowerCase().slice(0, 120),
        phone: phone ? String(phone).slice(0, 40) : undefined,
        source: source || 'optin-landing',
        tags: Array.isArray(tags) && tags.length ? tags : ['Nouveau Lead'],
      }),
    });

    const data = await ghlRes.json().catch(() => ({}));

    if (!ghlRes.ok) {
      console.error('GHL error', ghlRes.status, data);
      return res.status(502).json({ error: 'Upstream error' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('lead.js exception', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
