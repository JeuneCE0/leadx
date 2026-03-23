/**
 * LEADX — Agent Social Proof
 * Notifications dynamiques de preuve sociale.
 * Affiche des bulles de notification avec prénoms français.
 */
(function() {
  'use strict';

  const CONFIG = {
    names: ['TechVision', 'GrowthLab', 'DataPulse', 'ScaleUp Pro', 'NexGen B2B', 'CloudForce', 'AdSphere', 'B2B Connect', 'LeadFactory', 'SalesIQ', 'StratEdge', 'ProximaB2B', 'AcquiPro', 'LeadPilot', 'DigitalCore'],
    templates: [
      '{name} a sa campagne active 🚀',
      '{name} a généré +{leads} prospects cette semaine 🔥',
      '{name} a généré +{percent}% de chiffre d\'affaires 📈',
      '{name} a divisé son coût par lead par 2 💰',
      '{name} a réservé {rdv} rendez-vous qualifiés cette semaine ✅'
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
      <div class="social-notif__logo" id="notif-logo"></div>
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
          background: #141414; border-radius: 14px; padding: 14px 18px 14px 14px;
          display: flex; align-items: center; gap: 12px;
          box-shadow: 0 8px 30px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.06);
          border-left: 3px solid #FF2600;
          transform: translateX(-120%); opacity: 0;
          transition: all 0.5s cubic-bezier(.25,.46,.45,.94);
          max-width: 340px;
        }
        .social-notif.show { transform: translateX(0); opacity: 1; }
        .social-notif__logo {
          width: 36px; height: 36px; border-radius: 10px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          font-size: 14px; font-weight: 800; color: #fff; letter-spacing: -0.5px;
        }
        .social-notif__text { font-size: 13px; color: rgba(255,255,255,0.9); line-height: 1.4; }
        .social-notif__time { font-size: 11px; color: rgba(255,255,255,0.4); }
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
    const leads = Math.floor(Math.random() * 25) + 8;
    const percent = Math.floor(Math.random() * 30) + 15;
    const rdv = Math.floor(Math.random() * 8) + 3;
    const imgId = Math.floor(Math.random() * 70) + 1;

    let text = CONFIG.templates[templateIdx]
      .replace('{name}', name)
      .replace('{leads}', leads)
      .replace('{percent}', percent)
      .replace('{rdv}', rdv);

    const logoEl = notifEl.querySelector('.social-notif__logo, #notif-logo');
    const textEl = notifEl.querySelector('.social-notif__text, #notif-text');
    const timeEl = notifEl.querySelector('.social-notif__time, #notif-time');

    // Company logo colors
    const logoColors = ['#FF2600','#C11D00','#2563eb','#7c3aed','#0891b2','#059669','#d97706','#dc2626'];
    const color = logoColors[Math.floor(Math.random() * logoColors.length)];
    if (logoEl) {
      logoEl.textContent = name.substring(0, 2).toUpperCase();
      logoEl.style.background = color;
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
