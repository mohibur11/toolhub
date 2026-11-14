// EasyApply app: sign in, edit the profile, photo/signature, bookmark setup.
// Google Drive (app data folder) holds the profile; IndexedDB keeps a device copy for the bookmark.

import { store } from './store.js?v=1';
import * as drive from './drive.js?v=1';
import { SECTIONS, JOB_FIELDS, isShown, optionsOf, validateProfile, optionText, OPTION_BN } from './schema.js?v=2';
import { emptyProfile, PROFILE_VERSION } from './fields.js?v=2';
import { SPECS, loadImage, Cropper, cleanSignature, colourfulness, encodeJpeg, blobToBase64 } from './image.js?v=2';
import { daysSince, bnNum } from './eligibility.js?v=2';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const toAscii = (s) => String(s).replace(/[০-৯]/g, (d) => '০১২৩৪৫৬৭৮৯'.indexOf(d));
const todayStr = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- language
let lang = (() => {
  try {
    return localStorage.getItem('easyapply.lang') || 'bn';
  } catch {
    return 'bn';
  }
})();
const t = (bn, en) => (lang === 'bn' ? bn : en);
const L = (o) => (o ? (lang === 'bn' ? o.bn : o.en) : '');
const num = (n) => (lang === 'bn' ? bnNum(n) : String(n));
function applyLang() {
  document.body.classList.toggle('bn', lang === 'bn');
  document.documentElement.lang = lang;
  $('#langBtn').textContent = lang === 'bn' ? 'EN' : 'বাংলা';
}

function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return t('এইমাত্র', 'just now');
  if (s < 3600) return t(`${num(Math.floor(s / 60))} মিনিট আগে`, `${Math.floor(s / 60)} min ago`);
  if (s < 86400) return t(`${num(Math.floor(s / 3600))} ঘণ্টা আগে`, `${Math.floor(s / 3600)} h ago`);
  return t(`${num(Math.floor(s / 86400))} দিন আগে`, `${Math.floor(s / 86400)} days ago`);
}

// ---------------------------------------------------------------- state
let profile = emptyProfile();
let meta = {}; // { account: {email,name,picture}, lastSyncedAt, pendingSync }
const touched = new Set();
const openSections = new Set(['personal']);

function normalize(p) {
  const base = emptyProfile();
  if (!p || typeof p !== 'object') return base;
  return {
    ...base,
    ...p,
    version: PROFILE_VERSION,
    data: { ...base.data, ...(p.data || {}) },
    labels: { ...base.labels, ...(p.labels || {}) },
    jobs: Array.isArray(p.jobs) ? p.jobs : [],
    photo: p.photo?.data ? p.photo : null,
    signature: p.signature?.data ? p.signature : null,
  };
}

// ---------------------------------------------------------------- saving & sync
// Nothing counts as saved until the user presses Save. Until then, edits are kept as a *draft* in this
// browser (so a closed tab loses nothing). Save writes the profile here — the copy the bookmark uses —
// and to Google Drive.
let draftTimer = null;
let dirty = false; // edits not saved yet
let draftRestored = false; // this visit started from a draft left by an earlier one
const saveMeta = () => store.set('meta', meta);

function keepDraft() {
  clearTimeout(draftTimer);
  return dirty ? store.set('draft', profile) : Promise.resolve();
}

function changed() {
  dirty = true;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(keepDraft, 300);
  setStatus('dirty');
}

async function saveNow() {
  clearTimeout(draftTimer);
  profile.updatedAt = new Date().toISOString();
  await store.set('profile', profile);
  await store.del('draft');
  dirty = false;
  draftRestored = false;
  meta.pendingSync = true; // saved here, Drive next
  await saveMeta();
  renderBanners();
  return pushNow();
}

/** Send the saved copy (never an unsaved draft) to Drive. */
async function pushNow() {
  if (!drive.hasToken()) return setStatus(dirty ? 'dirty' : 'needSignIn');
  setStatus('syncing');
  try {
    await drive.writeProfile((await store.get('profile')) || profile);
    meta.pendingSync = false;
    meta.lastSyncedAt = new Date().toISOString();
    await saveMeta();
    setStatus(dirty ? 'dirty' : 'synced');
  } catch (e) {
    driveFailed(e);
  }
}

