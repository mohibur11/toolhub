# Toolhub

A lightweight tools homepage for GitHub Pages. Tools are defined in code; the admin can sign in from any device (Firebase Auth) to **show or hide tools on the homepage** and to edit the DPDC Bill Calculator's tariff rates. No build step, no server to run — everything is free tier.

**How it works:** the site is static HTML/CSS/JS hosted on GitHub Pages. The homepage tool list lives in code (`js/tools.js`). Which tools are hidden is stored in Firestore (`settings/tools`); the homepage reads it with one small request (no Firebase library) and remembers the last answer on each device, so the shelf still appears instantly. The DPDC tariff rates live in Firestore too (`tariffs/dpdc`). The admin panel signs you in with email/password via Firebase Auth; Firestore security rules only allow *your* account to write. The Firebase config in `js/firebase-config.js` is safe to publish — it identifies the project but grants no access.

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

These rules mean: anyone can read the tariff rates and the list of hidden tools (the calculator and the homepage need them), but only your signed-in account can change them. This also blocks the known loophole where strangers self-register accounts — even if they somehow created one, the rules only trust your UID.

### 5. (Recommended) Restrict where login works
Console → **Authentication → Settings → Authorized domains**: keep `localhost` and add `YOUR_USERNAME.github.io`. Remove anything else.

### 6. Publish on GitHub Pages
1. Create a new **public** repository on GitHub (e.g. `toolhub`), or name it `YOUR_USERNAME.github.io` if you want the site at your root URL.
2. Upload all files in this folder (keep the folder structure: `css/`, `js/`, the three HTML files).
3. Repo → **Settings → Pages** → Source: **Deploy from a branch** → Branch: `main`, folder `/ (root)` → Save.
4. After a minute, your site is live at `https://YOUR_USERNAME.github.io/toolhub/` (or the root URL).

## Daily use
- Visit the site → footer → **Admin login** → sign in from any device.
- **Tools on the homepage:** switch any tool off to take it off the homepage for everyone (or back on), then **Save changes**. Visitors see the change on their next visit. A hidden tool's page still opens from a direct link or bookmark, because the site is static and the repo is public — hiding takes a tool off the shelf; it doesn't lock it.
- **DPDC tariff rates:** change the effective date, VAT %, and every energy rate / demand charge, then **Save tariff**. The calculator picks up the new numbers immediately (it falls back to the values bundled in code if it can't reach Firestore).
- **Reset to code defaults** refills the tariff form with the values hard-coded in `js/dpdc-tariff.js` (nothing is saved until you press Save).

## Show or hide tools (one-time rules update for existing setups)
If your Firebase project was set up before this feature, add one rule so the homepage can read the hidden list and your admin account can save it. Firebase console → **Firestore Database → Rules**, and paste this block next to the existing `match /tariffs/{docId}` block (above the "Everything else: locked" part), then **Publish**:

```
    match /settings/{docId} {
      allow read: if true;
      allow write: if isAdmin();
    }
```

Until then, the homepage simply shows every tool, and the admin panel says that saving isn't allowed yet.

## Adding a tool (by code)
Tools are defined in code; the admin panel only shows or hides them:
1. Create the tool's page, e.g. `tools/unit-converter/index.html`.
2. Add an entry to the `TOOLS` array in **`js/tools.js`** with a unique, permanent `id` (e.g. `id: "unit-converter"`), icon, name, description and `url: "tools/unit-converter/"`.
3. Push. It appears on the homepage (and in the admin panel, switched on).

### Built tools (FairShare)
FairShare (shared-expense splitter) is a React app, so it has a build step. Its source lives in **`fairshare/`**; `npm run build` there writes the static site into `tools/fairshare/`, which is committed so Pages can serve it without CI. It has no server: each group is a Google Sheet in its creator's Drive, read and written from the browser with the user's own Google sign-in. Its two config values (Google client ID and picker API key) live in **`js/fairshare-config.js`**. Setup and workflow: **`fairshare/README.md`**.

## Editing the calculator's fixed structure
The tariff **structure** (which voltage levels, consumer classes, and slab bands exist) is defined in `js/dpdc-tariff.js`. Add a new consumer class there; its default numbers show up in the admin editor, where you can then tune them. Changing a *rate* is admin; changing the *structure* is code.

## Security notes (honest version)
- Login and data writes are protected by Firebase — this is real authentication, not hidden-in-JavaScript.
- The tariff rates and the hidden-tools list are publicly readable by design (the calculator and homepage are public).
- Don't store anything private in Firestore under this project unless you also lock its read rules.
- If you ever suspect your password leaked, change it in Firebase console → Authentication.
