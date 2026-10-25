# FairShare

A Toolhub tool: a free, self-hosted Splitwise alternative. Track shared expenses on trips and events, then settle up with the fewest payments.

- **Frontend:** React + Vite + Tailwind. The build is committed to `../tools/fairshare/` and served by Toolhub's GitHub Pages (installable as a phone app / PWA).
- **Backend:** Google Apps Script web app (runs on your Google account, free)
- **Database:** Google Sheets in the owner's Drive: a registry sheet plus one spreadsheet per group, created automatically
- **Login:** Sign in with Google (any Gmail account). Users and group creators never grant Drive or Sheets access.

Live at `https://mohibur11.github.io/toolhub/tools/fairshare/` once configured.

## Features

- Groups with name, description and currency. Add members by email; they see the group the next time they sign in.
- Expenses split **equally**, by **exact amounts**, by **percent** or by **shares**, with one or **multiple payers**.
- Categories, notes and **receipt photos** (stored privately in the app owner's Drive).
- Balances per member, plus a **Settle up** plan that keeps the number of payments low. "Simplify debts" can be turned off for direct debts.
- **Record payments** (from the settle-up plan or freely). Balances update instantly.
- **Activity log** with restore for deleted expenses, edit history per expense, and **CSV export**.
- Group owners can **archive** or **permanently delete** a group.
- **Weekly automatic backup** of all data (last 8 kept).
- **Invite email** when someone adds you to a group.

## How it works

```
Browser (Toolhub Pages) ──POST JSON──▶  Apps Script web app (runs as the owner)
   Google Sign-In                         ├─ verifies Google ID token → issues 30-day session
                                          └─ Owner's Drive: FairShare/
                                               ├─ FairShare Registry   users, groups, memberships
                                               ├─ Groups/              one spreadsheet per group (expenses, payments, activity)
                                               ├─ Receipts/            receipt photos, one folder per group
                                               └─ Backups/             weekly snapshots (last 8)
```

Everything lives in the **owner account** (the Google account that deployed the script). Creating a group makes a new spreadsheet in `FairShare/Groups/`, with nothing to share or paste. Each group has its own spreadsheet, so a group stays fast however many groups exist.

**Privacy, honestly:** the owner account can see all groups' data. The app shows this on the login and new-group screens. Members only see their own groups, and sign-in shares only name, email and photo. Protect the owner account with 2-step verification; ideally use a dedicated Gmail for it.

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

You need Node 20+ and a Google account to own the app. This "owner account" runs the script and stores all data in its Drive, which counts toward its free 15 GB.

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
2. Select the `setup` function and click **Run**. Approve the permissions. This creates the `FairShare/` folder (Registry, Groups, Receipts, Backups), a session secret and the weekly backup trigger (Sundays around 3 AM). Run `weeklyBackup` by hand any time for an extra snapshot.
3. **Deploy → New deployment → Web app**: *Execute as:* **Me**, *Who has access:* **Anyone**. Copy the Web app URL (ends with `/exec`).

**Invite emails:** when someone is added to a group, the app emails them from the owner's Gmail as "FairShare". Replies go to the person who added them. Script properties that control this:

| Property      | Default (set by `setup`)                               | Meaning                                          |
| ------------- | ------------------------------------------------------ | ------------------------------------------------ |
| `SEND_EMAILS` | not set (= on)                                         | set to `false` to stop invite emails             |
| `APP_URL`     | `https://mohibur11.github.io/toolhub/tools/fairshare/` | link in the email; change it if the app moves     |

Gmail accounts can send about 100 emails a day from Apps Script. Once that's used up, people are still added to groups but don't get an email that day.

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

In FairShare, tap **New group**, enter a name and currency, and add friends' emails. That's all: no sheet to create or share. Friends see the group the next time they sign in with that Google account.

Behind the scenes the app creates `FairShare/Groups/FairShare – <name> (<id>)` with `Meta`, `Members`, `Expenses`, `Payments` and `Activity` tabs. As the owner you can open these sheets to inspect data, but make changes through the app so balances stay correct.

## Backups and deletion

- Every Sunday the `weeklyBackup` trigger copies the registry and every group spreadsheet into `FairShare/Backups/FairShare backup <date>/`, keeping the latest 8. To restore a group, copy the data from a backup spreadsheet back into the live one, in `FairShare/Groups/`.
- One run copies roughly 300 groups (Apps Script stops a run after 6 minutes). If the log reports skipped groups, run `weeklyBackup` again by hand.
- Receipt photos are not copied into backups. They stay in `FairShare/Receipts/`.
- **Delete group** (group owner only, confirmed by typing the group name) removes the group from the registry and moves its spreadsheet and receipts to the owner's Drive trash, which Google empties after 30 days. Older weekly backups still contain the group until they rotate out (about 8 weeks).

## Development

```bash
npm test                 # shared split/settle logic (Vitest, includes randomized checks)
npm run test:backend     # builds the Apps Script bundle and runs end-to-end scenarios against in-memory fakes
npm run typecheck
```

## Limits

Apps Script has free daily quotas (e.g. 20k URL fetches and 100 emails per day on consumer accounts) and each request takes about 1–2 s. The UI shows changes immediately and syncs in the background. This is plenty for groups of friends: dozens of users and thousands of expenses. Writes are serialized with a script lock.
