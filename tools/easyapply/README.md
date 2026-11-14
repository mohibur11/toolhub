# EasyApply

Fill your details, photo and signature **once**, then fill any Teletalk government job application
form (`*.teletalk.com.bd`) in **one click** — on a computer, tablet or phone. Free, no app to install,
no browser extension (so it also works where extensions don't exist, like Chrome on Android and Safari on iPhone).
Which devices and browsers work, and their limits: `devices.html` (linked from the app).

Live: `https://mohibur11.github.io/toolhub/tools/easyapply/`

## How it works

```
EasyApply page (this folder)          Google Drive (user's own, hidden app-data folder)
  sign in with Google  ─────────────►  easyapply-profile.json   ← the real copy
  edit profile, photo, signature  ──►  IndexedDB on the device  ← copy the bookmark reads

Teletalk form ── user runs the "EasyApply" bookmark ──► loads fill.js into the page
  fill.js panel: [Fill with my details]  ──window.open──►  bridge.html (this site)
                                         ◄─postMessage──  reads the device copy, sends it
                                                          only to *.teletalk.com.bd, closes
  fill.js fills the form like Teletalk's own (paid) autofill, outlines fields
  green / yellow / red, shows an eligibility check. The user types the captcha,
  ticks the declaration and presses Submit.
Photo page (after Submit) ── bookmark again ──► [Attach my photo and signature]
```

- The bookmark is a `javascript:` bookmark that adds `<script type="module" src=".../fill.js">`. Teletalk
  pages send no Content-Security-Policy, and GitHub Pages sends `Access-Control-Allow-Origin: *`, so this works.
- The bridge never signs in: Google's sign-in page would cut the link back to the Teletalk tab. If a
  browser has no copy yet, the panel says "open EasyApply in this browser and sign in once". The copy is
  per browser (Chrome and Samsung Internet on one phone are separate), the Drive copy is shared by all.
- Teletalk pages have no mobile viewport tag (phones and tablets show a zoomed-out 980px page), so the
  panel follows `window.visualViewport` and counter-scales to stay readable; on computers it is a side card.
- Never submits, never touches the captcha / declaration, never sets Teletalk's premium fields
  (`alljobs_id`, `image`, `signature`, `imageurl`).

## Files

| File | What |
|---|---|
| `index.html`, `app.css`, `js/app.js` | The app: sign-in gate, profile form, photo/signature editor, bookmark setup guide |
| `fill.js` | Loaded into Teletalk pages by the bookmark: panel, filler, photo attach, "save this form" |
| `bridge.html`, `js/bridge.js` | Tab that hands the device copy to the Teletalk tab (origin-checked) |
| `js/fields.js` | Teletalk field names and their dependent-list rules (shared) |
| `js/schema.js` | Profile form sections, labels (BN/EN), validation copied from Teletalk's `validator.js` |
| `js/lookups.js` | Dropdown lists (districts, upazilas, boards, universities, subjects…). **Generated** |
| `js/eligibility.js` | Age (Teletalk's own method), allowed districts, required/accepted education, deadline, photo age |
| `js/image.js` | Cropper, signature cleanup, JPEG encoder that lands inside Teletalk's KB limits |
| `js/drive.js` | Google sign-in (popup) and the Drive app-data file; `?mock=1` fake Drive on localhost |
| `js/store.js` | IndexedDB device copy |
| `privacy.html` | Privacy policy (needed for Google's consent screen) |
| `devices.html` | Supported devices and browsers, with each one's limits (keep it in step with real tests) |
| `../../js/easyapply-config.js` | Google OAuth client ID |

Teletalk's rules this follows: photo 300×300 px, 4–100 KB; signature 300×80 px, 3–60 KB; `.jpg`;
colour photo taken within the last month (from the live `preview.php` and `js/imageup.js`).

## One-time Google setup (separate from FairShare)

1. Google Cloud Console → **New project** "EasyApply" (its own consent screen, so users see "EasyApply").
2. APIs & Services → Library → enable **Google Drive API**.
3. Google Auth Platform → Branding: app name **EasyApply**, support email, home page
   `https://mohibur11.github.io/toolhub/tools/easyapply/`, privacy policy
   `https://mohibur11.github.io/toolhub/tools/easyapply/privacy.html`.
   Audience: **External**, then **Publish app** (In production). While it is in "Testing", only listed test users can sign in.
   Data access → scopes: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`, `.../auth/drive.appdata`
   (all non-sensitive — no Google verification review needed).
4. Clients → Create client → **Web application**. Authorized JavaScript origins:
   `https://mohibur11.github.io` and `http://localhost:8080` (for local testing). No redirect URI needed.
5. Paste the client ID into `js/easyapply-config.js` and push.

## Developing

Dev tools live outside this repo, in the `EasyApply` folder next to `ToolsHub`:

- `dev/extract-lookups.py` — rebuild `js/lookups.js` from a saved Teletalk `application.php`.
- `dev/fixtures/` — saved Teletalk pages (DC Bagerhat and Bangladesh Parliament forms, and a preview page).
- `dev/test/e2e.mjs` — end-to-end test: fills both saved forms through the real bookmark → bridge → fill
  path, runs **Teletalk's own `validateForm`** on the result, attaches the photo and signature on the
  preview page, checks save-from-form, the bridge's origin check, the device-specific setup steps and that
  the panel fits the screen. `cd dev/test && npm install && node e2e.mjs --engine=… --device=…`
- `dev/test/matrix.mjs` — runs it on Chromium, WebKit and Firefox × phone, phone sideways, tablet and
  computer sizes (`npx playwright-core install firefox webkit` once). Playwright's WebKit on Windows can't
  encode JPEG or set file inputs (real Safari can); the test then checks the user-facing fallback instead.

Manual: serve the toolhub root on port 8080 (`python -m http.server 8080`) and open
`http://localhost:8080/tools/easyapply/?mock=1` to use a fake Drive without a Google project.

## Security, honestly

- The profile (NID, birth date, addresses, photo…) sits in the user's own Drive app-data folder and,
  unencrypted, in the browser storage of `mohibur11.github.io` on each device where they signed in.
  Anyone who can use that browser on that device could open it. "Sign out" wipes the copy in that browser
  (the setup tab tells people to do this on shared or shop computers).
- Other tools on `mohibur11.github.io` share that browser origin and could technically read it; they don't.
- The bridge only answers pages on `https://*.teletalk.com.bd` (plus `localhost` when itself served from localhost).