async function pull() {
  if (!drive.hasToken()) return setStatus(dirty ? 'dirty' : meta.pendingSync ? 'needSignIn' : 'idle');
  setStatus('syncing');
  try {
    const remote = await drive.readProfile();
    const saved = await store.get('profile');
    if (meta.pendingSync) return pushNow(); // saved here, not yet in Drive
    if (!remote) return saved?.updatedAt ? pushNow() : setStatus(dirty ? 'dirty' : 'idle');
    if (remote.updatedAt && remote.updatedAt !== saved?.updatedAt) {
      if (!saved?.updatedAt || remote.updatedAt > saved.updatedAt) {
        // Saved from another device: take it, unless the user is in the middle of editing here.
        await store.set('profile', normalize(remote));
        if (!dirty) {
          profile = normalize(remote);
          renderAll();
        }
      } else return pushNow();
    }
    meta.lastSyncedAt = new Date().toISOString();
    await saveMeta();
    setStatus(dirty ? 'dirty' : 'synced');
  } catch (e) {
    driveFailed(e);
  }
}

async function discardDraft() {
  if (!confirm(t('সেভ না করা পরিবর্তনগুলো বাদ দেবেন?', 'Discard the unsaved changes?'))) return;
  clearTimeout(draftTimer);
  await store.del('draft');
  dirty = false;
  draftRestored = false;
  profile = normalize(await store.get('profile'));
  touched.clear();
  renderAll();
  setStatus(meta.pendingSync ? 'needSignIn' : 'idle');
}

function driveFailed(e) {
  if (e?.status === 401) setStatus('needSignIn');
  else setStatus('error', e?.message || String(e));
}

/** Renew Google access from a tap, then sync. */
async function reconnect() {
  try {
    await drive.signIn(); // first statement: keeps the popup tied to the tap
    const acc = await drive.fetchAccount();
    if (meta.account?.email && acc.email !== meta.account.email) {
      drive.signOut();
      return setStatus('error', t(`অন্য অ্যাকাউন্ট (${acc.email}) বেছেছেন। ${meta.account.email} দিয়ে ঢুকুন।`, `You picked another account (${acc.email}). Use ${meta.account.email}.`));
    }
    meta.account = acc;
    await saveMeta();
    await pull();
  } catch (e) {
    setStatus('error', e.message);
  }
}

let statusState = 'idle';
let statusDetail = '';
function setStatus(state, detail = '') {
  statusState = state;
  statusDetail = detail;
  const el = $('#status');
  const btn = $('#statusBtn');
  el.className = 'status';
  // The Save button is always there; it is only greyed out when there is nothing new to save.
  btn.hidden = false;
  btn.disabled = false;
  btn.className = 'btn primary';
  btn.onclick = saveNow;
  btn.textContent = t('সেভ করুন', 'Save');
  const when = meta.lastSyncedAt ? ' · ' + timeAgo(meta.lastSyncedAt) : '';
  switch (state) {
    case 'dirty':
      el.classList.add('warn');
      el.textContent = t('● সেভ করা হয়নি এমন পরিবর্তন আছে', '● You have unsaved changes');
      break;
    case 'syncing':
      el.textContent = t('সেভ হচ্ছে…', 'Saving…');
      btn.textContent = t('সেভ হচ্ছে…', 'Saving…');
      btn.disabled = true;
      break;
    case 'synced':
      el.classList.add('ok');
      el.textContent = t('✓ সেভ হয়েছে — এই ডিভাইসে ও Google Drive-এ', '✓ Saved — on this device and in Google Drive') + when;
      btn.textContent = t('✓ সেভ হয়েছে', '✓ Saved');
      btn.disabled = true;
      break;
    case 'needSignIn':
      el.classList.add('warn');
      el.textContent = meta.pendingSync ? t('এই ডিভাইসে সেভ হয়েছে, Google Drive-এ এখনো নয়', 'Saved on this device, not yet in Google Drive') : t('Google Drive সংযোগ বিচ্ছিন্ন', 'Google Drive disconnected');
      btn.textContent = meta.pendingSync ? t('Drive-এ সেভ করুন', 'Save to Drive') : t('Drive সংযোগ দিন', 'Connect Drive');
      btn.onclick = reconnect;
      break;
    case 'error':
      el.classList.add('bad');
      el.textContent = t('Drive-এ সেভ হয়নি: ', 'Not saved to Drive: ') + detail;
      btn.textContent = t('আবার চেষ্টা', 'Retry');
      btn.onclick = () => (dirty ? saveNow() : drive.hasToken() ? pushNow() : reconnect());
      break;
    default: // idle: nothing changed since the last save
      el.textContent = meta.lastSyncedAt ? t('✓ সব সেভ করা আছে', '✓ Everything is saved') + when : t('তথ্য লিখে “সেভ করুন” চাপুন', 'Fill in your details, then press Save');
      btn.disabled = true;
  }
  updateAccountMenu();
}

