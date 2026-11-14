// Bridge tab, opened by fill.js from a Teletalk page.
// It runs on EasyApply's own site, so it can read the device copy of the profile, and it hands that copy
// back to the Teletalk tab with postMessage — only to *.teletalk.com.bd pages. Then it closes itself.
// It never signs in to Google: Google's sign-in page would cut the link back to the Teletalk tab.

import { store } from './store.js?v=1';

const TELETALK = /^https:\/\/[a-z0-9-]+\.teletalk\.com\.bd$/;
const DEV = ['localhost', '127.0.0.1'].includes(location.hostname);
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const allowed = (origin) => TELETALK.test(origin) || (DEV && LOCAL.test(origin));

const $ = (id) => document.getElementById(id);
function say(title, bn, en, { bad = false, openApp = false } = {}) {
  $('title').textContent = title;
  $('bn').textContent = bn;
  $('en').textContent = en;
  $('card').classList.toggle('bad', bad);
  $('open').hidden = !openApp;
}

function finish() {
  setTimeout(() => window.close(), 300);
  // Some browsers refuse to close the tab; tell the user how to go back.
  setTimeout(() => say('EasyApply', 'হয়ে গেছে। টেলিটকের ট্যাবে ফিরে যান।', 'Done. Go back to the Teletalk tab.'), 1200);
}

function lang() {
  try {
    return localStorage.getItem('easyapply.lang') || 'bn';
  } catch {
    return 'bn';
  }
}

if (!window.opener) {
  say('EasyApply', 'এই পেজটি EasyApply বুকমার্কের জন্য। টেলিটকের আবেদন ফর্মে বুকমার্কটি চাপুন।', 'This page is used by the EasyApply bookmark. Tap the bookmark on a Teletalk application form.', { openApp: true });
} else {
  let answered = false;
  const hello = () => {
    if (answered) return;
    try {
      window.opener.postMessage({ type: 'easyapply:hello' }, '*'); // carries no data
    } catch {
      /* opener gone */
    }
  };
  hello();
  const timer = setInterval(hello, 400);
  setTimeout(() => {
    clearInterval(timer);
    if (!answered) say('EasyApply', 'টেলিটকের পেজ থেকে সাড়া পাওয়া যায়নি। ট্যাবটি বন্ধ করে আবার চেষ্টা করুন।', 'No answer from the Teletalk page. Close this tab and try again.', { bad: true });
  }, 20000);

  window.addEventListener('message', async (e) => {
    if (answered || e.source !== window.opener || !allowed(e.origin)) return;
    const msg = e.data || {};
    if (msg.type === 'easyapply:get') {
      answered = true;
      clearInterval(timer);
      const profile = (await store.get('profile')) || null;
      const pending = (await store.get('pendingImport')) || null;
      const meta = (await store.get('meta')) || {};
      const chosen = profile || pending;
      e.source.postMessage({ type: 'easyapply:profile', nonce: msg.nonce, profile: chosen, source: profile ? 'profile' : pending ? 'pending' : 'none', lang: lang(), pendingSync: !!meta.pendingSync }, e.origin);
      if (chosen) {
        say('EasyApply', 'তথ্য পাঠানো হয়েছে। টেলিটকের ট্যাবে ফিরে যাচ্ছি…', 'Profile sent. Going back to Teletalk…');
        finish();
      } else {
        say('EasyApply', 'এই ফোনে কোনো প্রোফাইল নেই। EasyApply খুলে Google দিয়ে সাইন ইন করুন, তারপর আবার চেষ্টা করুন।', 'No profile on this device. Open EasyApply and sign in with Google, then try again.', { bad: true, openApp: true });
      }
    } else if (msg.type === 'easyapply:save') {
      answered = true;
      clearInterval(timer);
      const cap = msg.capture || {};
      const old = (await store.get('pendingImport')) || {};
      const merged = {
        ...old,
        data: { ...(old.data || {}), ...(cap.data || {}) },
        labels: { ...(old.labels || {}), ...(cap.labels || {}) },
        jobs: Array.isArray(cap.jobs) ? cap.jobs : old.jobs || [],
        photo: cap.photo || old.photo || null,
        signature: cap.signature || old.signature || null,
        from: e.origin,
        at: new Date().toISOString(),
      };
      await store.set('pendingImport', merged);
      e.source.postMessage({ type: 'easyapply:saved', nonce: msg.nonce }, e.origin);
      say('EasyApply', 'সেভ হয়েছে। পরে EasyApply খুলে তথ্য যাচাই করে Google Drive-এ সেভ করুন।', 'Saved. Later, open EasyApply to review it and save it to Google Drive.');
      finish();
    }
  });
}
