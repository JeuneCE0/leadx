/**
 * LEADX — calendrier de réservation maison, relié au calendrier GHL.
 *
 * Les créneaux viennent de /api/creneaux (relais des créneaux libres GHL),
 * la réservation part sur /api/reservation (contact + rendez-vous GHL +
 * Lead CAPI). Le Lead navigateur part ici, au succès, avec le même event_id.
 *
 * Si l'API ne répond pas, le widget GHL d'origine prend la place : une
 * réservation ne doit jamais se perdre parce que notre couche a un souci.
 */
(function () {
  'use strict';

  var root = document.getElementById('booking-app');
  if (!root) return;

  var GHL_WIDGET = 'https://api.leadconnectorhq.com/widget/booking/tGNGhXDjtFX9Fee4nMGD';
  var RANGE_DAYS = 56;
  var DURATION_MIN = 45;

  // Libellés exacts du formulaire GHL : ce sont les valeurs enregistrées.
  var QUESTIONS = [
    { key: 'activity', title: 'Votre activité', multiple: false, options: [
      'Entreprise de services (artisan, BTP, esthétique, coaching, habitat, conseil, nettoyage, sport…)',
      'Commerce / vente de produits / e-commerce',
      "Je n'ai pas d'entreprise ou de projet d'entreprise",
    ] },
    { key: 'revenue', title: "Chiffre d'affaires annuel actuel", multiple: false, compact: true, options: [
      'Moins de 100k€', '100k à 500k€', '500k à 1M€', '+1M€',
    ] },
    { key: 'budget', title: 'Budget mensuel pour votre acquisition (publicité et accompagnement)', multiple: false, compact: true, options: [
      '500€ à 1 000€ / mois', '1 000€ à 2000€ / mois', 'Plus de 2 000€ / mois',
    ] },
    { key: 'situation', title: "Où en êtes-vous aujourd'hui dans votre acquisition de clients ?", multiple: true, options: [
      'Je dépends surtout du bouche-à-oreille',
      'Je poste sur les réseaux mais ça ramène peu de clients',
      "J'ai déjà essayé de la publicité Meta sans vrais résultats",
      'Mon acquisition / publicité fonctionne, mais je veux l’améliorer',
      "Je n’ai pas encore de système d'acquisition et je veux en mettre un en place",
    ] },
    { key: 'goal', title: 'Votre objectif principal pour les 3 prochains mois', multiple: true, options: [
      'Générer un flux de prospects régulier chaque semaine',
      'Stabiliser mes ventes et mes revenus',
      'Augmenter mon chiffre d’affaires',
      'Améliorer mon image et ma visibilité',
    ] },
  ];

  var ZONES = [
    { tz: 'Indian/Reunion', label: 'La Réunion' },
    { tz: 'Europe/Paris', label: 'France métropolitaine' },
    { tz: 'Europe/Brussels', label: 'Belgique' },
    { tz: 'Indian/Mauritius', label: 'Maurice' },
  ];

  var state = {
    tz: detectZone(),
    days: {},
    month: null,
    day: null,
    slot: null,
    step: 'slot',
    loading: true,
    error: null,
    submitting: false,
    formError: null,
    missing: [],
    form: {},
    booked: null,
  };

  // ── Dates (chaînes AAAA-MM-JJ, calculées en UTC pour éviter l'heure d'été) ──
  function detectZone() {
    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) {
        new Intl.DateTimeFormat('fr-FR', { timeZone: tz });
        return tz;
      }
    } catch (e) { /* fuseau inconnu */ }
    return 'Indian/Reunion';
  }
  function todayIn(tz) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
  function addDays(date, n) {
    var d = new Date(date + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function monthOf(date) { return date.slice(0, 7); }
  function shiftMonth(month, n) {
    var d = new Date(month + '-01T12:00:00Z');
    d.setUTCMonth(d.getUTCMonth() + n);
    return d.toISOString().slice(0, 7);
  }
  function monthLabel(month) {
    var s = new Date(month + '-01T12:00:00Z').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function dayLabel(date) {
    var s = new Date(date + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function timeLabel(iso, tz) {
    return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz });
  }
  function zoneLabel(tz) {
    for (var i = 0; i < ZONES.length; i++) if (ZONES[i].tz === tz) return ZONES[i].label;
    return tz.replace(/_/g, ' ').split('/').pop();
  }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── Données ──
  function load() {
    state.loading = true;
    state.error = null;
    render();
    var from = todayIn(state.tz);
    var to = addDays(from, RANGE_DAYS);
    fetch('/api/creneaux?from=' + from + '&to=' + to + '&tz=' + encodeURIComponent(state.tz))
      .then(function (r) { if (!r.ok) throw new Error('slots ' + r.status); return r.json(); })
      .then(function (data) {
        state.days = data.days || {};
        state.loading = false;
        var first = Object.keys(state.days).sort()[0] || null;
        // On garde le jour choisi s'il est toujours ouvert, sinon le premier jour libre.
        if (!state.day || !state.days[state.day]) state.day = first;
        if (state.slot && (!state.days[state.day] || state.days[state.day].indexOf(state.slot) === -1)) state.slot = null;
        state.month = monthOf(state.day || from);
        render();
      })
      .catch(function () {
        state.loading = false;
        state.error = 'slots';
        render();
      });
  }

  function submit(form) {
    var data = new FormData(form);
    var payload = {
      start: state.slot,
      timezone: state.tz,
      firstName: data.get('firstName'),
      lastName: data.get('lastName'),
      email: data.get('email'),
      phone: data.get('phone'),
      company: data.get('company'),
      website: data.get('website'),
      eventSourceUrl: location.href,
    };
    QUESTIONS.forEach(function (q) {
      payload[q.key] = q.multiple ? data.getAll(q.key) : data.get(q.key);
    });
    state.form = payload;

    var missing = QUESTIONS.filter(function (q) {
      var v = payload[q.key];
      return q.multiple ? !v || v.length === 0 : !v;
    });
    state.missing = missing.map(function (q) { return q.key; });
    if (missing.length) {
      state.formError = missing.length === 1
        ? 'Il reste une question sans réponse, signalée en rouge.'
        : 'Il reste ' + missing.length + ' questions sans réponse, signalées en rouge.';
      render();
      var firstMissing = root.querySelector('.bk__question.is-missing');
      if (firstMissing) firstMissing.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    payload.eventId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'rdv-' + Date.now() + '-' + Math.round(Math.random() * 1e9);
    state.submitting = true;
    state.formError = null;
    render();

    fetch('/api/reservation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (body) { return { status: r.status, body: body }; }); })
      .then(function (res) {
        state.submitting = false;
        if (res.status === 200 && res.body.ok) {
          if (window.fbq) {
            fbq('track', 'Lead', { content_name: 'Appel stratégique réservé' }, { eventID: payload.eventId });
          }
          state.booked = { start: state.slot, name: payload.firstName };
          state.step = 'done';
          render();
          root.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }
        if (res.status === 409) {
          state.step = 'slot';
          state.slot = null;
          state.notice = "Ce créneau vient d'être réservé par quelqu'un d'autre. Choisissez-en un autre, vos réponses sont gardées.";
          load();
          return;
        }
        state.formError = res.body.error === 'invalid_email' ? 'Cette adresse e-mail ne semble pas valide.'
          : res.body.error === 'invalid_phone' ? 'Ce numéro de téléphone ne semble pas valide.'
          : 'La réservation n\'a pas abouti. Réessayez dans un instant, ou écrivez-nous à contact@lead-x.fr.';
        render();
      })
      .catch(function () {
        state.submitting = false;
        state.formError = 'Connexion interrompue. Vérifiez votre réseau puis réessayez.';
        render();
      });
  }

  // ── Rendu ──
  function header() {
    return '<div class="bk__head">' +
      '<img class="bk__avatar" src="assets/dayyaan.webp" alt="" width="40" height="40">' +
      '<div><p class="bk__title">Appel stratégique avec Dayyaan</p>' +
      '<p class="bk__meta">45 min · Visio Google Meet · Offert</p></div>' +
      '</div>';
  }

  function stepper() {
    var steps = [['slot', 'Créneau'], ['form', 'Vos informations']];
    return '<ol class="bk__steps">' + steps.map(function (s, i) {
      var cls = state.step === s[0] ? ' is-current' : (state.step === 'form' && i === 0 ? ' is-done' : '');
      return '<li class="bk__step' + cls + '"><span>' + (i + 1) + '</span>' + s[1] + '</li>';
    }).join('') + '</ol>';
  }

  function renderSlot() {
    if (state.loading) return '<div class="bk__status">Chargement des créneaux disponibles…</div>';
    if (state.error === 'slots') {
      return '<div class="bk__status">Le calendrier ne répond pas pour le moment.' +
        '<button type="button" class="bk__link" data-action="fallback">Ouvrir le calendrier de réservation</button></div>';
    }
    var available = Object.keys(state.days).sort();
    if (!available.length) {
      return '<div class="bk__status">Aucun créneau n\'est ouvert pour le moment. Écrivez-nous à ' +
        '<a href="mailto:contact@lead-x.fr">contact@lead-x.fr</a>, nous vous proposons un horaire.</div>';
    }

    var today = todayIn(state.tz);
    var month = state.month;
    var firstMonth = monthOf(today);
    var lastMonth = monthOf(available[available.length - 1]);
    var first = new Date(month + '-01T12:00:00Z');
    var offset = (first.getUTCDay() + 6) % 7; // lundi = 0
    var daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();

    var cells = '';
    for (var i = 0; i < offset; i++) cells += '<span class="bk__cell"></span>';
    for (var d = 1; d <= daysInMonth; d++) {
      var date = month + '-' + (d < 10 ? '0' + d : d);
      var open = !!state.days[date];
      var cls = 'bk__day' + (open ? ' is-open' : '') + (date === state.day ? ' is-selected' : '') + (date === today ? ' is-today' : '');
      cells += open
        ? '<button type="button" class="' + cls + '" data-day="' + date + '" aria-pressed="' + (date === state.day) + '" aria-label="' + esc(dayLabel(date)) + '">' + d + '</button>'
        : '<span class="' + cls + '" aria-hidden="true">' + d + '</span>';
    }

    var slots = state.day ? state.days[state.day] || [] : [];
    var times = slots.map(function (iso) {
      var selected = iso === state.slot;
      return '<button type="button" class="bk__time' + (selected ? ' is-selected' : '') + '" data-slot="' + esc(iso) + '" aria-pressed="' + selected + '">' + timeLabel(iso, state.tz) + '</button>';
    }).join('');

    var zones = ZONES.slice();
    if (!zones.some(function (z) { return z.tz === state.tz; })) zones.unshift({ tz: state.tz, label: zoneLabel(state.tz) });

    return (state.notice ? '<p class="bk__notice">' + esc(state.notice) + '</p>' : '') +
      '<div class="bk__picker">' +
        '<div class="bk__month">' +
          '<div class="bk__month-head">' +
            '<button type="button" class="bk__nav" data-month="-1" aria-label="Mois précédent"' + (month <= firstMonth ? ' disabled' : '') + '><svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
            '<p>' + monthLabel(month) + '</p>' +
            '<button type="button" class="bk__nav" data-month="1" aria-label="Mois suivant"' + (month >= lastMonth ? ' disabled' : '') + '><svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
          '</div>' +
          '<div class="bk__weekdays"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span></div>' +
          '<div class="bk__grid">' + cells + '</div>' +
        '</div>' +
        '<div class="bk__times">' +
          '<p class="bk__times-title">' + (state.day ? esc(dayLabel(state.day)) : 'Choisissez un jour') + '</p>' +
          '<div class="bk__time-list">' + (times || '<p class="bk__empty">Aucun horaire ce jour-là.</p>') + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="bk__foot">' +
        '<label class="bk__zone">Fuseau horaire ' +
          '<select data-action="zone">' + zones.map(function (z) {
            return '<option value="' + esc(z.tz) + '"' + (z.tz === state.tz ? ' selected' : '') + '>' + esc(z.label) + '</option>';
          }).join('') + '</select>' +
        '</label>' +
        '<button type="button" class="bk__cta" data-action="continue"' + (state.slot ? '' : ' disabled') + '>Continuer</button>' +
      '</div>';
  }

  function field(name, label, type, autocomplete, half) {
    var value = state.form[name] || '';
    return '<label class="bk__field' + (half ? ' bk__field--half' : '') + '"><span>' + label + '</span>' +
      '<input name="' + name + '" type="' + type + '" autocomplete="' + autocomplete + '" required value="' + esc(value) + '"></label>';
  }

  function question(q) {
    var saved = state.form[q.key];
    var chosen = q.multiple ? (Array.isArray(saved) ? saved : []) : (saved ? [saved] : []);
    var cls = 'bk__question' + (q.compact ? ' bk__question--compact' : '') + (state.missing.indexOf(q.key) !== -1 && !chosen.length ? ' is-missing' : '');
    return '<fieldset class="' + cls + '"><legend>' + esc(q.title) +
      (q.multiple ? ' <small>Plusieurs réponses possibles</small>' : '') + '</legend><div class="bk__options">' +
      q.options.map(function (option) {
        return '<label class="bk__option"><input type="' + (q.multiple ? 'checkbox' : 'radio') + '" name="' + q.key + '" value="' + esc(option) + '"' +
          (chosen.indexOf(option) !== -1 ? ' checked' : '') + '><span>' + esc(option) + '</span></label>';
      }).join('') + '</div></fieldset>';
  }

  function renderForm() {
    var end = new Date(Date.parse(state.slot) + DURATION_MIN * 60000).toISOString();
    var day = new Intl.DateTimeFormat('en-CA', { timeZone: state.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(state.slot));
    return '<div class="bk__recap"><div><strong>' + esc(dayLabel(day)) + '</strong>' +
        '<span>' + timeLabel(state.slot, state.tz) + ' à ' + timeLabel(end, state.tz) + ', heure ' + (state.tz === 'Indian/Reunion' ? 'de La Réunion' : 'locale (' + esc(zoneLabel(state.tz)) + ')') + '</span></div>' +
        '<button type="button" class="bk__link" data-action="back">Modifier</button></div>' +
      '<form class="bk__form" novalidate>' +
        '<div class="bk__row">' + field('firstName', 'Prénom', 'text', 'given-name', true) + field('lastName', 'Nom', 'text', 'family-name', true) + '</div>' +
        field('email', 'E-mail', 'email', 'email') +
        field('phone', 'Téléphone', 'tel', 'tel') +
        field('company', 'Entreprise', 'text', 'organization') +
        '<input class="bk__trap" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">' +
        QUESTIONS.map(question).join('') +
        (state.formError ? '<p class="bk__error" role="alert">' + esc(state.formError) + '</p>' : '') +
        '<button type="submit" class="bk__cta bk__cta--full"' + (state.submitting ? ' disabled' : '') + '>' +
          (state.submitting ? 'Réservation en cours…' : 'Confirmer mon appel') + '</button>' +
        '<p class="bk__legal">Vos réponses servent uniquement à préparer l\'appel. <a href="politique-de-confidentialite.html">Confidentialité</a></p>' +
      '</form>';
  }

  function renderDone() {
    var day = new Intl.DateTimeFormat('en-CA', { timeZone: state.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(state.booked.start));
    return '<div class="bk__done">' +
      '<span class="bk__check" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
      '<p class="bk__done-title">C\'est réservé, ' + esc(state.booked.name) + '.</p>' +
      '<p class="bk__done-text">' + esc(dayLabel(day)) + ' à ' + timeLabel(state.booked.start, state.tz) + ' (' + esc(zoneLabel(state.tz)) + ') avec Dayyaan. Le lien de la visio Google Meet vous est envoyé par e-mail.</p>' +
      '<ul class="bk__tips">' +
        '<li>Connectez-vous depuis un ordinateur.</li>' +
        '<li>Installez-vous dans un endroit calme.</li>' +
        '<li>Préparez vos questions et vos chiffres clés.</li>' +
      '</ul></div>';
  }

  function render() {
    var body = state.step === 'done' ? renderDone() : state.step === 'form' ? renderForm() : renderSlot();
    root.innerHTML = header() + (state.step === 'done' ? '' : stepper()) + '<div class="bk__body" aria-live="polite">' + body + '</div>';
  }

  // GHL d'origine, en secours.
  function fallback() {
    root.innerHTML = header() +
      '<iframe src="' + GHL_WIDGET + '" style="width:100%;border:none;overflow:hidden;min-height:680px;display:block" scrolling="no" id="hjefRqxorRuPkcPAZEx4_vsl" title="Réserver un appel avec LEADX"></iframe>';
    var s = document.createElement('script');
    s.src = 'https://link.msgsndr.com/js/form_embed.js';
    document.body.appendChild(s);
  }

  // ── Interactions ──
  // Clics écoutés sur window en phase de capture : la page arrête les clics
  // avant document pour que VTurb ne relance pas la VSL (voir index.html).
  window.addEventListener('click', function (event) {
    var target = event.target.closest && event.target.closest('button');
    if (!target || target.disabled || !root.contains(target)) return;
    if (target.dataset.day) {
      state.day = target.dataset.day;
      state.slot = null;
      state.notice = null;
      render();
    } else if (target.dataset.slot) {
      state.slot = target.dataset.slot;
      render();
    } else if (target.dataset.month) {
      state.month = shiftMonth(state.month, Number(target.dataset.month));
      var inMonth = Object.keys(state.days).sort().filter(function (d) { return monthOf(d) === state.month; });
      if (inMonth.length) { state.day = inMonth[0]; state.slot = null; }
      render();
    } else if (target.dataset.action === 'continue' && state.slot) {
      state.step = 'form';
      render();
      var firstInput = root.querySelector('input[name="firstName"]');
      if (firstInput && !firstInput.value) firstInput.focus({ preventScroll: true });
    } else if (target.dataset.action === 'back') {
      saveForm();
      state.step = 'slot';
      render();
    } else if (target.dataset.action === 'fallback') {
      fallback();
    }
  }, true);

  root.addEventListener('change', function (event) {
    // Une question répondue perd aussitôt son signalement.
    var fieldset = event.target.closest('.bk__question.is-missing');
    if (fieldset) {
      fieldset.classList.remove('is-missing');
      state.missing = state.missing.filter(function (key) { return key !== event.target.name; });
      if (!root.querySelector('.bk__question.is-missing')) {
        var error = root.querySelector('.bk__error');
        if (error) error.remove();
        state.formError = null;
      }
    }
    if (event.target.dataset && event.target.dataset.action === 'zone') {
      state.tz = event.target.value;
      state.day = null;
      state.slot = null;
      load();
    }
  });

  root.addEventListener('submit', function (event) {
    event.preventDefault();
    if (state.submitting) return;
    var form = event.target;
    if (!form.checkValidity()) {
      saveForm();
      state.formError = 'Merci de compléter vos coordonnées : prénom, nom, e-mail, téléphone et entreprise.';
      render();
      return;
    }
    submit(form);
  });

  // Garde les réponses quand on revient changer de créneau.
  function saveForm() {
    var form = root.querySelector('form');
    if (!form) return;
    var data = new FormData(form);
    ['firstName', 'lastName', 'email', 'phone', 'company'].forEach(function (k) { state.form[k] = data.get(k) || ''; });
    QUESTIONS.forEach(function (q) { state.form[q.key] = q.multiple ? data.getAll(q.key) : data.get(q.key); });
  }

  load();
})();
