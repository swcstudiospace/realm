const REVEAL_SELECTOR = '.VPFeatures .item, .vp-doc h2, .vp-doc h3';
const PROGRESS_CLASS = 'scroll-progress';

let observer = null;
let progressBar = null;
let scrollListening = false;
let frameQueued = false;

function getObserver() {
  if (observer) return observer;
  const Observer = globalThis.IntersectionObserver;
  if (typeof Observer !== 'function') return null;
  observer = new Observer(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
  );
  return observer;
}

function markReveals(doc) {
  const io = getObserver();
  // Drop every target from the previous page, so detached page nodes are released.
  if (io) io.disconnect();
  for (const el of doc.querySelectorAll(REVEAL_SELECTOR)) {
    el.classList.add('reveal');
    if (el.classList.contains('is-visible')) continue;
    if (io) {
      io.observe(el);
    } else {
      el.classList.add('is-visible');
    }
  }
}

function ensureProgressBar(doc) {
  if (progressBar && progressBar.isConnected) return progressBar;
  progressBar = doc.createElement('div');
  progressBar.className = PROGRESS_CLASS;
  progressBar.setAttribute('aria-hidden', 'true');
  doc.body.appendChild(progressBar);
  return progressBar;
}

function updateScroll(win, doc) {
  frameQueued = false;
  const root = doc.documentElement;
  const max = root.scrollHeight - win.innerHeight;
  const ratio = max > 0 ? Math.min(1, Math.max(0, win.scrollY / max)) : 0;
  root.style.setProperty('--scroll-progress', String(ratio));
  root.classList.toggle('is-scrolled', win.scrollY > 8);
}

function listenToScroll(win, doc) {
  if (scrollListening) return;
  scrollListening = true;
  const schedule = () => {
    if (frameQueued) return;
    frameQueued = true;
    const raf = globalThis.requestAnimationFrame;
    if (typeof raf === 'function') {
      raf(() => updateScroll(win, doc));
    } else {
      updateScroll(win, doc);
    }
  };
  win.addEventListener('scroll', schedule, { passive: true });
  win.addEventListener('resize', schedule, { passive: true });
  updateScroll(win, doc);
}

// Idempotent: safe to call again after client-side navigation, when new
// reveal targets appear without a full page load.
export function startMotion() {
  const win = globalThis.window;
  const doc = globalThis.document;
  if (!win || !doc || !doc.body) return;
  if (typeof globalThis.matchMedia !== 'function') return;
  if (globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  ensureProgressBar(doc);
  markReveals(doc);
  listenToScroll(win, doc);
}
