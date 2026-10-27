const $ = (id) => document.getElementById(id);
let page = null; // what the Messages tab reports: { id, title, running }

function setStatus(text, isError = false) {
  $('status').textContent = text;
  $('status').className = isError ? 'error' : 'gray';
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return GMLib.normalizeSettings(settings);
}
async function saveSettings(patch) {
  await chrome.storage.local.set({ settings: { ...(await getSettings()), ...patch } });
}

const NOT_MESSAGES = 'not-messages';
async function send(msg) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.startsWith('https://messages.google.com/')) {
    throw Object.assign(new Error('Open Google Messages in this tab first.'), { code: NOT_MESSAGES });
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, msg);
  } catch {
    // The tab was open before the extension was installed or reloaded; inject it now.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['zip.js', 'library.js', 'content.js'] });
    return chrome.tabs.sendMessage(tab.id, msg);
  }
}

const openSettings = (hash = '') => chrome.tabs.create({ url: chrome.runtime.getURL(`options.html${hash}`) });

// ---------- date range (always a separate zip) ----------

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function currentRange() {
  const v = $('range').value;
  const today = new Date();
  if (v === 'all') return null;
  if (v === 'custom') {
    if (!$('from').value && !$('to').value) return null;
    return { from: $('from').value || '1970-01-01', to: $('to').value || ymd(today) };
  }
  if (v === 'year') return { from: `${today.getFullYear()}-01-01`, to: ymd(today) };
  if (v === 'lastyear') return { from: `${today.getFullYear() - 1}-01-01`, to: `${today.getFullYear() - 1}-12-31` };
  const from = new Date(today);
  from.setDate(from.getDate() - (+v - 1));
  return { from: ymd(from), to: ymd(today) };
}

function syncRange() {
  $('customDates').hidden = $('range').value !== 'custom';
  const r = currentRange();
  $('rangeLabel').textContent = r ? `${r.from} to ${r.to}, downloaded as a zip` : '';
  $('rangeBtn').disabled = !r || !page?.id;
  $('fullSize').disabled = !$('includeMedia').checked;
}

const mediaOptions = () => ({
  includeMedia: $('includeMedia').checked,
  fullSize: $('includeMedia').checked && $('fullSize').checked,
});

// These two are the same settings as in Settings, so a change here sticks.
async function rememberChoices() {
  await saveSettings({ includeMedia: $('includeMedia').checked, fullSize: $('fullSize').checked });
}

// ---------- actions ----------

async function start(type, opts, done) {
  try {
    await rememberChoices();
    const res = await send({ type, opts });
    if (!res?.ok) throw new Error(res?.error || 'The page did not respond.');
    setStatus(done);
    setTimeout(() => window.close(), 1200);
  } catch (err) {
    setStatus(err.message, true);
  }
}

$('current').onclick = () => start('gm-export', { ...mediaOptions(), mode: 'current', fullHistory: true },
  'Started. Follow along on the page, and leave that tab alone until it says it’s done.');
$('analyze').onclick = () => start('gm-analyze', { includeMedia: false, fullHistory: true },
  'Reading the chat. The analysis opens over the page when it’s ready.');
$('rangeBtn').onclick = () => start('gm-export', { ...mediaOptions(), mode: 'current', fullHistory: false, range: currentRange() },
  'Started. The zip downloads when it’s done.');

// Backup list: the select both adds the chat and sets how often it runs.
$('every').addEventListener('change', async () => {
  if (!page?.id) return;
  const s = await getSettings();
  const others = s.schedules.filter((j) => j.id !== page.id);
  const v = $('every').value;
  if (v === 'off') {
    await saveSettings({ schedules: others });
    setStatus(`“${page.title}” won’t be backed up automatically any more. What’s saved stays in your backup.`);
  } else {
    const old = s.schedules.find((j) => j.id === page.id) || {};
    await saveSettings({ schedules: [...others, { ...old, id: page.id, title: page.title, everyHours: +v, enabled: true, addedAt: old.addedAt || Date.now() }] });
    setStatus(+v ? `Done. It will be backed up ${$('every').selectedOptions[0].text.toLowerCase()} while Google Messages is open in Chrome.` : 'Done. It’s backed up whenever you click “Back up all now” in Settings.');
  }
  renderChatStatus();
});

