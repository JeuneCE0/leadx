// Vercel serverless function — POST /api/lead
// Deux entrées :
//   - kind "booking" (assets/booking-lead.js) : l'appel vient d'être réservé
//     dans le widget GHL (booking.html, ou secours de la page VSL quand le
//     calendrier maison ne répond pas). C'est désormais LE lead : Lead CAPI,
//     contact rangé dans la pipeline. Toujours 200 — le rendez-vous existe déjà
//     dans GHL, ce suivi ne doit jamais faire échouer quoi que ce soit.
//   - par défaut (formulaires d'optin restants, ex. variants/) : upsert du
//     contact dans GHL, opportunité, Lead CAPI.
// Env vars (set in Vercel dashboard):
//   GHL_API_KEY          — Private Integration Token (pit-...)
//   GHL_LOCATION_ID      — sub-account location id
//   GHL_PIPELINE_ID      — pipeline id (défaut: CRM LEADX)
//   GHL_PIPELINE_STAGE_ID — stage d'entrée (défaut: 🆕 Nouveau Lead)
//   META_CAPI_TOKEN      — Conversions API access token (server-only)
//   META_PIXEL_ID        — pixel id (défaut: 3530904023724600)

import {
  EMAIL_REGEX,
  createGhlOpportunity,
  sendCapiLead,
  text,
  upsertGhlContact,
} from './_lib.js';

// Appel réservé : le contact et le rendez-vous existent déjà dans GHL (c'est le
// calendrier qui les crée). On le range dans la pipeline comme le faisait
// l'optin, puis on envoie le Lead à Meta. Chaque étape est best-effort.
async function handleBooking({ apiKey, locationId, firstName, lastName, email, phone, ghlContactId, eventId, eventSourceUrl, req }) {
  const contact = {
    firstName: text(firstName, 80),
    lastName: text(lastName, 80),
    email: text(email, 120) && EMAIL_REGEX.test(email.trim()) ? email.trim().toLowerCase() : undefined,
    phone: text(phone, 40),
  };
  let contactId = text(ghlContactId, 64);
  const ghlReady = Boolean(apiKey && locationId);

  if (ghlReady && (contact.email || contact.phone)) {
    // « Nouveau Lead » seul : le tag « whatsapp » était propre à l'optin.
    try {
      contactId = (await upsertGhlContact({ ...contact, source: 'vsl-rdv', tags: ['Nouveau Lead'] })) || contactId;
    } catch (err) {
      console.error('GHL booking upsert exception', err);
    }
  }

  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ');
  if (ghlReady) await createGhlOpportunity({ locationId, contactId, name: name || undefined });

  await sendCapiLead({ ...contact, externalId: contactId, eventId, eventSourceUrl, req });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;

  if ((!apiKey || !locationId) && req.body?.kind !== 'booking') {
    return res.status(500).json({ error: 'Server not configured' });
  }

  const { firstName, lastName, email, phone, source, tags, eventId, eventSourceUrl, kind, ghlContactId } = req.body || {};

  if (kind === 'booking') {
    await handleBooking({
      apiKey,
      locationId,
      firstName,
      lastName,
      email,
      phone,
      ghlContactId,
      eventId,
      eventSourceUrl,
      req,
    });
    return res.status(200).json({ ok: true });
  }

  if (!firstName || !lastName || !email) {
    return res.status(400).json({ error: 'firstName, lastName and email required' });
  }

  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  try {
    const contactId = await upsertGhlContact({
      firstName: String(firstName).slice(0, 80),
      lastName: String(lastName).slice(0, 80),
      email: String(email).toLowerCase().slice(0, 120),
      phone: phone ? String(phone).slice(0, 40) : undefined,
      source: source || 'optin-landing',
      tags: Array.isArray(tags) && tags.length ? tags : ['Nouveau Lead'],
    });
    if (!contactId) return res.status(502).json({ error: 'Upstream error' });

    await createGhlOpportunity({ locationId, contactId, name: `${firstName} ${lastName}`.trim() });

    await sendCapiLead({ firstName, lastName, email, phone, eventId, eventSourceUrl, req });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('lead.js exception', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
