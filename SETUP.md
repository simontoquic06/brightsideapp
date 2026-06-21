# Brightside Home Services — Setup Guide

## Quick Start (Local)

```bash
cd backend
npm install
node db/seed.js      # seeds demo data
node server.js       # starts on http://localhost:3000
```

Open http://localhost:3000 — the full app runs there.

---

## Deploy to Render (recommended, free tier)

1. Push this repo to GitHub.
2. Go to https://render.com → New Web Service → connect your repo.
3. Set:
   - **Root directory:** `backend`
   - **Build command:** `npm install`
   - **Start command:** `node server.js`
4. Add all environment variables from `backend/.env.example` (see below).
5. Deploy. Your public URL is something like `https://brightside-xxxx.onrender.com`.

---

## Environment Variables

Copy `backend/.env.example` → `backend/.env` and fill in:

### Required for SMS (Twilio)
| Variable | Where to get it |
|---|---|
| `TWILIO_ACCOUNT_SID` | https://console.twilio.com → Account Info |
| `TWILIO_AUTH_TOKEN` | Same page |
| `TWILIO_FROM_NUMBER` | Buy a number at Twilio (E.164 format, e.g. `+15551234567`) |

### Required for Google Calendar sync
| Variable | Where to get it |
|---|---|
| `GOOGLE_CLIENT_ID` | https://console.cloud.google.com → APIs & Services → Credentials → Create OAuth 2.0 Client ID (Web application) |
| `GOOGLE_CLIENT_SECRET` | Same page |

Add redirect URI in Google Console: `https://your-deployed-url.com/api/google/callback`

### Required for QuickBooks invoices
| Variable | Where to get it |
|---|---|
| `QB_CLIENT_ID` | https://developer.intuit.com → Dashboard → Keys & credentials |
| `QB_CLIENT_SECRET` | Same page |
| `QB_ENVIRONMENT` | `sandbox` for testing, `production` when live |

Add redirect URI in Intuit: `https://your-deployed-url.com/api/quickbooks/callback`

---

## Code2Native (iOS IPA)

Once your backend is deployed:
1. Go to code2native.com
2. Enter your deployed URL (e.g. `https://brightside-xxxx.onrender.com`)
3. Set app name: **Brightside**
4. Upload the icon from `frontend/assets/brightside-logo.png`
5. Build → download IPA

The app connects to your live backend for SMS, Google Calendar, and QuickBooks.

---

## API Endpoints

```
GET  /api/health
GET  /api/settings          GET/PUT owner settings

GET  /api/clients           list all clients
GET  /api/clients/:id       client detail
POST /api/clients           create
PUT  /api/clients/:id       update
DEL  /api/clients/:id       delete

GET  /api/jobs              list (query: ?date=YYYY-MM-DD or ?month=YYYY-MM)
GET  /api/jobs/:id
POST /api/jobs              create
PUT  /api/jobs/:id
DEL  /api/jobs/:id

POST /api/texts/send        { jobId, kind } → sends real SMS via Twilio
POST /api/texts/preview     { jobId, kind } → returns composed message
GET  /api/texts             sent log

GET  /api/payments/summary  ?period=month|quarter|year|all → Money page data
POST /api/payments/mark-paid  { clientId }

POST /api/google/auth-url   → returns Google OAuth consent URL
GET  /api/google/callback   → OAuth callback (set as redirect URI in Google Console)
GET  /api/google/status     → { connected: bool }
POST /api/google/sync       → push/pull jobs ↔ Google Calendar
DEL  /api/google/disconnect → revoke & clear tokens

POST /api/quickbooks/auth-url
GET  /api/quickbooks/callback
GET  /api/quickbooks/status
GET  /api/quickbooks/summary
POST /api/quickbooks/mark-paid
DEL  /api/quickbooks/disconnect
```

---

## What Seth (owner) must do

1. **Twilio**: Create account at twilio.com, add a card, buy a local Canadian number, register for A2P 10DLC messaging.
2. **Google**: Create project at console.cloud.google.com, enable Calendar API, create OAuth 2.0 credentials (Web), add redirect URI, submit for verification.
3. **Intuit**: Create developer account at developer.intuit.com, create an app with Accounting scope, add redirect URI, submit for production access.
4. **Deploy**: Deploy this repo to Render (or similar). Paste secret keys into environment variables.
5. **Code2Native**: Use the deployed URL to generate the IPA.