// Backing up many conversations takes two deliberate steps here (open the
// panel, tick the box) and a third on the page (after seeing the count).
function syncAllPanel() {
  $('limit').disabled = $('everything').checked;
  $('allStart').disabled = !$('ack').checked || (!$('everything').checked && !(+$('limit').value > 0));
  $('allStart').textContent = $('everything').checked ? 'Find every conversation' : `Find the ${+$('limit').value || '…'} most recent`;
}
$('all').onclick = () => { $('allPanel').hidden = false; $('all').hidden = true; syncAllPanel(); };
$('allCancel').onclick = () => { $('allPanel').hidden = true; $('all').hidden = false; $('ack').checked = false; };
['limit', 'everything', 'ack'].forEach((id) => $(id).addEventListener('input', syncAllPanel));
$('allStart').onclick = () => start('gm-total', { ...mediaOptions(), limit: $('everything').checked ? 0 : Math.floor(+$('limit').value) },
  'Finding conversations. Confirm on the page to start.');

$('diagnose').onclick = async () => {
  try {
    const res = await send({ type: 'gm-diagnose' });
    await navigator.clipboard.writeText(res.text);
    setStatus('Copied. Message text is masked, so it only shows page structure.');
  } catch (err) {
    setStatus(err.message, true);
  }
};

$('settings').onclick = () => chrome.runtime.openOptionsPage();
$('openBackup').onclick = () => { chrome.runtime.sendMessage({ type: 'gm-open-backup' }); window.close(); };
$('allQuick').onclick = () => { $('more').open = true; $('all').click(); $('allPanel').scrollIntoView({ block: 'nearest' }); };

// When the chat card can't be used yet, says what to do next, with a button
// for it where there is one.
function guide(step, title, text, label, onClick) {
  $('guide').hidden = false;
  $('guideStep').textContent = step || '';
  $('guideTitle').textContent = title;
  $('guideText').innerHTML = text;
  $('guideBtn').hidden = !label;
  if (label) { $('guideBtn').textContent = label; $('guideBtn').onclick = onClick; }
}
window.GMTheme?.bind($('themeBtn'));
['range', 'from', 'to', 'includeMedia'].forEach((id) => $(id).addEventListener('input', syncRange));

// ---------- startup ----------

// The chat's photos and videos by status (from its last backup), with a
// button to fetch the ones not saved yet and one to upgrade thumbnails.
function renderPhotos(c) {
  const n = (x) => (x || 0).toLocaleString();
  if (!c || !Object.values(c).some(Boolean)) { $('photos').hidden = true; return; }
  $('photos').hidden = false;
  $('photosText').textContent = [c.full + c.same && `${n(c.full + c.same)} full size`, c.thumbnail && `${n(c.thumbnail)} thumbnails`, c.original && `${n(c.original)} GIFs, videos and others`,
    c.waiting && `${n(c.waiting)} not fetched yet`, c.failed && `${n(c.failed)} failed`, c.skipped && `${n(c.skipped)} link-preview pictures not saved`].filter(Boolean).join(' · ') || 'None';
  const toFetch = (c.waiting || 0) + (c.failed || 0);
  $('fetchPhotos').hidden = !toFetch;
  $('fetchPhotos').textContent = `Fetch ${n(toFetch)} photo${toFetch === 1 ? '' : 's'}`;
  $('fetchPhotos').title = 'Goes back in the chat only as far as the oldest one, and saves just those';
  $('fetchPhotos').onclick = () => runPhotos('fetch', !!c.failed);
  $('upgradePhotos').hidden = !c.thumbnail;
  $('upgradePhotos').textContent = `Upgrade ${n(c.thumbnail)} to full size`;
  $('upgradePhotos').title = 'Opens each one in Google Messages’ viewer and replaces the thumbnail with the full-size photo';
  $('upgradePhotos').onclick = () => runPhotos('fullsize', !!c.failed);
}
async function runPhotos(mode, retryFailed) {
  try {
    if ((await send({ type: 'gm-ping' }))?.running) {
      setStatus('A backup is already running on the Google Messages page. Try again when it’s done.', true);
      return;
    }
    // The page answers only when the run is done, but a refusal comes at once.
    const started = send({ type: 'gm-media', mode, retryFailed }).catch((e) => ({ ok: false, error: e.message }));
    const early = await Promise.race([started, new Promise((r) => setTimeout(r, 600))]);
    if (early && !early.ok) throw new Error(early.error || 'The page did not start it.');
  } catch (err) {
    setStatus(err.message, true);
    return;
  }
  setStatus(mode === 'fullsize' ? 'Upgrading in the Google Messages window. Follow it there.' : 'Fetching in the Google Messages window. Follow it there.');
  setTimeout(() => window.close(), 1200);
}