// ---------------------------------------------------------------- gate / account
function showGate() {
  $('#gate').hidden = false;
  $('#app').hidden = true;
  $('#savebar').hidden = true;
  $('#accountBtn').hidden = true;
  const err = $('#gateError');
  if (!drive.configured()) {
    err.hidden = false;
    err.textContent = t('Google সাইন-ইন এখনো চালু হয়নি (নির্মাতার কাজ বাকি)।', 'Google sign-in is not set up yet (pending on the maker’s side).') + (['localhost', '127.0.0.1'].includes(location.hostname) ? ' Dev: add ?mock=1' : '');
  } else err.hidden = true;
}

function showApp() {
  $('#gate').hidden = true;
  $('#app').hidden = false;
  $('#savebar').hidden = false;
  $('#accountBtn').hidden = false;
  renderAll();
}

async function onSignIn() {
  const btn = $('#signInBtn');
  const err = $('#gateError');
  if (!drive.configured()) return showGate();
  err.hidden = true;
  const started = drive.signIn({ chooseAccount: true }); // straight from the tap
  btn.disabled = true;
  try {
    await started;
    const acc = await drive.fetchAccount();
    meta = { ...meta, account: acc };
    const remote = await drive.readProfile();
    if (remote) {
      profile = normalize(remote);
      meta.pendingSync = false;
      meta.lastSyncedAt = new Date().toISOString();
    }
    await store.set('profile', profile);
    await store.del('draft');
    dirty = false;
    await saveMeta();
    showApp();
    setStatus(remote ? 'synced' : 'idle');
  } catch (e) {
    err.hidden = false;
    err.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}

function updateAccountMenu() {
  const acc = meta.account;
  const btn = $('#accountBtn');
  if (!acc) return;
  btn.innerHTML = acc.picture ? `<img src="${esc(acc.picture)}" alt="" referrerpolicy="no-referrer">` : esc((acc.name || acc.email || '?').trim()[0].toUpperCase());
  btn.title = acc.email;
  $('#accountEmail').textContent = acc.email + (drive.MOCK ? ' (test mode)' : '');
  $('#accountSync').textContent = meta.lastSyncedAt ? t('সর্বশেষ Drive সিঙ্ক: ', 'Last Drive sync: ') + timeAgo(meta.lastSyncedAt) : t('এখনো Drive-এ সিঙ্ক হয়নি', 'Not synced to Drive yet');
}

function toggleMenu(open) {
  const menu = $('#accountMenu');
  const show = open ?? menu.hidden;
  menu.hidden = !show;
  $('#accountBtn').setAttribute('aria-expanded', String(show));
}

async function onSignOut() {
  if (!confirm(t('সাইন আউট করলে এই ডিভাইস থেকে আপনার প্রোফাইল, ছবি ও স্বাক্ষর মুছে যাবে (Google Drive-এ থেকে যাবে)। চালিয়ে যাবেন?', 'Signing out removes your profile, photo and signature from this device (they stay in your Google Drive). Continue?'))) return;
  if ((dirty || meta.pendingSync) && !confirm(t('কিছু পরিবর্তন এখনো Drive-এ সেভ হয়নি — সেগুলো হারিয়ে যাবে। তবুও সাইন আউট করবেন?', 'Some changes are not in Drive yet and will be lost. Sign out anyway?'))) return;
  clearTimeout(draftTimer);
  drive.signOut();
  await store.clear();
  profile = emptyProfile();
  dirty = false;
  meta = {};
  touched.clear();
  toggleMenu(false);
  showGate();
}

// ---------------------------------------------------------------- banners (import from Teletalk form)
async function renderBanners() {
  const box = $('#banners');
  box.innerHTML = '';
  if (drive.MOCK) box.insertAdjacentHTML('beforeend', `<div class="banner info"><p class="small"><b>Test mode</b> — ${t('নকল Drive (শুধু এই ব্রাউজারে)।', 'fake Drive kept in this browser.')}</p></div>`);
  if (dirty && draftRestored) {
    const d = document.createElement('div');
    d.className = 'banner';
    d.innerHTML = `<p><b>${t('আগের সেভ না করা পরিবর্তনগুলো ফিরিয়ে আনা হয়েছে', 'Your unsaved changes from last time are back')}</b></p>
      <p class="small">${t('রাখতে চাইলে “সেভ করুন” চাপুন, না চাইলে বাদ দিন।', 'Press Save to keep them, or discard them.')}</p>
      <div class="row"><button class="btn primary" type="button" data-act="save">${t('সেভ করুন', 'Save')}</button><button class="btn secondary" type="button" data-act="drop">${t('বাদ দিন', 'Discard')}</button></div>`;
    d.querySelector('[data-act=save]').onclick = saveNow;
    d.querySelector('[data-act=drop]').onclick = discardDraft;
    box.appendChild(d);
  }
  const imp = await store.get('pendingImport');
  if (!imp) return;
  let host = '';
  try {
    host = imp.from ? new URL(imp.from).hostname : '';
  } catch {
    /* ignore */
  }
  const div = document.createElement('div');
  div.className = 'banner';
  div.innerHTML = `<p><b>${t('টেলিটক ফর্ম থেকে সেভ করা তথ্য পাওয়া গেছে', 'Data saved from a Teletalk form')}</b>${host ? ` <span class="small muted">(${esc(host)})</span>` : ''}</p>
    <p class="small">${t('প্রোফাইলে যোগ করলে খালি ঘরগুলো পূরণ হবে; আগের তথ্যের সাথে না মিললে ফর্মের তথ্য বসবে। পরে সব ঘর দেখে “সেভ করুন” চাপুন।', 'Adding it fills your profile; where values differ, the form’s values are used. Check every section, then press Save.')}</p>
    <div class="row"><button class="btn primary" type="button" data-act="apply">${t('প্রোফাইলে যোগ করুন', 'Add to my profile')}</button><button class="btn secondary" type="button" data-act="discard">${t('বাদ দিন', 'Discard')}</button></div>`;
  div.querySelector('[data-act=apply]').onclick = () => applyImport(imp);
  div.querySelector('[data-act=discard]').onclick = async () => {
    if (!confirm(t('সেভ করা তথ্য বাদ দেবেন?', 'Discard the saved data?'))) return;
    await store.del('pendingImport');
    renderBanners();
  };
  box.appendChild(div);
}

async function applyImport(imp) {
  const d = imp.data || {};
  for (const [k, v] of Object.entries(d)) if (v !== '' && v != null) profile.data[k] = v;
  for (const k of ['has_ssc', 'has_hsc', 'has_gra', 'has_mas', 'same_as_present']) if (k in d) profile.data[k] = d[k];
  Object.assign(profile.labels, imp.labels || {});
  if (Array.isArray(imp.jobs) && imp.jobs.length) profile.jobs = imp.jobs;
  if (imp.photo?.data) profile.photo = { data: imp.photo.data, bytes: imp.photo.bytes, takenAt: imp.photo.takenAt || '' };
  if (imp.signature?.data) profile.signature = { data: imp.signature.data, bytes: imp.signature.bytes };
  await store.del('pendingImport');
  SECTIONS.forEach((s) => openSections.add(s.id));
  changed();
  renderAll();
}

// ---------------------------------------------------------------- profile form
const controls = new Map(); // input id -> { f, wrap, input, err, src, jobIndex }

function setLabel(f, src, code, jobIndex) {
  const text = code ? optionText(f, src, code) : '';
  if (jobIndex == null) {
    if (text) profile.labels[f.name] = text;
    else delete profile.labels[f.name];
  } else src[f.name + '_label'] = text;
}

function buildField(f, src, idPrefix, jobIndex = null) {
  const id = idPrefix + f.name;
  const wrap = document.createElement('div');
  wrap.className = 'field' + (f.type === 'textarea' ? ' wide' : '') + (f.type === 'check' ? ' check-field' : '');
  let input;
  let err = null;
  const after = () => {
    changed();
    refresh();
  };
  if (f.type === 'check') {
    wrap.innerHTML = `<label class="check"><input type="checkbox" id="${id}"> <span>${esc(L(f.label))}</span></label>`;
    input = wrap.querySelector('input');
    input.checked = src[f.name] === '1';
    input.addEventListener('change', () => {
      src[f.name] = input.checked ? '1' : '';
      after();
    });
  } else {
    const lab = document.createElement('label');
    lab.htmlFor = id;
    lab.textContent = L(f.label);
    wrap.appendChild(lab);
    if (f.type === 'select') input = document.createElement('select');
    else if (f.type === 'textarea') {
      input = document.createElement('textarea');
      input.rows = f.max > 200 ? 4 : 2;
    } else {
      input = document.createElement('input');
      input.type = { date: 'date', email: 'email', tel: 'tel' }[f.type] || 'text';
      if (f.type === 'digits' || f.type === 'tel') {
        input.inputMode = 'numeric';
        input.pattern = '[0-9]*';
      }
      if (f.type === 'gpa') input.inputMode = 'decimal';
      if (f.type === 'bn') input.lang = 'bn';
      if (f.upper) input.autocapitalize = 'characters';
      if (f.type === 'date') input.max = todayStr();
      input.autocomplete = 'off';
      input.spellcheck = false;
    }
    input.id = id;
    if (f.max && f.type !== 'select') input.maxLength = f.max;
    wrap.appendChild(input);
    if (f.hint) {
      const h = document.createElement('span');
      h.className = 'hint';
      h.textContent = L(f.hint);
      wrap.appendChild(h);
    }
    err = document.createElement('span');
    err.className = 'err';
    err.hidden = true;
    wrap.appendChild(err);
    if (f.type !== 'select') input.value = src[f.name] || '';

    input.addEventListener(f.type === 'select' ? 'change' : 'input', () => {
      let val = input.value;
      if (f.upper) val = val.toUpperCase();
      if (f.type === 'digits' || f.type === 'tel') val = toAscii(val).replace(/\D/g, '');
      if (f.type === 'gpa') val = toAscii(val).replace(/[^\d.]/g, '');
      if (val !== input.value) {
        const pos = input.selectionStart;
        input.value = val;
        try {
          input.setSelectionRange(pos, pos);
        } catch {
          /* not a text input */
        }
      }
      src[f.name] = val;
      if (f.type === 'select') {
        setLabel(f, src, val, jobIndex);
        touched.add(id);
      }
      after();
    });
    input.addEventListener('blur', () => {
      touched.add(id);
      if (f.type !== 'select' && typeof src[f.name] === 'string') {
        const tidy = src[f.name].replace(/\s+/g, ' ').trim();
        if (tidy !== src[f.name] && f.type !== 'textarea') {
          src[f.name] = tidy;
          input.value = tidy;
          changed();
        }
      }
      refresh();
    });
  }
  controls.set(id, { f, wrap, input, err, src, jobIndex });
  return wrap;
}

function syncSelect(c) {
  const opts = optionsOf(c.f, c.src);
  const sig = lang + '|' + opts.map((o) => o[0]).join(',');
  if (c.sig !== sig) {
    c.sig = sig;
    const sel = c.input;
    sel.textContent = '';
    const empty = !opts.length && c.f.emptyHint ? L(c.f.emptyHint) : t('— বাছাই করুন —', '— Select —');
    sel.add(new Option(empty, ''));
    const bn = c.f.bnKey && OPTION_BN[c.f.bnKey];
    for (const [code, text] of opts) sel.add(new Option(lang === 'bn' && bn?.[code] ? `${bn[code]} (${text})` : text, code));
  }
  const v = String(c.src[c.f.name] ?? '');
  let dirty = false;
  if (v && !opts.some((o) => o[0] === v)) {
    // The list changed (e.g. a new district) and the old choice is not in it.
    c.src[c.f.name] = '';
    setLabel(c.f, c.src, '', c.jobIndex);
    dirty = true;
  }
  c.input.value = c.src[c.f.name] || '';
  return dirty;
}

function refresh() {
  let dirty = false;
  for (const c of controls.values()) {
    c.wrap.hidden = !isShown(c.f, c.src);
    if (c.f.type === 'select') dirty = syncSelect(c) || dirty;
  }
  const v = validateProfile(profile);
  for (const c of controls.values()) {
    if (!c.err) continue;
    const e = c.wrap.hidden ? null : c.jobIndex == null ? v.errors[c.f.name] : v.jobErrors[c.jobIndex]?.[c.f.name];
    const hasValue = String(c.src[c.f.name] ?? '').trim() !== '';
    const show = !!e && (touched.has(c.input.id) || hasValue);
    c.err.hidden = !show;
    c.err.textContent = show ? L(e) : '';
    c.wrap.classList.toggle('invalid', show);
  }
  updateBadges(v);
  if (dirty) changed();
}

function updateBadges(v) {
  for (const det of $$('#sections details.sec')) {
    const s = SECTIONS.find((x) => x.id === det.dataset.sec);
    const b = det.querySelector('.badge');
    const n = v.bySection[s.id] || 0;
    const off = s.level && profile.data['has_' + s.level] !== '1';
    if (off) {
      b.className = 'badge off';
      b.textContent = t('প্রযোজ্য নয়', 'Not applicable');
    } else if (s.jobs && !profile.jobs.length) {
      b.className = 'badge off';
      b.textContent = t('ঐচ্ছিক', 'Optional');
    } else if (n) {
      b.className = 'badge todo';
      b.textContent = t(`${num(n)}টি বাকি`, `${n} to fix`);
    } else {
      b.className = 'badge done';
      b.textContent = t('✓ সম্পূর্ণ', '✓ Done');
    }
  }
  // Overall progress: required visible fields + photo + signature.
  let total = 2;
  let bad = (profile.photo ? 0 : 1) + (profile.signature ? 0 : 1);
  for (const s of SECTIONS) for (const f of s.fields) if (f.type !== 'check' && !f.opt && isShown(f, profile.data)) total++;
  for (const je of v.jobErrors) total += JOB_FIELDS.length;
  bad += Object.values(v.bySection).reduce((a, b2) => a + b2, 0);
  const pct = Math.max(0, Math.min(100, Math.round(((total - bad) / total) * 100)));
  $('#progress').innerHTML = `<div class="bar"><i style="width:${pct}%"></i></div><span>${pct === 100 ? t('✓ প্রোফাইল সম্পূর্ণ', '✓ Profile complete') : t(`${num(pct)}% সম্পূর্ণ`, `${pct}% complete`)}</span>`;
}

function renderProfile() {
  controls.clear();
  const host = $('#sections');
  host.textContent = '';
  SECTIONS.forEach((s, i) => {
    const det = document.createElement('details');
    det.className = 'sec';
    det.dataset.sec = s.id;
    det.open = openSections.has(s.id);
    det.addEventListener('toggle', () => (det.open ? openSections.add(s.id) : openSections.delete(s.id)));
    det.innerHTML = `<summary><span class="num">${num(i + 1)}</span><span class="ttl">${esc(L(s.title))}</span><span class="badge"></span><span class="chev" aria-hidden="true">›</span></summary><div class="sec-body"></div>`;
    const body = det.querySelector('.sec-body');
    for (const f of s.fields) body.appendChild(buildField(f, profile.data, 'f-'));
    if (s.jobs) body.appendChild(buildJobs());
    host.appendChild(det);
  });
  refresh();
}

function buildJobs() {
  const box = document.createElement('div');
  box.className = 'jobs';
  if (!profile.jobs.length) box.insertAdjacentHTML('beforeend', `<p class="small muted">${t('চাকরির অভিজ্ঞতা না থাকলে এই অংশ খালি রাখুন।', 'Leave this empty if you have no job experience.')}</p>`);
  profile.jobs.forEach((j, i) => {
    const card = document.createElement('div');
    card.className = 'job';
    card.innerHTML = `<div class="job-head"><span>${t('চাকরি', 'Job')} ${num(i + 1)}</span><button type="button">${t('মুছুন', 'Remove')}</button></div>`;
    card.querySelector('button').onclick = () => {
      if (!confirm(t('এই চাকরির তথ্য মুছবেন?', 'Remove this job?'))) return;
      profile.jobs.splice(i, 1);
      changed();
      renderProfile();
    };
    for (const f of JOB_FIELDS) card.appendChild(buildField(f, j, `j${i}-`, i));
    box.appendChild(card);
  });
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn secondary';
  add.textContent = t('+ চাকরি যোগ করুন', '+ Add a job');
  add.onclick = () => {
    profile.jobs.push({ currently_working: '' });
    openSections.add('jobs');
    changed();
    renderProfile();
  };
  box.appendChild(add);
  return box;
}

// ---------------------------------------------------------------- photo & signature
function renderMedia() {
  for (const kind of ['photo', 'signature']) {
    const card = $('#media-' + kind);
    card.textContent = '';
    card.appendChild($('#tpl-media').content.cloneNode(true));
    const spec = SPECS[kind];
    const saved = profile[kind];
    $('.m-title', card).textContent = kind === 'photo' ? t('ছবি', 'Photo') : t('স্বাক্ষর', 'Signature');
    $('.m-spec', card).textContent = `${spec.w}×${spec.h} px · ${num(spec.minKB)}–${num(spec.maxKB)} KB · .jpg`;
    const img = $('.m-img', card);
    const info = $('.m-info', card);
    const dl = $('.m-download', card);
    if (saved) {
      const url = 'data:image/jpeg;base64,' + saved.data;
      img.src = url;
      dl.href = url;
      dl.download = kind + '.jpg';
      dl.hidden = false;
      info.innerHTML = `<p>✓ ${t('সেভ করা আছে', 'Saved')} · ${num(Math.round(saved.bytes / 1024))} KB</p>`;
      if (kind === 'photo') {
        const age = daysSince(saved.takenAt);
        info.insertAdjacentHTML('beforeend', `<p><label>${t('ছবি তোলার তারিখ', 'Date taken')}<br><input type="date" class="m-taken" max="${todayStr()}" value="${esc(saved.takenAt || '')}"></label></p>`);
        if (!saved.takenAt) info.insertAdjacentHTML('beforeend', `<p class="msg warn">${t('ছবিটি কবে তোলা, তারিখ দিন।', 'Add the date the photo was taken.')}</p>`);
        else if (age > 30) info.insertAdjacentHTML('beforeend', `<p class="msg warn">${t(`ছবিটি ${num(age)} দিন আগের। টেলিটক গত ১ মাসের মধ্যে তোলা ছবি চায় — নতুন ছবি দিন।`, `This photo is ${age} days old. Teletalk wants one from the last month — add a new photo.`)}</p>`);
        $('.m-taken', info).addEventListener('change', (e) => {
          profile.photo.takenAt = e.target.value;
          changed();
          renderMedia();
        });
      }
    } else {
      img.removeAttribute('src');
      info.innerHTML = `<p class="muted">${t('এখনো যোগ করা হয়নি।', 'Not added yet.')}</p>`;
    }
    $('.m-clean-wrap', card).hidden = kind !== 'signature';
    const pick = (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file) openEditor(card, kind, file);
    };
    $('.m-file', card).addEventListener('change', pick);
    const cam = $('.m-file-camera', card);
    cam.setAttribute('capture', kind === 'photo' ? 'user' : 'environment');
    cam.addEventListener('change', pick);
  }
}

