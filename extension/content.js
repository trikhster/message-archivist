// Message Archivist: runs on messages.google.com, reads conversations
// out of the page and saves them (JSON + CSV + offline viewer + media) straight
// into the backup folder as it goes. Only date-range copies are built as a zip.
(() => {
  // After the extension is reloaded, the copy already running on an open tab
  // is cut off from it; let the new copy take over instead of bowing out.
  if (window.__gmExporter?.alive?.()) return;
  window.__gmExporter = { alive: () => { try { return !!chrome.runtime?.id; } catch { return false; } } };

  // Google Messages for Web is an Angular app built from custom elements. These
  // selectors are the only coupling to its markup; if Google changes the page,
  // fix them here (use "Copy page diagnostics" in the popup to see the markup).
  const SEL = {
    convLink: 'mws-conversation-list-item a[href*="/conversations/"], a[href*="/web/conversations/"]',
    convName: '[data-e2e-conversation-name], .name, h2, h3',
    headerTitle: [
      'mws-header [data-e2e-header-title]',
      '[data-e2e-conversation-header] .title',
      'mws-conversation-header [data-e2e-conversation-title]',
      'mws-conversation-header .title',
      'mws-conversation-header h2',
      '.conversation-header .title',
    ].join(', '),
    header: 'mws-header, [data-e2e-conversation-header]',
    message: 'mws-message-wrapper',
    tombstone: 'mws-tombstone-message-wrapper',
    sender: '.participant-display-name-text, .sender-name, [data-e2e-sender-name]',
    textPart: 'mws-text-message-part',
    textInner: '.text-msg, [data-e2e-text-message-content]',
    timestamp: '[data-e2e-message-timestamp], mws-relative-timestamp, .timestamp, time',
    skipImg: 'mws-avatar, [class*="avatar"], [class*="emoji"], mws-message-status, mws-reactions, [class*="reaction"]',
    // A pinned chat in the list: its pin icon (by name, as Google's icons are
    // marked) or a "Pinned" label. Not yet checked against the live page; the
    // item's aria-label is checked for "Pinned" too.
    pinned: '[data-mat-icon-name="push_pin"], [data-mat-icon-name="keep"], [aria-label*="Pinned" i], [title*="Pinned" i], [data-e2e-is-pinned="true"]',
  };

  let running = false;
  let cancelled = false;
  let mediaSink = null; // the backup folder's frame while it's open: it also fetches what the page can't
  let lastStart = null; // how the current run started, for "Carry on now" after a stop

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const firstLine = (s) => (s || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const safeName = (s) => (s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim().slice(0, 60) || 'Conversation';
  const currentId = () => location.pathname.match(/\/conversations\/([^/?#]+)/)?.[1] || null;

  // ---------- progress HUD ----------
  // A live panel in the bottom-right of the page: what it's doing now, two
  // progress bars, running totals and a scrolling log of every step. It lives
  // in a shadow root so Google's styles can't touch it (and vice versa). The
  // log is also kept so it can be saved with the export and in run history.

  let paused = false;
  let background = false; // scheduled runs keep going while the tab is hidden

  // Google Messages (Material 3) look, light or dark to match the extension's theme setting.
  const HUD_CSS = `
    :host { all: initial; }
    .hud { --bg: #ffffff; --surface: #f0f4f9; --surface-2: #e9eef6; --divider: #e1e3e1; --text: #1f1f1f; --text-2: #444746; --muted: #5e5e5e;
      --primary: #0b57d0; --on-primary: #fff; --tonal: #d3e3fd; --on-tonal: #041e49; --ok: #146c2e; --warn: #8a5300; --err: #b3261e; --hover: rgba(31,31,31,.08);
      color: var(--text); background: var(--bg); border-radius: 28px;
      box-shadow: 0 4px 8px 3px rgba(0,0,0,.15), 0 1px 3px rgba(0,0,0,.3);
      font: 14px/20px 'Google Sans Text', 'Google Sans', Roboto, 'Segoe UI', system-ui, sans-serif; overflow: hidden;
      display: flex; flex-direction: column; }
    .hud.dark { --bg: #1e1f20; --surface: #282a2c; --surface-2: #333537; --divider: #444746; --text: #e3e3e3; --text-2: #c4c7c5; --muted: #a8aaa8;
      --primary: #a8c7fa; --on-primary: #062e6f; --tonal: #0842a0; --on-tonal: #d3e3fd; --ok: #6dd58c; --warn: #ffb95c; --err: #f2b8b5; --hover: rgba(227,227,227,.08); }
    .top { display: flex; align-items: center; gap: 10px; padding: 18px 16px 6px 24px; }
    .title { font: 400 22px/28px 'Google Sans', Roboto, system-ui, sans-serif; color: var(--text); }
    .hud.docked .top { padding: 14px 12px 6px 18px; } .hud.docked .title { font: 500 16px/24px 'Google Sans', Roboto, system-ui, sans-serif; }
    .state { font: 500 11px/16px 'Google Sans', Roboto, sans-serif; letter-spacing: .5px; padding: 2px 8px; border-radius: 8px; background: var(--surface); color: var(--text-2); }
    .state.run { background: var(--tonal); color: var(--on-tonal); } .state.done { color: var(--ok); } .state.err { color: var(--err); } .state.paused { color: var(--warn); }
    .clock { margin-left: auto; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
    .body { padding: 4px 24px 20px; display: flex; flex-direction: column; min-height: 0; flex: 1; }
    .hud.docked .body { padding: 4px 18px 16px; }
    .phase { margin-bottom: 12px; white-space: pre-line; color: var(--text); font-size: 15px; line-height: 22px; }
    .hud.docked .phase { font-size: 14px; line-height: 20px; }
    .notice { margin: 0 0 14px; padding: 10px 14px; border-radius: 12px; background: var(--tonal); color: var(--on-tonal); }
    .notice b { display: block; }
    .hud.docked .notice { display: none; }
    .bar { height: 4px; background: var(--surface-2); position: relative; overflow: hidden; border-radius: 2px; }
    .bar.thin { margin-top: 10px; }
    .bar > div { position: absolute; inset: 0 auto 0 0; width: 0; background: var(--primary); border-radius: 2px; transition: width .4s cubic-bezier(.2,0,0,1); }
    .bar.indet > div { width: 30%; animation: scan 1.3s linear infinite; }
    @keyframes scan { from { left: -30%; } to { left: 100%; } }
    .sub { display: flex; justify-content: space-between; color: var(--muted); font-size: 12px; margin-top: 4px; min-height: 16px; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 12px 0; }
    .stat { background: var(--surface); border-radius: 12px; padding: 8px 10px; }
    .stat b { display: block; font: 400 18px/24px 'Google Sans', Roboto, sans-serif; color: var(--text); font-variant-numeric: tabular-nums; }
    .stat span { font-size: 11px; color: var(--muted); }
    .log { height: 34vh; min-height: 120px; overflow-y: auto; border-radius: 12px; background: var(--surface); padding: 8px 10px; font: 11.5px/17px 'Roboto Mono', Menlo, monospace; }
    .hud.docked .log { height: 150px; }
    .log div { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-2); }
    .log .t { color: var(--muted); margin-right: 6px; }
    .log .ok { color: var(--ok); } .log .warn { color: var(--warn); } .log .err { color: var(--err); } .log .head { color: var(--primary); font-weight: bold; }
    .hud.small .log, .hud.small .stats { display: none; }
    .btns { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
    button { height: 40px; padding: 0 20px; border: 0; border-radius: 20px; background: transparent; color: var(--primary); cursor: pointer;
      font: 500 14px/20px 'Google Sans', Roboto, system-ui, sans-serif; }
    button:hover { background: var(--hover); }
    button.action { background: var(--primary); color: var(--on-primary); }
    button.action:hover { box-shadow: 0 1px 2px rgba(0,0,0,.3), 0 1px 3px 1px rgba(0,0,0,.15); }
    .min { width: 36px; height: 36px; padding: 0; border-radius: 50%; color: var(--text-2); font-size: 18px; }
    /* While it works: a large panel in the middle, over a dimmed page that
       takes every click. Once it's done or paused it docks in the corner. */
    .hud { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(720px, calc(100vw - 32px)); max-height: calc(100vh - 32px); pointer-events: auto; }
    .hud.docked { left: auto; top: auto; right: 16px; bottom: 16px; transform: none; width: min(440px, calc(100vw - 32px)); border-radius: 16px; }
    .shield { position: fixed; inset: 0; pointer-events: auto; background: rgba(32,33,36,.5); backdrop-filter: blur(2px) grayscale(.3); cursor: not-allowed; }
    .shield.dark { background: rgba(0,0,0,.6); }
    .shield[hidden] { display: none; }
    /* Motion: the panel scales in, docks with a slide, and the page dims gently. */
    .hud { animation: hud-in .32s cubic-bezier(.05,.7,.1,1) both; }
    .hud.docked { animation: hud-dock .32s cubic-bezier(.05,.7,.1,1) both; }
    @keyframes hud-in { from { opacity: 0; transform: translate(-50%, -48%) scale(.96); } }
    @keyframes hud-dock { from { opacity: 0; transform: translateY(16px); } }
    .shield:not([hidden]) { animation: shield-in .32s ease both; }
    @keyframes shield-in { from { opacity: 0; } }
    .log div:last-child { animation: line-in .2s ease both; }
    @keyframes line-in { from { opacity: 0; transform: translateY(4px); } }
    button { transition: background-color .12s, box-shadow .12s, transform .12s; }
    button:active { transform: scale(.97); }
    .stat b { transition: color .2s; }
    @media (prefers-reduced-motion: reduce) { .hud, .hud.docked, .shield, .log div { animation: none !important; } button { transition: none; } }
  `;

  // The extension's theme choice ('light', 'dark' or 'system'), shared from its pages.
  let themeChoice = 'system';
  const isDark = () => themeChoice === 'dark' || (themeChoice !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  try {
    chrome.storage.local.get('theme').then(({ theme }) => { themeChoice = theme || 'system'; });
    chrome.storage.onChanged.addListener((c) => { if (c.theme) { themeChoice = c.theme.newValue || 'system'; HUD.retheme(); } });
  } catch { /* storage unavailable */ }

  const HUD = (() => {
    let host = null;
    let $ = null;
    let started = 0;
    let clockTimer = 0;
    let autoScroll = true;
    let lines = [];

    function ensure() {
      if (host?.isConnected) return;
      host = document.createElement('div');
      // The panel lives in the browser's top layer (as a popover), so nothing
      // Messages opens, such as its contact Details, can appear above it.
      host.setAttribute('popover', 'manual');
      host.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;max-width:none;max-height:none;margin:0;padding:0;border:0;background:transparent;overflow:visible;z-index:2147483646;pointer-events:none';
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${HUD_CSS}</style>
        <div class="shield${isDark() ? ' dark' : ''}" hidden></div>
        <div class="hud${isDark() ? ' dark' : ''}">
        <div class="top"><span>💬</span><span class="title">Message Archivist</span><span class="state">READY</span><span class="clock">00:00</span><button class="min" title="Show or hide details">–</button></div>
        <div class="body">
          <div class="phase"></div>
          <div class="notice" hidden><b>Please leave this window alone until it’s done.</b>The exporter is scrolling and opening photos here, so clicks, scrolling and keys on this page are blocked. You can use other windows meanwhile; just don’t minimise this one or cover it completely, because Google Messages only loads older messages while it’s showing.</div>
          <div class="bar b1"><div></div></div><div class="sub s1"><span></span><span></span></div>
          <div class="bar thin b2"><div></div></div><div class="sub s2"><span></span><span></span></div>
          <div class="stats"></div>
          <div class="log"></div>
          <div class="btns"></div>
        </div></div>`;
      $ = (s) => root.querySelector(s);
      $('.min').onclick = () => { $('.hud').classList.toggle('small'); $('.min').textContent = $('.hud').classList.contains('small') ? '+' : '–'; };
      $('.log').addEventListener('scroll', () => { const l = $('.log'); autoScroll = l.scrollTop + l.clientHeight >= l.scrollHeight - 8; });
      document.body.append(host);
      place(false);
      watchTopLayer();
    }

    // While it works or needs an answer, the panel sits in a modal dialog of
    // its own: the topmost thing on the page, the only part you can click,
    // and above anything Messages opens (its contact Details, say). Once
    // docked, it's a popover: still on top, but the page is usable again.
    let modal = null;
    let central = false;
    function place(isCentral) {
      central = isCentral;
      if (!host) return;
      if (isCentral) {
        if (!modal) {
          modal = document.createElement('dialog');
          modal.id = 'gm-modal';
          modal.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;max-width:none;max-height:none;margin:0;padding:0;border:0;background:transparent;overflow:visible;outline:none';
          modal.addEventListener('cancel', (e) => e.preventDefault()); // Esc doesn't close it
          const st = document.createElement('style');
          st.textContent = '#gm-modal::backdrop{background:transparent}';
          document.head.append(st);
          document.body.append(modal);
        }
        if (host.parentNode !== modal) { try { host.hidePopover(); } catch { /* not shown */ } modal.append(host); }
        if (!modal.isConnected) document.body.append(modal);
        if (!modal.open) modal.showModal();
      } else {
        if (modal?.open) modal.close();
        if (host.parentNode !== document.body) document.body.append(host);
        try { if (!host.matches(':popover-open')) host.showPopover(); } catch { /* older Chrome: z-index only */ }
      }
    }

    // When the page puts something of its own in the top layer (a dialog or
    // popover, like Messages' contact Details), step back in front of it.
    let topWatch = null;
    function watchTopLayer() {
      if (topWatch) return;
      const raise = () => {
        if (!host?.isConnected) return;
        const others = [...document.querySelectorAll('dialog[open], :popover-open')].filter((e) => e !== host && e !== modal && e.id !== 'gm-writer');
        if (!others.length) return;
        if (central) { modal.close(); modal.showModal(); } else { try { host.hidePopover(); host.showPopover(); } catch { /* not shown */ } }
        const writer = document.getElementById('gm-writer');
        if (writer?.matches(':popover-open')) { writer.hidePopover(); writer.showPopover(); } // the folder prompt stays on top
      };
      let queued = false;
      topWatch = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; raise(); });
      });
      topWatch.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'popover', 'class'] });
      document.addEventListener('toggle', raise, true);
    }

    const fmtClock = (ms) => { const s = Math.floor(ms / 1000); return `${s >= 3600 ? Math.floor(s / 3600) + ':' : ''}${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; };

    function bar(sel, subSel, done, total, left, right) {
      ensure();
      const b = $(sel);
      if (total == null) { b.classList.add('indet'); b.firstChild.style.width = ''; }
      else { b.classList.remove('indet'); b.firstChild.style.width = `${total ? Math.min(100, (done / total) * 100) : 0}%`; }
      $(`${subSel} span:first-child`).textContent = left || '';
      $(`${subSel} span:last-child`).textContent = right || '';
    }

    return {
      start() {
        ensure();
        started = Date.now();
        lines = [];
        $('.log').textContent = '';
        $('.stats').textContent = '';
        bar('.b1', '.s1', 0, 1, '', '');
        bar('.b2', '.s2', 0, 1, '', '');
        clearInterval(clockTimer);
        clockTimer = setInterval(() => { if (host?.isConnected) $('.clock').textContent = fmtClock(Date.now() - started); }, 1000);
        this.state('RUNNING', 'run');
      },
      elapsed: () => Date.now() - started,
      lines: () => lines.slice(),
      state(label, kind = '') {
        ensure();
        $('.state').textContent = label;
        $('.state').className = `state ${kind}`;
        // Front and centre over a blocked page while it works or needs an
        // answer; docked in the corner once it's done, paused or stopped.
        const isCentral = kind === 'run' || label === 'WAITING' || label === 'STOPPING';
        $('.shield').hidden = !isCentral;
        $('.hud').classList.toggle('docked', !isCentral);
        place(isCentral);
        $('.notice').hidden = kind !== 'run';
        guard(kind === 'run');
      },
      phase(text) { ensure(); $('.phase').textContent = text; this.base = text; this.lastStep = null; },
      // "Backing up “Mom” (chat 2 of 5)" plus what it's doing now, in plain words.
      step(n, total, text, temporary = false) {
        ensure();
        $('.phase').textContent = `${this.base || ''}\n${n ? `Step ${n} of ${total}: ` : ''}${text}`;
        if (!temporary) this.lastStep = [n, total, text];
      },
      restoreStep() { if (this.lastStep) this.step(...this.lastStep); else this.phase(this.base || ''); },
      overall(done, total, left, right) { bar('.b1', '.s1', done, total, left, right); },
      task(done, total, left, right) { bar('.b2', '.s2', done, total, left, right); },
      stats(items) {
        ensure();
        $('.stats').innerHTML = items.map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');
      },
      log(text, level = '') {
        ensure();
        const when = fmtClock(Date.now() - (started || Date.now()));
        lines.push(`[${new Date().toISOString()}] ${level ? level.toUpperCase() + ' ' : ''}${text}`);
        if (lines.length > 20000) lines.splice(0, lines.length - 20000);
        const l = $('.log');
        const row = document.createElement('div');
        const t = document.createElement('span');
        t.className = 't';
        t.textContent = when;
        const m = document.createElement('span');
        m.className = level;
        m.textContent = text;
        row.append(t, m);
        l.append(row);
        while (l.childElementCount > 400) l.firstChild.remove();
        if (autoScroll) l.scrollTop = l.scrollHeight;
      },
      // Detail for troubleshooting: kept in the saved log, not shown in the panel.
      debug(text) {
        lines.push(`[${new Date().toISOString()}] DEBUG ${text}`);
        if (lines.length > 20000) lines.splice(0, lines.length - 20000);
      },
      buttons(list) {
        ensure();
        $('.btns').replaceChildren(...list.map(([label, onClick, primary]) => {
          const b = document.createElement('button');
          b.textContent = label;
          if (primary) b.className = 'action';
          b.onclick = onClick;
          return b;
        }));
      },
      close() { if (modal?.open) modal.close(); modal?.remove(); modal = null; host?.remove(); host = null; topWatch?.disconnect(); topWatch = null; guard(false); },
      // The folder prompt (an extension frame) can't live inside the panel's
      // dialog, so the panel steps out of modal mode while it shows.
      yieldTop(on) { if (on) place(false); else if (host) place(true); },
      get central() { return central; },
      retheme() { if (host?.isConnected) { $('.hud').classList.toggle('dark', isDark()); $('.shield').classList.toggle('dark', isDark()); } },
      finish(text, kind = 'done', extra = []) {
        clearInterval(clockTimer);
        this.state(kind === 'err' ? 'FAILED' : kind === 'paused' ? 'STOPPED' : 'COMPLETE', kind);
        this.phase(text);
        // The log, for whoever is helping, if something went wrong.
        const copy = ['Copy log', async (e) => {
          try { await navigator.clipboard.writeText(lines.join('\n')); e.target.textContent = 'Log copied'; } catch { e.target.textContent = 'Couldn’t copy; see Settings → More settings → Past runs'; }
        }];
        this.buttons([...extra, ...(kind === 'done' ? [] : [copy]), ['Close', () => this.close()]]);
      },
    };
  })();

  // While a backup runs, nothing on the page may open a link or another tab:
  // a stray click on a link or map preview would hide this tab and stall it.
  let guarded = false;
  const blockLinks = (e) => {
    const a = e.target.closest?.('a[href]');
    if (!a) return;
    const url = new URL(a.href, location.href);
    if (a.target === '_blank' || url.origin !== location.origin) { e.preventDefault(); e.stopImmediatePropagation(); }
  };
  const blockKeys = (e) => {
    if (e.composedPath().some((n) => n?.id === 'gm-writer')) return;
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); e.stopImmediatePropagation(); }
  };
  function guard(on) {
    if (on === guarded) return;
    guarded = on;
    for (const ev of ['click', 'auxclick']) (on ? addEventListener : removeEventListener)(ev, blockLinks, true);
    (on ? addEventListener : removeEventListener)('keydown', blockKeys, true);
    // window.open from the page's own code can only be stopped in the page's world.
    try { chrome.runtime.sendMessage({ type: 'gm-guard', on }); } catch { /* extension reloaded */ }
  }

  // Pause holds the backup where it is, on this page, until you resume it.
  // Stop ends it: everything read so far is saved, and the next backup of the
  // same chat (or "Back up everything") carries on from there.
  function runningButtons() {
    HUD.buttons([
      [paused ? 'Resume' : 'Pause', () => {
        paused = !paused;
        HUD.state(paused ? 'PAUSED' : 'RUNNING', paused ? 'paused' : 'run');
        HUD.log(paused ? 'Paused by you.' : 'Resumed.', 'warn');
        if (!paused) HUD.restoreStep();
        runningButtons();
      }],
      ['Stop…', confirmStop],
    ]);
  }

  // Asks before stopping, and holds the backup still while you decide.
  function confirmStop() {
    const wasPaused = paused;
    paused = true;
    HUD.state('WAITING', 'paused');
    HUD.step(null, null, 'Stop this backup?\n\nEverything read so far is saved. When you back up again, it carries on from here: Google Messages has to show the older messages again first, which goes quickly, and nothing already saved is fetched twice.\n\nTo just hold it for a moment and keep this page as it is, choose Keep going and then Pause.', true);
    HUD.buttons([
      ['Stop and save', () => {
        cancelled = true;
        paused = false;
        HUD.state('STOPPING', 'paused');
        HUD.step(null, null, 'Stopping: saving everything read so far…', true);
        HUD.log('Stopping by your choice. Everything read so far is being saved; the next backup carries on from here.', 'warn');
        HUD.buttons([]);
      }, true],
      ['Keep going', () => {
        paused = wasPaused;
        HUD.state(paused ? 'PAUSED' : 'RUNNING', paused ? 'paused' : 'run');
        HUD.restoreStep();
        runningButtons();
      }],
    ]);
  }

  // Asks a question on the page with a button for each choice, and Cancel.
  // Resolves to the chosen value, or null.
  function askChoice(text, choices) {
    return new Promise((resolve) => {
      HUD.state('WAITING', 'paused');
      HUD.phase(text);
      HUD.buttons([...choices.map(([label, value, primary]) => [label, () => resolve(value), primary]), ['Cancel', () => resolve(null)]]);
    });
  }
  const SPEED_NOTE = 'A speed run saves every message first and lists the photos and videos that haven’t loaded, to fetch later (popup or Settings: “Fetch photos”).';

  // Asks a question on the page with two buttons. Used as the second safety
  // check for big exports, and wherever a folder needs choosing or allowing
  // (Chrome only shows those prompts after a click on the page itself).
  function askOnPage(text, yesLabel, onYes = null) {
    return new Promise((resolve) => {
      HUD.state('WAITING', 'paused');
      HUD.phase(text);
      HUD.buttons([
        [yesLabel, async () => {
          if (onYes) {
            try { resolve(await onYes()); } catch (e) { if (e.name !== 'AbortError') HUD.log(e.message, 'err'); }
            return;
          }
          resolve(true);
        }, true],
        ['Cancel', () => resolve(null)],
      ]);
    });
  }

  // Moves this Google Messages tab into a window of its own (if it shares
  // one), so it stays showing, and keeps working, while you use other windows.
  async function ownWindow() {
    if ((await getSettings()).backupWindow === 'tab') return;
    try {
      const r = await chrome.runtime.sendMessage({ type: 'gm-own-window' });
      if (r?.compact) HUD.log('Google Messages is in a small window in the corner of the screen, so you can use the rest of it while the backup runs. Leave part of that window showing: don’t minimise it or cover it completely.', 'ok');
      else if (r?.moved) HUD.log('Moved Google Messages into its own window, so the backup keeps going while you use other windows. Don’t minimise that window or cover it completely.', 'ok');
    } catch { /* extension reloaded */ }
  }
  // Gives a window that was made small for the backup its size back.
  function restoreWindow() {
    try { chrome.runtime.sendMessage({ type: 'gm-restore-window' }).catch(() => {}); } catch { /* extension reloaded */ }
  }

  // Asks the extension to un-minimise this window, or bring this tab to the
  // front of it, so Messages keeps loading. Returns whether it changed anything.
  async function keepVisible() {
    try { return !!(await chrome.runtime.sendMessage({ type: 'gm-keep-visible' }))?.changed; } catch { return false; }
  }

  // Waits while paused, or while the tab is hidden (Chrome throttles hidden
  // tabs, which makes Messages load slowly and the export unreliable).
  // Scheduled runs carry on in the background instead.
  async function checkpoint() {
    let note = false;
    let asked = 0;
    // A hidden tab doesn't load older messages, so try to make it visible
    // again first (un-minimise its window, or show the tab in it).
    if (document.hidden && !paused && running) {
      if (await keepVisible()) { HUD.log('Brought the Google Messages window back so the backup can carry on.', 'ok'); await sleep(800); }
      asked = Date.now();
    }
    while ((paused || (document.hidden && !background)) && !cancelled) {
      if (!paused && Date.now() - asked > 30000) { asked = Date.now(); if (await keepVisible()) HUD.log('Brought the Google Messages window back so the backup can carry on.', 'ok'); }
      if (!paused && !note) {
        HUD.state('WAITING', 'paused');
        HUD.log('Paused: this tab isn’t showing (another tab is in front of it, or its window is minimised or covered). It carries on by itself when it’s showing again.', 'warn');
        HUD.step(null, null, 'Paused because this window isn’t showing. Click on it, or move other windows aside, and it carries on by itself.', true);
        note = true;
      }
      await sleep(500);
    }
    if (note) { HUD.state('RUNNING', 'run'); HUD.restoreStep(); HUD.log('Tab is visible again. Carrying on.', 'ok'); }
  }

  // ---------- timestamps ----------
  // Google Messages shows date/time "tombstones" between groups of messages
  // ("Today 3:45 PM", "Mon 9:02 AM", "Sep 3, 2023, 4:05 PM") and sometimes a
  // per-message time in accessibility labels. We keep the raw text and also
  // normalise it to "YYYY-MM-DD HH:MM" in your local time zone.

  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const DAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const MON_RE = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';

  function midnight(d) {
    const r = new Date(d);
    r.setHours(0, 0, 0, 0);
    return r;
  }

  function parseTime(s) {
    const m = (s || '').match(/\b(\d{1,2}):(\d{2})\s*([ap])?\.?\s?m?\.?/i);
    if (!m) return null;
    let h = +m[1];
    const ap = m[3]?.toLowerCase();
    if (ap === 'p' && h < 12) h += 12;
    if (ap === 'a' && h === 12) h = 0;
    return { h, min: +m[2] };
  }

  function parseDay(s, now) {
    const t = (s || '').toLowerCase();
    const today = midnight(now);
    if (/\btoday\b/.test(t)) return today;
    if (/\byesterday\b/.test(t)) { today.setDate(today.getDate() - 1); return today; }

    const withYear = (y, mo, d) => {
      const r = new Date(y ?? now.getFullYear(), mo, d);
      if (y == null && r > now) r.setFullYear(r.getFullYear() - 1);
      return r;
    };
    let m = t.match(new RegExp(`\\b${MON_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`));
    if (m) return withYear(m[3] ? +m[3] : null, MONTHS[m[1]], +m[2]);
    m = t.match(new RegExp(`\\b(\\d{1,2})\\s+${MON_RE}(?:,?\\s+(\\d{4}))?`));
    if (m) return withYear(m[3] ? +m[3] : null, MONTHS[m[2]], +m[1]);
    m = t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/); // assumes US month/day/year
    if (m) return new Date(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1] - 1, +m[2]);
    m = t.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/);
    if (m) {
      // A bare weekday means within the last week; today itself would say "Today" or just a time.
      const back = (today.getDay() - DAYS[m[1]] + 7) % 7 || 7;
      today.setDate(today.getDate() - back);
      return today;
    }
    return null;
  }

  function formatDate(d, withTime) {
    const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return withTime ? `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}` : day;
  }

  // ---------- reading messages from the DOM ----------

  function elementKey(w) {
    return w.getAttribute('msg-id') || w.getAttribute('data-e2e-message-id') || w.getAttribute('data-message-id') || w.id || null;
  }

  function readMessage(w) {
    const outAttr = w.getAttribute('is-outgoing');
    const outgoing = outAttr != null
      ? outAttr === 'true'
      : !!(w.matches('[class*="outgoing"]') || w.querySelector('[class*="outgoing"]'));

    // Big animated emoji render as a Lottie animation with no text, so fall
    // back to the part's label ("You said: 😑. Sent on …").
    const labelText = (l) => l?.match(/\bsaid: ([\s\S]*?)\.\s+(?:Sent|Received)\b/i)?.[1] || '';
    let texts = [...w.querySelectorAll(SEL.textPart)]
      .map((p) => (p.querySelector(SEL.textInner) || p).innerText.trim() || labelText(p.getAttribute('aria-label')))
      .filter(Boolean);
    if (!texts.length) texts = [...w.querySelectorAll(SEL.textInner)].map((e) => e.innerText.trim()).filter(Boolean);

    const media = [];
    const seenSrc = new Set();
    // Keep the element so the downloader can wait for it to finish loading.
    const addMedia = (kind, src, el) => {
      if (!src || seenSrc.has(src) || src.startsWith('data:image/svg')) return;
      seenSrc.add(src);
      media.push({ kind, src, el });
    };
    for (const img of w.querySelectorAll('img')) {
      if (img.closest(SEL.skipImg)) continue;
      if (img.naturalWidth && img.naturalWidth < 40 && img.naturalHeight < 40) continue; // icons
      const gif = /\.gif\b/i.test(img.src) || !!img.closest('mws-gif-message-part, [class*="gif"]');
      // Pictures that are part of a link or map preview are kept, but marked as
      // previews: they're never opened, since clicking them opens the link.
      const preview = !gif && (!img.closest('mws-image-message-part') || !!img.closest('a, [class*="rich"], [class*="link-preview"], [class*="location"], [class*="map"]'));
      // An image that hasn't loaded yet has no src, and img.src then reports
      // the page's own URL; record it anyway and let the downloader wait.
      addMedia(gif ? 'gif' : preview ? 'preview' : 'image', img.getAttribute('src') ? img.currentSrc || img.src : `pending:${media.length}`, img);
    }
    for (const v of w.querySelectorAll('video')) addMedia('video', v.currentSrc || v.src || v.querySelector('source')?.src || `pending:${media.length}`, v);
    for (const a of w.querySelectorAll('audio')) addMedia('audio', a.currentSrc || a.src || a.querySelector('source')?.src || `pending:${media.length}`, a);

    let fallbackText = false;
    if (!texts.length && !media.length) {
      const t = w.innerText.trim();
      if (t) { texts = [t]; fallbackText = true; }
    }

    // Each message part's aria-label reads like
    //   'Alice said: hi. Received on Sep 3, 2024 at 4:05 PM.'
    //   'You sent an image. Sent on Sep 3, 2024 at 4:05 PM. Read.'
    // and replies add 'message from Bob: "quoted text".'
    const labels = [...new Set([w, ...w.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label')).filter(Boolean))];
    let replyTo = null;
    if (w.querySelector('mws-reply-message-part')) {
      for (const l of labels) {
        const r = l.match(/\bmessage from ([^:]{1,60}): "([\s\S]*?)"\.\s+(?:Sent|Received)\b/i);
        if (r) { replyTo = { sender: clean(r[1]), text: r[2] }; break; }
      }
    }
    return {
      id: elementKey(w),
      outgoing,
      text: texts.join('\n'),
      fallbackText,
      media,
      replyTo,
      sender: clean(w.querySelector(SEL.sender)?.innerText) || null,
      stampText: clean(w.querySelector(SEL.timestamp)?.innerText) || null,
      labels,
      details: messageDetails(w, labels),
    };
  }

  // Everything else the page shows about a message, for a complete archive:
  // delivery status, reactions, edits, link previews, links and attachments,
  // and how the message is built (its parts and attributes), so it could be
  // recreated or checked later.
  function messageDetails(w, labels) {
    const all = labels.join(' ');
    const d = {};
    // "… Sent on Oct 3 at 4:05 PM. Read." / "Delivered." / "Not sent" / "Failed to send"
    const st = all.match(/\b(Read|Delivered|Sent|Sending|Not sent|Failed to send|Failed|Seen)\.?\s*$/i)
      || [...all.matchAll(/\.\s+(Read|Delivered|Not sent|Failed to send|Failed|Seen)\b/gi)].pop();
    const statusEl = w.querySelector('mws-message-status, [data-e2e-message-status], .status-text');
    const status = clean(statusEl?.getAttribute('aria-label') || statusEl?.innerText) || st?.[1] || null;
    if (status) d.status = status;
    if (/\bedited\b/i.test(all) || w.querySelector('[class*="edited"]')) d.edited = true;
    // Reactions: each one's label says who reacted with what.
    const reacts = [...w.querySelectorAll('mws-reactions [aria-label], mws-reaction [aria-label], [class*="reaction"][aria-label]')]
      .map((e) => clean(e.getAttribute('aria-label'))).filter(Boolean);
    const reactText = clean(w.querySelector('mws-reactions')?.innerText);
    if (reacts.length || reactText) d.reactions = reacts.length ? [...new Set(reacts)] : [reactText];
    // Link and map previews: where they point and what they show.
    const previews = [...w.querySelectorAll('mws-rich-link-preview-part, [class*="link-preview"], [class*="rich-link"]')].map((p) => {
      const a = p.querySelector('a[href]');
      const lines = (p.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean);
      return { url: a?.href || null, title: lines[0] || null, text: lines.slice(1).join(' ') || null };
    }).filter((x) => x.url || x.title);
    if (previews.length) d.link_previews = previews;
    const links = [...new Set([...w.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => !/^javascript:/i.test(h)))];
    if (links.length) d.links = links;
    // Attachments that aren't pictures, video or audio (files, contact cards, locations).
    const files = [...w.querySelectorAll('[class*="attachment"], [class*="file"], mws-file-message-part, [download]')]
      .map((e) => clean(e.getAttribute('aria-label') || e.getAttribute('download') || e.innerText)).filter(Boolean);
    if (files.length) d.attachments = [...new Set(files)];
    d.parts = [...w.querySelectorAll(PART_TAGS)].map((e) => e.tagName.toLowerCase());
    if (!d.parts.length) delete d.parts;
    const attrs = {};
    for (const a of w.attributes) if (!/^(class|style|_ng|ng-)/.test(a.name)) attrs[a.name] = a.value;
    if (Object.keys(attrs).length) d.attributes = attrs;
    if (rawMarkup) d.raw_html = w.outerHTML;
    return d;
  }
  const PART_TAGS = 'mws-text-message-part, mws-image-message-part, mws-gif-message-part, mws-video-message-part, mws-audio-message-part, mws-file-message-part, mws-location-message-part, mws-vcard-message-part, mws-reply-message-part, mws-rich-link-preview-part, mws-reactions';
  // Settings → More settings: keep each message's page markup too (large).
  let rawMarkup = false;

  // Reading every message again on every pass gets slow in long chats, so each
  // message element's reading is kept until the page changes something in it.
  const readCache = new WeakMap();
  let readWatch = null;
  function cachedRead(w) {
    if (!readWatch) {
      readWatch = new MutationObserver((muts) => {
        for (const mu of muts) {
          const el = mu.target.nodeType === 1 ? mu.target : mu.target.parentElement;
          const msg = el?.closest?.(SEL.message);
          if (msg) readCache.delete(msg);
        }
      });
      readWatch.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    }
    let r = readCache.get(w);
    if (!r) { r = readMessage(w); readCache.set(w, r); }
    return r;
  }

  function senderFromLabels(labels) {
    for (const l of labels) {
      const m = l.match(/^(.{1,60}?) (?:said|sent)\b/i);
      const name = m && clean(m[1]);
      if (name && !/^(you|me)$/i.test(name)) return name;
    }
    return null;
  }

  // Finds the last "Received on <date> at <time>" / "Sent on <date> at <time>".
  function stampFromLabels(labels) {
    let found = null;
    for (const l of labels) {
      for (const m of l.matchAll(/\b(?:received|sent)\s+(?:on\s+)?((?:today|yesterday|[a-z]{3,9}\.?\s+\d{1,2}(?:,?\s+\d{4})?|\d{1,2}\s+[a-z]{3,9}\.?(?:,?\s+\d{4})?|\d{1,2}\/\d{1,2}\/\d{2,4}|(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*),?\s+)?at\s+(\d{1,2}:\d{2}\s*(?:[ap]\.?\s?m\.?)?)/gi)) {
        found = { day: m[1] || '', time: m[2], raw: clean(`${m[1] || ''} ${m[2]}`).replace(/\.$/, '') };
      }
    }
    return found;
  }

  // Reads every message currently rendered, in display order, with the date
  // section and group-chat sender label that applies to each one.
  function scrapeSnapshot(conv) {
    const nodes = document.querySelectorAll(`${SEL.tombstone}, ${SEL.message}, ${SEL.sender}`);
    const out = [];
    const repeats = new Map();
    let sectionRaw = '';
    let sectionDay = null;
    let sectionTime = null;
    let lastSender = null;

    const events = [];
    for (const n of nodes) {
      if (n.matches(SEL.tombstone)) {
        const raw = clean(n.innerText);
        const t = parseTime(raw);
        const day = parseDay(raw, conv.now);
        // Not a date heading: a conversation event ("Alice named the group…").
        if (!t && !day && raw) {
          events.push({ text: raw, after: out.length ? out[out.length - 1].key : null, section: sectionRaw || null, timestamp: out.length ? out[out.length - 1].timestamp : null });
          continue;
        }
        sectionRaw = raw;
        sectionTime = t;
        sectionDay = day || (sectionTime ? midnight(conv.now) : sectionDay);
        continue;
      }
      if (!n.matches(SEL.message)) {
        // A sender name shown above a run of messages in a group chat.
        if (!n.closest(SEL.message)) lastSender = clean(n.innerText) || lastSender;
        continue;
      }

      const m = cachedRead(n);
      const fromLabel = stampFromLabels(m.labels);
      const ownRaw = fromLabel?.raw || m.stampText;
      const ownTime = fromLabel ? parseTime(fromLabel.time) : parseTime(m.stampText);
      const ownDay = fromLabel ? parseDay(fromLabel.day, conv.now) : m.stampText ? parseDay(m.stampText, conv.now) : null;
      const day = ownDay || sectionDay;
      const time = ownTime || sectionTime;
      let when = null;
      if (day) {
        when = new Date(day);
        if (time) when.setHours(time.h, time.min, 0, 0);
      }

      let sender;
      if (m.outgoing) {
        sender = 'Me';
        lastSender = null;
      } else {
        sender = m.sender || senderFromLabels(m.labels) || lastSender || conv.title;
        lastSender = sender;
      }

      let key = m.id;
      if (!key) {
        const base = `${m.outgoing}|${sectionRaw}|${m.text}|${m.media.map((x) => x.src).join(',')}`;
        const k = (repeats.get(base) || 0) + 1;
        repeats.set(base, k);
        key = `${base}#${k}`;
      }

      out.push({
        key,
        id: m.id || undefined,
        direction: m.outgoing ? 'sent' : 'received',
        sender,
        timestamp: when ? formatDate(when, !!time) : null,
        timestamp_precision: ownTime ? 'message' : time ? 'section' : day ? 'day' : 'unknown',
        timestamp_raw: ownRaw || sectionRaw || null,
        section: sectionRaw || null,
        text: m.text,
        text_is_fallback: m.fallbackText || undefined,
        reply_to: m.replyTo || undefined,
        media: m.media.map((md) => ({ ...md })),
        label: m.labels.join(' | ') || undefined,
        details: m.details,
      });
    }
    out.events = events;
    return out;
  }

  // ---------- media ----------

  const EXT = {
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
    'image/heic': 'heic', 'image/heif': 'heif', 'image/bmp': 'bmp',
    'video/mp4': 'mp4', 'video/3gpp': '3gp', 'video/webm': 'webm', 'video/quicktime': 'mov',
    'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/amr': 'amr', 'audio/ogg': 'ogg',
    'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'webm',
  };
  const extFor = (type, kind) =>
    EXT[(type || '').split(';')[0].trim().toLowerCase()] || { image: 'jpg', gif: 'gif', video: 'mp4', audio: 'm4a' }[kind] || 'bin';
  const nf = (n) => Number(n).toLocaleString();
  const fmtBytes = (b) => b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : b < 1073741824 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1073741824).toFixed(2)} GB`;

  // A media address is only usable if it points at the file itself. An image
  // that hasn't loaded yet reports the Messages page URL instead, and fetching
  // that saves a web page with a .jpg name (the "broken image" bug).
  const isMediaUrl = (s) => !!s && /^(blob:|https?:|data:)/i.test(s) && !/^https:\/\/messages\.google\.com\/web(\/|$|\?)/i.test(s);
  const srcOf = (el) => el.currentSrc || (el.getAttribute('src') ? el.src : '') || el.querySelector?.('source')?.src || '';

  // Identify a file from its first bytes rather than trusting the URL or the
  // reported type. Returns null for anything that isn't a known media format.
  async function sniff(blob) {
    const b = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    const s = (i, n) => String.fromCharCode(...b.slice(i, i + n));
    if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
    if (s(1, 3) === 'PNG') return 'image/png';
    if (s(0, 3) === 'GIF') return 'image/gif';
    if (s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return 'image/webp';
    if (s(0, 4) === 'RIFF' && s(8, 4) === 'WAVE') return 'audio/wav';
    if (s(4, 4) === 'ftyp') {
      const brand = s(8, 4);
      if (/^(hei|hev|mif1|msf1|avif)/.test(brand)) return brand === 'avif' ? 'image/avif' : 'image/heic';
      if (/^3g/.test(brand)) return 'video/3gpp';
      if (/^M4A/.test(brand)) return 'audio/mp4';
      if (/^qt/.test(brand)) return 'video/quicktime';
      return 'video/mp4';
    }
    if (s(0, 5) === '#!AMR') return 'audio/amr';
    if (s(0, 4) === 'OggS') return 'audio/ogg';
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
    if (s(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
    if (s(0, 2) === 'BM') return 'image/bmp';
    return null;
  }

  // Where a media address points, for the log ("blob" for the page's own copy).
  const hostOf = (src) => { try { return src.startsWith('blob:') ? 'blob' : src.startsWith('data:') ? 'data' : new URL(src).host; } catch { return '?'; } };

  // Fetches a media file from the page first, then (for web addresses the page
  // isn't allowed to read) through the extension. Returns { blob } or, when it
  // can't, { why } saying what each attempt got, and `blocked` if the file is on
  // a website the extension hasn't been allowed to read.
  async function fetchBlob(src) {
    const why = [];
    try {
      const res = await fetch(src, { credentials: 'include' });
      if (res.ok) return { blob: await res.blob() };
      why.push(`page: HTTP ${res.status}`);
    } catch (e) { why.push(`page: ${e.message}`); }
    if (/^https?:/i.test(src) && mediaSink) {
      try {
        const res = await mediaSink.fetchMedia(src);
        if (res?.blob) return { blob: res.blob };
        if (res?.blocked) return { why: `${hostOf(src)} isn’t a site the extension may read`, blocked: true };
      } catch (e) { why.push(`backup frame: ${e.message}`); }
    }
    // Without the frame (date-range zips, the contact card before a backup
    // starts), or if it failed: through the background worker, as base64.
    if (/^https?:/i.test(src)) {
      try {
        const res = await chrome.runtime.sendMessage({ type: 'gm-fetch', url: src });
        if (res?.ok) {
          const bin = atob(res.b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return { blob: new Blob([bytes], { type: res.type }) };
        }
        if (res?.blocked) return { why: `${hostOf(src)} isn’t a site the extension may read`, blocked: true };
        why.push(`extension: ${res?.error || 'no answer'}`);
      } catch (e) { why.push(`extension: ${e.message}`); }
    }
    return { why: `${hostOf(src)} · ${why.join('; ')}` };
  }

  // The element for a media item, re-found by message ID if Messages re-rendered it.
  function liveElement(m, md, idx) {
    if (md.el?.isConnected) return md.el;
    if (!m.id) return null;
    const core = document.querySelector(`[msg-id="${CSS.escape(m.id)}"], [data-e2e-message-id="${CSS.escape(m.id)}"]`);
    const w = core?.closest(SEL.message) || core;
    const els = w ? [...w.querySelectorAll('img, video, audio')].filter((e) => !e.closest(SEL.skipImg)) : [];
    return els[idx] || null;
  }

  // Scrolls the media into view and waits until it has really loaded.
  async function waitForMedia(el) {
    const ready = () => isMediaUrl(srcOf(el)) && (el.tagName !== 'IMG' || (el.complete && el.naturalWidth > 0));
    if (ready()) return true;
    el.scrollIntoView({ block: 'center' });
    for (let i = 0; i < 35 && !ready() && !cancelled; i++) await sleep(200);
    return ready();
  }

  // One trip to the full-size viewer per photo: a second picture in the same
  // photo (Messages' placeholder) would only fetch the same image again.
  function firstInPhoto(el) {
    const holder = el.closest('mws-image') || el.closest('mws-image-message-part');
    return !holder || [...holder.querySelectorAll('img')].filter((e) => !e.closest(SEL.skipImg))[0] === el;
  }

  // Opens a photo in Messages' own full-screen viewer and returns the image
  // shown there, which can be larger than the chat thumbnail.
  async function fullSizeFromViewer(img) {
    const target = img.closest('mws-image') || img;
    if (target.closest('a')) return null;
    target.scrollIntoView({ block: 'center' });
    target.click();
    // If Messages' viewer doesn't open quickly, keep the thumbnail and move on.
    for (let i = 0; i < 16 && !document.querySelector('mws-lightbox') && !cancelled; i++) await sleep(150);
    if (!document.querySelector('mws-lightbox')) return null;
    let big = null;
    for (let i = 0; i < 40 && !cancelled; i++) {
      await sleep(150);
      big = document.querySelector('mws-lightbox img');
      if (big?.complete && big.naturalWidth && isMediaUrl(srcOf(big))) break;
    }
    await sleep(500); // give a higher-resolution swap a moment
    big = document.querySelector('mws-lightbox img');
    const found = big?.naturalWidth && isMediaUrl(srcOf(big)) ? { src: srcOf(big), w: big.naturalWidth, h: big.naturalHeight } : null;
    const close = [...document.querySelectorAll('mws-lightbox button, mw-lightbox-wrapper button')].find((b) => /exit|close|back/i.test(b.getAttribute('aria-label') || ''));
    if (close) close.click();
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    for (let i = 0; i < 20 && document.querySelector('mws-lightbox'); i++) await sleep(100);
    return found;
  }

  // Saves the exact bytes Messages for Web holds, never a re-encoded copy. For
  // SMS/MMS that is whatever size the carrier delivered; RCS photos arrive full size.
  async function downloadMedia(m, md, idx, opts = {}) {
    let problem = 'unknown error';
    let detail = '';
    for (let attempt = 1; attempt <= 3 && !cancelled; attempt++) {
      const el = liveElement(m, md, idx);
      if (!el) detail = 'its element is no longer on the page';
      if (el) {
        await waitForMedia(el);
        const s = srcOf(el);
        if (isMediaUrl(s)) { md.src = s; md.source = el.tagName === 'IMG' ? 'chat thumbnail' : `${el.tagName.toLowerCase()} element`; }
        if (el.tagName === 'IMG' && el.naturalWidth) { md.w = el.naturalWidth; md.h = el.naturalHeight; }
        if (el.tagName === 'VIDEO' && el.videoWidth) { md.w = el.videoWidth; md.h = el.videoHeight; }
        if (opts.fullSize && el.tagName === 'IMG' && md.kind === 'image' && el.closest('mws-image-message-part') && firstInPhoto(el) && !el.closest('a') && attempt === 1) {
          const big = await fullSizeFromViewer(el);
          if (big && big.w * big.h > (md.w || 0) * (md.h || 0)) {
            md.src = big.src; md.w = big.w; md.h = big.h; md.source = 'full-size viewer';
          } else if (big) {
            md.source = 'chat thumbnail (same size as the full-size viewer)';
          }
        }
      }
      if (!isMediaUrl(md.src)) {
        problem = 'never finished loading';
        if (el) detail = `${el.tagName.toLowerCase()}${el.tagName === 'IMG' ? ` complete=${el.complete} width=${el.naturalWidth}` : ''} src=${hostOf(srcOf(el) || 'none')}`;
      } else {
        const { blob, why, blocked } = await fetchBlob(md.src);
        // A link or map preview's picture usually lives on the linked website
        // (Spotify, TikTok, a news site…). That isn't your media, so unless
        // Settings allows reading other websites it's noted and skipped.
        if (blocked && md.kind === 'preview') return { skipped: `link preview picture from ${hostOf(md.src)} (another website)` };
        if (!blob) {
          problem = 'could not be fetched';
          detail = why;
        } else {
          const type = await sniff(blob);
          if (type) return { blob: blob.type === type ? blob : new Blob([blob], { type }), type };
          const head = new TextDecoder().decode(await blob.slice(0, 64).arrayBuffer()).trim();
          problem = head.startsWith('<') ? 'got a web page instead of the file' : `unrecognised file (${blob.type || 'no type'})`;
          detail = `${hostOf(md.src)} sent ${fmtBytes(blob.size)} of ${blob.type || 'no type'} starting “${head.slice(0, 24).replace(/\s+/g, ' ')}”`;
        }
      }
      if (attempt < 3) {
        HUD.log(`  ↻ ${md.kind} ${problem}; retrying (${attempt + 1}/3)`, 'warn');
        HUD.debug(`    ${md.kind} from ${m.sender}, ${m.timestamp || 'undated'}, message ${m.id || '?'}: ${detail}`);
        await sleep(800 * attempt);
      }
    }
    return { error: problem, detail };
  }

  // "2026-10-03 14.05 - Mom.jpg", with " (2)" etc. if that name is taken.
  // A name is claimed before checking the folder, so saves running side by
  // side never pick the same one.
  async function uniqueName(sink, dir, base, ext, used) {
    for (let n = 1; ; n++) {
      const name = `${base}${n > 1 ? ` (${n})` : ''}.${ext}`;
      const key = `${dir}/${name}`.toLowerCase();
      if (used.has(key)) continue;
      used.add(key);
      if (!(await sink.exists(`${dir}/${name}`))) return name;
    }
  }
  const mediaBaseName = (m) => `${m.timestamp ? m.timestamp.replace(':', '.') : 'undated'} - ${safeName(m.sender)}`;

  // ---------- where files go ----------
  // Backups write straight into the backup folder (File System Access API) as
  // each piece is read. Only a date-range copy is built as a zip and downloaded.

  // Both record the SHA-256 of everything they write, for SHA256SUMS.txt.
  class ZipSink {
    constructor(root) { this.root = root; this.zip = new GMZip.ZipWriter(); this.hashes = new Map(); }
    async exists(path) { return this.zip.names.has(`${this.root}/${path}`); }
    async write(path, data) { this.hashes.set(path, await sha256(data)); await this.zip.add(`${this.root}/${path}`, data); }
    get bytes() { return this.zip.size; }
  }

  // The backup folder belongs to the extension (chosen in Settings), so the
  // reading and writing happens in a small extension frame on this page; this
  // talks to it over a private MessageChannel. Blobs pass straight through.
  class FrameSink {
    constructor(frame, port) {
      this.frame = frame;
      this.port = port;
      this.bytes = 0;
      this.hashes = new Map();
      this.seq = 1;
      this.waiting = new Map();
      port.onmessage = ({ data }) => {
        const w = this.waiting.get(data.id);
        if (!w) return;
        this.waiting.delete(data.id);
        if (data.ok) w.resolve(data.result);
        else w.reject(Object.assign(new Error(data.error), { name: data.name }));
      };
    }

    static async open() {
      document.getElementById('gm-writer')?.remove();
      const frame = document.createElement('iframe');
      frame.id = 'gm-writer';
      frame.src = chrome.runtime.getURL('writer.html');
      frame.style.cssText = 'position:fixed;width:0;height:0;border:0;left:0;top:0;z-index:2147483647;color-scheme:normal';
      const loaded = new Promise((r) => { frame.onload = r; });
      document.documentElement.append(frame);
      await loaded;
      const { port1, port2 } = new MessageChannel();
      const ready = new Promise((resolve, reject) => {
        port1.onmessage = ({ data }) => (data.id === 0 ? resolve() : null);
        setTimeout(() => reject(new Error('The backup folder helper didn’t start. Reload this tab and try again.')), 8000);
      });
      frame.contentWindow.postMessage({ type: 'gm-writer-init' }, new URL(frame.src).origin, [port2]);
      await ready;
      return (mediaSink = new FrameSink(frame, port1));
    }

    call(op, args) {
      const id = this.seq++;
      return new Promise((resolve, reject) => {
        this.waiting.set(id, { resolve, reject });
        this.port.postMessage({ id, op, args });
      });
    }

    async exists(path) { return this.call('exists', { path }); }
    async readText(path) { return this.call('readText', { path }); }
    async write(path, data) {
      this.hashes.set(path, await sha256(data));
      await this.call('write', { path, data });
      this.bytes += typeof data === 'string' ? new TextEncoder().encode(data).length : data.size;
    }
    // Working files (the journal of a backup in progress): not part of the
    // checksums, since they're folded into messages.json and removed.
    async writeTemp(path, data) {
      await this.call('write', { path, data });
      this.bytes += typeof data === 'string' ? new TextEncoder().encode(data).length : data.size;
    }
    async remove(path) {
      for (const p of [...this.hashes.keys()]) if (p === path || p.startsWith(`${path}/`)) this.hashes.delete(p);
      (this.removed ||= new Set()).add(path);
      return this.call('remove', { path });
    }
    async list(path) { return this.call('list', { path }); }
    async joinCsv(out, parts) {
      const { sha256: hash, size } = await this.call('joinCsv', { out, parts });
      this.hashes.set(out, hash);
      this.bytes += size;
    }

    // Shows the frame's "Allow access" card in the middle of the page.
    async askPermission() {
      this.frame.style.cssText = 'position:fixed;inset:auto;left:50%;top:50%;transform:translate(-50%,-50%);width:400px;height:236px;margin:0;padding:0;border:0;border-radius:24px;z-index:2147483647;box-shadow:0 2px 3px rgba(0,0,0,.3),0 6px 10px 4px rgba(0,0,0,.15);color-scheme:normal';
      // In the top layer too, above the progress panel.
      const wasCentral = HUD.central;
      HUD.yieldTop(true);
      this.frame.setAttribute('popover', 'manual');
      try { this.frame.showPopover(); } catch { /* z-index only */ }
      try { return await this.call('ask'); } finally {
        try { this.frame.hidePopover(); } catch { /* not shown */ }
        if (wasCentral) HUD.yieldTop(false);
        this.frame.removeAttribute('popover');
        this.frame.style.cssText = 'position:fixed;width:0;height:0;border:0;left:0;top:0';
      }
    }

    fetchMedia(url) { return this.call('fetch', { url }); }

    close() { this.frame.remove(); if (mediaSink === this) mediaSink = null; }
  }

  // ---------- one conversation ----------

  function findScroller(from) {
    for (let el = from?.parentElement; el && el !== document.documentElement; el = el.parentElement) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return el;
    }
    return null;
  }

  function updateStats(ctx) {
    HUD.stats([['Messages', nf(ctx.msgs)], ['Media', nf(ctx.media)], ['Failed', nf(ctx.failed)], ['Size', fmtBytes(ctx.sink?.bytes || 0)]]);
  }

  // Messages loads older history from the phone in batches of about 50, with a
  // spinner at the top of the chat while it works. It only asks for the next
  // batch when the list is scrolled up to the top from further down, and after
  // each batch it keeps your place (the list jumps down). So every pass leaves
  // the top, lets the page see that, and then goes back up.
  const BATCH = 50;
  const nextFrame = () => new Promise((r) => {
    const t = setTimeout(r, 150); // hidden tabs don't draw frames
    requestAnimationFrame(() => { clearTimeout(t); r(); });
  });
  async function scrollToTop(scroller) {
    scroller.scrollTop = Math.max(1, Math.min(scroller.scrollHeight - scroller.clientHeight, Math.round(scroller.clientHeight * 1.5)));
    await nextFrame();
    await nextFrame();
    await sleep(300);
    scroller.scrollTop = 0;
  }
  const spinning = () => [...document.querySelectorAll('mws-messages-list mws-spinner, mws-messages-list mat-progress-spinner, mws-bottom-anchored mws-spinner, mws-bottom-anchored mat-progress-spinner')]
    .some((sp) => sp.offsetParent && !sp.closest('.hide'));

  // Reads the open conversation, scrolling up for older history. With
  // `opts.stopAt` (updates) it stops as soon as it reaches messages that are
  // already saved. `opts.onSnapshot` sees each read of the page (to save media
  // that has loaded meanwhile); `opts.onPass` runs after each batch.
  //
  // It only decides it has reached the first message on evidence: a batch
  // smaller than a full one (or a chat that never had a full one) followed by
  // further tries that found nothing, or several tries over a long quiet spell.
  // The evidence is returned in `.history`, and saved with the chat.
  async function collectConversation(conv, opts) {
    let merged = [];
    const byKey = new Map();
    // Each snapshot is in display order. Messages from the new snapshot come
    // first; anything we saw earlier that has since left the DOM (if the page
    // unloads newer messages while scrolling up) is kept after them.
    const events = new Map();
    const snapshot = () => {
      const snap = scrapeSnapshot(conv);
      for (const ev of snap.events) events.set(`${ev.section}|${ev.text}`, ev);
      const snapKeys = new Set();
      const next = snap.map((m) => {
        snapKeys.add(m.key);
        byKey.set(m.key, m);
        return m;
      });
      for (const m of merged) if (!snapKeys.has(m.key)) next.push(m);
      merged = next;
    };
    const stop = opts.stopAt;
    const overlapped = () => (stop && merged.some((m) => (m.id && stop.ids.has(m.id)) || (stop.lastT && m.timestamp && m.timestamp <= stop.lastT)))
      || (opts.range && merged.some((m) => m.timestamp && m.timestamp.slice(0, 10) < opts.range.from));

    snapshot();
    opts.onSnapshot?.(merged);
    HUD.log(`  ${nf(merged.length)} messages on screen`);
    if (opts.fullHistory || stop || opts.range) {
      const quietNeeded = (opts.patience || 25) * 1000;
      const startedAt = Date.now();
      const startCount = merged.length;
      const count = () => document.querySelectorAll(SEL.message).length;
      let quietSince = Date.now();
      let passes = 0;
      let batches = 0;
      let lastBatch = null;
      let tries = 0; // passes since the last batch that found nothing
      // Fewer than a full batch on screen, or a short last batch, means
      // Messages has probably sent everything; a few more tries confirm it.
      let short = merged.length < BATCH;
      // A hidden tab may not load older history at all, which would look like
      // the start of the chat; never call a chat complete from such a run.
      let sawHidden = document.hidden;
      let end = null;
      let stuck = false;
      // Like refreshing the page: when Messages goes quiet without any sign
      // that it reached the start, the chat is reopened once and loading
      // carries on. Messages already read are kept.
      let reopened = false;
      const reopen = async (why) => {
        reopened = true;
        HUD.log(`  ↻ ${why}; reopening the chat and carrying on (${nf(merged.length)} messages already read are kept)`, 'warn');
        await reopenConversation(conv);
        HUD.debug(`    reopened: ${count()} messages on screen`);
        tries = 0;
        quietSince = Date.now();
      };
      HUD.debug(`  history: ${count()} on page, patience ${quietNeeded / 1000}s, stop at ${stop ? `${stop.ids.size} saved IDs / ${stop.lastT || 'no time'}` : opts.range ? `before ${opts.range.from}` : 'the first message'}`);
      while (!cancelled && !overlapped()) {
        await checkpoint();
        sawHidden ||= document.hidden;
        const scroller = findScroller(document.querySelector(SEL.message));
        if (!scroller) { end = { method: 'fits on screen', detail: `All ${nf(merged.length)} messages fit on screen` }; break; }
        const beforeCount = count();
        const beforeFirst = firstMessageSignature();
        await scrollToTop(scroller);
        passes++;
        const quietFor = Math.round((Date.now() - quietSince) / 1000);
        HUD.task(null, null, tries ? `checking for older messages · try ${tries + 1}${quietFor > 4 ? ` · ${quietFor}s` : ''}` : `loading older messages · batch ${batches + 1}`, `${nf(merged.length)} msgs`);
        // Wait for the batch: up to 12 seconds, or up to a minute while
        // Messages' own spinner says it's still fetching from the phone.
        const t0 = Date.now();
        let grew = false;
        let worked = false; // used the wait for full-size photos (experimental)
        let offered = false;
        const arrived = () => count() !== beforeCount || firstMessageSignature() !== beforeFirst;
        while (!cancelled) {
          await sleep(250);
          if (arrived()) { grew = true; break; }
          const waited = Date.now() - t0;
          // Once Messages has had a moment to see the list at the top and ask
          // the phone for more, the wait can be used for full-size photos.
          if (opts.betweenBatches && !offered && waited > 600) {
            offered = true;
            worked = (await opts.betweenBatches(merged, arrived)) > 0;
            continue;
          }
          if (waited > 60000 || (waited > 12000 && !spinning())) break;
        }
        const waited = ((Date.now() - t0) / 1000).toFixed(1);
        // Let the whole batch render before reading it.
        if (grew) for (let n = -1, i = 0; i < 12 && n !== count(); i++) { n = count(); await sleep(250); }
        const before = merged.length;
        snapshot();
        opts.onSnapshot?.(merged);
        // A batch is what appeared on the page; after reopening, that can be
        // messages already read, which still shows Messages is sending history.
        const fresh = merged.length - before;
        const got = Math.max(fresh, count() - beforeCount);
        HUD.debug(`  pass ${passes}: ${waited}s, on page ${beforeCount}→${count()}, new ${fresh}, spinner ${spinning() ? 'on' : 'off'}, scroll ${Math.round(scroller.scrollTop)}/${scroller.scrollHeight} (view ${scroller.clientHeight})${document.hidden ? ', tab hidden' : ''}`);
        if (got > 0) {
          batches++;
          lastBatch = got;
          tries = 0;
          short = got < BATCH;
          quietSince = Date.now();
          const back = merged.find((m) => m.timestamp)?.timestamp;
          const perMin = Math.round(((merged.length - startCount) / Math.max(1, Date.now() - startedAt)) * 60000);
          HUD.log(fresh ? `  ▲ ${nf(merged.length)} loaded (+${fresh} in ${waited}s) · back to ${back || '?'} · ${nf(perMin)}/min` : `  ↻ catching up: ${nf(count())} on screen again of ${nf(merged.length)} read`);
          HUD.task(null, null, `back to ${back ? back.slice(0, 10) : '?'} · ${nf(perMin)} messages a minute`, `${nf(merged.length)} msgs`);
        } else {
          // A pass spent on full-size photos isn't a fair try: the photo viewer
          // may have held up the batch. Only quiet passes count towards the end.
          if (!worked) tries++;
          if (tries === 1 || tries % 3 === 0) HUD.log(`  · nothing older yet (try ${tries}${spinning() ? ', Messages is still loading' : ''})`);
        }
        if (opts.onPass) {
          // Time spent saving isn't time spent waiting for older messages.
          const t = Date.now();
          await opts.onPass(merged);
          quietSince += Date.now() - t;
        }
        if (!got && !spinning()) {
          const secs = Math.round((Date.now() - quietSince) / 1000);
          if (short && batches && tries >= 2) {
            end = { method: 'short last batch', detail: `The last batch had ${lastBatch} messages (a full one has ${BATCH}), then ${tries} more tries over ${secs}s found nothing older` };
          } else if (short && !batches && tries >= 3) {
            end = { method: 'short chat', detail: `Only ${nf(merged.length)} messages, and ${tries} tries over ${secs}s found nothing older` };
          } else if (tries >= 3 && Date.now() - quietSince >= quietNeeded) {
            if (!reopened && conv.id) { await reopen('nothing older for a while, with no sign this is the start'); continue; }
            end = { method: 'quiet', detail: `${tries} tries over ${secs}s found nothing older, also after reopening the chat` };
          }
          if (end) break;
        }
        // A spinner that never finishes: try reopening once, then stop for now
        // without calling the chat complete.
        if (!got && Date.now() - quietSince > Math.max(4 * quietNeeded, 180000)) {
          if (!reopened && conv.id) { await reopen('Messages kept loading without sending anything'); continue; }
          stuck = true;
          break;
        }
      }
      const history = { batches, passes, loaded: merged.length - startCount, seconds: Math.round((Date.now() - startedAt) / 1000), ...(reopened ? { reopened: true } : {}), ...(end || {}) };
      merged.events = [...events.values()];
      HUD.debug(`  history done: ${JSON.stringify(history)}${stuck ? ' (stuck)' : ''}${sawHidden ? ' (tab was hidden)' : ''}`);
      merged.history = history;
      if (overlapped()) HUD.log(stop ? '  reached messages already saved' : `  reached messages before ${opts.range.from}`, 'ok');
      else if (cancelled) { /* nothing to add */ }
      else if (sawHidden) { history.stopped_reason = 'Older messages don’t load while the tab is in the background. A backup with the tab in front finishes this chat.'; HUD.log(`  no older messages loaded while the tab was in the background (${nf(merged.length)} so far); a run with the tab in front will finish this chat`, 'warn'); }
      else if (stuck) { history.stopped_reason = 'Messages kept loading without sending anything older. Check the phone is online, then run the backup again.'; HUD.log('  Messages kept loading without sending anything older; is the phone online? Run it again to carry on', 'warn'); }
      else if (end) { HUD.log(`  reached the first message (${nf(merged.length)} total). ${end.detail}`, 'ok'); merged.reachedStart = true; }
    }
    HUD.task(1, 1, 'history loaded', `${nf(merged.length)} msgs`);
    merged.events ||= [...events.values()];
    return merged;
  }

  // Writes one message's downloaded media (`got`: [{ md, r }], r being
  // { blob, type } or { error }). When a message has a GIF, its still preview
  // image (no larger than the GIF) is left out. What was saved is remembered in
  // ctx.done by message, since the page is read afresh on every pass.
  // Marks pictures in `got` that are another copy of a picture in the same
  // message (a GIF's still preview, or a thumbnail beside the full-size
  // photo), keeping only the best copy. Different photos never match.
  async function dropSamePictures(got, quiet) {
    const pics = got.filter((g) => g.r.blob && g.r.type?.startsWith('image/'));
    if (pics.length < 2) return;
    for (const g of pics) {
      g.fp = await GMLib.imageFingerprint(g.r.blob);
      g.cmp = { gif: g.r.type === 'image/gif', w: g.fp?.w || g.md.w, h: g.fp?.h || g.md.h, size: g.r.blob.size };
    }
    for (let i = 0; i < pics.length; i++) {
      for (let j = i + 1; j < pics.length; j++) {
        const [a, b] = [pics[i], pics[j]];
        if (a.md.dropped || b.md.dropped) continue;
        // Pictures the browser can't fingerprint fall back to the old rule: a
        // still no bigger than a GIF beside it is the GIF's preview.
        const unknown = !a.fp || !b.fp;
        const gifPreview = unknown && a.cmp.gif !== b.cmp.gif && (() => { const [gif, still] = a.cmp.gif ? [a, b] : [b, a]; return !(gif.cmp.w * gif.cmp.h) || still.cmp.w * still.cmp.h <= gif.cmp.w * gif.cmp.h; })();
        if (!GMLib.sameImage(a.fp, b.fp) && !gifPreview) continue;
        const keep = GMLib.betterCopy(a.cmp, b.cmp) === a.cmp ? a : b;
        const drop = keep === a ? b : a;
        drop.md.dropped = true;
        drop.md.leftOut = { kind: drop.cmp.gif ? 'gif' : 'image', reason: keep.cmp.gif && !drop.cmp.gif ? 'gif-preview' : 'duplicate', ...(drop.cmp.w ? { width: drop.cmp.w, height: drop.cmp.h } : {}) };
        if (!quiet) HUD.log(`  · left out ${keep.cmp.gif && !drop.cmp.gif ? 'the still preview of a GIF' : `a smaller copy of the same picture (${drop.cmp.w}×${drop.cmp.h}, kept ${keep.cmp.w}×${keep.cmp.h})`}`);
        HUD.debug(`    same picture twice: kept ${keep.r.type} ${keep.cmp.w}×${keep.cmp.h}, left out ${drop.r.type} ${drop.cmp.w}×${drop.cmp.h}`);
      }
    }
  }

  async function writeMessageMedia(m, folder, ctx, got, quiet = false) {
    await dropSamePictures(got, quiet);
    ctx.used ||= new Set();
    await Promise.all(got.map(async ({ md, r }) => {
      if (r.skipped) {
        md.skipped = r.skipped;
        md.error = undefined;
        ctx.skipped = (ctx.skipped || 0) + 1;
        if (!quiet) HUD.log(`  · not saved: ${r.skipped}`);
        return;
      }
      if (r.error) {
        md.error = r.error;
        ctx.failed++;
        HUD.log(`  ✗ ${md.kind} from ${m.sender}, ${m.timestamp || 'undated'}: ${r.error}`, 'err');
        if (r.detail) HUD.debug(`    message ${m.id || '?'}: ${r.detail}`);
        return;
      }
      if (md.dropped) return;
      await saveMediaFile(m, md, r, folder, ctx);
      if (!quiet) HUD.log(`  ✓ ${md.kind}${md.w ? ` ${md.w}×${md.h}` : ''} · ${fmtBytes(r.blob.size)}${md.source === 'full-size viewer' ? ' · full size' : ''} → ${name}`, 'ok');
    }));
    ctx.done ||= new Map();
    ctx.done.set(GMLib.keyOf(m), m.media.map((md) => ({ file: md.file, sha256: md.sha256, w: md.w, h: md.h, bytes: md.bytes, kind: md.kind, source: md.source, error: md.error, skipped: md.skipped, dropped: md.dropped, leftOut: md.leftOut })));
    const skipped = m.media.filter((md) => md.dropped).length;
    if (skipped) { m.left_out = m.media.filter((md) => md.dropped).map((md) => md.leftOut).filter(Boolean); m.media = m.media.filter((md) => !md.dropped); m.previews_skipped = skipped; }
    updateStats(ctx);
  }

  // Writes one media file and records what it really is: its kind from its
  // bytes, its true size in pixels (read from the file, not the page) and in bytes.
  async function saveMediaFile(m, md, r, folder, ctx) {
    md.kind = r.type === 'image/gif' ? 'gif' : r.type.startsWith('video/') ? 'video' : r.type.startsWith('audio/') ? 'audio' : md.kind === 'preview' ? 'preview' : 'image';
    if (r.type.startsWith('image/')) {
      try { const b = await createImageBitmap(r.blob); md.w = b.width; md.h = b.height; b.close(); } catch { /* a format Chrome can't draw: keep the page's size */ }
    }
    md.bytes = r.blob.size;
    ctx.used ||= new Set();
    const name = await uniqueName(ctx.sink, `${folder}/media`, mediaBaseName(m), extFor(r.type, md.kind), ctx.used);
    await ctx.sink.write(`${folder}/media/${name}`, r.blob);
    md.file = `media/${name}`;
    md.sha256 = ctx.sink.hashes.get(`${folder}/media/${name}`);
    md.error = undefined;
    md.skipped = undefined;
    ctx.media++;
    return name;
  }

  // Copies media saved on an earlier read of the page onto this read's copy of the message.
  function applyDone(m, ctx) {
    const done = ctx.done?.get(GMLib.keyOf(m));
    if (!done || m.doneApplied || m.media.length !== done.length) return;
    m.doneApplied = true;
    m.media.forEach((md, i) => {
      const d = done[i];
      if (d.file) Object.assign(md, { file: d.file, sha256: d.sha256, w: d.w, h: d.h, bytes: d.bytes, kind: d.kind, source: d.source });
      else if (d.error) md.error = d.error;
      else if (d.skipped) md.skipped = d.skipped;
      if (d.dropped) { md.dropped = true; md.leftOut = d.leftOut; }
    });
    const skipped = m.media.filter((md) => md.dropped).length;
    if (skipped) { m.left_out = m.media.filter((md) => md.dropped).map((md) => md.leftOut).filter(Boolean); m.media = m.media.filter((md) => !md.dropped); m.previews_skipped = skipped; }
  }

  const isReady = (el) => !!el?.isConnected && isMediaUrl(srcOf(el)) && (el.tagName !== 'IMG' || (el.complete && el.naturalWidth > 0));
  const needsViewer = (md, el, opts) => !!opts.fullSize && md.kind === 'image' && el?.tagName === 'IMG' && !!el.closest('mws-image-message-part') && !el.closest('a');

  // Saves media that has already loaded on the page, several messages at a
  // time. Nothing here scrolls or clicks, so it runs while older history is
  // still loading. Media that hasn't loaded yet, or that needs Messages'
  // full-size viewer, is left for saveMedia's one-by-one pass; so is anything
  // that fails here, which that pass retries properly.
  function mediaSaver(folder, ctx, opts, skip = () => false) {
    const queue = [];
    const taken = new Set();
    const waiters = [];
    let active = 0;
    const LIMIT = 4;
    const readyAll = (m) => m.media.every((md, idx) => {
      if (md.file) return true;
      const el = liveElement(m, md, idx);
      return isReady(el) && !needsViewer(md, el, opts);
    });

    async function work(m, key) {
      const got = [];
      for (let idx = 0; idx < m.media.length; idx++) {
        const md = m.media[idx];
        if (md.file) continue;
        const el = liveElement(m, md, idx);
        if (!isReady(el)) { taken.delete(key); return; }
        const src = srcOf(el);
        const { blob } = await fetchBlob(src);
        const type = blob && await sniff(blob);
        if (!type) { taken.delete(key); return; }
        md.src = src;
        md.source = el.tagName === 'IMG' ? 'chat thumbnail' : `${el.tagName.toLowerCase()} element`;
        if (el.tagName === 'IMG') { md.w = el.naturalWidth; md.h = el.naturalHeight; }
        if (el.tagName === 'VIDEO' && el.videoWidth) { md.w = el.videoWidth; md.h = el.videoHeight; }
        got.push({ md, r: { blob: blob.type === type ? blob : new Blob([blob], { type }), type } });
      }
      if (cancelled) { taken.delete(key); return; }
      await writeMessageMedia(m, folder, ctx, got, true);
      ctx.early = (ctx.early || 0) + got.filter((g) => g.md.file).length;
    }
    function pump() {
      while (active < LIMIT && queue.length && !cancelled) {
        const [m, key] = queue.shift();
        active++;
        work(m, key).catch((e) => { taken.delete(key); HUD.log(`  ⚠ couldn’t save media early (${e.message}); it’s saved at the end instead`, 'warn'); })
          .finally(() => { active--; pump(); });
      }
      if (!active && (!queue.length || cancelled)) { queue.length = 0; waiters.splice(0).forEach((w) => w()); }
    }
    return {
      offer(list) {
        for (const m of list) {
          if (!m.media?.length || m.media.every((md) => md.file)) continue;
          const key = GMLib.keyOf(m);
          if (taken.has(key) || ctx.done?.has(key) || skip(m) || !readyAll(m)) continue;
          taken.add(key);
          queue.push([m, key]);
        }
        pump();
      },
      drain: () => new Promise((r) => { waiters.push(r); pump(); }),
      has: (key) => taken.has(key),
    };
  }

  // Downloads the media of `list`: first whatever has already loaded, several
  // at a time, then the rest message by message, scrolling to each and (for
  // full-size photos) opening Messages' viewer.
  async function saveMedia(list, folder, ctx, label, opts = {}) {
    list.forEach((m) => applyDone(m, ctx));
    const total = list.reduce((n, m) => n + m.media.filter((md) => !md.file).length, 0);
    if (!total) return;
    HUD.log(`  downloading ${nf(total)} ${label}…`);
    HUD.task(null, null, `${label}: saving the ones already loaded`, '');
    const early = ctx.media;
    const fast = mediaSaver(folder, ctx, opts);
    fast.offer(list);
    await fast.drain();
    if (ctx.media > early) HUD.log(`  ✓ ${nf(ctx.media - early)} saved straight away (already loaded)`, 'ok');
    // A speed run doesn't wait for anything: the rest are listed to fetch later.
    if (opts.media === 'speed') { HUD.task(total, total, `${label}: the rest are listed to fetch later`, ''); return; }
    let n = ctx.media - early;
    for (const m of list) {
      if (cancelled) break;
      if (m.media.every((md) => md.file)) continue;
      const got = [];
      for (let idx = 0; idx < m.media.length && !cancelled; idx++) {
        await checkpoint();
        const md = m.media[idx];
        if (md.file) continue;
        HUD.task(n, total, `${label} ${++n} of ${nf(total)}`, md.kind);
        got.push({ md, r: await downloadMedia(m, md, idx, opts) });
      }
      await writeMessageMedia(m, folder, ctx, got);
    }
    HUD.task(total, total, `${label} done`, `${nf(total)}`);
  }

  const record = (m, index) => ({
    index,
    ...(m.id ? { id: m.id } : {}),
    direction: m.direction,
    sender: m.sender,
    timestamp: m.timestamp,
    timestamp_precision: m.timestamp_precision,
    timestamp_raw: m.timestamp_raw,
    section: m.section,
    text: m.text,
    ...(m.text_is_fallback ? { text_is_fallback: true } : {}),
    ...(m.reply_to ? { reply_to: m.reply_to } : {}),
    ...(m.previews_skipped ? { gif_previews_skipped: m.previews_skipped } : {}),
    media: m.media.map((md) => ({
      kind: md.kind,
      file: md.file || null,
      ...(md.w ? { width: md.w, height: md.h } : {}),
      ...(md.bytes ? { bytes: md.bytes } : {}),
      ...(md.source ? { source: md.source } : {}),
      ...(md.sha256 ? { sha256: md.sha256 } : {}),
      ...(md.error ? { error: md.error } : {}),
      ...(md.skipped ? { skipped: md.skipped } : {}),
    })),
    ...(m.left_out?.length ? { media_left_out: m.left_out } : {}),
    ...(m.label ? { accessibility_label: m.label } : {}),
    ...(m.details && Object.keys(m.details).length ? m.details : {}),
  });

  function convData(conv, messages, previous, range = null) {
    const media = messages.flatMap((m) => m.media || []);
    return {
      conversation: conv.title,
      conversation_id: conv.id,
      url: conv.url,
      exported_at: previous?.exported_at || new Date().toISOString(),
      ...(previous ? { updated_at: new Date().toISOString() } : {}),
      ...(range ? { range } : {}),
      participants: [...new Set(messages.map((m) => m.sender))],
      message_count: messages.length,
      media_count: media.filter((x) => x.file).length,
      media_failed: media.filter((x) => !x.file && !x.skipped).length,
      media_skipped: media.filter((x) => x.skipped).length,
      messages,
    };
  }

  const inRange = (m, r) => !r || (!!m.timestamp && m.timestamp.slice(0, 10) >= r.from && m.timestamp.slice(0, 10) <= r.to);

  async function exportOne(conv, opts, ctx, folder) {
    const card = await captureContact(conv);
    const contact = card ? await saveContact(card, folder, ctx) : null;
    let scraped = await collectConversation(conv, opts);
    if (opts.range) {
      const before = scraped.length;
      scraped = scraped.filter((m) => inRange(m, opts.range));
      HUD.log(`  ${plural(scraped.length, 'message')} between ${opts.range.from} and ${opts.range.to} (${nf(before - scraped.length)} outside the range left out)`);
    }
    ctx.msgs += scraped.length;
    updateStats(ctx);
    if (opts.includeMedia) await saveMedia(scraped, folder, ctx, 'media files', opts);
    const data = convData(conv, scraped.map((m, i) => record(m, i + 1)), null, opts.range);
    if (contact) data.contact = contact;
    const progress = { complete: !cancelled, history_complete: !cancelled, start: opts.range ? { method: 'date range', detail: `Every message from ${opts.range.from} to ${opts.range.to}` } : scraped.history || null };
    progress.checks = GMLib.checkChat(data.messages, progress, contact);
    await ctx.sink.write(`${folder}/messages.json`, JSON.stringify(data));
    await ctx.sink.write(`${folder}/progress.json`, JSON.stringify(progress, null, 2));
    HUD.log(`  ✓ saved ${nf(data.message_count)} messages and ${nf(data.media_count)} media files to ${folder}/`, 'ok');
    return { id: conv.id, title: conv.title, folder, data, progress, dirty: true };
  }

  // ---------- resumable backup of one conversation ----------
  // Saves into the backup folder as it goes. While a chat loads, new messages
  // (and any changed ones) are written every 15 seconds or 100 messages as a
  // small piece in the chat's journal/ folder, so a save never costs more than
  // what's new. Every few minutes, and at the end, they're folded into
  // messages.json and the journal is cleared. If a run stops for any reason,
  // the next one folds in what the journal holds and carries on from there.

  const { keyOf, unknownIn, mergeChrono } = GMLib;

  // Reads a chat's saved files the first time they're needed, including the
  // journal an interrupted backup left behind.
  async function loadEntry(sink, entry) {
    if (entry.data === undefined) {
      try { entry.data = JSON.parse(await sink.readText(`${entry.folder}/messages.json`)); } catch { entry.data = null; }
    }
    if (entry.progress === undefined) {
      try { entry.progress = JSON.parse((await readText(sink, `${entry.folder}/progress.json`)) || 'null'); } catch { entry.progress = null; }
    }
    if (!entry.journalChecked && sink.list) {
      entry.journalChecked = true;
      const pieces = (await sink.list(`${entry.folder}/journal`)).filter((p) => p.kind === 'file' && p.name.endsWith('.json')).map((p) => p.name).sort();
      if (pieces.length) {
        const data = entry.data || { messages: [] };
        const byKey = new Map(data.messages.map((r) => [keyOf(r), r]));
        const fresh = [];
        let n = 0;
        for (const name of pieces) {
          let piece;
          try { piece = JSON.parse(await sink.readText(`${entry.folder}/journal/${name}`)); } catch { continue; } // a piece cut short when Chrome closed
          for (const r of piece.records || []) {
            const k = keyOf(r);
            if (byKey.has(k)) Object.assign(byKey.get(k), r); else { byKey.set(k, r); fresh.push(r); }
            n++;
          }
          if (piece.events) data.events = piece.events;
        }
        data.messages = mergeChrono(data.messages, fresh);
        entry.data = data;
        entry.journalPieces = pieces.length;
        HUD.log(`  recovered ${plural(n, 'message')} saved just before the last backup stopped`, 'ok');
      }
    }
    return entry;
  }

  // Lines up a saved message's media with the same message's media on the
  // page. The saved list leaves out copies (a GIF's still frame), so they're
  // matched by kind, in order, skipping the ones that were left out.
  function alignMedia(raw, saved, leftOut, previewsSkipped) {
    const map = new Array(saved.length).fill(null);
    const left = [...(leftOut || Array.from({ length: previewsSkipped || 0 }, () => ({ kind: 'image' })))];
    let j = 0;
    const spare = [];
    for (const md of raw) {
      if (j < saved.length && md.kind === saved[j].kind) { map[j++] = md; continue; }
      const li = left.findIndex((l) => l.kind === md.kind || (l.kind === 'image' && md.kind === 'preview'));
      if (li >= 0) { left.splice(li, 1); continue; }
      spare.push(md);
    }
    // Kinds that changed when the file was checked (a photo that was really a GIF): in order.
    for (let k = 0; k < map.length && spare.length; k++) if (!map[k]) map[k] = spare.shift();
    return map;
  }

  // About the conversation as a whole, from the page: a group or not, what
  // Messages says under its name, the kind of chat its message box offers
  // (RCS chat or SMS/MMS text), and when this was read.
  function conversationDetails(conv) {
    const header = document.querySelector(SEL.header);
    const box = document.querySelector('mws-message-compose textarea, [data-e2e-message-input-box], textarea[placeholder]');
    const link = chatLinks().find((a) => a.getAttribute('href')?.endsWith(`/conversations/${conv.id}`));
    const item = link?.closest('mws-conversation-list-item');
    return {
      read_at: new Date().toISOString(),
      url: conv.url,
      title: conv.title,
      header_text: clean(header?.innerText) || null,
      group: !!item?.querySelector('mws-group-avatar') || undefined,
      compose_placeholder: box?.getAttribute('placeholder') || null,
      kind: /rcs|chat/i.test(box?.getAttribute('placeholder') || '') ? 'RCS chat' : /text|sms|mms/i.test(box?.getAttribute('placeholder') || '') ? 'SMS/MMS' : null,
      list_item_label: item ? clean(item.querySelector('a')?.getAttribute('aria-label')) || null : null,
      ...(item && isPinned(item, item.querySelector('a')?.getAttribute('aria-label') || '') ? { pinned: true } : {}),
    };
  }

  // How a backup treats media (opts.media):
  //   'all'       messages and media; photos still to fetch from earlier are fetched too
  //   'speed'     messages first: media that has already loaded is saved, the rest is
  //               listed (status "not fetched yet") to fetch later
  //   'fetch'     fetch photos not fetched yet (and, with retryFailed, failed ones)
  //   'fullsize'  also replace thumbnails with full-size photos
  // 'fetch' and 'fullsize' go back in the chat only as far as the oldest photo
  // they need, and don't read the contact card again.
  const mediaOnly = (opts) => opts.media === 'fetch' || opts.media === 'fullsize';

  async function backupConversation(conv, opts, ctx, entry) {
    const folder = entry.folder;
    const mode = opts.media || 'all';
    const timer = { start: Date.now() };
    const mark = (k) => { timer[k] = Date.now(); };
    HUD.debug(`  page: ${pageState()} · folder ${folder} · media ${mode}`);
    await loadEntry(ctx.sink, entry);
    let saved = entry.data?.messages || [];
    const progress = entry.progress;
    // Exports made before progress tracking were always full exports.
    const wasComplete = progress ? !!(progress.history_complete ?? progress.complete) : saved.length > 0;
    const first = saved.find((m) => m.timestamp)?.timestamp;
    const last = [...saved].reverse().find((m) => m.timestamp)?.timestamp;

    // Media in saved messages to (re)fetch, by message: not fetched yet
    // (except in a speed run), failed or skipped (Retry failed photos), and
    // thumbnails (Upgrade to full size).
    const wants = (md) => {
      if (!md.file && !md.error && !md.skipped) return mode !== 'speed';
      if (!md.file) return !!opts.retryFailed;
      return mode === 'fullsize' && GMLib.mediaStatus(md) === 'thumbnail';
    };
    const tried = new Set(); // `${key}#${item}` already tried in this run
    const findTargets = () => {
      const t = new Map();
      for (const r of saved) {
        const k = keyOf(r);
        const idx = (r.media || []).map((md, i) => (wants(md) && !tried.has(`${k}#${i}`) ? i : -1)).filter((i) => i >= 0);
        if (idx.length) t.set(k, idx);
      }
      return t;
    };
    const targets = findTargets();
    // Messages saved during this run before their media had loaded join in too.
    const refreshTargets = () => { for (const [k, v] of findTargets()) targets.set(k, v); };
    const targetCount = () => [...targets.values()].reduce((n, v) => n + v.length, 0);
    const startTargets = targetCount();

    if (saved.length) {
      HUD.log(wasComplete ? `  ${nf(saved.length)} messages already saved, newest ${last || 'unknown'}`
        : progress?.imported_from ? `  ${nf(saved.length)} messages imported from “${progress.imported_from}”; reading the whole chat to make sure nothing older is missing`
        : `  ${nf(saved.length)} messages saved so far, back to ${first || '?'}; this chat's backup isn't finished, so it carries on`);
    }
    if (startTargets) HUD.log(`  ${plural(startTargets, 'photo or video', 'photos and videos')} to ${mode === 'fullsize' ? 'fetch or upgrade to full size' : 'fetch'} in messages already saved`);

    const steps = opts.includeMedia ? 3 : 2;
    let contact = entry.data?.contact || null;
    if (!mediaOnly(opts)) {
      HUD.step(1, steps, 'reading the contact’s name, number and photo');
      const card = await captureContact(conv);
      if (card) contact = await saveContact(card, folder, ctx);
    }
    mark('contact');

    // Where to stop reading back: at messages already saved, or (with photos
    // to fetch) at the oldest of those photos; otherwise the first message.
    const oldestTarget = saved.filter((r) => targets.has(keyOf(r))).map((r) => r.timestamp);
    let stopAt = null;
    if (wasComplete && saved.length && !(oldestTarget.length && oldestTarget.some((t) => !t))) {
      stopAt = oldestTarget.length ? { ids: new Set(), lastT: oldestTarget.sort()[0] } : { ids: new Set(saved.map((m) => m.id).filter(Boolean)), lastT: last || null };
    }
    HUD.step(2, steps, mediaOnly(opts) ? `going back to the oldest photo to fetch${stopAt?.lastT ? ` (${stopAt.lastT.slice(0, 10)})` : ''}; photos are saved as they appear`
      : stopAt && !oldestTarget.length ? 'looking for new messages' : 'loading older messages from your phone. A long chat can take several minutes; that’s normal, and it’s saved as it goes.');

    const previous = entry.data;
    let added = 0;
    let lastFlush = Date.now();
    let lastComplete = false;
    let historyComplete = wasComplete;
    let start = progress?.start || (wasComplete ? { method: 'earlier run', at: progress?.updated_at || null } : null);
    let stoppedReason = null;
    let newestCheck = null;
    let secondRead = progress?.second_read || null;
    const speedRun = mode === 'speed' || (!!progress?.speed_run && mode !== 'all');

    // The conversation as a whole, and its events ("Alice named the group…").
    const meta = { ...(previous?.conversation_details || {}), ...conversationDetails(conv) };
    let events = previous?.events || [];
    let eventsChanged = false;
    const addEvents = (list) => {
      const have = new Set(events.map((e) => `${e.section}|${e.text}`));
      const add = (list || []).filter((e) => !have.has(`${e.section}|${e.text}`)).map(({ text, section, timestamp }) => ({ text, section, timestamp }));
      if (add.length) { events = [...events, ...add].sort((x, y) => ((x.timestamp || '') < (y.timestamp || '') ? -1 : 1)); eventsChanged = true; }
      return add.length;
    };

    // Saved messages, by key; and the ones whose media is all dealt with.
    let savedBy = new Map();
    // Saved messages by key, and their IDs and signatures as sets, so finding
    // what's new on the page costs the size of the page, not of the chat (which
    // after years of daily texts can be 100,000 messages).
    let savedIds = new Set();
    let savedSigs = new Set();
    // Messages that came from a phone backup (the Android app) have no Google
    // ID, and the page can show them a little differently: the page's message
    // claims the one it matches (GMLib.phoneClaims), which takes its ID, so from
    // then on it's matched like any other and its missing photos can be
    // fetched. Messages the phone never stored (sent RCS messages, during
    // Google's bug) match nothing, and are added.
    let phone = GMLib.phoneClaims([]);
    let claimed = 0;
    const reindex = () => {
      savedBy = new Map(saved.map((r) => [keyOf(r), r]));
      savedIds = new Set(saved.map((r) => r.id).filter(Boolean));
      for (const r of saved) for (const x of r.also_ids || []) savedIds.add(x);
      savedSigs = new Set(saved.map(GMLib.sigOf));
      phone = GMLib.phoneClaims(saved);
    };
    const claim = (m) => {
      const r = phone.claim(m);
      if (!r) return false;
      savedIds.add(m.id);
      savedBy.set(m.id, r);
      touched.add(keyOf(r));
      claimed++;
      return true;
    };
    const unknown = (scraped) => scraped.filter((m) => {
      if (m.id && savedIds.has(m.id)) return false;
      if (savedSigs.has(GMLib.sigOf(m))) { claim(m); return false; }
      return !claim(m);
    });
    // New messages from scrolling back are older than everything saved (and
    // new arrivals newer): those are put in front or at the end, renumbering in
    // place. Anything else goes through the full merge by time.
    const mergeIn = (recs, scraped) => {
      const first = saved.find((r) => r.timestamp)?.timestamp;
      const last = saved.findLast((r) => r.timestamp)?.timestamp;
      const times = recs.map((r) => r.timestamp);
      if (first && times.every(Boolean)) {
        const lo = times.reduce((a, b) => (b < a ? b : a));
        const hi = times.reduce((a, b) => (b > a ? b : a));
        if (hi < first || lo > last) {
          saved = hi < first ? [...recs, ...saved] : [...saved, ...recs];
          saved.forEach((r, k) => { r.index = k + 1; });
          // Same objects, so the lookups only need the new ones.
          for (const r of recs) { savedBy.set(keyOf(r), r); if (r.id) savedIds.add(r.id); savedSigs.add(GMLib.sigOf(r)); }
          return;
        }
      }
      saved = mergeChrono(saved, recs, scraped);
      reindex();
    };
    reindex();
    const waitingMedia = () => saved.reduce((n, r) => n + (r.media || []).filter((md) => !md.file && !md.error && !md.skipped).length, 0);

    let lastChecks = null;
    const buildProgress = ({ checks = true } = {}) => {
      const complete = historyComplete && !(opts.includeMedia && waitingMedia()); // finished only once its media is in too
      lastComplete = complete;
      const prog = {
        complete,
        history_complete: historyComplete,
        message_count: saved.length,
        oldest: saved.find((m) => m.timestamp)?.timestamp || null,
        newest: [...saved].reverse().find((m) => m.timestamp)?.timestamp || null,
        updated_at: new Date().toISOString(),
        start,
        ...(stoppedReason && !historyComplete ? { stopped_reason: stoppedReason } : {}),
        newest_check: newestCheck,
        ...(secondRead ? { second_read: secondRead } : {}),
        ...(speedRun && waitingMedia() ? { speed_run: true } : {}),
        ...(progress?.imported_from && !historyComplete ? { imported_from: progress.imported_from } : {}),
        ...(progress?.from_phone && !historyComplete ? { from_phone: progress.from_phone } : {}),
      };
      prog.checks = checks || !lastChecks ? (lastChecks = GMLib.checkChat(saved, prog, contact)) : lastChecks;
      entry.progress = prog;
      return prog;
    };

    // Saving: small journal pieces as it goes, the whole chat every few minutes.
    const JOURNAL = `${folder}/journal`;
    let touched = new Set();
    let journalSeq = 0;
    let journalRecords = 0;
    // 0: the first save writes messages.json, so a new chat's folder is recognisable at once.
    // A chat already on disk doesn't need that: its journal is enough until the next
    // compaction. (Unless pieces from a run that stopped hard are still there: they're
    // folded in first, so new pieces don't overwrite them.)
    let lastCompact = entry.data?.messages?.length && !entry.journalPieces ? Date.now() : 0;
    const compact = async (final) => {
      const prog = buildProgress();
      const data = convData(conv, saved, previous);
      if (contact) data.contact = contact;
      data.conversation_details = meta;
      if (events.length) data.events = events;
      entry.data = data;
      entry.title = conv.title;
      entry.dirty = true;
      // No indentation: a third smaller, and quicker to write for big chats. Any
      // JSON viewer (or jq) shows it formatted.
      await ctx.sink.write(`${folder}/messages.json`, JSON.stringify(data));
      await ctx.sink.write(`${folder}/progress.json`, JSON.stringify(prog, null, 2));
      // Everything the journal held is in messages.json now.
      if (journalSeq || entry.journalPieces) { await ctx.sink.remove(JOURNAL); entry.journalPieces = 0; }
      journalSeq = 0;
      journalRecords = 0;
      touched = new Set();
      eventsChanged = false;
      lastCompact = Date.now();
      // Keep the backup's index (and the viewer) current during a long chat too.
      if (!final && opts.onCompact) await opts.onCompact();
    };
    const save = async (final = false) => {
      // Rewriting messages.json costs the size of the chat, so a big chat does
      // it less often: every 3 minutes for small ones, about every half hour
      // for 100,000 messages. Nothing is at risk meanwhile: the journal has it all.
      const every = Math.max(180000, saved.length * 20);
      if (final || !lastCompact || Date.now() - lastCompact > every || journalRecords > Math.max(3000, saved.length / 4)) return compact(final);
      const records = saved.filter((r) => touched.has(keyOf(r)));
      if (records.length || eventsChanged) {
        journalSeq++;
        await ctx.sink.writeTemp(`${JOURNAL}/${String(journalSeq).padStart(6, '0')}.json`, JSON.stringify({ at: new Date().toISOString(), records, ...(eventsChanged ? { events } : {}) }));
        journalRecords += records.length;
      }
      touched = new Set();
      eventsChanged = false;
      await ctx.sink.write(`${folder}/progress.json`, JSON.stringify(buildProgress({ checks: false }), null, 2));
    };

    // Fetching (or upgrading) media of saved messages that are on the page.
    const fetched = { saved: 0, upgraded: 0, same: 0, failed: 0 };
    const wantFull = mode === 'fullsize' || !!opts.fullSize;
    const fetchTarget = async (m, { viewer, scroll }) => {
      const key = keyOf(m);
      const idxs = targets.get(key);
      const r = savedBy.get(key);
      if (!idxs || !r) return 0;
      // The background saver has (or is getting) this message's media: adoptLate takes it from there.
      if (ctx.done?.has(key) || early?.has(key)) return 0;
      const map = alignMedia(m.media, r.media || [], r.media_left_out, r.gif_previews_skipped);
      let did = 0;
      for (const i of [...idxs]) {
        if (cancelled) break;
        const raw = map[i];
        if (!raw) continue;
        const rawIdx = m.media.indexOf(raw);
        const el = liveElement(m, raw, rawIdx);
        const old = r.media[i];
        // A full-size photo whose file went missing comes back full size.
        const full = wantFull || !!old.want_full;
        const usesViewer = full && needsViewer(raw, el, { fullSize: true }) && firstInPhoto(el);
        if (!scroll && (!isReady(el) || usesViewer !== viewer)) continue;
        const res = await downloadMedia(m, raw, rawIdx, { fullSize: full });
        const now = new Date().toISOString();
        if (res.error) {
          if (!old.file) old.error = res.error;
          fetched.failed++;
        } else if (res.skipped) {
          if (!old.file) old.skipped = res.skipped;
        } else if (old.file && raw.source !== 'full-size viewer') {
          // Asked to upgrade, but the viewer had nothing bigger: keep the file.
          if (/same size/.test(raw.source || '')) { old.source = raw.source; fetched.same++; } else { old.viewer_tried_at = now; fetched.failed++; }
        } else {
          const item = { kind: raw.kind, w: raw.w, h: raw.h, source: raw.source };
          await saveMediaFile(r, item, res, folder, ctx);
          const next = { kind: item.kind, file: item.file, ...(item.w ? { width: item.w, height: item.h } : {}), bytes: item.bytes, source: item.source, sha256: item.sha256 };
          if (old.file) {
            // The thumbnail it replaces is removed; its details are kept.
            next.upgraded_from = { width: old.width || null, height: old.height || null, sha256: old.sha256 || null, at: now };
            await ctx.sink.remove(`${folder}/${old.file}`);
            fetched.upgraded++;
            HUD.log(`  ⬆ ${old.width || '?'}×${old.height || '?'} → ${next.width}×${next.height} full size, ${r.timestamp || 'undated'}`, 'ok');
          } else {
            fetched.saved++;
          }
          r.media[i] = next;
        }
        targets.set(key, targets.get(key).filter((x) => x !== i));
        tried.add(`${key}#${i}`);
        did++;
      }
      if (!targets.get(key)?.length) targets.delete(key);
      if (did) touched.add(key);
      return did;
    };
    // While the history loads: photos of saved messages that have loaded and
    // need no viewer, a few at a time in the background.
    let fetchQueue = Promise.resolve();
    const offerTargets = (list) => {
      if (!targets.size) return;
      const ready = list.filter((m) => targets.has(keyOf(m)));
      if (ready.length) fetchQueue = fetchQueue.then(async () => { for (const m of ready) await fetchTarget(m, { viewer: false, scroll: false }); }).catch(() => {});
    };

    // `withMedia` is false for the saves made while still scrolling back: they
    // save the messages straight away (with whatever media has loaded), and
    // the rest of the media follows at the end.
    // Media the early saver finished after its message was already saved: put
    // it into the saved message now (or a crash would leave the file unused).
    const adoptLate = (m) => {
      const key = keyOf(m);
      const r = savedBy.get(key);
      const d = ctx.done?.get(key);
      if (!r || !d || !r.media?.length) return;
      const kept = d.filter((x) => !x.dropped);
      const full = r.media.length === d.length; // saved before any copies were left out
      if (!full && r.media.length !== kept.length) return;
      let changed = false;
      (full ? d : kept).forEach((x, i) => {
        const md = r.media[i];
        if (!md.file && x.file) { Object.assign(md, { kind: x.kind, file: x.file, sha256: x.sha256, ...(x.w ? { width: x.w, height: x.h } : {}), bytes: x.bytes, source: x.source }); delete md.error; changed = true; }
      });
      if (full && d.some((x) => x.dropped)) {
        r.media_left_out = d.filter((x) => x.dropped).map((x) => x.leftOut).filter(Boolean);
        r.gif_previews_skipped = (r.gif_previews_skipped || 0) + d.filter((x) => x.dropped).length;
        r.media = r.media.filter((_, i) => !d[i].dropped);
        changed = true;
      }
      if (changed) { touched.add(key); targets.delete(key); const again = findTargets().get(key); if (again) targets.set(key, again); }
    };

    const flush = async (scraped, { final = false, withMedia = true } = {}) => {
      scraped.forEach((m) => applyDone(m, ctx));
      scraped.forEach(adoptLate);
      const claimedBefore = claimed;
      const fresh = unknown(scraped);
      if (claimed > claimedBefore) HUD.debug(`  matched ${plural(claimed - claimedBefore, 'message')} from a phone backup`);
      let changed = touched.size > 0;
      // Photos of saved messages still to fetch or upgrade, now on the page.
      if (withMedia && opts.includeMedia && targets.size && !cancelled) {
        const before = targetCount();
        await fetchQueue;
        for (const m of scraped) if (targets.has(keyOf(m))) await fetchTarget(m, { scroll: true });
        if (targetCount() !== before) changed = true;
      }
      // Messages already saved can change: delivered becomes read, someone
      // reacts, a message is edited. Keep the latest of those.
      let updated = 0;
      for (const m of scraped) {
        const r = m.id && savedBy.get(m.id);
        if (!r || !m.details) continue;
        const next = {};
        for (const k of ['status', 'edited', 'reactions', 'link_previews', 'links', 'attachments']) {
          if (m.details[k] !== undefined && JSON.stringify(m.details[k]) !== JSON.stringify(r[k])) next[k] = m.details[k];
        }
        if (Object.keys(next).length) { Object.assign(r, next, { details_updated_at: new Date().toISOString() }); touched.add(keyOf(r)); updated++; }
      }
      if (updated) { changed = true; HUD.debug(`  updated status, reactions or edits on ${updated} saved messages`); }
      if (addEvents(scraped.events)) changed = true;
      if (fresh.length) {
        if (opts.includeMedia && withMedia) await saveMedia(fresh, folder, ctx, 'media files', opts);
        const recs = fresh.map((m) => record(m, 0));
        mergeIn(recs, scraped);
        for (const r of recs) touched.add(keyOf(r));
        added += fresh.length;
        ctx.msgs += fresh.length;
        updateStats(ctx);
        HUD.log(`  ↓ saved ${plural(fresh.length, 'message')} (${nf(saved.length)} in this chat so far)`, 'ok');
        changed = true;
      }
      if (opts.includeMedia) refreshTargets();
      if (changed || final) await save(final);
      lastFlush = Date.now();
    };

    if (opts.retryFailed) HUD.log('  retrying media that failed before');
    const early = opts.includeMedia ? mediaSaver(folder, ctx, opts, (m) => savedBy.has(keyOf(m))) : null;
    // While Messages fetches the next batch, open the photos of the batch that
    // just arrived (now at the top, on screen) in its full-size viewer and
    // save them, instead of waiting for the end. Photos of saved messages to
    // upgrade come first.
    const triedFull = new Set();
    let fullEarly = 0;
    const fullSizeBetween = async (merged, arrived) => {
      const t0 = Date.now();
      let did = 0;
      for (const m of merged) {
        if (cancelled || arrived() || Date.now() - t0 > 8000) break;
        const key = keyOf(m);
        if (targets.has(key)) { did += await fetchTarget(m, { viewer: true, scroll: false }); continue; }
        if (triedFull.has(key) || ctx.done?.has(key) || savedBy.has(key) || !m.media?.length) continue;
        const els = m.media.map((md, idx) => liveElement(m, md, idx));
        if (!m.media.some((md, i) => !md.file && needsViewer(md, els[i], opts))) continue;
        if (!els.every((el, i) => m.media[i].file || isReady(el))) continue; // not loaded yet: the end pass gets it
        triedFull.add(key);
        const got = [];
        for (const [i, md] of m.media.entries()) {
          if (md.file) continue;
          const el = els[i];
          md.src = srcOf(el);
          md.source = el.tagName === 'IMG' ? 'chat thumbnail' : `${el.tagName.toLowerCase()} element`;
          if (el.tagName === 'IMG') { md.w = el.naturalWidth; md.h = el.naturalHeight; }
          if (needsViewer(md, el, opts) && firstInPhoto(el)) {
            const big = await fullSizeFromViewer(el);
            if (big && big.w * big.h > (md.w || 0) * (md.h || 0)) Object.assign(md, { src: big.src, w: big.w, h: big.h, source: 'full-size viewer' });
            else if (big) md.source = 'chat thumbnail (same size as the full-size viewer)';
          }
          const { blob } = await fetchBlob(md.src);
          const type = blob && await sniff(blob);
          if (!type) { got.length = 0; break; } // leave the whole message for the end pass
          got.push({ md, r: { blob: blob.type === type ? blob : new Blob([blob], { type }), type } });
        }
        if (!got.length) continue;
        await writeMessageMedia(m, folder, ctx, got, true);
        fullEarly += got.filter((g) => g.md.source === 'full-size viewer').length;
        did++;
      }
      HUD.debug(`    between batches: ${did} message${did === 1 ? '' : 's'} of photos in ${((Date.now() - t0) / 1000).toFixed(1)}s${arrived() ? ', batch arrived meanwhile' : ''}`);
      return did;
    };
    const earlyBefore = ctx.early || 0;
    const scraped = await collectConversation(conv, {
      ...opts,
      range: null,
      fullHistory: !stopAt,
      stopAt,
      onSnapshot: opts.includeMedia ? (merged) => { early?.offer(merged); offerTargets(merged); } : null,
      betweenBatches: opts.includeMedia && mode !== 'speed' && (wantFull && opts.fullSizeEarly !== false) ? fullSizeBetween : null,
      onPass: async (merged) => {
        if (Date.now() - lastFlush > 15000 || unknown(merged).length >= 100 || touched.size) await flush(merged, { withMedia: false });
      },
    });
    if (!cancelled && scraped.reachedStart && !historyComplete) {
      historyComplete = true;
      start = { ...scraped.history, at: new Date().toISOString() };
    }
    if (!historyComplete) stoppedReason = scraped.history?.stopped_reason || null;
    mark('history');
    if (opts.includeMedia) HUD.step(3, 3, mode === 'speed' ? 'saving the photos that have already loaded; the rest are listed for later' : 'saving photos and videos');
    if (early) {
      HUD.task(null, null, 'finishing media saved during loading', '');
      await early.drain();
      await fetchQueue;
      if ((ctx.early || 0) > earlyBefore) HUD.log(`  ✓ ${plural(ctx.early - earlyBefore, 'media file')} saved while the history loaded`, 'ok');
      if (fullEarly) HUD.log(`  ✓ ${plural(fullEarly, 'full-size photo')} saved between batches`, 'ok');
    }
    await flush(scraped, { final: true });
    if (startTargets) {
      const left = targetCount();
      HUD.log(`  photos in saved messages: ${[fetched.saved && `${nf(fetched.saved)} fetched`, fetched.upgraded && `${nf(fetched.upgraded)} upgraded to full size`, fetched.same && `${nf(fetched.same)} were already full size`, fetched.failed && `${nf(fetched.failed)} couldn’t be fetched`, left && `${nf(left)} not found on the page`].filter(Boolean).join(', ') || 'none reached'}`, left || fetched.failed ? 'warn' : 'ok');
    }
    mark('media');

    // The newest messages on screen must all be in the backup. Any that
    // arrived while it ran are added now.
    if (!cancelled) {
      const sc = findScroller(document.querySelector(SEL.message));
      if (sc) { sc.scrollTop = sc.scrollHeight; await sleep(1500); }
      const onScreen = scrapeSnapshot(conv).slice(-30);
      await flush(onScreen);
      const missing = unknownIn(saved, onScreen).length;
      newestCheck = { at: new Date().toISOString(), on_screen: onScreen.length, all_saved: missing === 0 };
      HUD.log(missing ? `  ✗ ${missing} of the newest messages couldn’t be saved` : `  ✓ checked: the ${onScreen.length} newest messages are all saved`, missing ? 'err' : 'ok');
      await save(true);
    }

    // Optional double check: open the chat afresh, read the whole history
    // again and compare. Anything the first read missed is added.
    if (opts.verifyRead && historyComplete && !cancelled && !mediaOnly(opts)) {
      HUD.log('  double-checking: reading the whole chat a second time', 'head');
      await reopenConversation(conv);
      const again = await collectConversation(conv, { ...opts, range: null, stopAt: null, fullHistory: true, onPass: null, onSnapshot: null, betweenBatches: null });
      if (!cancelled && again.reachedStart) {
        const extra = unknownIn(saved, again);
        const seen = new Set(again.map((m) => m.id).filter(Boolean));
        const notOnPage = saved.filter((r) => r.id && !seen.has(r.id)).length;
        if (extra.length) await flush(again);
        secondRead = { at: new Date().toISOString(), read: again.length, added: extra.length, not_on_page: notOnPage };
        HUD.log(extra.length ? `  ⚠ the second read found ${plural(extra.length, 'more message')}; saved now` : `  ✓ second read matches: ${nf(again.length)} messages`, extra.length ? 'warn' : 'ok');
        if (notOnPage) HUD.log(`  · ${plural(notOnPage, 'saved message')} no longer showing in Messages (deleted since?); kept in the backup`, 'warn');
        await save(true);
      } else if (!cancelled) {
        HUD.log('  the second read didn’t reach the first message, so it can’t confirm the first one', 'warn');
      }
    }
    // Stopped part-way: what was read is saved (and folded into messages.json).
    if (cancelled && (touched.size || journalSeq)) await save(true);

    const verdict = entry.progress?.checks;
    const counts = { ...GMLib.mediaCounts(saved.flatMap((r) => (r.media || []).map(GMLib.mediaStatus))), left: saved.reduce((n, r) => n + (r.media_left_out?.length ?? r.gif_previews_skipped ?? 0), 0) };
    const secs = (x, y) => `${Math.round(((timer[y] || Date.now()) - (timer[x] || timer.start)) / 1000)}s`;
    HUD.debug(`  chat done: ${saved.length} messages (+${added}) · media ${JSON.stringify(counts)}` +
      ` · time: contact ${secs('start', 'contact')}, history ${secs('contact', 'history')}, media ${secs('history', 'media')}, checks ${secs('media', 'end')}`);
    if (verdict) HUD.debug(`  checks: ${verdict.items.map((i) => `${i.level} ${i.label}${i.detail ? ` (${i.detail})` : ''}`).join(' | ')}`);
    if (!added) HUD.log(lastComplete || verdict?.status === 'messages' ? '  ✓ no new messages' : '  no new messages yet (not finished: run it again to carry on)', lastComplete || verdict?.status === 'messages' ? 'ok' : 'warn');
    else HUD.log(`  ✓ ${plural(added, 'message')} added to ${folder}/${lastComplete || verdict?.status === 'messages' ? '' : ' (not finished: run it again to carry on)'}`, lastComplete ? 'ok' : 'warn');
    if (verdict) HUD.log(`  ${GMLib.STATUS_LABEL[verdict.status]}${verdict.problems.length ? `: ${verdict.problems.join(', ')}` : ''}`, ['verified', 'complete', 'messages'].includes(verdict.status) ? 'ok' : 'warn');
    return { id: conv.id, title: conv.title, folder, added, complete: lastComplete, count: saved.length, oldest: saved.find((m) => m.timestamp)?.timestamp || null, status: verdict?.status || null, media: counts, fetched };
  }

  // ---------- contact card ----------
  // Opens Messages' "Details" page for the chat to read each participant's
  // name, number and contact photo, then returns to the conversation.

  async function backToChat(conv) {
    const inChat = () => !document.querySelector('mw-conversation-details') && document.querySelector(SEL.message) && currentId() === conv.id;
    if (inChat()) return;
    const open = () => chatLinks().find((a) => a.getAttribute('href')?.endsWith(`/conversations/${conv.id}`))?.click();
    open();
    for (let i = 0; i < 20 && !inChat(); i++) await sleep(150);
    if (!inChat()) {
      // The details page keeps the chat's address, so go via the list.
      history.pushState({}, '', '/web/conversations');
      dispatchEvent(new PopStateEvent('popstate'));
      await sleep(600);
      if (!chatLinks().some((a) => a.getAttribute('href')?.endsWith(`/conversations/${conv.id}`))) {
        history.pushState({}, '', `/web/conversations/${conv.id}`);
        dispatchEvent(new PopStateEvent('popstate'));
      } else open();
    }
    await waitForMessages(null, 10000);
  }

  async function captureContact(conv) {
    const menu = [...document.querySelectorAll(SEL.header.split(',').map((h) => `${h.trim()} button`).join(', '))].find((b) => /conversation menu|more options/i.test(b.getAttribute('aria-label') || ''));
    if (!menu) return null;
    try {
      menu.click();
      let item = null;
      for (let i = 0; i < 20 && !(item = document.querySelector('[data-e2e-details-button]')); i++) await sleep(100);
      if (!item) { document.querySelector('.cdk-overlay-backdrop')?.click(); return null; }
      item.click();
      let rows = [];
      for (let i = 0; i < 40 && !rows.length; i++) {
        await sleep(150);
        rows = [...document.querySelectorAll('mw-conversation-details [data-e2e-details-participant], mw-conversation-details li.participant')];
      }
      await sleep(400); // let the photos draw
      const people = [];
      for (const li of rows) {
        const name = clean(li.querySelector('[data-e2e-details-participant-name]')?.innerText);
        const number = clean(li.querySelector('[data-e2e-details-participant-number]')?.innerText);
        const canvas = li.querySelector('canvas');
        const img = li.querySelector('img');
        let photo = null;
        try {
          if (canvas?.width) photo = await new Promise((r) => canvas.toBlob(r, 'image/png'));
          else if (img && isMediaUrl(srcOf(img))) photo = (await fetchBlob(srcOf(img))).blob;
        } catch { /* photo unavailable */ }
        if (name || number) people.push({ name: name || number, number, photo });
      }
      const details = document.querySelector('mw-conversation-details');
      const e2ee = details?.querySelector('.e2ee-status-on') ? true : details?.querySelector('.e2ee-status-off') ? false : null;
      HUD.log(`  contact card: ${people.map((p) => `${p.name}${p.number && p.number !== p.name ? ` (${p.number})` : ''}`).join(', ') || 'none'}${e2ee != null ? ` · end-to-end encryption ${e2ee ? 'on' : 'off'}` : ''}`);
      return people.length ? { people, e2ee } : null;
    } catch (e) {
      HUD.log(`  ⚠ couldn't read the contact card: ${e.message}`, 'warn');
      return null;
    } finally {
      await backToChat(conv);
    }
  }

  async function saveContact(card, folder, ctx) {
    const people = [];
    for (const p of card.people) {
      let photo = null;
      if (p.photo) {
        photo = `contact/${safeName(p.name)}.png`;
        await ctx.sink.write(`${folder}/${photo}`, p.photo);
      }
      people.push({ name: p.name, number: p.number || null, photo });
    }
    const contact = { captured_at: new Date().toISOString(), end_to_end_encrypted: card.e2ee, people };
    await ctx.sink.write(`${folder}/contact.json`, JSON.stringify(contact, null, 2));
    return contact;
  }

  // ---------- navigating between conversations ----------

  // The list is ordered most recent first, so stop scrolling once we have `limit`.
  async function listConversations(limit = Infinity) {
    const links = chatLinks;
    const found = new Map();
    const scroller = findScroller(links()[0]);
    let stable = 0;
    let last = -1;
    while (stable < 3 && !cancelled && found.size < limit) {
      for (const a of links()) {
        const href = a.getAttribute('href');
        const name = chatListInfo(a).name;
        if (!found.has(href) || (!found.get(href) && name)) found.set(href, name);
      }
      HUD.task(null, null, 'scanning the conversation list', `${nf(found.size)} found`);
      if (!scroller) break;
      scroller.scrollTop = scroller.scrollHeight;
      await sleep(1000);
      stable = found.size === last ? stable + 1 : 0;
      last = found.size;
    }
    if (scroller) scroller.scrollTop = 0;
    return [...found].slice(0, limit).map(([href, name]) => ({ href, name: name || 'Unnamed chat', id: href.match(/\/conversations\/([^/?#]+)/)[1] }));
  }

  // The conversation list for Settings' "Add chats": names and last-message
  // dates only, scrolling the list to load more and then putting it back.
  // Links to conversations in Messages' list. Other links to a conversation
  // (in the open chat's header, say) have no name, so the list's own items
  // are used whenever the page has them.
  function chatLinks() {
    const ok = (a) => { const id = a.getAttribute('href')?.match(/\/conversations\/([^/?#]+)/)?.[1]; return id && id !== 'new' && /^[\w-]+$/.test(id); };
    const inList = [...document.querySelectorAll('mws-conversation-list-item a[href*="/conversations/"]')].filter(ok);
    return inList.length ? inList : [...document.querySelectorAll(SEL.convLink)].filter(ok);
  }

  // A conversation in Messages' list: its name, when it was last active, and
  // whether it's a group. The name falls back to the item's label and then
  // its text, so a chat is never listed without one.
  function chatListInfo(a) {
    const item = a.closest('mws-conversation-list-item') || a;
    const nameEl = a.querySelector(SEL.convName) || item.querySelector(SEL.convName);
    const label = clean(a.getAttribute('aria-label') || item.getAttribute('aria-label'));
    const name = firstLine(nameEl?.innerText) || clean(nameEl?.textContent) || label.split(/[.:]/)[0].replace(/^conversation with\s+/i, '').trim() || firstLine(a.innerText);
    // Messages shows the time twice ("Saturday" for screen readers, "Sat" on screen): keep one.
    const ts = item.querySelector('mws-relative-timestamp');
    const when = firstLine(ts?.innerText) || clean(ts?.getAttribute('aria-label')) || '';
    return { name, when, group: !!item.querySelector('mws-group-avatar'), pinned: isPinned(item, label) };
  }

  // Pinned in Messages' list (shown first in the viewer's lists).
  const isPinned = (item, label = '') => !!item?.querySelector(SEL.pinned) || /\bpinned\b/i.test(label)
    || [...(item?.querySelectorAll('mat-icon, .material-icons, .material-symbols-outlined') || [])].some((i) => /^(push_pin|keep)$/.test(clean(i.textContent)));

  async function listChatsQuick(limit) {
    const links = chatLinks;
    const found = new Map();
    const scroller = findScroller(links()[0]);
    const start = scroller?.scrollTop || 0;
    let stable = 0;
    let last = -1;
    while (stable < 3 && found.size < limit) {
      for (const a of links()) {
        const id = a.getAttribute('href').match(/\/conversations\/([^/?#]+)/)[1];
        const info = chatListInfo(a);
        if (!found.has(id) || (!found.get(id).name && info.name)) found.set(id, { id, ...info });
      }
      if (!scroller) break;
      scroller.scrollTop = scroller.scrollHeight;
      await sleep(700);
      stable = found.size === last ? stable + 1 : 0;
      last = found.size;
    }
    if (scroller) scroller.scrollTop = start;
    return [...found.values()].slice(0, limit);
  }

  function firstMessageSignature() {
    const w = document.querySelector(SEL.message);
    return w ? elementKey(w) || w.innerText.slice(0, 200) : null;
  }

  async function waitForMessages(previous, timeout = 12000) {
    const start = Date.now();
    let lastCount = -1;
    let stableSince = Date.now();
    while (Date.now() - start < timeout && !cancelled) {
      const count = document.querySelectorAll(SEL.message).length;
      const stale = previous != null && firstMessageSignature() === previous;
      if (!stale && count !== lastCount) { lastCount = count; stableSince = Date.now(); }
      if (!stale && count > 0 && Date.now() - stableSince > 1200) return true;
      await sleep(200);
    }
    return document.querySelectorAll(SEL.message).length > 0;
  }

  async function openConversation(c) {
    if (currentId() === c.id) return waitForMessages(null);
    const previous = firstMessageSignature();
    const link = chatLinks().find((a) => a.getAttribute('href') === c.href || a.getAttribute('href')?.endsWith(`/conversations/${c.id}`));
    if (link) {
      link.click();
    } else {
      history.pushState({}, '', c.href || `/web/conversations/${c.id}`);
      dispatchEvent(new PopStateEvent('popstate'));
    }
    for (let i = 0; i < 50 && currentId() !== c.id; i++) await sleep(100);
    return waitForMessages(previous);
  }

  // Goes back to the conversation list and opens the chat again, so Messages
  // renders it from scratch (for the second read). Going via the list rather
  // than another chat means no other conversation gets marked as read.
  async function reopenConversation(conv) {
    history.pushState({}, '', '/web/conversations');
    dispatchEvent(new PopStateEvent('popstate'));
    for (let i = 0; i < 30 && document.querySelector(SEL.message); i++) await sleep(100);
    await sleep(500);
    await openConversation({ id: conv.id, href: `/web/conversations/${conv.id}` });
  }

  // The open chat's picture, exactly as Messages shows it: the contact's photo,
  // or Messages' coloured circle with an initial. For the popup, which can't
  // load the page's own images, it's returned as a data: URL where possible.
  async function chatAvatar() {
    const id = currentId();
    const link = id && chatLinks().find((a) => a.getAttribute('href')?.endsWith(`/conversations/${id}`));
    // The chat's entry in the conversation list first (its picture is a
    // canvas Messages draws), then the open chat's header.
    const inHeader = SEL.header.split(',').map((h) => `${h.trim()} mws-avatar, ${h.trim()} mws-group-avatar`).join(', ');
    const holders = [link?.closest('mws-conversation-list-item')?.querySelector('mws-conversation-avatar, mws-group-avatar, mws-avatar'), document.querySelector(inHeader)].filter(Boolean);
    const toData = (blob) => new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.onerror = () => r(null); f.readAsDataURL(blob); });
    for (const h of holders) {
      const img = [...h.querySelectorAll('img')].find((i) => i.complete && i.naturalWidth && isMediaUrl(srcOf(i)));
      if (img) {
        const src = srcOf(img);
        if (/^data:/.test(src)) return { photo: src };
        const { blob } = await fetchBlob(src);
        if (blob) return { photo: await toData(blob) };
        if (/^https:/.test(src)) return { photo: src };
      }
      // A group avatar holds several pictures: the whole thing is drawn on one canvas here.
      const canvases = [...h.querySelectorAll('canvas')].filter((c) => c.width && c.height);
      if (canvases.length === 1) { try { return { photo: canvases[0].toDataURL('image/png') }; } catch { /* drawn from another site's image */ } }
      if (canvases.length > 1) {
        try {
          const out = document.createElement('canvas');
          out.width = out.height = 80;
          const g = out.getContext('2d');
          canvases.slice(0, 4).forEach((c, i, all) => {
            const n = all.length;
            const [x, y, w, hh] = n === 2 ? [i * 40, 0, 40, 80] : [(i % 2) * 40, Math.floor(i / 2) * 40, 40, 40];
            g.drawImage(c, x, y, w, hh);
          });
          return { photo: out.toDataURL('image/png') };
        } catch { /* fall through */ }
      }
      // Messages' letter avatar drawn with HTML: its colour and initial (never a whole name).
      const el = [h, ...h.querySelectorAll('*')].find((e) => { const bg = getComputedStyle(e).backgroundColor; return bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg); });
      const letter = firstLine(h.innerText);
      if (el && letter.length <= 2) return { color: getComputedStyle(el).backgroundColor, letter: letter || null };
    }
    return null;
  }

  // The contact's name as Messages shows it, or their number if they aren't a contact.
  function currentTitle() {
    const h = document.querySelector(SEL.headerTitle);
    if (h && clean(h.innerText)) return firstLine(h.innerText);
    const id = currentId();
    const link = id && chatLinks().find((a) => a.getAttribute('href')?.includes(`/conversations/${id}`));
    if (link) return firstLine((link.querySelector(SEL.convName) || link).innerText);
    return clean(document.title.replace(/\s*[-|]\s*Google Messages.*$/i, '')) || 'Conversation';
  }

  // ---------- settings ----------
  // Shared with the popup and the settings page through chrome.storage.

  async function getSettings() {
    const { settings } = await chrome.storage.local.get('settings');
    return GMLib.normalizeSettings(settings);
  }
  // Opens the backup folder chosen in Settings. Interactive runs can ask for
  // Chrome's OK on the page; automatic runs can't, so they report it instead.
  async function backupSink(interactive, quiet = false) {
    const sink = await FrameSink.open();
    const st = await sink.call('status');
    if (!st.folder) {
      sink.close();
      if (interactive) {
        HUD.log('No backup folder chosen yet. Settings has opened in a new tab: choose one there, then start again.', 'warn');
        chrome.runtime.sendMessage({ type: 'gm-open-settings', hash: 'folder' });
      }
      return null;
    }
    sink.folderName = st.folder;
    if (st.permission !== 'granted') {
      if (!interactive) { sink.close(); return null; }
      HUD.state('WAITING', 'paused');
      HUD.phase(`Chrome needs your OK to save into “${st.folder}”.`);
      const answer = await sink.askPermission();
      if (answer !== 'granted') { sink.close(); return null; }
    }
    if (!quiet) HUD.log(`Backup folder: “${st.folder}”`);
    return sink;
  }

  // ---------- the library's index, checksums, logs and export info ----------

  async function sha256(data) { return GMLib.sha256(data); }

  async function readText(sink, path) {
    try { return sink.readText ? await sink.readText(path) : null; } catch { return null; }
  }

  // Opens the library in the backup folder: the summary of every chat from
  // data.js (each chat's messages are only read when it's backed up) and the
  // conversation list kept by "Back up everything".
  async function openLibrary(sink) {
    const lib = { entries: [], skipped: [], csv: new Map(), exp: null, state: null };
    const read = await GMLib.readLibrary({ readText: (p) => readText(sink, p), write: (p, d) => sink.write(p, d) }, (t) => HUD.log(t, 'ok'));
    if (read) {
      lib.exp = read.exp;
      lib.skipped = read.exp.skipped || [];
      lib.entries = read.rows.map((r) => ({ id: r.id, title: r.title, folder: r.folder, row: r }));
    }
    try { lib.state = JSON.parse((await readText(sink, 'backup-state.json')) || 'null'); } catch { lib.state = null; }
    return lib;
  }

  // A chat already in the library: by Google's ID; else, for a chat with no ID
  // (from an old export or a phone backup), by name, or by number when it's
  // named by one ("+15550100001" on the phone is "(555) 010-0001" here).
  const findEntry = (lib, conv) => {
    const num = GMLib.restoreAddrs(null, conv.title)[0];
    const sameNumber = (e) => { const n = GMLib.restoreAddrs(null, e.title)[0]; return !!num && !!n && GMLib.phoneKey(n) === GMLib.phoneKey(num); };
    return lib.entries.find((e) => e.id && e.id === conv.id) || lib.entries.find((e) => !e.id && e.title === conv.title) || lib.entries.find((e) => !e.id && sameNumber(e)) || null;
  };

  // A chat's own index files: chat.js for the viewer and its messages.csv.
  async function writeChatFiles(sink, entry, lib) {
    if (!entry.data) return;
    const csv = GMLib.chatCsv(entry.title, entry.folder, entry.data.messages);
    // The chat's master list of media: every item and its status.
    const media = GMLib.mediaIndex(entry.data.messages, entry.folder);
    await Promise.all([
      sink.write(`${entry.folder}/chat.js`, GMLib.chatScript(entry.folder, GMLib.compactMessages(entry.folder, entry.data.messages))),
      sink.write(`${entry.folder}/messages.csv`, csv),
      sink.write(`${entry.folder}/media-index.json`, JSON.stringify({ conversation: entry.title, updated_at: new Date().toISOString(), statuses: GMLib.MEDIA_STATUS, counts: GMLib.mediaCounts(media.map((r) => r.status)), items: media }, null, 2)),
      sink.write(`${entry.folder}/media-index.csv`, GMLib.mediaIndexCsv(entry.title, media)),
    ]);
    entry.row = GMLib.summarize(entry);
    entry.dirty = false;
    lib.changed = true;
    // In a folder, a finished chat is read back from disk if it's needed again,
    // so a backup of hundreds of chats doesn't hold them all in memory.
    if (sink.readText) { entry.data = undefined; entry.progress = undefined; } else lib.csv.set(entry.folder, csv);
  }

  // Writes the library's index: each changed chat's files, data.js (a summary
  // of every chat), export-info.json and SHA256SUMS.txt (checksums for every
  // file, so the copy can be verified later with: shasum -a 256 -c SHA256SUMS.txt).
  // `final` (the end of a run) also writes the viewer, messages.csv for every
  // chat, verification.json and the log of the run.
  async function writeIndex(sink, lib, run, final = true, { chatFiles = true } = {}) {
    HUD.task(null, null, final ? 'writing index, data, log and checksums' : 'updating the index', '');
    // Mid-chat (chatFiles: false) only the summary and checksums are updated;
    // the chat's own files are written once it's done.
    if (chatFiles) for (const e of lib.entries) if (e.dirty) await writeChatFiles(sink, e, lib);
    const settings = await getSettings();
    lib.info ||= JSON.parse((await readText(sink, 'export-info.json')) || '{}');
    const prevInfo = lib.info;
    const now = new Date();
    const stamp = `${formatDate(now, true).replace(':', '.')}.${pad(now.getSeconds())}`;
    const logPath = `logs/${stamp} - ${run.kind}.txt`;
    if (final) run.log_file = logPath;
    const info = {
      tool: 'Message Archivist',
      version: chrome.runtime.getManifest().version,
      created_at: prevInfo.created_at || now.toISOString(),
      updated_at: now.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      user_agent: navigator.userAgent,
      source: 'https://messages.google.com/web',
      case_note: settings.caseNote || prevInfo.case_note || '',
      hash_algorithm: 'SHA-256',
      verify_with: 'shasum -a 256 -c SHA256SUMS.txt',
      runs: final ? [...(prevInfo.runs || []), run] : prevInfo.runs || [],
    };
    if (final) lib.info = info;
    const rows = lib.entries.map((e) => e.row).filter(Boolean);
    const verification = GMLib.verificationOf(rows, lib.state, chrome.runtime.getManifest().version);
    const data = { exported_at: info.created_at, updated_at: info.updated_at, info: { ...info, runs: info.runs.map(({ log_file, ...r }) => r) }, conversations: rows, skipped: lib.skipped || [], verification: verification.summary };
    await sink.write('data.js', GMLib.indexScript(data));
    await sink.write('export-info.json', JSON.stringify(info, null, 2));
    if (final || !(await sink.exists('index.html'))) {
      const viewer = await viewerFiles();
      await sink.write('index.html', viewer['viewer.html']);
      for (const f of ['viewer.js', 'theme.js', 'theme.css']) await sink.write(f, viewer[f]);
      await sink.write('README.txt', GMLib.README);
    }
    if (final) {
      // The whole library's messages.csv: only rebuilt when a chat changed (an
      // automatic backup that found nothing new leaves it alone). In the backup
      // folder it's joined by the writer frame, so years of messages don't pass
      // through this page as text.
      if (sink.joinCsv) {
        if (lib.changed || !(await sink.exists('messages.csv'))) await sink.joinCsv('messages.csv', rows.map((r) => `${r.folder}/messages.csv`));
      } else {
        const parts = [];
        for (const r of rows) {
          const text = lib.csv.get(r.folder) ?? (await readText(sink, `${r.folder}/messages.csv`));
          if (text) parts.push(text);
        }
        await sink.write('messages.csv', GMLib.joinCsv(parts));
      }
      await sink.write('verification.json', JSON.stringify(verification.full, null, 2));
      const v = verification.summary;
      HUD.log(`✓ wrote index.html, data.js, messages.csv, verification.json, export-info.json`, 'ok');
      HUD.log(`Library: ${plural(v.chats, 'chat')} · ${nf(v.verified + v.complete)} complete${v.verified ? ` (${nf(v.verified)} verified)` : ''}${v.incomplete ? ` · ${nf(v.incomplete)} unfinished` : ''}${v.problem ? ` · ${nf(v.problem)} need attention` : ''}`, v.incomplete || v.problem ? 'warn' : 'ok');
      if (v.coverage) HUD.log(`Coverage: ${nf(v.coverage.backed_up)} of the ${nf(v.coverage.in_messages)} conversations in Messages are completely backed up${v.coverage.not_backed_up ? `; ${nf(v.coverage.not_backed_up)} not backed up yet` : ''}${v.coverage.unfinished ? `; ${nf(v.coverage.unfinished)} unfinished` : ''}`, v.coverage.backed_up === v.coverage.in_messages ? 'ok' : 'warn');
      const header = [
        `Message Archivist ${info.version} — ${run.kind}`,
        `Started:   ${run.started_at}`,
        `Finished:  ${now.toISOString()}`,
        `Timezone:  ${info.timezone}`,
        `Browser:   ${info.user_agent}`,
        `Chats:     ${run.chats.join(', ')}`,
        run.range ? `Range:     ${run.range.from} to ${run.range.to}` : 'Range:     all available history',
        `Photos:    ${run.full_size ? 'full-size viewer where larger' : 'chat thumbnails'}`,
        `Options:   ${Object.entries(run.options || {}).map(([k, v]) => `${k}=${v}`).join(', ')}`,
        `Page:      ${innerWidth}×${innerHeight} window, ${navigator.language}, ${navigator.onLine ? 'online' : 'OFFLINE'}`,
        `Saved to:  ${sink.folderName ? `backup folder “${sink.folderName}”` : 'zip download'}`,
        `Result:    ${nf(run.added_messages || 0)} messages, ${nf(run.added_media || 0)} media added, ${nf(run.failed_media || 0)} media failed${run.skipped_media ? `, ${nf(run.skipped_media)} preview pictures skipped` : ''}`,
        info.case_note ? `Case note: ${info.case_note}` : null,
        '',
        'Lines marked DEBUG are extra detail for troubleshooting; they aren’t shown in the progress panel.',
        '',
      ].filter((l) => l != null).join('\n');
      await sink.write(logPath, `${header}\n${HUD.lines().join('\n')}\n`);
      HUD.log(`✓ log saved as ${logPath}`, 'ok');
    }
    // Checksums: keep earlier entries for files this run didn't touch.
    lib.sums ||= GMLib.parseSums(await readText(sink, 'SHA256SUMS.txt'));
    // Files removed during the run (thumbnails replaced by full-size photos, a finished journal).
    for (const gone of sink.removed || []) for (const p of [...lib.sums.keys()]) if (p === gone || p.startsWith(`${gone}/`)) lib.sums.delete(p);
    for (const [p, h] of sink.hashes) lib.sums.set(p, h);
    await sink.write('SHA256SUMS.txt', GMLib.formatSums(lib.sums));
    if (final) HUD.log(`✓ SHA-256 checksums for ${nf(lib.sums.size)} files in SHA256SUMS.txt`, 'ok');
    HUD.task(1, 1, final ? 'index, data, log and checksums written' : 'index updated', '');
    return verification.summary;
  }

  // Run history shown on the settings page (last 30 runs, with their logs).
  async function recordRun(entry) {
    const { runs = [] } = await chrome.storage.local.get('runs');
    runs.unshift({ ...entry, log: HUD.lines().slice(-1500) });
    await chrome.storage.local.set({ runs: runs.slice(0, 30) });
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  const runOptions = (o) => ({ includeMedia: !!o.includeMedia, fullSize: !!o.fullSize, patience: o.patience || 25, ...(o.retryFailed ? { retryFailed: true } : {}), ...(o.verifyRead ? { verifyRead: true } : {}), ...(o.fullSize && o.fullSizeEarly !== false ? { fullSizeBetweenBatches: true } : {}), ...(o.media && o.media !== 'all' ? { media: o.media } : {}), ...(o.limit ? { limit: o.limit } : {}), ...(background ? { background: true } : {}) });

  // What the page looks like right now, for the log.
  function pageState() {
    const sc = findScroller(document.querySelector(SEL.message));
    return `${location.pathname.replace(/\/conversations\/[^/]+/, '/conversations/…')} · ${document.querySelectorAll(SEL.message).length} messages, ${document.querySelectorAll(SEL.tombstone).length} date headers on page` +
      ` · list ${sc ? `${Math.round(sc.scrollTop)}/${sc.scrollHeight} (view ${sc.clientHeight})` : 'not scrollable'} · spinner ${spinning() ? 'on' : 'off'} · tab ${document.hidden ? 'hidden' : 'visible'}`;
  }

  // Errors on the page during a run go into the log too.
  addEventListener('error', (e) => { if (running) HUD.debug(`page error: ${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`); });
  addEventListener('unhandledrejection', (e) => { if (running) HUD.debug(`unhandled: ${e.reason?.stack || e.reason}`); });
  document.addEventListener('visibilitychange', () => { if (running) HUD.debug(`tab ${document.hidden ? 'hidden' : 'visible'}`); });

  function startRun(isBackground = false) {
    getSettings().then((s) => { rawMarkup = !!s.rawMarkup; });
    running = true;
    cancelled = false;
    paused = false;
    background = isBackground;
    report('gm-badge', { text: '…' });
    HUD.start();
    runningButtons();
  }

  function overallProgress(i, total, title) {
    const per = i ? HUD.elapsed() / i : 0;
    const eta = i && total > 1 && i < total ? ` · ~${Math.max(1, Math.round((per * (total - i)) / 60000))} min left` : '';
    HUD.overall(i, total, total > 1 ? `chat ${Math.min(i + 1, total)} of ${nf(total)}` : 'chat', `${title}${eta}`);
  }

  const plural = (n, word, many) => `${nf(n)} ${n === 1 ? word : many || `${word}s`}`;

  // ---------- choosing chats ----------

  async function chooseTargets(opts) {
    if (opts.mode !== 'all') {
      const id = currentId();
      if (!id || !document.querySelector(SEL.message)) throw new Error('Open a conversation first.');
      return [{ id, href: location.pathname, name: currentTitle() }];
    }
    const limit = opts.limit > 0 ? opts.limit : Infinity;
    HUD.phase('Finding conversations…');
    HUD.log('Scanning the conversation list', 'head');
    const targets = await listConversations(limit);
    if (cancelled) throw new Error('Cancelled.');
    if (!targets.length) throw new Error('No conversations found in the list on the left.');
    HUD.log(`Found ${plural(targets.length, 'conversation')}: ${targets.slice(0, 8).map((t) => t.name).join(', ')}${targets.length > 8 ? ', …' : ''}`);
    const ok = await askOnPage(
      `Ready to export ${plural(targets.length, 'conversation')}${limit === Infinity ? ' (all of them)' : ` (the ${targets.length} most recent)`}` +
      `${opts.range ? `, messages from ${opts.range.from} to ${opts.range.to}` : ''}.\n\n` +
      'Each one is opened and scrolled back through its history. Long chats can take several minutes each, so keep this tab open and in front.', 'Start export');
    if (!ok) return null;
    HUD.state('RUNNING', 'run');
    runningButtons();
    return targets;
  }

  // ---------- a date range, as a zip ----------

  async function zipExport(targets, opts, settings, kind = 'export') {
    const now = new Date();
    const ctx = { msgs: 0, media: 0, failed: 0, sink: null };
    const label = opts.range ? `${opts.range.from} to ${opts.range.to}` : formatDate(now, false);
    const root = targets.length === 1 && opts.mode !== 'all'
      ? `${safeName(targets[0].name)} - Messages - ${label}`
      : `Google Messages - ${plural(targets.length, 'chat')} - ${label}`;
    ctx.sink = new ZipSink(root);
    const lib = { entries: [], skipped: [], csv: new Map() };
    const folders = new Set();
    const run = { kind, started_at: now.toISOString(), chats: [], range: opts.range || null, full_size: !!opts.fullSize, options: runOptions(opts) };
    updateStats(ctx);
    for (let i = 0; i < targets.length && !cancelled; i++) {
      await checkpoint();
      if (cancelled) break;
      if (i > 0) await sleep(1500); // gentle pace between conversations
      const t = targets[i];
      overallProgress(i, targets.length, t.name);
      HUD.phase(`Exporting “${t.name}”${opts.range ? ` (${label})` : ''}`);
      HUD.log(`▸ ${t.name}`, 'head');
      if ((opts.mode === 'all' || background) && !(await openConversation(t))) {
        HUD.log('  ✗ no messages loaded; skipping', 'err');
        lib.skipped.push({ title: t.name, error: 'No messages loaded' });
        continue;
      }
      const conv = { id: t.id, title: currentTitle() || t.name, now, url: location.href };
      let folder = `conversations/${safeName(conv.title)}`;
      for (let n = 2; folders.has(folder.toLowerCase()); n++) folder = `conversations/${safeName(conv.title)} (${n})`;
      folders.add(folder.toLowerCase());
      lib.entries.push(await exportOne(conv, opts, ctx, folder));
      run.chats.push(conv.title);
    }
    overallProgress(targets.length, targets.length, 'finishing');
    HUD.phase('Packing the zip…');
    run.added_messages = ctx.msgs;
    run.added_media = ctx.media;
    run.failed_media = ctx.failed;
    run.skipped_media = ctx.skipped || 0;
    await writeIndex(ctx.sink, lib, run);
    updateStats(ctx);
    const name = `${root}${cancelled ? ' (partial)' : ''}.zip`;
    const sub = (settings.downloadsSubfolder || '').trim();
    try { await chrome.runtime.sendMessage({ type: 'gm-expect-download', name, subfolder: sub }); } catch { /* saved to Downloads itself */ }
    download(ctx.sink.zip.finish(), name);
    HUD.log(`✓ downloaded ${name} (${fmtBytes(ctx.sink.bytes)})`, 'ok');
    return {
      ok: true,
      summary: `${cancelled ? 'Partial copy saved' : 'Done'}: ${plural(lib.entries.length, 'chat')}, ${plural(ctx.msgs, 'message')}, ${plural(ctx.media, 'media file')}` +
        `${ctx.failed ? `, ${nf(ctx.failed)} media failed (see log)` : ''}.\nSaved to Downloads${sub ? `/${sub}` : ''} as “${name}”.`,
      added: ctx.msgs,
    };
  }

  // ---------- backing up into the library ----------
  // Used by "Back up this chat", the backup list, schedules and "Back up
  // everything". New chats are added in full; chats already in the library
  // carry on (if unfinished) or only get the messages sent since.

  async function folderRun(sink, pickTargets, opts, kind, hooks = {}) {
    const now = new Date();
    const ctx = { msgs: 0, media: 0, failed: 0, sink };
    const lib = await openLibrary(sink);
    if (lib.exp) {
      HUD.log(`Opened “${sink.folderName}”: ${plural(lib.entries.length, 'chat')}, started ${lib.exp.exported_at ? new Date(lib.exp.exported_at).toLocaleString() : '?'}${lib.exp.updated_at ? `, last saved ${new Date(lib.exp.updated_at).toLocaleString()}` : ''}`);
    } else {
      HUD.log(`“${sink.folderName}” has no backups yet; starting the library there`);
    }
    const targets = await pickTargets(lib);
    if (!targets) return { ok: false, summary: 'Cancelled. Nothing was changed.', cancelled: true };
    const run = { kind, started_at: now.toISOString(), chats: [], range: null, full_size: !!opts.fullSize, ...(opts.verifyRead ? { second_read: true } : {}), options: runOptions(opts) };
    updateStats(ctx);
    let added = 0;
    const perChat = [];
    for (let i = 0; i < targets.length && !cancelled; i++) {
      await checkpoint();
      if (cancelled) break;
      if (i > 0) await sleep(1500);
      const t = targets[i];
      overallProgress(i, targets.length, t.name);
      HUD.phase(targets.length > 1 ? `Backing up “${t.name}” (chat ${i + 1} of ${nf(targets.length)})` : `Backing up “${t.name}”`);
      HUD.log(`▸ ${t.name}`, 'head');
      if (t.id !== currentId() && !(await openConversation(t))) {
        HUD.log('  ✗ could not open this chat; left unchanged', 'err');
        perChat.push({ id: t.id, title: t.name, failed: true });
        await hooks.afterChat?.({ id: t.id, title: t.name, failed: true }, null, lib);
        continue;
      }
      if (cancelled) break;
      const conv = { id: t.id, title: currentTitle() || t.name, now, url: location.href };
      const entry = t.entry || findEntry(lib, conv) || await adoptOrCreate(sink, lib.entries, conv);
      const result = await backupConversation(conv, { ...opts, onCompact: () => writeIndex(sink, lib, run, false, { chatFiles: false }) }, ctx, entry);
      perChat.push(result);
      // A chat deleted earlier with "don't back it up again", backed up now on
      // purpose, is back in: take it off that list.
      if (lib.state?.excluded?.some((e) => e.id === conv.id) && kind !== 'total backup') {
        lib.state.excluded = lib.state.excluded.filter((e) => e.id !== conv.id);
        await sink.write('backup-state.json', JSON.stringify(lib.state, null, 2));
      }
      run.chats.push(conv.title);
      added += result.added;
      await hooks.afterChat?.(result, entry, lib);
      // Keep the library's index current after every chat, so a stopped run
      // still leaves a usable, up-to-date copy. This only rewrites this chat's
      // files and the summary, however big the library is.
      if (i < targets.length - 1 && !cancelled) await writeIndex(sink, lib, run, false);
    }
    overallProgress(targets.length, targets.length, 'finishing');
    HUD.phase('Finishing up: updating the backup’s index and checks…');
    run.added_messages = added;
    run.added_media = ctx.media;
    run.failed_media = ctx.failed;
    run.skipped_media = ctx.skipped || 0;
    await hooks.beforeIndex?.(lib);
    const v = await writeIndex(sink, lib, run);
    updateStats(ctx);
    const done = perChat.filter((r) => !r.failed);
    const unfinished = done.filter((r) => !r.complete && r.status !== 'messages').length;
    // Speed runs: messages saved, photos listed to fetch later.
    const listed = done.filter((r) => r.status === 'messages').reduce((n, r) => n + (r.media?.waiting || 0), 0);
    const couldnt = perChat.length - done.length;
    return {
      ok: true,
      added,
      perChat: done,
      verification: v,
      summary: `${cancelled ? 'Stopped. Everything read so far is saved. “Carry on now”, or backing up again later, picks up from here.'
        : unfinished ? `Saved, but ${unfinished === 1 ? 'a chat isn’t' : `${nf(unfinished)} chats aren’t`} finished yet. Nothing is lost: back up again to carry on.`
        : listed ? `Messages saved. ${plural(listed, 'photo or video', 'photos and videos')} that hadn’t loaded ${listed === 1 ? 'is' : 'are'} listed to fetch later: use “Fetch photos” in the popup or in Settings.`
        : ctx.failed ? `Done: your messages are backed up, but ${ctx.failed === 1 ? 'a photo or video' : `${nf(ctx.failed)} photos or videos`} couldn’t be saved. “Fetch photos” in the popup, or “Retry failed photos” in Settings, tries again.`
        : 'All done. Everything is backed up.'}\n` +
        `${plural(added, 'new message')} and ${nf(ctx.media)} ${ctx.media === 1 ? 'photo or video' : 'photos and videos'} added to “${sink.folderName}”` +
        `${ctx.failed ? `, ${nf(ctx.failed)} couldn’t be saved` : ''}.` +
        `${couldnt ? ` ${plural(couldnt, 'chat')} couldn’t be opened.` : ''}` +
        `\nYour backup has ${plural(v.chats, 'chat')}, ${nf(v.verified + v.complete)} complete${v.messages ? `, ${nf(v.messages)} with photos still to fetch` : ''}${v.coverage ? `; ${nf(v.coverage.backed_up)} of the ${nf(v.coverage.in_messages)} conversations in Messages are completely backed up` : ''}. Click “Open my backup” to see them.`,
    };
  }

  // A chat not yet in data.js may still have a folder from a run that was
  // stopped before the index was written; carry on in that folder.
  async function adoptOrCreate(sink, entries, conv) {
    const base = `conversations/${safeName(conv.title)}`;
    for (let n = 1; n < 50; n++) {
      const folder = n === 1 ? base : `${base} (${n})`;
      if (entries.some((e) => e.folder.toLowerCase() === folder.toLowerCase())) continue;
      let existing = null;
      try { existing = JSON.parse((await readText(sink, `${folder}/messages.json`)) || 'null'); } catch { /* unreadable: use another folder */ continue; }
      if (existing && existing.conversation_id !== conv.id) continue;
      const entry = { id: conv.id, title: conv.title, folder, data: existing };
      if (existing) HUD.log(`  found an unfinished backup in ${folder}/; carrying on`, 'warn');
      entries.push(entry);
      return entry;
    }
    throw new Error(`Too many folders named “${base}”.`);
  }

  // ---------- back up everything ----------
  // Every conversation in Messages' list, one after another, into the library.
  // The list and how far this got are kept in backup-state.json, so a stopped
  // run carries on where it left off. At the end the coverage check compares
  // the list with the library, and anything not completely backed up is named
  // in verification.json and in Settings.

  const NO_FOLDER = 'Nothing was saved: the backup folder isn’t set up or wasn’t allowed. Choose it in Settings, then start again.';

  async function runTotal(opts) {
    lastStart = () => runTotal(opts);
    startRun();
    const target = opts.limit > 0 ? `${opts.limit} most recent chats` : 'every conversation';
    try {
      const settings = await getSettings();
      opts = { includeMedia: settings.includeMedia, fullSize: settings.fullSize, ...opts, fullHistory: true, patience: settings.patience, fullSizeEarly: settings.fullSizeEarly };
      const probe = await backupSink(true, true);
      if (!probe) return finishRun('total backup', target, { ok: false, cancelled: true, summary: NO_FOLDER });
      probe.close();
      const limit = opts.limit > 0 ? opts.limit : Infinity;
      HUD.phase('Finding every conversation…');
      HUD.log('Scanning the conversation list', 'head');
      const found = await listConversations(limit);
      if (cancelled) throw new Error('Cancelled.');
      if (!found.length) throw new Error('No conversations found in the list on the left.');
      const sink = await backupSink(true);
      if (!sink) return finishRun('total backup', target, { ok: false, cancelled: true, summary: NO_FOLDER });
      const writeState = (lib) => sink.write('backup-state.json', JSON.stringify(lib.state, null, 2));
      try {
        const result = await folderRun(sink, async (lib) => {
          const byId = new Map(lib.entries.filter((e) => e.id).map((e) => [e.id, e]));
          const prev = lib.state?.run;
          const resuming = !!prev && !prev.finished_at && !prev.limited && limit === Infinity;
          const doneBefore = new Set(resuming ? prev.done : []);
          // Chats deleted from the backup with "don't back it up again".
          const excluded = new Set((lib.state?.excluded || []).map((e) => e.id));
          const leftOut = found.filter((c) => excluded.has(c.id));
          if (leftOut.length) HUD.log(`Leaving out ${plural(leftOut.length, 'chat')} you deleted from the backup: ${leftOut.map((c) => c.name).join(', ')}`);
          const todo = found.filter((c) => !doneBefore.has(c.id) && !excluded.has(c.id));
          const fresh = todo.filter((c) => !byId.has(c.id)).length;
          const unfinished = todo.filter((c) => ['incomplete', 'problem'].includes(byId.get(c.id)?.row?.status)).length;
          const before = todo.length - fresh - unfinished;
          HUD.log(`Found ${plural(found.length, 'conversation')}: ${nf(fresh)} new to the backup, ${nf(unfinished)} unfinished, ${nf(before)} backed up before`);
          const choice = await askChoice(
            `${resuming ? `Carrying on the backup of everything started ${new Date(prev.started_at).toLocaleString()}: ${nf(doneBefore.size)} done, ${nf(todo.length)} to go.`
              : limit === Infinity ? `Back up all ${plural(found.length, 'conversation')}?` : `Back up the ${plural(found.length, 'most recent conversation')}?`}\n\n` +
            `${nf(fresh)} new to the backup, ${nf(unfinished)} unfinished, ${nf(before)} already backed up (only new messages are added to those).\n\n` +
            `Each chat is opened and read back to its first message. With many chats this takes hours and your phone has to stay online. Keep this window open and showing. You can stop at any time and carry on later.\n\n${SPEED_NOTE}`,
            [[resuming ? 'Carry on' : 'Back up everything', 'all', true], ['Speed run', 'speed']]);
          if (!choice) return null;
          if (choice === 'speed') { opts.media = 'speed'; opts.fullSize = false; HUD.log('Speed run: messages first; photos that haven’t loaded are listed to fetch later.'); }
          HUD.state('RUNNING', 'run');
          runningButtons();
          await ownWindow();
          // A full scan replaces the list of conversations; "most recent N" adds to it.
          const known = new Map((limit === Infinity ? [] : lib.state?.conversations || []).map((c) => [c.id, c]));
          for (const c of found) known.set(c.id, { id: c.id, title: c.name });
          lib.state = {
            ...(lib.state?.excluded ? { excluded: lib.state.excluded } : {}),
            scanned_at: new Date().toISOString(),
            conversations: [...known.values()],
            run: resuming ? prev : { started_at: new Date().toISOString(), total: found.length, limited: limit !== Infinity, done: [] },
          };
          await writeState(lib);
          return todo;
        }, opts, 'total backup', {
          // A chat stopped part-way isn't done: carrying on starts with it.
          afterChat: async (r, _entry, lib) => {
            if (cancelled) return;
            if (!lib.state.run.done.includes(r.id)) lib.state.run.done.push(r.id);
            await writeState(lib);
          },
          beforeIndex: async (lib) => {
            if (!lib.state) return;
            if (!cancelled) lib.state.run.finished_at = new Date().toISOString();
            await writeState(lib);
          },
        });
        return finishRun('total backup', target, result);
      } finally { sink.close(); }
    } catch (err) {
      return failRun('total backup', target, err);
    } finally {
      running = false;
    }
  }

  // ---------- entry points ----------

  // Tells the background page how a run ended: badge, notification, and the
  // backup list's per-chat status.
  function report(type, payload) {
    try { chrome.runtime.sendMessage({ type, ...payload }); } catch { /* extension reloaded */ }
  }

  async function finishRun(kind, target, result) {
    restoreWindow();
    if (result.perChat?.length) report('gm-backup-status', { results: result.perChat.map(({ id, title, added, complete, count, oldest, status, media }) => ({ id, title, added, complete, count, oldest, status, media })), ...(result.statusOnly ? { statusOnly: true } : {}) });
    if (kind !== 'analyze' && kind !== 'scheduled') report('gm-done', { ok: !!result.ok && !result.cancelled, title: result.ok ? 'Backup finished' : 'Backup stopped', message: result.summary.split('\n')[0] });
    const stopped = cancelled || result.cancelled;
    const carryOn = stopped && lastStart && !result.perChat?.every((r) => r.complete)
      ? [['Carry on now', () => { const again = lastStart; HUD.close(); if (!running) again(); }, true]] : [];
    const toBackup = [...carryOn, ...(result.ok && result.perChat ? [['Open my backup', () => report('gm-open-backup', {}), !carryOn.length]] : [])];
    HUD.finish(result.summary, result.cancelled ? 'paused' : result.ok ? (cancelled ? 'paused' : 'done') : 'err', toBackup);
    await recordRun({ at: new Date().toISOString(), kind, target, ok: !!result.ok && !result.cancelled, summary: result.summary, added: result.added || 0 });
    return result;
  }

  async function failRun(kind, target, err) {
    console.error('[Message Archivist]', err);
    HUD.log(err.stack || err.message, 'err');
    return finishRun(kind, target, { ok: false, summary: `Something went wrong: ${err.message}\nWhatever was read before this is saved. Reloading the Google Messages page (⌘R or Ctrl+R) and starting again usually fixes it; the backup carries on where it stopped. If it keeps happening, click “Copy log” and send it to whoever is helping you.` });
  }

  // "Back up this chat" in the popup: straight into the backup folder. A date
  // range is the one thing that's a separate copy, downloaded as a zip.
  async function run(opts) {
    if (opts.mode === 'all' && !opts.range) return runTotal(opts);
    lastStart = opts.range ? null : () => run(opts);
    startRun();
    const target = opts.mode === 'all' ? 'many chats' : currentTitle();
    try {
      const settings = await getSettings();
      opts = { ...opts, patience: settings.patience || 25, fullSizeEarly: settings.fullSizeEarly !== false };
      const toFolder = !opts.range;
      if (opts.range) HUD.log(`Date range ${opts.range.from} to ${opts.range.to}: saved as a separate zip`);
      // Check the folder before anything else, so nothing is read that can't be saved.
      if (toFolder) {
        const probe = await backupSink(true, true);
        if (!probe) return finishRun('backup', target, { ok: false, cancelled: true, summary: NO_FOLDER });
        probe.close();
      }
      const targets = await chooseTargets(opts);
      if (!targets) return finishRun('backup', target, { ok: false, cancelled: true, summary: 'Cancelled. Nothing was saved.' });
      if (toFolder) {
        const sink = await backupSink(true);
        if (!sink) return finishRun('backup', target, { ok: false, cancelled: true, summary: NO_FOLDER });
        // Says what's about to happen, and starts only when you click Start.
        const confirmStart = async (lib) => {
          const t = targets[0];
          const ent = findEntry(lib, { id: t.id, title: t.name });
          let row = ent?.row;
          // The chat's own progress is saved more often than the summary: use whichever is newer.
          try {
            const prog = ent && JSON.parse((await readText(sink, `${ent.folder}/progress.json`)) || 'null');
            if (prog && prog.message_count > (row?.count || 0)) row = { ...row, count: prog.message_count, first: prog.oldest, status: prog.checks?.status || row?.status };
          } catch { /* the summary will do */ }
          const back = row?.first ? ` back to ${new Date(+row.first.slice(0, 4), +row.first.slice(5, 7) - 1, +row.first.slice(8, 10)).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}` : '';
          const now = !row ? 'Not backed up yet. The whole chat is read, all the way back to its first message. A long chat can take several minutes or more.'
            : row.status === 'incomplete' ? `Partly backed up so far: ${plural(row.count, 'message')}${back}. This carries on reading back to the first message.`
            : `Already backed up: ${plural(row.count, 'message')}${back}. Only newer messages are added.`;
          const what = opts.includeMedia ? `messages, ${opts.fullSize ? 'full-size photos' : 'photos'}, GIFs, videos, voice notes and the contact card` : 'messages and the contact card (no photos)';
          const choice = await askChoice(`Back up “${t.name}”?\n\n${now}\n\nSaving ${what} into your backup folder, “${sink.folderName}”.${opts.includeMedia ? `\n\n${SPEED_NOTE}` : ''}\n\nOnce it starts, leave this window alone until it’s done. You can pause or stop at any time, and nothing already saved is lost.`,
            [['Start backup', 'all', true], ...(opts.includeMedia ? [['Speed run', 'speed']] : [])]);
          if (!choice) return null;
          if (choice === 'speed') { opts.media = 'speed'; opts.fullSize = false; HUD.log('Speed run: messages first; photos that haven’t loaded are listed to fetch later.'); }
          HUD.state('RUNNING', 'run');
          runningButtons();
          await ownWindow();
          return targets;
        };
        try { return finishRun('backup', target, await folderRun(sink, opts.mode === 'all' ? async () => targets : confirmStart, opts, 'backup')); } finally { sink.close(); }
      }
      return finishRun('export', target, await zipExport(targets, opts, settings));
    } catch (err) {
      return failRun('backup', target, err);
    } finally {
      running = false;
    }
  }

  // Scheduled jobs, started by the background page. They run in the
  // background tab and never prompt; if the backup folder needs permission
  // again they report that instead.
  // `interactive` is true for "Run now" / "Back up all now", which can ask
  // for folder access on the page; timed runs never prompt.
  async function runScheduled(jobs, interactive = false, retryFailed = false, extra = {}) {
    lastStart = interactive ? () => runScheduled(jobs, true, retryFailed, extra) : null;
    startRun(!interactive);
    const what = extra.media === 'fullsize' ? 'Upgrading photos to full size' : extra.media === 'fetch' ? 'Fetching photos' : interactive ? 'Backing up' : 'Scheduled backup';
    HUD.log(`${what}: ${jobs.map((j) => j.title).join(', ')}`, 'head');
    const settings = await getSettings();
    const results = [];
    let perChat = [];
    try {
      // Fetch and upgrade runs are about photos, so they save them whatever the setting.
      const opts = { includeMedia: settings.includeMedia || !!extra.media, fullSize: settings.fullSize, fullHistory: true, patience: settings.patience, fullSizeEarly: settings.fullSizeEarly, retryFailed, ...extra };
      const sink = await backupSink(interactive);
      if (interactive) { HUD.state('RUNNING', 'run'); runningButtons(); if (sink) await ownWindow(); }
      if (!sink) {
        const msg = settings.folderName
          ? 'Chrome needs your OK to use the backup folder again. Open the extension’s Settings and click “Allow access”.'
          : 'No backup folder is set. Choose one in the extension’s Settings.';
        HUD.log(msg, 'err');
        for (const j of jobs) results.push({ id: j.id, ok: false, summary: msg });
      } else {
        try {
          const kind = extra.media === 'fullsize' ? 'upgrade photos' : extra.media === 'fetch' ? 'fetch photos' : interactive ? 'backup' : 'scheduled backup';
          const r = await folderRun(sink, async (lib) => jobs.map((j) => ({ id: j.id, name: j.title, href: `/web/conversations/${j.id}`, entry: lib.entries.find((e) => e.id === j.id) })), opts, kind);
          perChat = r.perChat || [];
          for (const j of jobs) {
            const c = r.perChat?.find((x) => x.id === j.id);
            results.push(c
              ? { id: j.id, ok: true, added: c.added, complete: c.complete, count: c.count, oldest: c.oldest, status: c.status, media: c.media,
                summary: `${c.status === 'messages' ? 'Messages saved, photos to fetch' : c.complete ? 'Up to date' : 'Partly backed up'}: ${plural(c.count, 'message')}${c.oldest ? ` back to ${c.oldest.slice(0, 10)}` : ''}${c.added ? `, ${nf(c.added)} new` : ''}${c.complete || c.status === 'messages' ? '' : '. Run again to carry on.'}` }
              : { id: j.id, ok: false, summary: cancelled ? 'Stopped before this chat.' : 'Could not open this chat.' });
          }
        } finally { sink.close(); }
      }
      const summary = results.map((r) => `${jobs.find((j) => j.id === r.id)?.title}: ${r.summary.split('\n')[0]}`).join('\n') || 'Nothing to do.';
      // Each chat's result goes to the popup (its photo counts) and, for "Fetch photos" and
      // "Upgrade to full size", to the backup list; scheduled runs update that list themselves.
      await finishRun(interactive ? 'backup' : 'scheduled', jobs.map((j) => j.title).join(', '), { ok: results.every((r) => r.ok), summary, added: results.reduce((n, r) => n + (r.added || 0), 0), perChat, statusOnly: !extra.media });
    } catch (err) {
      await failRun('scheduled', jobs.map((j) => j.title).join(', '), err);
      for (const j of jobs) if (!results.some((r) => r.id === j.id)) results.push({ id: j.id, ok: false, summary: err.message });
    } finally {
      running = false;
      background = false;
    }
    return results;
  }

  // ---------- analyze without saving ----------
  // Reads the open chat (text only) and opens the archive viewer over the page.
  // Nothing is written anywhere.

  async function runAnalyze(opts) {
    startRun();
    const target = currentTitle();
    try {
      const id = currentId();
      if (!id || !document.querySelector(SEL.message)) throw new Error('Open a conversation first.');
      const now = new Date();
      const conv = { id, title: target, now, url: location.href };
      HUD.phase(`Reading “${conv.title}”${opts.range ? ` (${opts.range.from} to ${opts.range.to})` : ''}`);
      HUD.log(`▸ ${conv.title} (analyze only, nothing is saved)`, 'head');
      opts = { ...opts, patience: (await getSettings()).patience || 25 };
      const card = await captureContact(conv);
      let msgs = await collectConversation(conv, opts);
      if (opts.range) msgs = msgs.filter((m) => inRange(m, opts.range));
      const records = msgs.map((m, i) => record(m, i + 1));
      const chat = { id, title: conv.title, folder: '', participants: [...new Set(records.map((m) => m.sender))], messages: GMLib.compactMessages('', records) };
      if (card) {
        const toData = (b) => new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
        chat.contact = GMLib.contactSummary('', { end_to_end_encrypted: card.e2ee, people: await Promise.all(card.people.map(async (p) => ({ name: p.name, number: p.number || null, photo: p.photo ? await toData(p.photo) : null }))) });
      }
      const data = {
        version: 3, live: true, exported_at: now.toISOString(), range: opts.range || null,
        info: { tool: 'Message Archivist', version: chrome.runtime.getManifest().version, source: location.href, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        conversations: [chat], skipped: [],
      };
      openAnalyzer(data, conv.title);
      setTimeout(() => HUD.close(), 2500); // get out of the analyzer's way
      return finishRun('analyze', target, { ok: true, summary: `Analyzing ${plural(records.length, 'message')} from “${conv.title}”. Nothing was saved.` });
    } catch (err) {
      return failRun('analyze', target, err);
    } finally {
      running = false;
    }
  }

  function openAnalyzer(data, title) {
    document.getElementById('gm-analyzer')?.remove();
    const dark = isDark();
    const wrap = document.createElement('div');
    wrap.id = 'gm-analyzer';
    wrap.style.cssText = `position:fixed;inset:0;z-index:2147483646;display:flex;flex-direction:column;background:${dark ? '#1b1b1c' : '#f8fafd'}`;
    const bar = document.createElement('div');
    bar.style.cssText = `display:flex;align-items:center;gap:12px;height:56px;padding:0 12px 0 20px;font:14px/20px 'Google Sans Text','Google Sans',Roboto,system-ui,sans-serif;color:${dark ? '#e3e3e3' : '#1f1f1f'}`;
    const name = document.createElement('b');
    name.style.cssText = "font:500 16px 'Google Sans',Roboto,system-ui,sans-serif";
    name.textContent = `💬 Analyzer: ${title}`;
    const note = document.createElement('span');
    note.style.color = dark ? '#a8aaa8' : '#5e5e5e';
    note.textContent = 'Live from this page. Nothing has been saved.';
    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    const close = document.createElement('button');
    close.textContent = 'Close';
    close.style.cssText = `height:40px;padding:0 24px;border:0;border-radius:20px;cursor:pointer;font:500 14px 'Google Sans',Roboto,system-ui,sans-serif;background:${dark ? '#a8c7fa' : '#0b57d0'};color:${dark ? '#062e6f' : '#fff'}`;
    close.onclick = () => wrap.remove();
    bar.append(name, note, spacer, close);
    const frame = document.createElement('iframe');
    frame.src = `${chrome.runtime.getURL('viewer.html')}?embed=1`;
    frame.style.cssText = 'flex:1;border:0;width:100%';
    frame.onload = () => frame.contentWindow.postMessage({ type: 'gm-data', data }, new URL(frame.src).origin);
    wrap.append(bar, frame);
    document.body.append(wrap);
  }

  // ---------- index files ----------

  // The archive viewer (viewer.html + viewer.js, shipped with the extension)
  // becomes the library's index.html. It reads data.js and each chat's
  // chat.js, so it works offline straight from the folder, with no server.
  async function viewerFiles() {
    const files = ['viewer.html', 'viewer.js', 'theme.js', 'theme.css'];
    const texts = await Promise.all(files.map(async (f) => {
      const res = await fetch(chrome.runtime.getURL(f));
      if (!res.ok) throw new Error('Could not load the archive viewer from the extension.');
      return res.text();
    }));
    return Object.fromEntries(files.map((f, i) => [f, texts[i]]));
  }

  // ---------- diagnostics (structure only, text masked) ----------

  function diagnose() {
    const KEEP = new Set(('received sent delivered read seen from said says at on you me today yesterday am pm message ' +
      'image photo picture video gif audio voice reaction sun mon tue wed thu fri sat sunday monday tuesday wednesday ' +
      'thursday friday saturday jan feb mar apr may jun jul aug sep sept oct nov dec january february march april june ' +
      'july august september october november december').split(' '));
    const mask = (s) => s.replace(/\p{L}+/gu, (w) => (KEEP.has(w.toLowerCase()) ? w : 'x'.repeat(Math.min(w.length, 3)))).replace(/\d/g, '9');
    const sanitize = (el) => {
      if (!el) return '(none found)';
      const c = el.cloneNode(true);
      c.querySelectorAll('svg').forEach((s) => s.replaceChildren());
      const walk = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
      while (walk.nextNode()) walk.currentNode.nodeValue = mask(walk.currentNode.nodeValue);
      for (const e of [c, ...c.querySelectorAll('*')]) {
        for (const a of [...e.attributes]) {
          if (a.name === 'style' || a.name.startsWith('_ng')) e.removeAttribute(a.name);
          else if (/^(aria-label|title|alt|placeholder|data-e2e-.*name.*)$/.test(a.name)) e.setAttribute(a.name, mask(a.value));
          else if (a.name === 'src' || a.name === 'href') e.setAttribute(a.name, a.value.replace(/^((?:[a-z]+:)?\/\/[^/]+|blob:|data:[^;,]+).*$/i, '$1…').replace(/\d/g, '9'));
        }
      }
      const html = c.outerHTML;
      return html.length > 5000 ? html.slice(0, 5000) + '…[truncated]' : html;
    };
    const tags = {};
    document.querySelectorAll('*').forEach((e) => {
      const t = e.tagName.toLowerCase();
      if (t.includes('-')) tags[t] = (tags[t] || 0) + 1;
    });
    const wrappers = [...document.querySelectorAll(SEL.message)];
    const pick = [
      wrappers.find((w) => readMessage(w).outgoing),
      wrappers.find((w) => !readMessage(w).outgoing),
      wrappers.find((w) => w.querySelector('img, video, audio')),
    ];
    const out = [
      `Message Archivist diagnostics, ${new Date().toISOString()}`,
      `Path: ${location.pathname.replace(/\d/g, '9')}`,
      `Selector matches: ${Object.entries(SEL).map(([k, s]) => `${k}=${document.querySelectorAll(s).length}`).join(', ')}`,
      `Custom elements: ${Object.entries(tags).map(([t, n]) => `${t}(${n})`).join(', ')}`,
      '', '== Conversation list item ==', sanitize(document.querySelector(SEL.convLink)?.closest('mws-conversation-list-item') || document.querySelector(SEL.convLink)),
      '', '== Conversation header ==', sanitize(document.querySelector('mws-header, [data-e2e-conversation-header]') || document.querySelector(SEL.headerTitle)),
      '', '== Date headers ==', ...[...document.querySelectorAll(SEL.tombstone)].slice(0, 2).map(sanitize),
      '', '== Sent message ==', sanitize(pick[0]),
      '', '== Received message ==', sanitize(pick[1]),
      '', '== Message with media ==', sanitize(pick[2]),
    ];
    if (!wrappers.length) {
      out.push('', '== No message elements matched; main area ==', sanitize(document.querySelector('main, [role="main"]')));
    }
    return out.join('\n');
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    const busy = () => reply({ ok: false, error: 'An export is already running on this page.' });
    switch (msg?.type) {
      case 'gm-ping':
        // `paired`: the conversation list is showing, so the phone is connected.
        // `screen`: the free area of the display this tab is on, for the compact backup window.
        reply({ ok: true, running, id: currentId(), title: currentId() ? currentTitle() : null, paired: !!document.querySelector(SEL.convLink) || !!document.querySelector(SEL.message),
          screen: { left: screen.availLeft ?? 0, top: screen.availTop ?? 0, width: screen.availWidth, height: screen.availHeight } });
        break;
      case 'gm-avatar':
        chatAvatar().then((avatar) => reply({ ok: true, avatar }), () => reply({ ok: true, avatar: null }));
        return true;
      case 'gm-export':
        if (running) return busy();
        run(msg.opts || {});
        reply({ ok: true });
        break;
      case 'gm-media':
        // "Fetch photos" / "Upgrade to full size" for chats already backed up.
        if (running) return busy();
        runScheduled(msg.jobs?.length ? msg.jobs : [{ id: currentId(), title: currentTitle() }], true, !!msg.retryFailed, { media: msg.mode === 'fullsize' ? 'fullsize' : 'fetch', ...(msg.mode === 'fullsize' ? { fullSize: true } : {}) })
          .then((results) => reply({ ok: true, results }));
        return true;
      case 'gm-total':
        if (running) return busy();
        runTotal(msg.opts || {});
        reply({ ok: true });
        break;
      case 'gm-analyze':
        if (running) return busy();
        runAnalyze(msg.opts || {});
        reply({ ok: true });
        break;
      case 'gm-scheduled':
        if (running) return busy();
        runScheduled(msg.jobs || [], !!msg.interactive, !!msg.retryFailed).then((results) => reply({ ok: true, results }));
        return true;
      case 'gm-list-chats':
        if (running) return busy();
        listChatsQuick(msg.limit || 500).then((chats) => reply({ ok: true, chats }));
        return true;
      case 'gm-diagnose':
        reply({ ok: true, text: diagnose() });
        break;
    }
  });
})();
