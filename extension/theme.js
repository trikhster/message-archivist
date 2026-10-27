// Light/dark theme for the popup, settings page and archive viewer. Starts
// from the system setting; a toggle overrides it and is remembered.
(() => {
  const KEY = 'gm-theme';
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const buttons = new Set();
  const SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7a5 5 0 100 10 5 5 0 000-10zM2 13h2a1 1 0 000-2H2a1 1 0 000 2zm18 0h2a1 1 0 000-2h-2a1 1 0 000 2zM11 2v2a1 1 0 002 0V2a1 1 0 00-2 0zm0 18v2a1 1 0 002 0v-2a1 1 0 00-2 0zM5.99 4.58a1 1 0 00-1.41 1.41l1.06 1.06a1 1 0 001.41-1.41L5.99 4.58zm12.37 12.37a1 1 0 00-1.41 1.41l1.06 1.06a1 1 0 001.41-1.41l-1.06-1.06zm1.06-10.96a1 1 0 00-1.41-1.41l-1.06 1.06a1 1 0 001.41 1.41l1.06-1.06zM7.05 18.36a1 1 0 00-1.41-1.41l-1.06 1.06a1 1 0 001.41 1.41l1.06-1.06z"/></svg>';
  const MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 109 9c0-.46-.04-.92-.1-1.36a5.39 5.39 0 01-4.4 2.26 5.4 5.4 0 01-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/></svg>';

  const saved = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const effective = () => document.documentElement.dataset.theme || (mq.matches ? 'dark' : 'light');

  function sync(b) {
    const dark = effective() === 'dark';
    b.innerHTML = dark ? SUN : MOON;
    b.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
    b.setAttribute('aria-label', b.title);
  }

  function apply(t) {
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
    buttons.forEach(sync);
    document.dispatchEvent(new CustomEvent('gm-theme', { detail: effective() }));
  }

  // 'light', 'dark', or null for the system setting.
  function set(t) {
    try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); } catch { /* storage blocked */ }
    // Extension pages also share it with the progress panel on the Messages tab.
    try { if (typeof chrome !== 'undefined' && chrome.storage?.local) chrome.storage.local.set({ theme: t || 'system' }); } catch { /* not an extension page */ }
    apply(t);
  }

  apply(saved());
  mq.addEventListener('change', () => { if (!saved()) apply(null); });

  window.GMTheme = {
    effective,
    current: () => saved() || 'system',
    set,
    toggle: () => set(effective() === 'dark' ? 'light' : 'dark'),
    bind(b) { buttons.add(b); sync(b); b.addEventListener('click', () => window.GMTheme.toggle()); },
  };
})();