async function openEditor(card, kind, file) {
  const msg = $('.m-msg', card);
  msg.hidden = true;
  let img;
  try {
    img = await loadImage(file);
  } catch {
    msg.hidden = false;
    msg.className = 'msg bad m-msg';
    msg.textContent = t('ছবিটি খোলা যায়নি। অন্য একটি ছবি বেছে নিন (JPG/PNG)।', 'Could not open that image. Pick another (JPG/PNG).');
    return;
  }
  const spec = SPECS[kind];
  const editor = $('.m-editor', card);
  editor.hidden = false;
  $('.m-actions', card).hidden = true;
  $('.m-current', card).hidden = true;
  const cropper = new Cropper($('.m-canvas', card), spec);
  cropper.setImage(img);
  const zoom = $('.m-zoom', card);
  zoom.value = '1';
  zoom.oninput = () => cropper.setZoom(+zoom.value);
  cropper.onchange = () => (zoom.value = String(cropper.zoom));
  $('.m-rotate', card).onclick = () => cropper.rotate();
  $('.m-cancel', card).onclick = () => renderMedia();
  $('.m-save', card).onclick = async (e) => {
    const btn = e.currentTarget;
    const out = cropper.output();
    if (kind === 'signature' && $('.m-clean', card).checked) cleanSignature(out);
    if (kind === 'photo' && colourfulness(out) < 0.035 && !confirm(t('ছবিটি সাদাকালো মনে হচ্ছে। টেলিটক রঙিন ছবি চায়। তবুও সেভ করবেন?', 'This photo looks black and white. Teletalk needs a colour photo. Save anyway?'))) return;
    btn.disabled = true;
    try {
      const blob = await encodeJpeg(out, spec);
      const data = await blobToBase64(blob);
      profile[kind] = kind === 'photo' ? { data, bytes: blob.size, takenAt: todayStr() } : { data, bytes: blob.size };
      renderMedia();
      const m = $('.m-msg', $('#media-' + kind));
      m.hidden = false;
      m.className = 'msg ok m-msg';
      m.textContent = kind === 'photo' ? t('ছবি সেভ হয়েছে। আজ তোলা না হলে নিচে তারিখ ঠিক করুন।', 'Photo saved. If it was not taken today, fix the date.') : t('স্বাক্ষর সেভ হয়েছে।', 'Signature saved.');
      await saveNow(); // "Save this" saves for real, like the Save button
    } catch (e) {
      btn.disabled = false;
      msg.hidden = false;
      msg.className = 'msg bad m-msg';
      msg.textContent =
        e?.message === 'no-jpeg'
          ? t('এই ব্রাউজার .jpg ছবি বানাতে পারে না। Chrome বা Safari-তে EasyApply খুলুন, বা ব্রাউজার আপডেট করুন।', 'This browser can’t make .jpg pictures. Open EasyApply in Chrome or Safari, or update your browser.')
          : t('টেলিটকের মাপে আনা যায়নি। অন্য একটি ছবি চেষ্টা করুন।', 'Could not fit Teletalk’s size limits. Try another picture.');
    }
  };
}

