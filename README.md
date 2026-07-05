# Toolhub

A lightweight tools homepage for GitHub Pages, with a real admin login (Firebase Auth) and an admin panel that edits the site from any device. No build step, no server to run — everything is free tier.

**How it works:** the site is static HTML/CSS/JS hosted on GitHub Pages. The tool list and site title live in Firestore (Firebase's database). The admin panel signs you in with email/password via Firebase Auth; Firestore security rules only allow *your* account to write. The Firebase config in `js/firebase-config.js` is safe to publish — it identifies the project but grants no access.

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

These rules mean: anyone can read the tool list (the public site needs that), but only your signed-in account can add/edit/delete anything. This also blocks the known loophole where strangers self-register accounts — even if they somehow created one, the rules only trust your UID.

### 5. (Recommended) Restrict where login works
Console → **Authentication → Settings → Authorized domains**: keep `localhost` and add `YOUR_USERNAME.github.io`. Remove anything else.

### 6. Publish on GitHub Pages
1. Create a new **public** repository on GitHub (e.g. `toolhub`), or name it `YOUR_USERNAME.github.io` if you want the site at your root URL.
2. Upload all files in this folder (keep the folder structure: `css/`, `js/`, the three HTML files).
3. Repo → **Settings → Pages** → Source: **Deploy from a branch** → Branch: `main`, folder `/ (root)` → Save.
4. After a minute, your site is live at `https://YOUR_USERNAME.github.io/toolhub/` (or the root URL).

## Daily use
- Visit the site → footer → **Admin login** → sign in from any device.
- Add a tool: give it an emoji, a name, a one-line description, and a link. The link can be an external URL or a relative path like `tools/converter/index.html` for tools you add to the repo later.
- You can reorder tools, hide/show them, edit, or delete. Site title and tagline are editable too.

## Adding an actual tool page later
Put its files in the repo, e.g. `tools/unit-converter/index.html`, push, then add a tool entry in the admin panel pointing to `tools/unit-converter/`.

## Security notes (honest version)
- Login and data writes are protected by Firebase — this is real authentication, not hidden-in-JavaScript.
- The tool list itself is publicly readable by design (it's a public homepage).
- Don't store anything private in Firestore under this project unless you also lock its read rules.
- If you ever suspect your password leaked, change it in Firebase console → Authentication.
