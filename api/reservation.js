// POST /api/reservation — réserve un appel dans le calendrier GHL depuis le
// calendrier maison de la page VSL.
//
// 1. Contact créé ou mis à jour dans GHL, avec les réponses du formulaire de
//    qualification dans les mêmes champs personnalisés que le formulaire GHL
//    du calendrier (fI8wxS46R2p7rr3LfYLu) : la fiche est identique, quel que
//    soit le chemin de réservation.
// 2. Rendez-vous créé dans le calendrier, au nom de Dayyaan, avec la visio
//    Google Meet du calendrier ; GHL revérifie que le créneau est libre.
// 3. Opportunité dans la pipeline, puis Lead à Meta (CAPI), avec l'event_id
//    du pixel déclenché par la page : Meta ne le compte qu'une fois.
import {
  CALENDAR_ID,
  EMAIL_REGEX,
  GHL_API,
  GHL_CALENDAR_VERSION,
  createGhlOpportunity,
  ghlHeaders,
  sendCapiLead,
  text,
  upsertGhlContact,
} from './_lib.js';

// Dayyaan, seul membre du calendrier (round robin à une personne).
const ASSIGNED_USER_ID = process.env.GHL_CALENDAR_USER_ID || 'AOHBmll46CCgylNrdfTz';
const DURATION_MIN = 45;

// Questions du formulaire GHL : id du champ personnalisé, réponses admises au
// caractère près (GHL n'accepte que ses propres libellés).
export const QUESTIONS = {
  activity: {
    id: 'PxhTe1fp7yQar2ckYmX6',
    multiple: false,
    options: [
      'Entreprise de services (artisan, BTP, esthétique, coaching, habitat, conseil, nettoyage, sport…)',
      'Commerce / vente de produits / e-commerce',
      "Je n'ai pas d'entreprise ou de projet d'entreprise",
    ],
  },
  revenue: {
    id: 'JDJjQUq1HBzlRjKtkEwC',
    // Champ « choix multiples » dans GHL, une seule réponse côté page.
    multiple: true,
    options: ['Moins de 100k€', '100k à 500k€', '500k à 1M€', '+1M€'],
  },
  budget: {
    id: '8huU9Qeo8aYai91W84OB',
    multiple: false,
    options: ['500€ à 1 000€ / mois', '1 000€ à 2000€ / mois', 'Plus de 2 000€ / mois'],
  },
  situation: {
    id: 'SztjklKpfIxlPbbWjeGN',
    multiple: true,
    options: [
      'Je dépends surtout du bouche-à-oreille',
      'Je poste sur les réseaux mais ça ramène peu de clients',
      "J'ai déjà essayé de la publicité Meta sans vrais résultats",
      'Mon acquisition / publicité fonctionne, mais je veux l’améliorer',
      "Je n’ai pas encore de système d'acquisition et je veux en mettre un en place",
    ],
  },
  goal: {
    id: 'hp4PULbgbhSNN35wjZLH',
    multiple: true,
    options: [
      'Générer un flux de prospects régulier chaque semaine',
      'Stabiliser mes ventes et mes revenus',
      'Augmenter mon chiffre d’affaires',
      'Améliorer mon image et ma visibilité',
    ],
  },
};

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function answers(body) {
  const customFields = [];
  for (const [key, question] of Object.entries(QUESTIONS)) {
    const raw = body[key];
    const values = (Array.isArray(raw) ? raw : [raw]).filter((v) => typeof v === 'string' && question.options.includes(v));
    if (values.length === 0) return { error: `missing_${key}` };
    customFields.push({ id: question.id, field_value: question.multiple ? values : values[0] });
  }
  return { customFields };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!process.env.GHL_API_KEY || !process.env.GHL_LOCATION_ID) {
    return res.status(500).json({ error: 'not_configured' });
  }

  const body = req.body || {};

  // Champ piège invisible : un robot le remplit, un humain non.
  if (text(body.website, 200)) return res.status(200).json({ ok: true });

  const contact = {
    firstName: text(body.firstName, 80),
    lastName: text(body.lastName, 80),
    email: text(body.email, 120)?.toLowerCase(),
    phone: text(body.phone, 40),
    companyName: text(body.company, 120),
  };
  if (!contact.firstName || !contact.lastName || !contact.companyName) {
    return res.status(400).json({ error: 'missing_identity' });
  }
  if (!contact.email || !EMAIL_REGEX.test(contact.email)) return res.status(400).json({ error: 'invalid_email' });
  if (!contact.phone || contact.phone.replace(/\D/g, '').length < 6) return res.status(400).json({ error: 'invalid_phone' });

  const start = text(body.start, 40);
  const startMs = start && ISO_WITH_OFFSET.test(start) ? Date.parse(start) : NaN;
  if (!Number.isFinite(startMs) || startMs < Date.now()) return res.status(400).json({ error: 'invalid_slot' });

  const { customFields, error } = answers(body);
  if (error) return res.status(400).json({ error });

  let contactId;
  try {
    contactId = await upsertGhlContact({
      ...contact,
      source: 'vsl-rdv',
      tags: ['Nouveau Lead'],
      customFields,
    });
  } catch (err) {
    console.error('reservation upsert exception', err);
  }
  if (!contactId) return res.status(502).json({ error: 'crm_unavailable' });

  const name = `${contact.firstName} ${contact.lastName}`;
  let appointment;
  try {
    const r = await fetch(`${GHL_API}/calendars/events/appointments`, {
      method: 'POST',
      headers: ghlHeaders(GHL_CALENDAR_VERSION),
      body: JSON.stringify({
        calendarId: CALENDAR_ID,
        locationId: process.env.GHL_LOCATION_ID,
        contactId,
        assignedUserId: ASSIGNED_USER_ID,
        startTime: new Date(startMs).toISOString(),
        endTime: new Date(startMs + DURATION_MIN * 60_000).toISOString(),
        title: `${name} - ${contact.companyName}`,
        appointmentStatus: 'confirmed',
        // Lieu par défaut du calendrier : la visio Google Meet.
        meetingLocationId: 'default',
        toNotify: true,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('GHL appointment error', r.status, data);
      const message = String(data?.message || '').toLowerCase();
      // GHL refuse un créneau qui vient d'être pris ou qui n'est plus ouvert ;
      // toute autre erreur est la nôtre ou la sienne, pas celle du visiteur.
      if (r.status === 409 || /slot|no longer available|not available|already booked/.test(message)) {
        return res.status(409).json({ error: 'slot_taken' });
      }
      return res.status(502).json({ error: 'calendar_unavailable' });
    }
    appointment = data;
  } catch (err) {
    console.error('GHL appointment exception', err);
    return res.status(502).json({ error: 'calendar_unavailable' });
  }

  await createGhlOpportunity({ locationId: process.env.GHL_LOCATION_ID, contactId, name });
  await sendCapiLead({
    ...contact,
    externalId: contactId,
    eventId: text(body.eventId, 80),
    eventSourceUrl: text(body.eventSourceUrl, 500),
    req,
  });

  return res.status(200).json({
    ok: true,
    appointmentId: appointment?.id || null,
    start: new Date(startMs).toISOString(),
    end: new Date(startMs + DURATION_MIN * 60_000).toISOString(),
  });
}
