# investing-app

Web app for looking up companies and their financials (price, statements, ratios, charts).
Save companies to a watchlist dashboard.

## Architecture

```
┌────────────────────┐        ┌─────────────────────┐        ┌──────────┐
│  Vite + React (UI) │ ─────▶ │  Express (Node API) │ ─────▶ │  Yahoo   │
│  Vercel            │  HTTP  │  Railway            │  Yahoo │  Finance │
└────────────────────┘        │  + 60s / 24h cache  │  scrape└──────────┘
                              └─────────────────────┘
```

- **Frontend** (`/`, `src/`): React app. Doesn't hold any API key; talks only to our backend.
- **Backend** (`/server`): Express + `yahoo-finance2`. Adds CORS for known origins, caches each call so popular tickers don't re-hit Yahoo.
- **Type sharing**: backend imports types from `../src/core/types.ts` as type-only imports — they vanish at compile time, so the file is only needed during the build.

## Local development

You need Node 20+ (for `yahoo-finance2` v3).

```bash
# Terminal 1 — backend on :3001
cd server
npm install
npm run dev

# Terminal 2 — frontend on :5173
npm install
npm run dev
```

Create `.env.local` in the **root** with:

```
VITE_API_BASE_URL=http://localhost:3001
```

(See `.env.example`. The FMP key path is still supported as a backup if you don't want to run the backend.)

## Deployment

The monorepo is designed for: GitHub → Vercel (frontend) + Railway (backend).

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
gh repo create investing-app --public --source=. --push
```

### 2. Deploy backend on Railway

1. New Project → **Deploy from GitHub repo** → pick this repo.
2. **Settings → Root Directory** → `server`
3. **Settings → Variables** → add:
   - `ALLOWED_ORIGINS` = your Vercel URL once you have it (e.g. `https://investing-app.vercel.app`). Comma-separated for multiple.
4. Railway auto-detects Node, runs `npm install`, `npm run build`, `npm start`. It assigns `PORT` automatically.
5. **Settings → Networking → Generate Domain** to get a public HTTPS URL.

### 3. Deploy frontend on Vercel

1. **Add New Project** → import the same repo.
2. **Framework Preset** → Vite (auto-detected).
3. **Root Directory** → `.` (default).
4. **Environment Variables**:
   - `VITE_API_BASE_URL` = your Railway URL from step 2.5.
5. Deploy.

### 4. Wire CORS

After Vercel gives you a URL, go back to Railway and update `ALLOWED_ORIGINS` to include it. Redeploy is automatic.

### Optional: skip rebuilds when only the other half changes

To stop Vercel from redeploying when only `server/` changes (or vice versa), use each platform's "ignore step":

- **Vercel** → Settings → Git → Ignored Build Step:
  ```sh
  git diff --quiet HEAD^ HEAD -- ':(exclude)server/**'
  ```
- **Railway** → Settings → Build → Watch Paths: `server/**`

## Environment variables

### Frontend (`/.env.local`, Vercel project env)

| Variable | Description |
|---|---|
| `VITE_API_BASE_URL` | URL of your backend. Use this in production. |
| `VITE_FMP_API_KEY` | Optional fallback — calls Financial Modeling Prep directly from the browser (250/day, key exposed). |

If both are set, `VITE_API_BASE_URL` wins.

### Backend (`/server/.env`, Railway project env)

| Variable | Description |
|---|---|
| `ALLOWED_ORIGINS` | Comma-separated list of allowed origins (your Vercel URL). `localhost` is always allowed. |
| `PORT` | Auto-set by Railway. Defaults to 3001 locally. |

## Known limitations

- **Yahoo is unofficial.** `yahoo-finance2` scrapes Yahoo's public endpoints; they can break without notice. If you need an SLA, swap the backend's provider implementation.
- **EBITDA ROIC / interest coverage** aren't returned by Yahoo's `financialData` module — they display as `—` on the Multiples tab. Other providers expose these.
- **In-memory cache** is per-instance. If you scale Railway to multiple replicas, each has its own cache. Add Redis when traffic justifies it.
