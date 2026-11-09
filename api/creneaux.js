// GET /api/creneaux?from=AAAA-MM-JJ&to=AAAA-MM-JJ&tz=Europe/Paris
// Créneaux libres du calendrier GHL « Appel stratégique », pour le calendrier
// maison de la page VSL. GHL applique lui-même durée, intervalle, tampon,
// délai de prévenance et nombre de rendez-vous par jour : on ne fait que
// relayer, sans rien recalculer.
import { CALENDAR_ID, GHL_API, GHL_CALENDAR_VERSION, ghlHeaders } from './_lib.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 62;
const DAY = 86_400_000;

function validTimezone(tz) {
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const { from, to } = req.query;
  const tz = typeof req.query.tz === 'string' && validTimezone(req.query.tz) ? req.query.tz : 'Indian/Reunion';

  if (!DATE.test(from || '') || !DATE.test(to || '') || from > to) {
    return res.status(400).json({ error: 'invalid_range' });
  }
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T23:59:59Z`);
  if ((end - start) / DAY > MAX_DAYS) return res.status(400).json({ error: 'range_too_long' });

  // Marge d'un jour de chaque côté : GHL range les créneaux par date locale
  // du fuseau demandé, on recoupe ensuite sur [from, to].
  const url = `${GHL_API}/calendars/${CALENDAR_ID}/free-slots?startDate=${start - DAY}&endDate=${end + DAY}&timezone=${encodeURIComponent(tz)}`;

  try {
    const r = await fetch(url, { headers: ghlHeaders(GHL_CALENDAR_VERSION) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('GHL free-slots error', r.status, data);
      return res.status(502).json({ error: 'unavailable' });
    }

    const days = {};
    for (const [date, value] of Object.entries(data)) {
      if (!DATE.test(date) || date < from || date > to) continue;
      const slots = Array.isArray(value?.slots) ? value.slots.filter((s) => typeof s === 'string') : [];
      if (slots.length) days[date] = slots;
    }

    // Court : un créneau pris doit disparaître vite pour les autres visiteurs.
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=30');
    return res.status(200).json({ timezone: tz, days });
  } catch (err) {
    console.error('GHL free-slots exception', err);
    return res.status(502).json({ error: 'unavailable' });
  }
}
