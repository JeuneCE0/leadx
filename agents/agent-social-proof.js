/**
 * LEADX — Agent Social Proof
 * Notifications dynamiques de preuve sociale.
 * Affiche des bulles de notification avec prénoms français.
 */
(function() {
  'use strict';

  const CONFIG = {
    names: ['Thomas', 'Julie', 'Maxime', 'Sarah', 'Alexandre', 'Camille', 'Nicolas', 'Laura', 'Pierre', 'Emma', 'Antoine', 'Léa', 'Romain', 'Chloé', 'Sébastien'],
    templates: [
      '{name} vient de s\'inscrire 🔥',
      '{name} regarde la méthode en ce moment',
      '{name} a réservé son appel stratégique',
      '{name} vient d\'accéder à la masterclass',
      '{name} a rejoint LEADX il y a {time} min'
    ],
    displayDuration: 8000,
    interval: 12000,
    startDelay: 5000,
    maxPerSession: 10,
    avatarService: 'https://i.pravatar.cc/72?img=',
    pages: ['optin', 'vsl'] // pages où afficher (pas booking/confirmation)
  };

  // Check if we should show on this page
  function shouldShowOnPage() {
    const path = window.location.pathname.toLowerCase();
    if (path.includes('booking') || path.includes('confirmation') ||
        path.includes('politique') || path.includes('cgv') || path.includes('mentions')) {
      return false;
    }
    return true;
  }

  if (!shouldShowOnPage()) return;

  let sessionCount = 0;
  let notifEl = null;
  let intervalId = null;

  // Create notification element if not already in DOM
  function ensureNotifEl() {
    notifEl = document.getElementById('social-notif');
    if (notifEl) return; // Already exists in HTML

    // Create dynamically
    notifEl = document.createElement('div');
    notifEl.className = 'social-notif';
    notifEl.id = 'social-notif';
    notifEl.innerHTML = `
      <img class="social-notif__avatar" id="notif-avatar" src="" alt="" loading="lazy">
      <div>
        <div class="social-notif__text" id="notif-text"></div>
        <div class="social-notif__time" id="notif-time"></div>
      </div>
    `;

    // Add styles if not present
    if (!document.querySelector('[data-social-proof-styles]')) {
      const style = document.createElement('style');
      style.setAttribute('data-social-proof-styles', '');
      style.textContent = `
        .social-notif {
          position: fixed; bottom: 24px; left: 24px; z-index: 9990;
          background: #fff; border-radius: 14px; padding: 14px 18px 14px 14px;
          display: flex; align-items: center; gap: 12px;
          box-shadow: 0 8px 30px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06);
          border-left: 3px solid #FF2600;
          transform: translateX(-120%); opacity: 0;
          transition: all 0.5s cubic-bezier(.25,.46,.45,.94);
          max-width: 320px;
        }
        .social-notif.show { transform: translateX(0); opacity: 1; }
        .social-notif__avatar { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
        .social-notif__text { font-size: 13px; color: #000; line-height: 1.4; }
        .social-notif__time { font-size: 11px; color: #777; }
        @media(max-width:640px){
          .social-notif { bottom: auto; top: 12px; left: 12px; right: 12px; max-width: none; }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(notifEl);
  }

  function isModalOpen() {
    const modal = document.getElementById('modal-overlay');
    return modal && modal.classList.contains('open');
  }

  function showNotification() {
    if (sessionCount >= CONFIG.maxPerSession) {
      clearInterval(intervalId);
      return;
    }

    if (isModalOpen()) return; // Don't show if modal is open

    ensureNotifEl();

    const name = CONFIG.names[Math.floor(Math.random() * CONFIG.names.length)];
    const templateIdx = Math.floor(Math.random() * CONFIG.templates.length);
    const time = Math.floor(Math.random() * 16) + 2;
    const imgId = Math.floor(Math.random() * 70) + 1;

    let text = CONFIG.templates[templateIdx]
      .replace('{name}', name)
      .replace('{time}', time);

    const avatar = notifEl.querySelector('.social-notif__avatar, #notif-avatar');
    const textEl = notifEl.querySelector('.social-notif__text, #notif-text');
    const timeEl = notifEl.querySelector('.social-notif__time, #notif-time');

    if (avatar) {
      avatar.src = CONFIG.avatarService + imgId;
      avatar.onerror = function() { this.style.display = 'none'; };
    }
    if (textEl) textEl.textContent = text;
    if (timeEl) timeEl.textContent = 'il y a ' + (Math.floor(Math.random() * 12) + 1) + ' min';

    notifEl.classList.add('show');
    sessionCount++;

    setTimeout(function() {
      notifEl.classList.remove('show');
    }, CONFIG.displayDuration);
  }

  // Start notifications
  function init() {
    setTimeout(function() {
      showNotification();
      intervalId = setInterval(showNotification, CONFIG.interval + CONFIG.displayDuration);
    }, CONFIG.startDelay);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
