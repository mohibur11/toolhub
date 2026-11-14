// Bridge tab, opened by fill.js from a Teletalk page.
// It runs on EasyApply's own site, so it can read the device copy of the profile, and it hands that copy
// back to the Teletalk tab with postMessage — only to *.teletalk.com.bd pages. Then it closes itself.
// It never signs in to Google: Google's sign-in page would cut the link back to the Teletalk tab.
//
// Phone browsers pause the Teletalk tab while this tab is in front, so this tab never waits for a message
// from it. The request comes in the URL (after the #):
//   a = get | token | save     o = the Teletalk page's origin     n = nonce to echo back
//   save only: iv, d = the captured form data, encrypted with the token (see below)
// The answer is posted to the opener with targetOrigin = o. The browser delivers it only if the opener
// really is that origin, so naming a Teletalk origin from some other site gets that site nothing.
// "save" writes into this browser, so it needs proof that it comes from a Teletalk page: the token, a
// random secret this tab only ever hands out through that origin-checked postMessage.

import { store } from './store.js?v=1';

const TELETALK = /^https:\/\/([a-z0-9-]+\.)+teletalk\.com\.bd$/;
const DEV = ['localhost', '127.0.0.1'].includes(location.hostname);
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const allowed = (origin) => TELETALK.test(origin) || (DEV && LOCAL.test(origin));

const $ = (id) => document.getElementById(id);
function say(bn, en, { bad = false, openApp = false } = {}) {
  $('bn').textContent = bn;
  $('en').textContent = en;
  $('card').classList.toggle('bad', bad);
  $('open').hidden = !openApp;
}

function finish() {
  setTimeout(() => window.close(), 300);
  // Some browsers refuse to close the tab; tell the user how to go back.
  setTimeout(() => say('হয়ে গেছে। এই ট্যাবটি বন্ধ করে টেলিটকের ট্যাবে ফিরে যান।', 'Done. Close this tab and go back to the Teletalk tab.'), 1500);
}

function lang() {
  try {
    return localStorage.getItem('easyapply.lang') || 'bn';
  } catch {
    return 'bn';
  }
}

const b64u = {
  enc(bytes) {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(str) {
    const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};

async function getToken() {
  let tk = await store.get('bridgeToken');
  if (!tk) {
    tk = b64u.enc(crypto.getRandomValues(new Uint8Array(32)));
    await store.set('bridgeToken', tk);
  }
  return tk;
}

/** Decrypt a save request; null when it wasn't made with our token. */
async function unseal(token, iv, data) {
  try {
    const key = await crypto.subtle.importKey('raw', b64u.dec(token), 'AES-GCM', false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64u.dec(iv) }, key, b64u.dec(data));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
}

async function main() {
  const q = new URLSearchParams(location.hash.slice(1));
  try {
    history.replaceState(null, '', location.pathname + location.search); // keep the request out of the address bar
  } catch {
    /* not important */
  }
  const action = q.get('a');
  const origin = q.get('o') || '';
  const nonce = q.get('n') || '';
  const opener = window.opener;

  if (!opener || !action) {
    return say('এই পেজটি EasyApply বুকমার্কের জন্য। টেলিটকের আবেদন ফর্মে বুকমার্কটি চালান।', 'This page is used by the EasyApply bookmark. Run the bookmark on a Teletalk application form.', { openApp: true });
  }
  if (!allowed(origin)) {
    return say(`EasyApply শুধু টেলিটকের সাইটে (teletalk.com.bd) কাজ করে। এই পেজটি: ${origin || '?'}`, `EasyApply only works on Teletalk sites (teletalk.com.bd). This page is: ${origin || '?'}`, { bad: true });
  }
  const reply = (msg) => {
    try {
      opener.postMessage({ ...msg, nonce }, origin); // delivered only if the opener really is `origin`
    } catch {
      /* opener gone */
    }
  };
  const token = await getToken();

  if (action === 'get') {
    const profile = (await store.get('profile')) || null;
    const pending = (await store.get('pendingImport')) || null;
    const meta = (await store.get('meta')) || {};
    const chosen = profile || pending;
    reply({ type: 'easyapply:profile', profile: chosen, source: profile ? 'profile' : pending ? 'pending' : 'none', lang: lang(), pendingSync: !!meta.pendingSync, token });
    if (chosen) {
      say('তথ্য পাঠানো হয়েছে। টেলিটকের ট্যাবে ফিরে যাচ্ছি…', 'Details sent. Going back to Teletalk…');
      finish();
    } else {
      say('এই ব্রাউজারে কোনো প্রোফাইল নেই। এই ব্রাউজারেই EasyApply খুলে Google দিয়ে সাইন ইন করুন, তারপর আবার চেষ্টা করুন।', 'No profile in this browser. Open EasyApply in this same browser and sign in with Google, then try again.', { bad: true, openApp: true });
    }
  } else if (action === 'token') {
    reply({ type: 'easyapply:token', token });
    say('টেলিটকের ট্যাবে ফিরে বোতামটি আরেকবার চাপুন।', 'Go back to the Teletalk tab and press the button once more.');
    finish();
  } else if (action === 'save') {
    const cap = await unseal(token, q.get('iv') || '', q.get('d') || '');
    if (!cap) {
      reply({ type: 'easyapply:token', token }); // out-of-date token: hand out the current one, ask again
      say('টেলিটকের ট্যাবে ফিরে বোতামটি আরেকবার চাপুন।', 'Go back to the Teletalk tab and press the button once more.');
      return finish();
    }
    const old = (await store.get('pendingImport')) || {};
    await store.set('pendingImport', {
      ...old,
      data: { ...(old.data || {}), ...(cap.data || {}) },
      labels: { ...(old.labels || {}), ...(cap.labels || {}) },
      jobs: Array.isArray(cap.jobs) ? cap.jobs : old.jobs || [],
      photo: cap.photo || old.photo || null,
      signature: cap.signature || old.signature || null,
      from: origin,
      at: new Date().toISOString(),
    });
    reply({ type: 'easyapply:saved' });
    say('সেভ হয়েছে। পরে EasyApply খুলে তথ্য যাচাই করে সেভ করুন।', 'Saved. Later, open EasyApply to review it and save it.');
    finish();
  } else {
    say('অজানা অনুরোধ। ট্যাবটি বন্ধ করে আবার চেষ্টা করুন।', 'Unknown request. Close this tab and try again.', { bad: true });
  }
}

main().catch((e) => say('সমস্যা হয়েছে: ' + e.message + ' — ট্যাবটি বন্ধ করে আবার চেষ্টা করুন।', 'Something went wrong: ' + e.message + ' — close this tab and try again.', { bad: true }));