// ---------------------------------------------------------------- setup tab
function bookmarkletCode() {
  const fill = new URL('fill.js', location.href).href.split(/[?#]/)[0];
  return `javascript:(function(){var s=document.createElement('script');s.type='module';s.src='${fill}?v='+Date.now();document.head.appendChild(s);})();`;
}

/** Which bookmark how-to fits this browser. iPadOS Safari says "Macintosh", so check for touch too. */
function deviceKind() {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  return 'desktop';
}

function renderSetup() {
  const code = bookmarkletCode();
  $('#bmCode').value = code;
  $('#bmLink').href = code;
  // Open this device's how-to and point at its way of running the bookmark; the others stay one tap away.
  const kind = deviceKind();
  for (const d of $$('#tab-setup details.how')) if (d.dataset.os === kind) d.open = true;
  for (const li of $$('#tab-setup .run-ways li')) li.classList.toggle('mine', li.dataset.os === kind);
}

// ---------------------------------------------------------------- wiring
function renderAll() {
  renderBanners();
  renderProfile();
  renderMedia();
  renderSetup();
  updateAccountMenu();
}

function selectTab(name) {
  for (const b of $$('.tabs [role=tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const p of $$('#app .tab')) p.hidden = p.id !== 'tab-' + name;
  try {
    sessionStorage.setItem('easyapply.tab', name);
  } catch {
    /* ignore */
  }
}

function wire() {
  $('#langBtn').onclick = () => {
    lang = lang === 'bn' ? 'en' : 'bn';
    try {
      localStorage.setItem('easyapply.lang', lang);
    } catch {
      /* ignore */
    }
    applyLang();
    if (!$('#app').hidden) renderAll();
    else showGate();
    setStatus(statusState, statusDetail);
  };
  $('#signInBtn').onclick = onSignIn;
  $('#accountBtn').onclick = (e) => {
    e.stopPropagation();
    toggleMenu();
  };
  document.addEventListener('click', (e) => {
    if (!$('#accountMenu').hidden && !e.target.closest('#accountMenu')) toggleMenu(false);
  });
  $('#syncNowBtn').onclick = () => {
    toggleMenu(false);
    if (drive.hasToken()) pull();
    else reconnect();
  };
  $('#signOutBtn').onclick = onSignOut;
  for (const b of $$('.tabs [role=tab]')) b.onclick = () => selectTab(b.dataset.tab);
  $('#copyBm').onclick = async () => {
    const code = $('#bmCode').value;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      $('#bmCode').select();
      document.execCommand('copy');
    }
    $('#copied').hidden = false;
    setTimeout(() => ($('#copied').hidden = true), 2500);
  };
  $('#bmLink').onclick = (e) => {
    e.preventDefault();
    alert(t('এটি চাপবেন না — মাউস দিয়ে টেনে বুকমার্ক বারে রাখুন।', 'Don’t click it — drag it onto your bookmarks bar.'));
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && meta.account) keepDraft();
  });
  // Leaving with unsaved edits: the browser asks first (the draft is kept either way).
  window.addEventListener('beforeunload', (e) => {
    if (!dirty || !meta.account) return;
    keepDraft();
    e.preventDefault();
    e.returnValue = '';
  });
  // Ctrl+S / ⌘+S on a computer.
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && meta.account && !$('#app').hidden) {
      e.preventDefault();
      if (dirty) saveNow();
    }
  });
}

async function boot() {
  applyLang();
  wire();
  drive.loadGis().catch(() => {}); // ready before the user taps "Sign in"
  meta = (await store.get('meta')) || {};
  const cached = await store.get('profile');
  if (cached) profile = normalize(cached);
  const draft = await store.get('draft');
  if (draft && meta.account) {
    profile = normalize(draft);
    dirty = true;
    draftRestored = true;
  }
  if (!meta.account) return showGate();
  showApp();
  try {
    selectTab(sessionStorage.getItem('easyapply.tab') || 'profile');
  } catch {
    selectTab('profile');
  }
  if (drive.hasToken()) pull();
  else setStatus(dirty ? 'dirty' : meta.pendingSync ? 'needSignIn' : 'idle');
}

boot();
