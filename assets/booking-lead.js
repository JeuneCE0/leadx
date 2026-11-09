/**
 * LEADX — Lead Meta au moment où l'appel est réservé.
 *
 * Il n'y a plus d'optin : le contact ne laisse ses coordonnées que dans le
 * calendrier GHL, et c'est la réservation qui fait le lead. Le widget de
 * réservation (iframe api.leadconnectorhq.com) prévient la page par
 * postMessage :
 *   1. ["set-sticky-contacts", clé, JSON du contact, locationId, contactId]
 *      quand le formulaire de réservation est envoyé ;
 *   2. ["msgsndr-booking-complete", { fingerprint, calendarId }]
 *      quand le rendez-vous est confirmé.
 *
 * Au second message : Lead côté navigateur (pixel) et côté serveur (CAPI,
 * via /api/lead), avec le même event_id pour que Meta ne le compte qu'une
 * fois. Le widget redirige aussitôt vers la page de préparation : l'envoi
 * serveur part en `keepalive`, il survit au changement de page même quand le
 * pixel n'a pas le temps de partir.
 */
(function () {
  'use strict';

  var GHL_HOSTS = /(^|\.)(leadconnectorhq\.com|msgsndr\.com)$/;
  var contact = {};
  var ghlContactId = null;
  var sent = false;

  function fromGhl(origin) {
    try {
      return GHL_HOSTS.test(new URL(origin).hostname);
    } catch (e) {
      return false;
    }
  }

  function pick(source, keys) {
    for (var i = 0; i < keys.length; i++) {
      var value = source[keys[i]];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
  }

  // Les clés varient selon le formulaire du calendrier : on prend ce qui existe.
  function readContact(raw) {
    var data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return;
    }
    if (!data || typeof data !== 'object') return;
    var full = pick(data, ['full_name', 'fullName', 'name']) || '';
    var parts = full.split(/\s+/).filter(Boolean);
    contact = {
      firstName: pick(data, ['first_name', 'firstName']) || parts[0],
      lastName: pick(data, ['last_name', 'lastName']) || parts.slice(1).join(' ') || undefined,
      email: pick(data, ['email']),
      phone: pick(data, ['phone', 'phone_number', 'phoneNumber']),
    };
  }

  function sendLead() {
    var eventId = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'rdv-' + Date.now() + '-' + Math.round(Math.random() * 1e9);

    if (window.fbq) {
      fbq('track', 'Lead', { content_name: 'Appel stratégique réservé' }, { eventID: eventId });
    }

    try {
      fetch('/api/lead', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'booking',
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email,
          phone: contact.phone,
          ghlContactId: ghlContactId,
          eventId: eventId,
          eventSourceUrl: location.href,
        }),
      }).catch(function () {});
    } catch (e) {
      // Le Lead navigateur est parti ; l'envoi serveur est un complément.
    }
  }

  window.addEventListener('message', function (event) {
    if (!fromGhl(event.origin)) return;
    var data = event.data;
    if (!Array.isArray(data)) return;

    if (data[0] === 'set-sticky-contacts' && typeof data[2] === 'string' && data[2].charAt(0) === '{') {
      readContact(data[2]);
      if (typeof data[4] === 'string' && data[4]) ghlContactId = data[4];
      return;
    }

    if (data[0] === 'msgsndr-booking-complete' && !sent) {
      sent = true;
      sendLead();
    }
  });
})();