async function renderChatStatus() {
  const s = await getSettings();
  const { chatStatus = {} } = await chrome.storage.local.get('chatStatus');
  const listed = s.schedules.find((x) => x.id === page?.id);
  const job = listed ? { ...chatStatus[page.id], ...listed } : chatStatus[page?.id];
  $('every').value = listed ? String(listed.everyHours ?? 0) : 'off';
  const st = $('chatStatus');
  st.className = 'secondary';
  if (!page?.id) { st.textContent = 'No chat open'; return; }
  $('current').textContent = job?.count != null && !job.complete && job.status !== 'messages' ? 'Carry on backing up' : 'Back up this chat';
  if (job?.count != null) {
    const label = { verified: 'Backed up and verified', complete: 'Backed up', messages: 'Messages backed up, photos to fetch', incomplete: 'Partly backed up', problem: 'Backed up, needs attention' }[job.status] || (job.complete ? 'Backed up' : 'Partly backed up');
    st.className = `secondary ${(job.complete || job.status === 'messages') && job.status !== 'problem' ? 'ok' : 'warn'}`;
    st.textContent = `${label}: ${job.count.toLocaleString()} messages${job.oldest ? ` back to ${job.oldest.slice(0, 10)}` : ''}`;
    renderPhotos(job.media);
    $('labelsRow').hidden = false;
    $('editLabels').onclick = () => { chrome.runtime.sendMessage({ type: 'gm-open-backup', hash: `labels/${encodeURIComponent(page.id)}` }); window.close(); };
  } else {
    st.textContent = 'Not backed up yet';
  }
}

(async () => {
  chrome.runtime.sendMessage({ type: 'gm-clear-badge' });
  const s = await getSettings();
  $('includeMedia').checked = s.includeMedia;
  $('fullSize').checked = s.fullSize;
  ['includeMedia', 'fullSize'].forEach((id) => $(id).addEventListener('change', rememberChoices));
  $('where').textContent = s.folderName ? `Saved in your backup folder, “${s.folderName}”.` : '';
  $('libButtons').hidden = !s.folderName;
  const hideChat = () => { $('chatCard').hidden = true; $('more').hidden = true; $('allQuick').hidden = true; };

  if (!s.folderName) {
    hideChat();
    guide('Step 1 of 3', 'Choose where to keep your backups',
      'Pick a folder on your computer, for example a new folder called “Messages Backup” in Documents. Everything is saved there.',
      'Choose a folder', () => openSettings('#welcome'));
    return;
  }
  try {
    page = await send({ type: 'gm-ping' });
  } catch (err) {
    hideChat();
    if (err.code === NOT_MESSAGES) {
      guide('', 'Open Google Messages', 'Backups are made from Google Messages in Chrome. Open it, then click the 💬 icon again.',
        'Open Google Messages', async () => { await chrome.runtime.sendMessage({ type: 'gm-open-messages' }); window.close(); });
    } else {
      guide('', 'Reload the Messages page', 'The Messages page isn’t answering. Reload it (press ⌘R or Ctrl+R on that page), then click the 💬 icon again.');
    }
    return;
  }
  if (page && !page.paired) {
    hideChat();
    guide('', 'Connect your phone first', '<ol><li>On your phone, open the <b>Messages</b> app.</li><li>Tap your profile picture, then <b>Device pairing</b> (or <b>Messages for web</b>).</li><li>Tap <b>QR code scanner</b> and point it at the code on this page.</li></ol>When your chats appear on this page, click the 💬 icon again. (If they’re already showing, give the page a moment to finish loading and try again.)');
    return;
  }
  if (page?.title) {
    $('chatName').textContent = page.title;
    $('chatAvatar').textContent = /^[\s+(\d]/.test(page.title) ? '#' : (page.title.match(/[\p{L}\p{N}]/u)?.[0] || '#').toUpperCase();
    // The same picture Messages shows for this chat, once the page sends it.
    send({ type: 'gm-avatar' }).then((r) => {
      const a = r?.avatar;
      if (a?.photo) {
        const img = document.createElement('img');
        img.src = a.photo;
        img.alt = '';
        img.onload = () => $('chatAvatar').replaceChildren(img);
      } else if (a?.color) {
        $('chatAvatar').style.background = a.color;
        if (a.letter) $('chatAvatar').textContent = a.letter;
      }
    }).catch(() => {});
  }
  if (!page?.id) {
    $('chatCard').hidden = true;
    $('allQuick').hidden = true;
    guide('', 'Pick a chat to back up', 'Click a conversation on the left of the Messages page, then click the 💬 icon again. Or back up every chat at once:',
      'Back up everything…', () => { $('more').open = true; $('all').click(); $('allPanel').scrollIntoView({ block: 'nearest' }); });
  }
  if (page?.running) setStatus('A backup is already running on this page. Follow it there.');
  $('current').disabled = $('every').disabled = !page?.id;
  $('analyze').disabled = !page?.id;
  await renderChatStatus();
  syncRange();
})();
