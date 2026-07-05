# Toolhub

A lightweight tools homepage for GitHub Pages. Tools are defined in code; the only thing served from a database is the DPDC Bill Calculator's tariff rates, which the admin can edit from any device via a real login (Firebase Auth). No build step, no server to run — everything is free tier.

**How it works:** the site is static HTML/CSS/JS hosted on GitHub Pages. The homepage tool list lives in code (`js/tools.js`) and loads instantly — no database call. The DPDC tariff rates live in Firestore (`tariffs/dpdc`); the admin panel signs you in with email/password via Firebase Auth and lets you edit every rate. Firestore security rules only allow *your* account to write. The Firebase config in `js/firebase-config.js` is safe to publish — it identifies the project but grants no access.

## Setup (one time, ~15 minutes)

### 1. Create a Firebase project (free)
1. Go to https://console.firebase.google.com and click **Add project**. Name it anything (e.g. `toolhub`). Google Analytics: optional, off is fine.
2. Stay on the **Spark (free)** plan — no card needed.

### 2. Register a web app and copy the config
1. In the project overview, click the **`</>` (Web)** icon → give it a nickname → **Register app**. (Skip "Firebase Hosting".)
2. You'll see a `firebaseConfig` object. Copy the `apiKey`, `authDomain`, and `projectId` values into **`js/firebase-config.js`** in this folder.

### 3. Turn on email/password login and create your admin account
1. Console sidebar → **Build → Authentication → Get started**.
2. **Sign-in method** tab → enable **Email/Password** (only the first toggle) → Save.
3. **Users** tab → **Add user** → enter your admin email and a strong password.
4. Copy the **User UID** shown for that user — you need it in the next step.

### 4. Create the database and paste the security rules
1. Sidebar → **Build → Firestore Database → Create database** → choose a location → start in **production mode**.
2. **Rules** tab → replace everything with the contents of **`firestore.rules`** from this folder, and replace `PASTE_YOUR_ADMIN_UID_HERE` with the UID you copied → **Publish**.

These rules mean: anyone can read the tariff rates (the calculator needs that), but only your signed-in account can change them. This also blocks the known loophole where strangers self-register accounts — even if they somehow created one, the rules only trust your UID.

### 5. (Recommended) Restrict where login works
Console → **Authentication → Settings → Authorized domains**: keep `localhost` and add `YOUR_USERNAME.github.io`. Remove anything else.

### 6. Publish on GitHub Pages
1. Create a new **public** repository on GitHub (e.g. `toolhub`), or name it `YOUR_USERNAME.github.io` if you want the site at your root URL.
2. Upload all files in this folder (keep the folder structure: `css/`, `js/`, the three HTML files).
3. Repo → **Settings → Pages** → Source: **Deploy from a branch** → Branch: `main`, folder `/ (root)` → Save.
4. After a minute, your site is live at `https://YOUR_USERNAME.github.io/toolhub/` (or the root URL).

## Daily use
- Visit the site → footer → **Admin login** → sign in from any device.
- The admin panel is the **DPDC tariff editor**: change the effective date, VAT %, and every energy rate / demand charge, then **Save**. The calculator picks up the new numbers immediately (it falls back to the values bundled in code if it can't reach Firestore).
- **Reset to code defaults** refills the form with the values hard-coded in `js/dpdc-tariff.js` (nothing is saved until you press Save).

## Adding a tool (by code)
Tools are not managed from the admin panel — they're defined in code so the homepage loads with no database call:
1. Create the tool's page, e.g. `tools/unit-converter/index.html`.
2. Add an entry to the `TOOLS` array in **`js/tools.js`** (icon, name, description, `url: "tools/unit-converter/"`).
3. Push. It appears on the homepage.

## Editing the calculator's fixed structure
The tariff **structure** (which voltage levels, consumer classes, and slab bands exist) is defined in `js/dpdc-tariff.js`. Add a new consumer class there; its default numbers show up in the admin editor, where you can then tune them. Changing a *rate* is admin; changing the *structure* is code.

## Security notes (honest version)
- Login and data writes are protected by Firebase — this is real authentication, not hidden-in-JavaScript.
- The tariff rates are publicly readable by design (the calculator is public).
- Don't store anything private in Firestore under this project unless you also lock its read rules.
- If you ever suspect your password leaked, change it in Firebase console → Authentication.
