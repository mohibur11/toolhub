// EasyApply filler — loaded into a Teletalk page by the EasyApply bookmark.
// It never submits anything, never touches the captcha or the declaration tick box, and never sets
// Teletalk's paid "premium" fields. The user checks the form and presses Submit.

import { FLAT, EDU_LEVELS, EDU_PARTS, OTHER_CODE, hasLevel, gpaMax } from './js/fields.js?v=2';
import { checkEligibility, photoChecks, bnNum } from './js/eligibility.js?v=2';

const HERE = new URL('./', import.meta.url);
const BRIDGE_URL = new URL('bridge.html?v=3', HERE).href;
const BRIDGE_ORIGIN = new URL(BRIDGE_URL).origin;
const APP_URL = HERE.href;

const COLORS = { ok: '#12A150', need: '#E59400', bad: '#D93025' };
const LEVEL_NAME = { ssc: ['এসএসসি/সমমান', 'SSC or equivalent'], hsc: ['এইচএসসি/সমমান', 'HSC or equivalent'], gra: ['স্নাতক', 'Graduation'], mas: ['স্নাতকোত্তর', 'Masters'] };

let lang = 'bn';
const t = (bn, en) => (lang === 'bn' ? bn : en);
const num = (n) => (lang === 'bn' ? bnNum(n) : String(n));
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------------------------------------------------------------- bridge
// Phone browsers pause this page while the bridge tab is in front, so this page must not be needed for
// anything until the bridge has finished. Everything the bridge needs therefore travels in its URL (after
// the #, which is never sent to a server); the bridge posts its answer here — the browser only delivers it
// if this page really is the origin named in `o` — and closes itself, which brings this page back.
let saveToken = null; // secret the bridge hands only to Teletalk pages; proves a "save" comes from one
try {
  saveToken = sessionStorage.getItem('easyapply.token');
} catch {
  /* storage blocked */
}
function rememberToken(tk) {
  saveToken = tk;
  try {
    sessionStorage.setItem('easyapply.token', tk);
  } catch {
    /* storage blocked */
  }
}

