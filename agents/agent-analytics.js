/**
 * LEADX — Agent Analytics
 * Tracking comportemental sans dépendance externe.
 * Expose getAnalytics() dans la console.
 */
(function() {
  'use strict';

  // ⚠️ Optionnel : URL webhook pour envoyer les events
  const WEBHOOK_URL = ''; // ⚠️ À CONFIGURER (laisser vide pour désactiver)

  const events = [];
  const sessionId = 's_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  const pageStart = Date.now();

  // Detect device
  const isMobile = window.innerWidth <= 640;
  const device = isMobile ? 'mobile' : 'desktop';

  // Parse UTM params
  function getUTMs() {
    const params = new URLSearchParams(window.location.search);
    const utms = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(k => {
      if (params.get(k)) utms[k] = params.get(k);
    });
    return utms;
  }

  // Track event
  function track(eventName, data) {
    const evt = {
      event: eventName,
      page: window.location.pathname,
      timestamp: new Date().toISOString(),
      sessionId: sessionId,
      data: data || {}
    };
    events.push(evt);

    // Send to webhook if configured
    if (WEBHOOK_URL) {
      try {
        navigator.sendBeacon(WEBHOOK_URL, JSON.stringify(evt));
      } catch(e) {
        // Silent fail
      }
    }
  }

  // 1. Page view
  track('page_view', {
    url: window.location.href,
    referrer: document.referrer,
    utms: getUTMs(),
    device: device,
    viewport: window.innerWidth + 'x' + window.innerHeight,
    userAgent: navigator.userAgent
  });

  // 2. Scroll depth
  const scrollThresholds = [25, 50, 75, 100];
  const scrollTracked = new Set();

  let scrollTicking = false;
  window.addEventListener('scroll', function() {
    if (!scrollTicking) {
      scrollTicking = true;
      requestAnimationFrame(function() {
        const scrollPct = Math.round(
          (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100
        );
        scrollThresholds.forEach(t => {
          if (scrollPct >= t && !scrollTracked.has(t)) {
            scrollTracked.add(t);
            track('scroll_depth', { depth: t + '%' });
          }
        });
        scrollTicking = false;
      });
    }
  }, { passive: true });

  // 3. Time on page (track on unload)
  window.addEventListener('beforeunload', function() {
    const timeSpent = Math.round((Date.now() - pageStart) / 1000);
    track('time_on_page', { seconds: timeSpent });

    // Try to send remaining events
    if (WEBHOOK_URL && events.length > 0) {
      try {
        navigator.sendBeacon(WEBHOOK_URL, JSON.stringify({ batch: events.slice(-5) }));
      } catch(e) {}
    }
  });

  // 4. CTA clicks
  document.addEventListener('click', function(e) {
    const cta = e.target.closest('.cta-btn, .modal__submit, .exit-popup__cta, .sticky-cta__btn, [data-track-cta]');
    if (cta) {
      const rect = cta.getBoundingClientRect();
      const scrollY = window.scrollY || document.documentElement.scrollTop;
      track('cta_click', {
        text: cta.textContent.trim().substring(0, 60),
        className: cta.className,
        positionY: Math.round(rect.top + scrollY),
        viewport_position: Math.round((rect.top / window.innerHeight) * 100) + '%'
      });
    }
  });

  // 5. Modal optin open
  const modalObserver = new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      if (m.target.id === 'modal-overlay' && m.target.classList.contains('open')) {
        track('modal_open', { modal: 'optin' });
      }
    });
  });
  const modalEl = document.getElementById('modal-overlay');
  if (modalEl) {
    modalObserver.observe(modalEl, { attributes: true, attributeFilter: ['class'] });
  }

  // 6. Form submission (without personal data)
  const submitBtn = document.getElementById('submit-btn');
  if (submitBtn) {
    submitBtn.addEventListener('click', function() {
      const prenom = document.getElementById('f-prenom');
      const nom = document.getElementById('f-nom');
      const email = document.getElementById('f-email');
      const tel = document.getElementById('f-tel');

      const hasPrenom = prenom && prenom.value.trim().length > 0;
      const hasNom = nom && nom.value.trim().length > 0;
      const hasEmail = email && email.value.trim().length > 0;
      const hasTel = tel && tel.value.trim().length > 0;

      track('form_submit', {
        fields_filled: { prenom: hasPrenom, nom: hasNom, email: hasEmail, tel: hasTel },
        all_required_filled: hasPrenom && hasNom && hasEmail
      });
    });
  }

  // 7. VSL tracking
  const vslThumbnail = document.getElementById('vsl-thumbnail');
  if (vslThumbnail) {
    vslThumbnail.addEventListener('click', function() {
      track('vsl_play', { action: 'play_click' });
    });
  }

  // Track video progress if using HTML5 video element
  function setupVideoTracking(video) {
    if (!video) return;
    const videoThresholds = [25, 50, 75, 100];
    const videoTracked = new Set();

    video.addEventListener('timeupdate', function() {
      if (video.duration > 0) {
        const pct = Math.round((video.currentTime / video.duration) * 100);
        videoThresholds.forEach(t => {
          if (pct >= t && !videoTracked.has(t)) {
            videoTracked.add(t);
            track('vsl_progress', { progress: t + '%', duration_watched: Math.round(video.currentTime) });
          }
        });
      }
    });

    video.addEventListener('ended', function() {
      track('vsl_complete', { total_duration: Math.round(video.duration) });
    });
  }

  // Try to find video element
  const videoEl = document.querySelector('video');
  if (videoEl) setupVideoTracking(videoEl);

  // 8. Exit intent tracking
  if (window.innerWidth > 640) {
    let exitTracked = false;
    document.addEventListener('mouseout', function(e) {
      if (e.clientY < 5 && !exitTracked) {
        exitTracked = true;
        track('exit_intent', { triggered: true });
      }
    });
  }

  // 9. A/B test variant tracking
  window.addEventListener('ab_variant_shown', function(e) {
    track('ab_variant', e.detail);
  });

  // Expose analytics
  window.getAnalytics = function() {
    const timeSpent = Math.round((Date.now() - pageStart) / 1000);

    console.log('%c LEADX Analytics ', 'background: #FF2600; color: white; font-weight: bold; padding: 4px 8px; border-radius: 4px;');
    console.log('Session:', sessionId);
    console.log('Time on page:', timeSpent + 's');
    console.log('Device:', device);
    console.log('Events (' + events.length + '):');
    console.table(events.map(e => ({
      event: e.event,
      time: e.timestamp.split('T')[1].split('.')[0],
      data: JSON.stringify(e.data).substring(0, 80)
    })));

    return {
      sessionId,
      timeOnPage: timeSpent,
      device,
      events: [...events]
    };
  };

})();
