(function runProjectExplorer(document, window) {
  'use strict';

  const STORAGE_KEY = 'kokonada.learningMode';

  function bootstrap() {
    const core = window.KokonadaExplorerCore;
    const status = window.KokonadaStatus;

    if (!core || !status) {
      return;
    }

    const body = document.body;
    const learningToggle = document.querySelector('[data-learning-toggle]');
    const learningLabel = document.querySelector('[data-learning-label]');
    const snapshotState = document.querySelector('[data-snapshot-state]');
    const mobileNavToggle = document.querySelector('[data-mobile-nav-toggle]');

    function readLearningPreference() {
      return window.localStorage.getItem(STORAGE_KEY);
    }

    function writeLearningPreference(value) {
      try {
        window.localStorage.setItem(STORAGE_KEY, value);
      } catch (_error) {
        // The in-memory mode still works when storage is blocked.
      }
    }

    function applyLearningMode(enabled) {
      const value = enabled ? 'on' : 'off';
      body.dataset.learningMode = value;

      if (learningToggle) {
        learningToggle.setAttribute('aria-pressed', String(enabled));
      }

      if (learningLabel) {
        learningLabel.textContent = enabled ? 'מצב למידה פעיל' : 'מצב למידה כבוי';
      }
    }

    const initialMode = core.resolveInitialLearningMode(readLearningPreference);
    applyLearningMode(initialMode);

    if (learningToggle) {
      learningToggle.addEventListener('click', function toggleLearningMode() {
        const enabled = body.dataset.learningMode !== 'on';
        applyLearningMode(enabled);
        writeLearningPreference(enabled ? 'on' : 'off');
      });
    }

    if (snapshotState) {
      const state = core.deriveSnapshotState(
        status.snapshot.commit,
        window.__KOKONADA_CURRENT_COMMIT__,
      );
      const stateCopy = {
        current: 'ה-snapshot תואם ל-commit של סביבת העבודה',
        stale: 'אזהרה: ה-snapshot אינו תואם ל-commit של סביבת העבודה',
        unknown: 'לא ניתן לאמת את commit סביבת העבודה',
      };

      snapshotState.dataset.snapshotState = state;
      snapshotState.classList.remove('status-current', 'status-stale', 'status-unknown');
      snapshotState.classList.add(`status-${state}`);
      snapshotState.textContent = stateCopy[state];
    }

    const reducedMotion = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : true;

    document.querySelectorAll('[data-next-step]').forEach(function bindNextStep(link) {
      link.addEventListener('click', function moveToNextStep(event) {
        const target = document.querySelector(link.getAttribute('href'));
        if (!target) {
          return;
        }

        event.preventDefault();
        target.focus({ preventScroll: true });
        target.scrollIntoView({
          behavior: reducedMotion ? 'auto' : 'smooth',
          block: 'start',
        });
      });
    });

    if (mobileNavToggle) {
      mobileNavToggle.addEventListener('click', function toggleMobileNavigation() {
        const isOpen = mobileNavToggle.getAttribute('aria-expanded') === 'true';
        mobileNavToggle.setAttribute('aria-expanded', String(!isOpen));
        body.dataset.navOpen = isOpen ? 'false' : 'true';
      });

      document.querySelectorAll('#project-navigation a').forEach(function closeAfterNavigation(link) {
        link.addEventListener('click', function closeMobileNavigation() {
          mobileNavToggle.setAttribute('aria-expanded', 'false');
          body.dataset.navOpen = 'false';
        });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
})(document, window);
