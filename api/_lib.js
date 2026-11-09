// Outils partagés par les fonctions serverless (préfixe « _ » : Vercel n'en
// fait pas une route).
import crypto from 'node:crypto';

export const GHL_API = 'https://services.leadconnectorhq.com';
export const GHL_VERSION = '2021-07-28';
// Les routes calendrier de l'API v2 demandent leur propre version.
export const GHL_CALENDAR_VERSION = '2021-04-15';

// Pipeline « CRM LEADX » → stage d'entrée « 🆕 Nouveau Lead » (overridables via env).
const GHL_PIPELINE_ID = process.env.GHL_PIPELINE_ID || 'zzj4Cyt2lmNSXJ14JbKc';
const GHL_STAGE_ID = process.env.GHL_PIPELINE_STAGE_ID || '99eb31fc-1c10-4d6b-9713-13e023d3991a';

const META_GRAPH_VERSION = 'v21.0';
const DEFAULT_PIXEL_ID = '3530904023724600';

// Calendrier « Appel stratégique 100% OFFERT ».
export const CALENDAR_ID = process.env.GHL_CALENDAR_ID || 'tGNGhXDjtFX9Fee4nMGD';

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const text = (value, max) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;

export function ghlHeaders(version = GHL_VERSION) {
  return {
    Authorization: `Bearer ${process.env.GHL_API_KEY}`,
    Version: version,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

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

// Best-effort : un échec CAPI ne casse jamais l'appelant.
export async function sendCapiLead({ firstName, lastName, email, phone, externalId, eventId, eventSourceUrl, req }) {
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
    external_id: externalId ? [hashField(externalId)] : undefined,
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
// Best-effort. GHL renvoie 400 + meta.existingId si le contact a déjà une opportunité
// (réglage "no duplicate opportunity") → déjà dans la pipeline, on ne le déplace pas.
export async function createGhlOpportunity({ locationId, contactId, name }) {
  if (!contactId) return;
  try {
    const r = await fetch(`${GHL_API}/opportunities/`, {
      method: 'POST',
      headers: ghlHeaders(),
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

// Upsert : un prospect qui revient existe déjà dans GHL ; l'upsert fusionne
// au lieu d'échouer. Rend l'identifiant du contact, ou null.
export async function upsertGhlContact(fields) {
  const r = await fetch(`${GHL_API}/contacts/upsert`, {
    method: 'POST',
    headers: ghlHeaders(),
    body: JSON.stringify({ locationId: process.env.GHL_LOCATION_ID, ...fields }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('GHL upsert error', r.status, data);
    return null;
  }
  return data?.contact?.id || data?.contactId || data?.id || null;
}
