# FairShare

A Toolhub tool: a free Splitwise alternative. Track shared expenses on trips and events, then settle up with the fewest payments.

- **No server.** A React app (Vite + Tailwind) served by Toolhub's GitHub Pages, installable as a phone app (PWA).
- **Data in the users' own Google Drive.** Each group is a Google Sheet in its creator's Drive, shared only with the group's members. Nobody else, including the app's author, can see it.
- **Login:** Sign in with Google (any Gmail account).

Live at `https://mohibur11.github.io/toolhub/tools/fairshare/`.

## Features

- Groups with name, description and currency. Add members by email, then send them the invite link (share menu, WhatsApp or copy).
- Expenses split **equally**, by **exact amounts**, by **percent** or by **shares**, with one or **multiple payers**. Categories and notes.
- Balances per member, plus a **Settle up** plan with few payments. "Simplify debts" can be turned off for direct debts.
- **Record payments**. Balances update instantly.
- **Activity log** with restore for deleted expenses, edit history per expense, and **CSV export**.
- **Custom names**: anyone can set their own FairShare name; the group owner can rename members inside a group.
- **Hand over a group** to another member (the sheet moves to their Drive), **archive** or **delete** it (owner only).
- **Find groups shared with me**, and a **Google access** list showing anyone who can open the sheet without being a member.

## How it works

```
Browser (Toolhub Pages)                       Google, with the user's own sign-in
  React app ─────── Sheets API / Drive API ──▶  Group creator's Drive:
  (all logic runs here)                            "FairShare – <group>"  one Google Sheet per group,
                                                   shared (edit) with the members
                                                 Each user's Drive, hidden app data:
                                                   fairshare-index.json  my groups + my FairShare name
```

- **Google permissions:** basic profile, `drive.file` (only files FairShare creates or that the user opens with it) and `drive.appdata` (its hidden settings file). Both Drive permissions are "non-sensitive", so Google doesn't need to review the app.
- **Creating a group** makes a spreadsheet at the top of the creator's My Drive and shares it with each member as Editor.
- **Joining:** with `drive.file`, FairShare can open a sheet someone shared with you only after you select it in Google's file picker (once per group). The invite link does that: it opens the group, the app asks Google's picker for that one sheet, and the user taps it.
- **Writes** go to the sheet in one request each. New rows are appended (safe when two people save at once); edits rewrite their row in place.
- **Sign-in:** Google access lasts about an hour. When the app starts, it gets a new one by sending the page to Google and back (no click). Mid-session, renewing needs a tap (browsers only allow Google's popup after a click), so a "Continue" banner appears when needed.
- **Handover:** the owner offers ownership; the member accepts in the app, which also moves the sheet into their Drive. Otherwise the old owner would keep access through their own Drive and couldn't leave.

All money is stored as integer minor units (paisa/cents). Split and settle logic lives in `shared/`.

## Layout inside Toolhub

```
toolhub/
  fairshare/                 this folder (source)
    shared/                  split.ts, settle.ts, money.ts, types.ts + Vitest tests
    frontend/                React app; "npm run build" writes to ../tools/fairshare/
      src/data/              the app's actions on a group sheet (+ in-memory Google fake and tests)
      src/google/            sign-in, Drive/Sheets REST calls, file picker
    scripts/serve.mjs        local static server for the whole Toolhub site
  tools/fairshare/           committed build output, served at <site>/tools/fairshare/
  js/fairshare-config.js     runtime config: Google client ID + picker API key (no rebuild needed)
```

## One-time setup (Google Cloud)

All in one Google Cloud project (any Google account; it never sees user data).

1. **APIs & Services → Library:** enable **Google Sheets API**, **Google Drive API** and **Google Picker API**.
2. **Google Auth Platform → Branding:** app name, support email, homepage `https://mohibur11.github.io/toolhub/` and privacy policy `https://mohibur11.github.io/toolhub/tools/fairshare/privacy.html`. Then **Audience → Publish app** so any Gmail user can sign in.
3. **Google Auth Platform → Data Access → Add or remove scopes:** add `.../auth/drive.file` and `.../auth/drive.appdata` (both listed as non-sensitive).
4. **Google Auth Platform → Clients → Create client → Web application:**
   - Authorized JavaScript origins: `http://localhost:5173`, `https://mohibur11.github.io`
   - Authorized redirect URIs (exactly, with the trailing slash):
     - `https://mohibur11.github.io/toolhub/tools/fairshare/`
     - `http://localhost:5173/tools/fairshare/` (built app via `npm run serve`)
     - `http://localhost:5173/` (dev server via `npm run dev`)
5. **APIs & Services → Credentials → Create credentials → API key**, then edit it:
   - Application restrictions → Websites: `https://mohibur11.github.io/*`, `http://localhost:5173/*`, `https://docs.google.com/*` (the picker needs the last one)
   - API restrictions: **Google Picker API** and **Google Drive API**
6. Put the client ID and API key in **`js/fairshare-config.js`** in the Toolhub root, commit and push.

## Changing the app

```bash
cd fairshare
npm install
npm test                 # split/settle logic + data-layer scenarios against an in-memory Google fake
npm run typecheck
npm run build            # rebuilds ../tools/fairshare/
npm run serve            # http://localhost:5173/tools/fairshare/ (uses js/fairshare-config.js)
npm run dev              # http://localhost:5173 with hot reload; needs frontend/.env.local (see .env.example)
```

Toolhub is served straight from the `main` branch with no CI build. **After source changes, run `npm run build` and commit `tools/fairshare/` together with the source.**

## A group's sheet

Tabs: `Meta` (group settings), `Members`, `Expenses`, `Payments`, `Activity`. Row 1 holds the headers, and the app reads and writes by header name, so older sheets get new columns added automatically. Columns like `paidBy`, `amount` and `splitSummary` are there so the sheet is readable on its own.

Members have edit access, so they can also change the sheet directly in Google Sheets. Please don't: balances can break. Google's version history (File → Version history) shows who changed what.

## Limits and notes

- **Google quotas** (free): Sheets API allows about 60 requests per minute per user and 300 per minute for the whole project. Opening a group is one read; saving is one read and one write. Plenty for groups of friends, but the dashboard reads every group, so very many groups can be slow.
- **Invites:** Google's own "shared with you" email often doesn't arrive, so send the invite link yourself.
- **First open of a group** needs one tap in Google's file picker. **Find groups shared with me** on the dashboard lists every FairShare sheet shared with you.
- Tested on Chrome (Windows, Android). iPhone/Safari and the installed-app mode haven't been tested yet.
- Receipt photos and automatic backups from the earlier server version are gone. Each group is a normal Google Sheet in its owner's Drive (export CSV any time).

## Earlier version

FairShare first ran on a Google Apps Script server that stored every group in the app owner's Drive. That version's data isn't migrated. To retire it, archive the Apps Script deployment (script.google.com → the FairShare project → Deploy → Manage deployments → Archive).
