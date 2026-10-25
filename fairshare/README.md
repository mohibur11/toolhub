# FairShare

A Toolhub tool: a free, self-hosted Splitwise alternative. Track shared expenses on trips and events, then settle up with the fewest payments.

- **Frontend:** React + Vite + Tailwind. The build is committed to `../tools/fairshare/` and served by Toolhub's GitHub Pages (installable as a phone app / PWA).
- **Backend:** Google Apps Script web app (runs on your Google account, free)
- **Database:** Google Sheets: one central registry sheet plus one sheet per group
- **Login:** Sign in with Google (any Gmail account)

Live at `https://mohibur11.github.io/toolhub/tools/fairshare/` once configured.

## Features

- Groups with name, description and currency. Add members by email; they see the group the next time they sign in.
- Expenses split **equally**, by **exact amounts**, by **percent** or by **shares**, with one or **multiple payers**.
- Categories, notes and **receipt photos** (stored privately in the app owner's Drive).
- Balances per member, plus a **Settle up** plan that keeps the number of payments low. "Simplify debts" can be turned off for direct debts.
- **Record payments** (from the settle-up plan or freely). Balances update instantly.
- **Activity log** with restore for deleted expenses, edit history per expense, and **CSV export**.
- Optional email when someone adds you to a group.

## How it works

```
Browser (Toolhub Pages) ──POST JSON──▶  Apps Script web app (runs as the owner)
   Google Sign-In                         ├─ verifies Google ID token → issues 30-day session
                                          ├─ FairShare Registry sheet (users, groups, memberships)
                                          ├─ Group sheets (expenses, payments, activity)
                                          └─ Drive folder "FairShare Receipts"
```

Users never need direct access to the registry. A group's creator shares their group sheet with the **owner account** (the Google account that deployed the script) so the app can write to it.

All money is stored as integer minor units (paisa/cents). Split and settle logic lives in `shared/`. The frontend (for instant previews) and the backend (the final word) use the same code.

## Layout inside Toolhub

```
toolhub/
  fairshare/                 this folder (source)
    shared/                  split.ts, settle.ts, money.ts, types.ts + Vitest tests
    backend/                 Apps Script source (TypeScript, bundled by esbuild into dist/Code.js, pushed with clasp)
    frontend/                React app; "npm run build" writes to ../tools/fairshare/
  tools/fairshare/           committed build output, served at <site>/tools/fairshare/
  js/fairshare-config.js     runtime config: Google client ID + Apps Script URL (no rebuild needed)
```

## One-time setup

You need Node 20+ and a Google account to own the app. This "owner account" stores the registry and receipts, and runs the script.

### 1. Google OAuth client ID (for "Sign in with Google")

1. Go to <https://console.cloud.google.com/>, create a project (e.g. "FairShare"). You can also reuse the Toolhub Firebase project, since it is a Google Cloud project too.
2. **APIs & Services → OAuth consent screen**: choose *External*, fill in the app name and your email, and add no extra scopes. Click **Publish app** so any Gmail user can sign in. Basic sign-in scopes don't need Google verification.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → *Web application*.
   - Authorized JavaScript origins: `http://localhost:5173` and `https://mohibur11.github.io`
4. Copy the **Client ID**.

### 2. Backend (Apps Script)

```bash
cd fairshare
npm install
cd backend
npx clasp login                                   # sign in as the owner account
npx clasp create --type standalone --title FairShare --rootDir dist
npm run push                                      # builds dist/Code.js and uploads it
```

> If `clasp create` puts `.clasp.json` somewhere else, copy `backend/.clasp.json.example` to `backend/.clasp.json` and set your script ID (from the Apps Script URL). `.clasp.json` is git-ignored.
> You may need to enable the Apps Script API once at <https://script.google.com/home/usersettings>.

Then in the Apps Script editor (`npx clasp open`):

1. **Project Settings → Script properties → Add**: `GOOGLE_CLIENT_ID` = the client ID from step 1.
2. Select the `setup` function and click **Run**. Approve the permissions. This creates the *FairShare Registry* sheet, the *FairShare Receipts* folder and a session secret.
3. **Deploy → New deployment → Web app**: *Execute as:* **Me**, *Who has access:* **Anyone**. Copy the Web app URL (ends with `/exec`).

Optional script properties:

| Property      | Value                                                                              |
| ------------- | ---------------------------------------------------------------------------------- |
| `SEND_EMAILS` | `true` to email people when they're added to a group                               |
| `APP_URL`     | `https://mohibur11.github.io/toolhub/tools/fairshare/` (link used in those emails) |

After changing backend code, run `npm run push`, then **Deploy → Manage deployments → edit → Version: New version** so the same URL serves the new code.

### 3. Configure and publish

1. Edit **`js/fairshare-config.js`** in the Toolhub root: paste the client ID and the Apps Script `/exec` URL.
2. Commit and push Toolhub. FairShare appears on the Toolhub homepage.

To change the config later, edit the file and push. No rebuild needed.

## Changing the app

```bash
cd fairshare
cp frontend/.env.example frontend/.env.local      # same two values, for local dev only
npm run dev                                       # http://localhost:5173
npm run build                                     # rebuilds ../tools/fairshare/
```

Toolhub is served straight from the `main` branch with no CI build. **After source changes, run `npm run build` and commit `tools/fairshare/` together with the source.**

## Creating a group (for users)

1. Create a blank Google Sheet (<https://sheets.new>).
2. Share it with the owner email shown in the app, as **Editor**.
3. In FairShare: **New group** → paste the sheet link → add friends' emails.

The app creates the `Meta`, `Members`, `Expenses`, `Payments` and `Activity` tabs. The sheet stays readable on its own, but make changes through the app so balances stay correct.

## Development

```bash
npm test                 # shared split/settle logic (Vitest, includes randomized checks)
npm run test:backend     # builds the Apps Script bundle and runs end-to-end scenarios against in-memory fakes
npm run typecheck
```

## Limits

Apps Script has free daily quotas (e.g. 20k URL fetches and 100 emails per day on consumer accounts) and each request takes about 1–2 s. The UI shows changes immediately and syncs in the background. This is plenty for groups of friends: dozens of users and thousands of expenses. Writes are serialized with a script lock.
