// Vercel serverless function — POST /api/lead
// Upserts a contact in GoHighLevel for the LEADX optin/LP forms,
// then sends a server-side Meta Conversions API (CAPI) Lead event.
// Env vars (set in Vercel dashboard):
//   GHL_API_KEY          — Private Integration Token (pit-...)
//   GHL_LOCATION_ID      — sub-account location id
//   GHL_PIPELINE_ID      — pipeline id (défaut: CRM LEADX)
//   GHL_PIPELINE_STAGE_ID — stage d'entrée (défaut: 🆕 Nouveau Lead)
//   META_CAPI_TOKEN      — Conversions API access token (server-only)
//   META_PIXEL_ID        — pixel id (défaut: 3530904023724600)

import crypto from 'node:crypto';

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

// Pipeline « CRM LEADX » → stage d'entrée « 🆕 Nouveau Lead » (overridables via env).
const GHL_PIPELINE_ID = process.env.GHL_PIPELINE_ID || 'zzj4Cyt2lmNSXJ14JbKc';
const GHL_STAGE_ID = process.env.GHL_PIPELINE_STAGE_ID || '99eb31fc-1c10-4d6b-9713-13e023d3991a';

const META_GRAPH_VERSION = 'v21.0';
const DEFAULT_PIXEL_ID = '3530904023724600';

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

// Normalisation Meta : trim + lowercase, téléphone en chiffres seuls.
function hashField(value, { phone = false } = {}) {
  if (!value) return undefined;
  let v = String(value).trim().toLowerCase();
  if (phone) v = v.replace(/\D/g, '');
  if (!v) return undefined;
  return sha256(v);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Best-effort : un échec CAPI ne doit jamais casser l'optin.
async function sendCapiLead({ firstName, lastName, email, phone, eventId, eventSourceUrl, req }) {
  const token = process.env.META_CAPI_TOKEN;
  if (!token) return;
  const pixelId = process.env.META_PIXEL_ID || DEFAULT_PIXEL_ID;

  const cookies = parseCookies(req.headers.cookie);
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || undefined;

  const userData = {
    em: email ? [hashField(email)] : undefined,
    ph: phone ? [hashField(phone, { phone: true })] : undefined,
    fn: firstName ? [hashField(firstName)] : undefined,
    ln: lastName ? [hashField(lastName)] : undefined,
    client_ip_address: ip,
    client_user_agent: req.headers['user-agent'] || undefined,
    fbp: cookies._fbp || undefined,
    fbc: cookies._fbc || undefined,
  };

  const payload = {
    data: [{
      event_name: 'Lead',
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'website',
      event_id: eventId || undefined,
      event_source_url: eventSourceUrl || undefined,
      user_data: userData,
    }],
  };

  try {
    const r = await fetch(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(token)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
    );
    if (!r.ok) {
      const detail = await r.json().catch(() => ({}));
      console.error('CAPI Lead error', r.status, detail);
    }
  } catch (err) {
    console.error('CAPI Lead exception', err);
  }
}

// Crée l'opportunité dans la pipeline : un contact seul n'apparaît PAS dans la pipeline GHL.
// Best-effort : ne casse jamais l'optin. GHL renvoie 400 + meta.existingId si le contact a déjà
// une opportunité (réglage "no duplicate opportunity") → déjà dans la pipeline, on ne le déplace pas.
async function createGhlOpportunity({ apiKey, locationId, contactId, name }) {
  if (!contactId) return;
  try {
    const r = await fetch(`${GHL_API}/opportunities/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Version: GHL_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pipelineId: GHL_PIPELINE_ID,
        pipelineStageId: GHL_STAGE_ID,
        locationId,
        contactId,
        name: name || 'Nouveau lead LEADX',
        status: 'open',
        monetaryValue: 0,
      }),
    });
    if (!r.ok) {
      const detail = await r.json().catch(() => ({}));
      if (r.status === 400 && detail?.meta?.existingId) return;
      console.error('GHL opportunity error', r.status, detail);
    }
  } catch (err) {
    console.error('GHL opportunity exception', err);
  }
}

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

  const { firstName, lastName, email, phone, source, tags, eventId, eventSourceUrl } = req.body || {};

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

    const contactId = data?.contact?.id || data?.contactId || data?.id;
    await createGhlOpportunity({
      apiKey,
      locationId,
      contactId,
      name: `${firstName} ${lastName}`.trim(),
    });

    await sendCapiLead({ firstName, lastName, email, phone, eventId, eventSourceUrl, req });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('lead.js exception', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
