/**
 * LEADX — Agent Urgency
 * Gestion des éléments d'urgence et de scarcité.
 * S'auto-attache au DOM via des attributs data-urgency.
 */
(function() {
  'use strict';

  const URGENCY_CONFIG = {
    countdownTarget: 'next-monday-10h-paris',
    badgeMin: 28,
    badgeMax: 45,
    placesMin: 3,
    placesMax: 7,
    placesDecrementInterval: 7200000, // 2h en ms
    recentMin: 2,
    recentMax: 18,
    recentRefresh: 30000 // 30s
  };

  // ── Countdown: prochain lundi 10h Paris ──
  function getNextMonday10hParis() {
    // Get current time in Paris
    const now = new Date();
    const parisStr = now.toLocaleString('en-US', { timeZone: 'Europe/Paris' });
    const paris = new Date(parisStr);
    const day = paris.getDay(); // 0=Sun, 1=Mon
    let daysUntil = (1 - day + 7) % 7;
    if (daysUntil === 0 && paris.getHours() >= 10) {
      daysUntil = 7;
    }
    const target = new Date(paris);
    target.setDate(target.getDate() + daysUntil);
    target.setHours(10, 0, 0, 0);
    return target;
  }

  function updateCountdownElements() {
    const els = document.querySelectorAll('[data-urgency="countdown"]');
    if (els.length === 0) return;

    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const target = getNextMonday10hParis();
    let diff = Math.max(0, Math.floor((target - now) / 1000));

    const d = Math.floor(diff / 86400); diff %= 86400;
    const h = Math.floor(diff / 3600); diff %= 3600;
    const m = Math.floor(diff / 60);
    const s = diff % 60;

    const text = String(d).padStart(2, '0') + 'j ' +
                 String(h).padStart(2, '0') + 'h ' +
                 String(m).padStart(2, '0') + 'm ' +
                 String(s).padStart(2, '0') + 's';

    els.forEach(function(el) {
      el.textContent = text;
    });
  }

  // ── Badge "inscrits cette semaine" ──
  function getDailyNumber(min, max) {
    // Seed based on date (changes daily)
    const today = new Date();
    const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
    // Simple hash
    const hash = ((seed * 2654435761) >>> 0) % (max - min + 1);
    return min + hash;
  }

  function updateBadgeElements() {
    const els = document.querySelectorAll('[data-urgency="badge-inscrits"]');
    const count = getDailyNumber(URGENCY_CONFIG.badgeMin, URGENCY_CONFIG.badgeMax);
    els.forEach(function(el) {
      el.textContent = count;
    });
  }

  // ── Places limitées ──
  function getPlacesCount() {
    const key = 'leadx_places';
    let data;
    try { data = sessionStorage.getItem(key); } catch(e) { data = null; }
    let places, lastDecrement;

    if (data) {
      try {
        const parsed = JSON.parse(data);
        places = parsed.places;
        lastDecrement = parsed.lastDecrement;
      } catch(e) {
        places = null;
      }
    }

    if (places === null || places === undefined) {
      places = getDailyNumber(URGENCY_CONFIG.placesMin, URGENCY_CONFIG.placesMax);
      lastDecrement = Date.now();
      try { sessionStorage.setItem(key, JSON.stringify({ places, lastDecrement })); } catch(e) {}
    } else {
      const elapsed = Date.now() - lastDecrement;
      const decrements = Math.floor(elapsed / URGENCY_CONFIG.placesDecrementInterval);
      if (decrements > 0) {
        places = Math.max(URGENCY_CONFIG.placesMin, places - decrements);
        lastDecrement = Date.now();
        try { sessionStorage.setItem(key, JSON.stringify({ places, lastDecrement })); } catch(e) {}
      }
    }

    return places;
  }

  function updatePlacesElements() {
    const els = document.querySelectorAll('[data-urgency="places"]');
    const places = getPlacesCount();
    els.forEach(function(el) {
      // Preserve child elements — only update text content if no children
      var textTarget = el.querySelector('.urgency__text') || el;
      if (el.children.length > 0 && !el.querySelector('.urgency__text')) {
        var span = document.createElement('span');
        span.className = 'urgency__text';
        el.appendChild(span);
        textTarget = span;
      }
      textTarget.textContent = 'Plus que ' + places + ' places cette semaine';
    });
  }

  // ── Preuve récente ──
  function updateRecentElements() {
    const els = document.querySelectorAll('[data-urgency="recent"]');
    const mins = Math.floor(Math.random() * (URGENCY_CONFIG.recentMax - URGENCY_CONFIG.recentMin + 1)) + URGENCY_CONFIG.recentMin;
    els.forEach(function(el) {
      el.textContent = 'Dernière inscription il y a ' + mins + ' min';
    });
  }

  // ── Init ──
  function init() {
    // Update all elements
    updateBadgeElements();
    updatePlacesElements();
    updateRecentElements();
    updateCountdownElements();

    // Set up intervals only if matching elements exist
    if (document.querySelectorAll('[data-urgency="countdown"]').length > 0) {
      setInterval(updateCountdownElements, 1000);
    }
    if (document.querySelectorAll('[data-urgency="recent"]').length > 0) {
      setInterval(updateRecentElements, URGENCY_CONFIG.recentRefresh);
    }
    if (document.querySelectorAll('[data-urgency="places"]').length > 0) {
      setInterval(updatePlacesElements, URGENCY_CONFIG.placesDecrementInterval);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
