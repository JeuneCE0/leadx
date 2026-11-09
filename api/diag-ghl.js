// TEMPORAIRE (branche seulement) : vérifie ce que la clé GHL autorise.
// Aucune écriture : la création de rendez-vous est sondée avec un corps
// invalide, qui distingue « droit manquant » (401) de « données refusées » (4xx).
const GHL = 'https://services.leadconnectorhq.com';
const CAL = 'tGNGhXDjtFX9Fee4nMGD';

export default async function handler(req, res) {
  const headers = { Authorization: `Bearer ${process.env.GHL_API_KEY}`, Version: '2021-04-15', Accept: 'application/json' };
  const out = {};
  const call = async (name, url, init = {}) => {
    try {
      const r = await fetch(url, { ...init, headers: { ...headers, ...(init.headers || {}) } });
      const text = await r.text();
      out[name] = { status: r.status, body: text.slice(0, 1500) };
    } catch (e) { out[name] = { error: String(e) }; }
  };
  const now = Date.now();
  await call('calendar', `${GHL}/calendars/${CAL}`);
  await call('freeSlots', `${GHL}/calendars/${CAL}/free-slots?startDate=${now}&endDate=${now + 30 * 864e5}&timezone=Indian/Reunion`);
  await call('createAppointmentInvalide', `${GHL}/calendars/events/appointments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ calendarId: CAL }),
  });
  await call('customFields', `${GHL}/locations/${process.env.GHL_LOCATION_ID}/customFields`, { headers: { Version: '2021-07-28' } });
  res.status(200).json(out);
}