const b64u = {
  enc(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(str) {
    const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};

/** Encrypt with the token, so the URL (and browser history) never holds readable personal data. */
async function seal(token, obj) {
  const key = await crypto.subtle.importKey('raw', b64u.dec(token), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { iv: b64u.enc(iv), d: b64u.enc(new Uint8Array(ct)) };
}

/** Open an empty tab straight from the tap (so it isn't blocked); askBridge() then sends it to the bridge. */
function openBlankTab() {
  const win = window.open('', '_blank');
  if (!win) throw new Error('popup');
  return win;
}

function askBridge(action, extra = {}, win = null) {
  return new Promise((resolve, reject) => {
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const url = `${BRIDGE_URL}#${new URLSearchParams({ a: action, o: location.origin, n: nonce, ...extra })}`;
    let timer = null;
    let watch = null;
    const cleanup = () => {
      window.removeEventListener('message', onMsg);
      clearTimeout(timer);
      clearInterval(watch);
    };
    const onMsg = (e) => {
      const d = e.data || {};
      if (e.origin !== BRIDGE_ORIGIN || d.nonce !== nonce) return;
      cleanup();
      if (d.token) rememberToken(d.token);
      resolve(d);
    };
    window.addEventListener('message', onMsg);
    if (win) win.location.replace(url);
    else win = window.open(url, '_blank');
    if (!win) {
      cleanup();
      return reject(new Error('popup'));
    }
    const fail = () => {
      cleanup();
      reject(new Error('timeout'));
    };
    timer = setTimeout(fail, 45000);
    // Tab closed by hand without an answer: don't keep the button spinning.
    watch = setInterval(() => {
      if (win.closed) {
        clearInterval(watch);
        clearTimeout(timer);
        timer = setTimeout(fail, 2000);
      }
    }, 500);
  });
}

/** Save captured form data into EasyApply. Throws 'again' when one more tap is needed to confirm. */
async function saveToBridge(capture, win) {
  if (!saveToken) {
    await askBridge('token', {}, win);
    throw new Error('again');
  }
  const r = await askBridge('save', await seal(saveToken, capture), win);
  if (r.type !== 'easyapply:saved') throw new Error('again'); // token was out of date; a fresh one came back
}

function bridgeErrorText(err) {
  if (err.message === 'popup') return t('ব্রাউজার নতুন ট্যাব খুলতে দেয়নি। এই সাইটের জন্য পপ-আপ চালু করে আবার চাপুন।', 'The browser blocked the new tab. Allow pop-ups for this site and try again.');
  if (err.message === 'again') return t('নিশ্চিত করতে বোতামটি আরেকবার চাপুন।', 'Press the button once more to confirm.');
  return t('EasyApply থেকে সাড়া পাওয়া যায়নি। আবার চেষ্টা করুন।', 'No answer from EasyApply. Please try again.');
}

// ---------------------------------------------------------------- marking fields
const marked = new Map(); // element -> state
function mark(el, state) {
  if (!el) return;
  const target = el.type === 'checkbox' ? el.parentElement || el : el;
  target.style.setProperty('outline', `2px solid ${COLORS[state]}`, 'important');
  target.style.setProperty('outline-offset', '1px', 'important');
  marked.set(el, state);
}
function clearMarks() {
  for (const el of marked.keys()) {
    const target = el.type === 'checkbox' ? el.parentElement || el : el;
    target.style.removeProperty('outline');
    target.style.removeProperty('outline-offset');
  }
  marked.clear();
}
const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
function labelOf(el) {
  if (!el) return '';
  const byFor = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
  const txt = (byFor || el.closest('.form-group')?.querySelector('label'))?.textContent || el.name || '';
  return txt.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------- filling
function fire(el, type) {
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

function makeFiller(form) {
  const R = { ok: 0, issues: [] };
  const q = (n) => form.querySelector(`[name="${n}"]`);
  const issue = (level, bn, en, el) => R.issues.push({ level, bn, en, el });

  function putEl(el, v) {
    if (!el || v == null || v === '' || el.disabled) return false;
    el.value = String(v);
    fire(el, 'input');
    fire(el, 'change');
    mark(el, 'ok');
    R.ok++;
    return true;
  }
  function pickEl(el, code, text) {
    if (!el || el.tagName !== 'SELECT' || el.disabled) return false;
    if ((code == null || code === '') && !text) return false;
    const opts = [...el.options].filter((o) => o.value !== '' && !o.disabled);
    let opt = opts.find((o) => o.value === String(code));
    if (!opt && text) opt = opts.find((o) => norm(o.textContent) === norm(text));
    if (!opt) {
      mark(el, 'bad');
      const shown = text || code;
      issue('bad', `${labelOf(el)}: “${shown}” এই ফর্মের তালিকায় নেই।`, `${labelOf(el)}: “${shown}” is not in this form's list.`, el);
      return false;
    }
    el.value = opt.value;
    fire(el, 'change');
    mark(el, 'ok');
    R.ok++;
    return true;
  }
  function checkEl(el, want) {
    if (!el || el.disabled) return false;
    if (el.checked !== want) el.click(); // runs Teletalk's own onclick handler
    return el.checked === want;
  }
  return { R, q, issue, putEl, pickEl, checkEl, put: (n, v) => putEl(q(n), v), pick: (n, c, txt) => pickEl(q(n), c, txt), check: (n, w) => checkEl(q(n), w) };
}

function fillApplication(form, profile) {
  clearMarks();
  const d = profile.data || {};
  const lb = profile.labels || {};
  const f = makeFiller(form);
  const { R, q, issue, put, pick, check } = f;
  const upper = (v) => (v ? String(v).toUpperCase() : v);

  // Personal
  for (const n of ['name', 'father', 'mother']) put(n, upper(d[n]));
  for (const n of ['name_bn', 'father_bn', 'mother_bn']) put(n, d[n]);
  put('dob', d.dob);
  pick('nationality', d.nationality || 'Bangladeshi', 'Bangladeshi');
  pick('religion', d.religion, lb.religion);
  pick('gender', d.gender, lb.gender);

  // ID documents (the Yes/No select reveals the number box)
  for (const [sel, no] of [['nid', 'nid_no'], ['breg', 'breg_no'], ['passport', 'passport_no']]) {
    pick(sel, d[sel] === '1' ? '1' : '0');
    if (d[sel] === '1') put(no, sel === 'passport' ? upper(d[no]) : d[no]);
  }
  pick('marital_status', d.marital_status, lb.marital_status);
  if (d.marital_status === 'Married') put('spouse_name', upper(d.spouse_name));

  // Contact and quota
  put('mobile', d.mobile);
  put('confirm_mobile', d.mobile);
  put('email', d.email);
  if (q('quota')) {
    pick('quota', d.quota, lb.quota);
    if (['1', '2', '3', '6'].includes(String(d.quota))) put('quota_details', d.quota_details);
  }
  pick('dep_status', d.dep_status, lb.dep_status);

  // Present address (district first: it builds the upazila list)
  put('present_careof', d.present_careof);
  put('present_village', d.present_village);
  pick('present_district', d.present_district, lb.present_district);
  pick('present_upazila', d.present_upazila, lb.present_upazila);
  put('present_post', d.present_post);
  put('present_postcode', d.present_postcode);

  // Permanent address
  const same = q('same_as_present');
  if (d.same_as_present === '1' && same) {
    const pd = q('permanent_district');
    const allowed = pd && [...pd.options].some((o) => o.value === String(d.present_district));
    if (allowed) {
      check('same_as_present', true);
      if (same.checked) {
        mark(same, 'ok');
        R.ok += 6;
      }
    } else {
      mark(pd, 'bad');
      issue('bad', 'আপনার স্থায়ী ঠিকানার জেলা এই পদের তালিকায় নেই — এই পদে আবেদন করা যাবে না।', 'Your permanent district is not in this post’s list — you cannot apply for this post.', pd);
    }
  } else {
    if (same) check('same_as_present', false);
    put('permanent_careof', d.permanent_careof);
    put('permanent_village', d.permanent_village);
    pick('permanent_district', d.permanent_district, lb.permanent_district);
    pick('permanent_upazila', d.permanent_upazila, lb.permanent_upazila);
    put('permanent_post', d.permanent_post);
    put('permanent_postcode', d.permanent_postcode);
  }

  // Education
  for (const lvl of EDU_LEVELS) {
    const exam = q(lvl + '_exam');
    if (!exam) continue; // this post's form has no such section
    const has = hasLevel(d, lvl);
    const box = q('if_applicable_' + lvl);
    if (box) {
      f.checkEl(box, has);
      if (!has) continue;
    } else if (!has) {
      mark(exam, 'need');
      issue('need', `${LEVEL_NAME[lvl][0]}: এই ফর্মে আবশ্যক, কিন্তু আপনার প্রোফাইলে নেই।`, `${LEVEL_NAME[lvl][1]}: required on this form, but not in your profile.`, exam);
      continue;
    }
    for (const part of EDU_PARTS[lvl]) {
      const n = `${lvl}_${part}`;
      const el = q(n);
      if (!el) continue;
      if (part.endsWith('_other')) {
        const base = part.slice(0, -6);
        if (String(d[`${lvl}_${base}`]) === OTHER_CODE[base]) put(n, d[n]);
      } else if (part === 'result') {
        if (gpaMax(d[`${lvl}_result_type`])) put(n, d[n]);
      } else if (el.tagName === 'SELECT') pick(n, d[n], lb[n]);
      else put(n, d[n]);
    }
  }

  // Job experience
  const jobs = [...(profile.jobs || [])].filter((j) => j && (j.designation || j.organization));
  if (q('job[0][designation]') && jobs.length) {
    const box = q('if_applicable_exp');
    if (box) f.checkEl(box, true);
    jobs.sort((a, b) => (b.currently_working === '1') - (a.currently_working === '1') || String(b.job_end_date || '').localeCompare(String(a.job_end_date || '')));
    const add = document.getElementById('addNewJob');
    let rows = [...form.querySelectorAll('.jobExpTemplate')];
    for (let guard = 0; rows.length < jobs.length && add && guard < 15; guard++) {
      add.click();
      rows = [...form.querySelectorAll('.jobExpTemplate')];
    }
    rows.slice(jobs.length).forEach((r) => r.dataset.index !== '0' && r.remove());
    const today = window.today || new Date().toISOString().slice(0, 10);
    rows.slice(0, jobs.length).forEach((row, i) => {
      const j = jobs[i];
      const idx = row.dataset.index;
      const el = (part) => row.querySelector(`[name="job[${idx}][${part}]"]`);
      f.pickEl(el('employment_type'), j.employment_type, j.employment_type_label);
      f.putEl(el('designation'), j.designation);
      f.putEl(el('organization'), j.organization);
      f.putEl(el('office_address'), j.office_address);
      f.putEl(el('job_start_date'), j.job_start_date);
      const cw = el('currently_working');
      if (j.currently_working === '1' && cw) f.checkEl(cw, true);
      else {
        if (cw) f.checkEl(cw, false);
        f.putEl(el('job_end_date'), j.currently_working === '1' ? today : j.job_end_date);
      }
      f.putEl(el('job_description'), String(j.job_description || '').slice(0, 300));
    });
  }

  // Whatever is still empty and required is for the user (captcha, declaration, post-specific fields).
  for (const el of form.querySelectorAll('input[required], select[required], textarea[required]')) {
    if (el.disabled || el.type === 'hidden' || !visible(el) || marked.get(el) === 'bad') continue;
    const empty = el.type === 'checkbox' ? !el.checked : !String(el.value || '').trim();
    if (empty) mark(el, 'need');
  }
  return R;
}

/** Display name of an exam or subject code, from the page's own lists. */
function pageNameOf(lvl, kind, code) {
  const fromSelect = (name) => {
    const el = document.querySelector(`[name="${name}"]`);
    const o = el && [...el.options].find((x) => x.value === code);
    return o ? o.textContent.trim() : '';
  };
  if (kind === 'exam') return fromSelect(`${lvl}_exam`);
  const lists = { ssc: window.subjectGroupSSC, hsc: window.subjectGroupHSC, gra: window.subjectDegreeListGRA, mas: window.subjectDegreeListMAS };
  const hit = (Array.isArray(lists[lvl]) ? lists[lvl] : []).find((x) => String(x.code) === code);
  return hit ? hit.value : fromSelect(lvl === 'ssc' || lvl === 'hsc' ? `${lvl}_group` : `${lvl}_subject`);
}

// ---------------------------------------------------------------- saving a filled form
function captureApplication(form) {
  const q = (n) => form.querySelector(`[name="${n}"]`);
  const data = {};
  const labels = {};
  for (const n of FLAT) {
    const el = q(n);
    if (!el) continue;
    if (el.tagName === 'SELECT') {
      const o = el.options[el.selectedIndex];
      if (el.value && o && !o.disabled) {
        data[n] = el.value;
        labels[n] = o.textContent.trim();
      }
    } else if (String(el.value || '').trim()) data[n] = String(el.value).trim();
  }
  const same = q('same_as_present');
  if (same) data.same_as_present = same.checked ? '1' : '';
  for (const lvl of EDU_LEVELS) {
    const box = q('if_applicable_' + lvl);
    if (box) data['has_' + lvl] = box.checked ? '1' : '';
    else if (q(lvl + '_exam')) data['has_' + lvl] = q(lvl + '_exam').value ? '1' : '';
  }
  let jobs;
  const expBox = q('if_applicable_exp');
  if (q('job[0][designation]') && (!expBox || expBox.checked)) {
    jobs = [];
    for (const row of form.querySelectorAll('.jobExpTemplate')) {
      const idx = row.dataset.index;
      const el = (part) => row.querySelector(`[name="job[${idx}][${part}]"]`);
      const val = (part) => String(el(part)?.value || '').trim();
      const et = el('employment_type');
      const j = {
        employment_type: et?.value || '',
        employment_type_label: et && et.selectedIndex > 0 ? et.options[et.selectedIndex].textContent.trim() : '',
        designation: val('designation'),
        organization: val('organization'),
        office_address: val('office_address'),
        job_start_date: val('job_start_date'),
        job_end_date: val('job_end_date'),
        currently_working: el('currently_working')?.checked ? '1' : '',
        job_description: val('job_description'),
      };
      if (j.designation || j.organization) jobs.push(j);
    }
  }
  return { data, labels, jobs };
}

// ---------------------------------------------------------------- photo / signature page
function findUploads() {
  const files = [...document.querySelectorAll('input[type=file]')];
  const photo = document.getElementById('photo') || files.find((f) => /photo|image|picture/i.test(f.name + ' ' + f.id));
  const sign = document.getElementById('signature') || files.find((f) => /sign/i.test(f.name + ' ' + f.id));
  return { photo: photo?.type === 'file' ? photo : null, sign: sign?.type === 'file' ? sign : null };
}

function b64ToFile(b64, name) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: 'image/jpeg', lastModified: Date.now() });
}

function attachFile(input, b64, name) {
  try {
    const dt = new DataTransfer();
    dt.items.add(b64ToFile(b64, name));
    input.files = dt.files; // input.value becomes "...\name.jpg", which Teletalk's .jpg check needs
    fire(input, 'change'); // Teletalk's previewFile()/previewSign() checks size and shows the preview
    return input.files.length === 1;
  } catch {
    return false;
  }
}

const readAsBase64 = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

// ---------------------------------------------------------------- panel UI
// Teletalk pages have no mobile viewport tag, so phones show them as a zoomed-out 980px desktop page.
// The host box therefore follows the *visual* viewport (what is on screen) and is scaled so the panel
// keeps a normal, readable size whatever the zoom. Sheet and pill sit inside it, absolutely positioned.
const CSS_TEXT = `
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.sheet { position: absolute; right: 12px; bottom: 12px; width: min(420px, calc(100% - 24px)); max-height: min(70%, 640px);
  display: flex; flex-direction: column; background: #fff; color: #13241D; border-radius: 16px; pointer-events: auto;
  box-shadow: 0 2px 6px rgba(0,0,0,.12), 0 18px 48px -12px rgba(0,0,0,.45); border: 1px solid #DCE5E0;
  -webkit-text-size-adjust: 100%; text-size-adjust: 100%;
  font: 14px/1.5 "Noto Sans Bengali", "Hind Siliguri", "Nirmala UI", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
:host(.narrow) .sheet { right: 0; left: 0; bottom: 0; width: 100%; border-radius: 16px 16px 0 0; max-height: 62%; }
header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #E6ECE8; }
.mark { width: 28px; height: 28px; border-radius: 8px; background: #0B7A55; color: #fff; display: grid; place-items: center; font-weight: 700; font-size: 12px; }
header b { font-size: 15px; }
header .sp { flex: 1; }
header button { all: unset; cursor: pointer; padding: 4px 8px; border-radius: 8px; color: #44564E; font-size: 13px; }
header button:hover { background: #EEF3F0; }
.body { padding: 12px; overflow: auto; }
.lead { margin: 0 0 10px; color: #44564E; font-size: 13px; }
.lead b { color: #13241D; }
button.primary, button.secondary { all: unset; box-sizing: border-box; display: block; width: 100%; text-align: center; cursor: pointer;
  padding: 12px 14px; border-radius: 12px; font-weight: 600; font-size: 15px; margin: 8px 0; }
button.primary { background: #0B7A55; color: #fff; }
button.primary:hover { background: #096646; }
button.secondary { background: #EEF3F0; color: #13241D; font-size: 14px; }
button:disabled { opacity: .6; cursor: progress; }
.note { margin: 8px 0 0; font-size: 12.5px; color: #5E7068; }
.sum { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 10px; }
.chip { padding: 3px 10px; border-radius: 999px; font-size: 12.5px; font-weight: 600; }
.chip.ok { background: #E3F4EA; color: #0E7A3E; } .chip.need { background: #FFF1D6; color: #8A5A00; } .chip.bad { background: #FDE5E2; color: #A1271C; }
h4 { margin: 12px 0 6px; font-size: 13px; color: #44564E; }
ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
li { display: grid; grid-template-columns: 18px 1fr; gap: 6px; font-size: 13px; align-items: start; }
li .i { font-weight: 700; text-align: center; }
li.ok .i { color: #12A150; } li.warn .i, li.need .i { color: #C77D00; } li.bad .i { color: #D93025; }
li a { color: inherit; }
.msg { padding: 10px 12px; border-radius: 10px; font-size: 13.5px; margin: 6px 0; }
.msg.bad { background: #FDE5E2; color: #8F2318; } .msg.ok { background: #E3F4EA; color: #0E5E31; } .msg.info { background: #EEF3F0; color: #2C3D35; }
a.link { color: #0B7A55; font-weight: 600; }
.pill { all: unset; position: absolute; right: 12px; bottom: 12px; cursor: pointer; pointer-events: auto; -webkit-text-size-adjust: 100%; background: #0B7A55; color: #fff; padding: 10px 14px; border-radius: 999px;
  font: 600 14px/1 "Noto Sans Bengali", system-ui, sans-serif; box-shadow: 0 8px 24px -8px rgba(0,0,0,.5); }
.dl { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
.dl a { color: #0B7A55; font-weight: 600; font-size: 13px; }
@media (prefers-color-scheme: dark) {
  .sheet { background: #15211C; color: #E6EEE9; border-color: #2A3A33; }
  header { border-color: #2A3A33; } header button { color: #B9C9C1; } header button:hover { background: #20302A; }
  .lead, h4, .note { color: #A9BBB2; } .lead b { color: #E6EEE9; }
  button.secondary { background: #20302A; color: #E6EEE9; }
  .msg.info { background: #20302A; color: #D3DFD8; }
  a.link, .dl a { color: #4FC796; }
}
`;

function placeHost(host) {
  const vv = window.visualViewport;
  if (!vv) {
    Object.assign(host.style, { left: '0', top: '0', width: '100vw', height: '100vh', transform: 'none' });
    return;
  }
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  // "Natural" width = the screen width in normal CSS pixels (what a mobile-friendly page would have).
  // iPhone/iPad keep screen.width at the portrait width even when turned sideways, so pick the long or
  // short side from the page's own orientation (Android already swaps them; max/min is right for both).
  const landscape = window.matchMedia('(orientation: landscape)').matches;
  const sw = window.screen.width, sh = window.screen.height;
  const screenW = sw && sh ? (landscape ? Math.max(sw, sh) : Math.min(sw, sh)) : vv.width;
  const natural = Math.max(300, Math.round(coarse ? Math.min(screenW, 1200) : vv.width * vv.scale));
  const k = vv.width / natural;
  Object.assign(host.style, { left: vv.offsetLeft + 'px', top: vv.offsetTop + 'px', width: natural + 'px', height: vv.height / k + 'px', transform: `scale(${k})` });
  host.classList.toggle('narrow', natural <= 520);
}

function createPanel() {
  const host = document.createElement('div');
  host.id = 'easyapply-host';
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;transform-origin:0 0;pointer-events:none;display:block;';
  document.documentElement.appendChild(host);
  let raf = 0;
  const follow = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => placeHost(host));
  };
  placeHost(host);
  window.visualViewport?.addEventListener('resize', follow);
  window.visualViewport?.addEventListener('scroll', follow);
  window.addEventListener('scroll', follow, { passive: true });
  window.addEventListener('resize', follow);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${CSS_TEXT}</style>
    <div class="sheet" id="sheet" role="dialog" aria-label="EasyApply">
      <header><span class="mark">EA</span><b>EasyApply</b><span class="sp"></span>
        <button id="lang" type="button"></button><button id="min" type="button" aria-label="Minimise">—</button><button id="close" type="button" aria-label="Close">✕</button></header>
      <div class="body" id="body"></div>
    </div>
    <button class="pill" id="pill" type="button" hidden>EasyApply</button>`;
  const $ = (id) => root.getElementById(id);

  const state = { profile: null, source: '', result: null, elig: [], cursor: -1, view: 'start', message: null };
  const form = document.getElementById('applicationForm');
  const uploads = findUploads();
  const mode = form ? 'application' : uploads.photo || uploads.sign ? 'upload' : 'other';
  const post = window.postInfo || null;

  function show() {
    placeHost(host);
    $('sheet').hidden = false;
    $('pill').hidden = true;
  }
  function minimise() {
    $('sheet').hidden = true;
    const left = [...marked.values()].filter((s) => s !== 'ok').length;
    $('pill').textContent = left ? `EasyApply · ${t(`${num(left)}টি বাকি`, `${left} left`)}` : 'EasyApply';
    $('pill').hidden = false;
  }
  $('min').onclick = minimise;
  $('pill').onclick = show;
  $('close').onclick = () => {
    clearMarks();
    window.visualViewport?.removeEventListener('resize', follow);
    window.visualViewport?.removeEventListener('scroll', follow);
    window.removeEventListener('scroll', follow);
    window.removeEventListener('resize', follow);
    host.remove();
    delete window.__easyApply;
  };
  $('lang').onclick = () => {
    lang = lang === 'bn' ? 'en' : 'bn';
    render();
  };

  async function getProfile() {
    const r = await askBridge('get');
    if (r.lang) lang = r.lang;
    state.source = r.source;
    if (!r.profile) throw new Error('empty');
    state.profile = r.profile;
    return r.profile;
  }

  function setMessage(kind, text) {
    state.message = { kind, text };
    render();
  }

  function busy(btn, on) {
    if (!btn) return;
    btn.disabled = on;
    if (on) btn.dataset.label = btn.textContent;
    btn.textContent = on ? t('অপেক্ষা করুন…', 'Please wait…') : btn.dataset.label || btn.textContent;
  }

  function eligList(items) {
    if (!items.length) return '';
    const icon = { ok: '✓', warn: '!', bad: '✕' };
    return `<h4>${t('যোগ্যতা যাচাই', 'Eligibility check')}</h4><ul>${items.map((x) => `<li class="${x.level}"><span class="i">${icon[x.level]}</span><span>${esc(lang === 'bn' ? x.bn : x.en)}</span></li>`).join('')}</ul>`;
  }

  function msgHtml() {
    const m = state.message;
    return m ? `<div class="msg ${m.kind}">${m.text}</div>` : '';
  }

  function render() {
    $('lang').textContent = lang === 'bn' ? 'EN' : 'বাংলা';
    const body = $('body');
    const postLine = post?.post_name ? `<p class="lead">${t('পদ', 'Post')}: <b>${esc(post.post_name)}</b>${post.post_name_bn ? ` · ${esc(post.post_name_bn)}` : ''}</p>` : '';

    if (mode === 'other') {
      body.innerHTML = `${msgHtml()}<div class="msg info">${t('এটি আবেদন ফর্মের পেজ নয়। পদ বাছাই করে “Next” চেপে আবেদন ফর্ম খুলুন, তারপর আবার EasyApply বুকমার্ক চাপুন।', 'This is not an application form page. Choose the post, press “Next” to open the form, then tap the EasyApply bookmark again.')}</div>`;
      return;
    }

    if (mode === 'application') {
      if (state.view === 'start') {
        body.innerHTML = `${postLine}${msgHtml()}
          <button class="primary" id="fill" type="button">${t('আমার তথ্য দিয়ে পূরণ করুন', 'Fill with my details')}</button>
          <button class="secondary" id="save" type="button">${t('এই ফর্মের তথ্য EasyApply-তে সেভ করুন', 'Save this form to EasyApply')}</button>
          <p class="note">${t('একটি নতুন ট্যাব খুলে আপনার তথ্য এনে আবার এখানে ফিরে আসবে। ক্যাপচা, ঘোষণার টিক আর Submit আপনি নিজে করবেন।', 'A new tab opens briefly to fetch your details, then you come back here. You type the captcha, tick the declaration and press Submit yourself.')}</p>`;
      } else {
        const R = state.result;
        const need = [...marked.values()].filter((s) => s === 'need').length;
        const bad = [...marked.values()].filter((s) => s === 'bad').length;
        const pendingNote = state.source === 'pending' ? `<div class="msg info">${t('টেলিটক ফর্ম থেকে সেভ করা (যাচাই না করা) তথ্য দিয়ে পূরণ করা হয়েছে। EasyApply খুলে তথ্যগুলো যাচাই করে সেভ করুন।', 'Filled from data saved off a Teletalk form (not yet reviewed). Open EasyApply to review and save it.')}</div>` : '';
        const issues = R.issues.length
          ? `<h4>${t('দেখে নিন', 'Please check')}</h4><ul>${R.issues.map((x, i) => `<li class="${x.level}"><span class="i">${x.level === 'bad' ? '✕' : '!'}</span><span><a href="#" data-issue="${i}">${esc(lang === 'bn' ? x.bn : x.en)}</a></span></li>`).join('')}</ul>`
          : '';
        body.innerHTML = `${postLine}${msgHtml()}${pendingNote}
          <div class="sum"><span class="chip ok">${t(`${num(R.ok)}টি ঘর পূরণ হয়েছে`, `${R.ok} fields filled`)}</span>
          ${need ? `<span class="chip need">${t(`${num(need)}টি আপনি পূরণ করবেন`, `${need} for you`)}</span>` : ''}
          ${bad ? `<span class="chip bad">${t(`${num(bad)}টি সমস্যা`, `${bad} problems`)}</span>` : ''}</div>
          <button class="primary" id="next" type="button">${t('পরের বাকি ঘরে যান', 'Go to next field to check')}</button>
          <p class="note">${t('হলুদ ঘরগুলো (ক্যাপচা, ঘোষণা ইত্যাদি) আপনি পূরণ করবেন। সবুজগুলো একবার দেখে নিন, তারপর Submit চাপুন।', 'Yellow fields (captcha, declaration, etc.) are for you. Glance over the green ones, then press Submit.')}</p>
          ${issues}${eligList(state.elig)}
          <button class="secondary" id="refill" type="button">${t('আবার পূরণ করুন', 'Fill again')}</button>`;
      }
    }

    if (mode === 'upload') {
      body.innerHTML = `${msgHtml()}
        <button class="primary" id="attach" type="button">${t('আমার ছবি ও স্বাক্ষর যুক্ত করুন', 'Attach my photo and signature')}</button>
        <button class="secondary" id="savefiles" type="button">${t('বেছে নেওয়া ছবি ও স্বাক্ষর EasyApply-তে সেভ করুন', 'Save the chosen photo and signature to EasyApply')}</button>
        <p class="note">${t('এরপর ঘোষণায় টিক দিয়ে Submit আপনি নিজে চাপবেন।', 'Then tick the declaration and press Submit yourself.')}</p>
        ${state.elig.length ? eligList(state.elig) : ''}${state.downloads || ''}`;
    }
    wire();
  }

  function wire() {
    const fillBtn = $('fill') || $('refill');
    if (fillBtn)
      fillBtn.onclick = async () => {
        busy(fillBtn, true);
        state.message = null;
        try {
          const p = state.profile || (await getProfile());
          state.result = fillApplication(form, p);
          state.elig = checkEligibility(post, p, new Date(), window.postEdu || null, pageNameOf);
          state.view = 'done';
          state.cursor = -1;
        } catch (err) {
          state.message = err.message === 'empty' ? { kind: 'bad', text: `${t('এই ব্রাউজারে EasyApply প্রোফাইল নেই। এই ব্রাউজারেই EasyApply খুলে একবার সাইন ইন করুন।', 'No EasyApply profile in this browser. Open EasyApply in this same browser and sign in once.')} <a class="link" href="${APP_URL}" target="_blank" rel="noopener">${t('EasyApply খুলুন', 'Open EasyApply')}</a>` } : { kind: 'bad', text: bridgeErrorText(err) };
        }
        render();
      };

    const saveBtn = $('save');
    if (saveBtn)
      saveBtn.onclick = async () => {
        const cap = captureApplication(form);
        if (!cap.data.name && !cap.data.mobile) return setMessage('bad', t('ফর্মে সেভ করার মতো তথ্য নেই। আগে ফর্ম পূরণ করুন।', 'Nothing to save yet — fill the form first.'));
        busy(saveBtn, true);
        try {
          await saveToBridge(cap, openBlankTab());
          setMessage('ok', `${t('সেভ হয়েছে। পরে EasyApply খুলে তথ্য যাচাই করে Google Drive-এ সেভ করুন।', 'Saved. Later, open EasyApply to review it and save it to Google Drive.')} <a class="link" href="${APP_URL}" target="_blank" rel="noopener">${t('EasyApply খুলুন', 'Open EasyApply')}</a>`);
        } catch (err) {
          setMessage(err.message === 'again' ? 'info' : 'bad', bridgeErrorText(err));
        }
      };

    const next = $('next');
    if (next)
      next.onclick = () => {
        const list = [...marked.entries()].filter(([, s]) => s !== 'ok').map(([el]) => el);
        if (!list.length) return;
        state.cursor = (state.cursor + 1) % list.length;
        goTo(list[state.cursor]);
      };
    for (const a of root.querySelectorAll('[data-issue]'))
      a.onclick = (e) => {
        e.preventDefault();
        goTo(state.result.issues[+a.dataset.issue]?.el);
      };

    const attach = $('attach');
    if (attach)
      attach.onclick = async () => {
        busy(attach, true);
        state.message = null;
        try {
          const p = state.profile || (await getProfile());
          state.elig = photoChecks(p);
          const done = [];
          const failed = []; // saved in EasyApply, but this browser wouldn't take the file
          const missing = []; // not saved in EasyApply yet
          const tryAttach = (input, media, name, label) => {
            if (!input) return;
            if (!media?.data) missing.push(label);
            else (attachFile(input, media.data, name) ? done : failed).push(label);
          };
          tryAttach(uploads.photo, p.photo, 'photo.jpg', t('ছবি', 'photo'));
          tryAttach(uploads.sign, p.signature, 'signature.jpg', t('স্বাক্ষর', 'signature'));
          if (uploads.photo) mark(uploads.photo, uploads.photo.files?.length ? 'ok' : 'need');
          if (uploads.sign) mark(uploads.sign, uploads.sign.files?.length ? 'ok' : 'need');
          const agree = document.getElementById('agree');
          if (agree && !agree.checked) mark(agree, 'need');
          state.downloads = '';
          if (failed.length && (p.photo?.data || p.signature?.data)) {
            // Fallback: let the user save the files and pick them by hand.
            const links = [p.photo?.data ? `<a download="photo.jpg" href="data:image/jpeg;base64,${p.photo.data}">photo.jpg</a>` : '', p.signature?.data ? `<a download="signature.jpg" href="data:image/jpeg;base64,${p.signature.data}">signature.jpg</a>` : ''].join('');
            state.downloads = `<h4>${t('নিজে বেছে নিতে চাইলে ফাইল নামান', 'Or download and pick them yourself')}</h4><div class="dl">${links}</div>`;
          }
          const parts = [];
          if (done.length) parts.push(`${t('যুক্ত হয়েছে', 'Attached')}: ${done.join(', ')}. ${t('প্রিভিউ দেখে নিন।', 'Check the previews.')}`);
          if (failed.length) parts.push(`${t('এই ব্রাউজার নিজে থেকে ফাইল বসাতে দেয়নি', 'This browser would not let EasyApply put in')}: ${failed.join(', ')}. ${t('নিচ থেকে ফাইল নামিয়ে ফর্মের ঘরে নিজে বেছে নিন।', 'Download the file below and choose it in the form yourself.')}`);
          if (missing.length) parts.push(`${t('EasyApply-তে সেভ নেই', 'Not saved in EasyApply yet')}: ${missing.join(', ')}. ${t('EasyApply খুলে “ছবি ও স্বাক্ষর” ট্যাবে যোগ করুন।', 'Add it in EasyApply’s “Photo & signature” tab.')}`);
          state.message = { kind: failed.length || missing.length ? 'bad' : 'ok', text: parts.join(' ') };
        } catch (err) {
          state.message = err.message === 'empty' ? { kind: 'bad', text: `${t('এই ব্রাউজারে EasyApply প্রোফাইল নেই। এই ব্রাউজারেই EasyApply খুলে একবার সাইন ইন করুন।', 'No EasyApply profile in this browser. Open EasyApply in this same browser and sign in once.')} <a class="link" href="${APP_URL}" target="_blank" rel="noopener">${t('EasyApply খুলুন', 'Open EasyApply')}</a>` } : { kind: 'bad', text: bridgeErrorText(err) };
        }
        render();
      };

    const saveFiles = $('savefiles');
    if (saveFiles)
      saveFiles.onclick = async () => {
        const cap = {};
        const pf = uploads.photo?.files?.[0];
        const sf = uploads.sign?.files?.[0];
        if (!pf && !sf) return setMessage('bad', t('আগে ফর্মে ছবি/স্বাক্ষর বেছে নিন।', 'Choose the photo/signature in the form first.'));
        busy(saveFiles, true);
        let tab = null;
        try {
          tab = openBlankTab(); // before any waiting, while the tap still counts
          if (pf) cap.photo = { data: await readAsBase64(pf), bytes: pf.size, takenAt: '' };
          if (sf) cap.signature = { data: await readAsBase64(sf), bytes: sf.size };
          await saveToBridge(cap, tab);
          setMessage('ok', t('সেভ হয়েছে। EasyApply খুলে ছবি তোলার তারিখ দিন ও সেভ করুন।', 'Saved. Open EasyApply to add the photo date and save it.'));
        } catch (err) {
          try {
            tab?.close(); // don't leave an empty tab behind
          } catch {
            /* already gone */
          }
          setMessage(err.message === 'again' ? 'info' : 'bad', bridgeErrorText(err));
        }
      };
  }

  function goTo(el) {
    if (!el) return;
    const target = el.type === 'checkbox' ? el.parentElement || el : el;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (el.tagName === 'INPUT' && /^(text|tel|email|number)$/.test(el.type)) setTimeout(() => el.focus({ preventScroll: true }), 350);
    if (host.classList.contains('narrow')) minimise();
  }

  render();
  return { show };
}

if (window.__easyApply) window.__easyApply.show();
else window.__easyApply = createPanel();
