# geno-api

Bridge between the Geno explorer ([basetlabs.com/costaricahist1500-1800](https://basetlabs.com/costaricahist1500-1800/)) and the Discord server **Historia Documental Costa Rica**. The "Aportar" panel in the explorer signs people in (Discord, Google or Facebook), shows the conversation about a record and lets them post messages, images and PDFs. Discord is the source of truth: every record that receives a contribution becomes one post in the `#aportes` forum, and the panel reads and writes that post.

```
Geno (browser) ──► geno-api.basetlabs.com (this Worker) ──► Discord REST API
                       │  KV: record → thread, OAuth state, rate limit
                       └► R2: copy of every uploaded file, with record/author metadata
```

Endpoints: `GET /config`, `GET /auth/:provider/start?record=N`, `GET /auth/:provider/callback`, `GET /me`, `GET|POST /records/:id/messages`, `GET /files/:key`.

## One-time setup

Everything below is done once. Values marked **var** go in `wrangler.jsonc`; values marked **secret** are set with
`npm run secret NAME` inside `geno-api/` (wrangler asks for the value; nothing is written to the repo).

### 1. Discord server

1. Create a **forum channel** named `#aportes` (Server Settings → Channels → Create → Forum). Optional tags: `documento`, `foto`, `corrección`, `genealogía`, `lugar`.
2. Turn on Developer Mode (User Settings → Advanced) and right-click → **Copy ID** on the server icon and on the `#aportes` channel → **vars** `DISCORD_GUILD_ID`, `DISCORD_FORUM_CHANNEL_ID`.
3. Create a permanent invite (channel → Invite → Edit: never expires, no use limit) → **var** `DISCORD_INVITE`.

### 2. Discord application (bot + sign-in)

1. https://discord.com/developers/applications → **New Application** → name "Geno".
2. **OAuth2** page: copy *Client ID* and *Client Secret* → **secrets** `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`. Add the redirect `https://geno-api.basetlabs.com/auth/discord/callback`.
3. **Bot** page: *Reset Token* → **secret** `DISCORD_BOT_TOKEN`. Under *Privileged Gateway Intents* enable **Message Content Intent**.
4. Invite the bot to the server: **OAuth2 → URL Generator**, scope `bot`, permissions *View Channels, Send Messages, Send Messages in Threads, Create Public Threads, Manage Webhooks, Attach Files, Read Message History*. Open the generated URL and pick the server.
5. Make sure the bot's role can see and post in `#aportes`.

### 3. Google sign-in

1. https://console.cloud.google.com → a project (any) → **APIs & Services → OAuth consent screen**: External, app name "Geno · Historia Documental Costa Rica", support e-mail, then publish the app (otherwise only test users can sign in).
2. **Credentials → Create credentials → OAuth client ID** → Web application. Authorized redirect URI: `https://geno-api.basetlabs.com/auth/google/callback`.
3. Client ID / secret → **secrets** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

### 4. Facebook sign-in

1. https://developers.facebook.com → **Create App** → "Consumer" → add the **Facebook Login** product.
2. Facebook Login → Settings → *Valid OAuth Redirect URIs*: `https://geno-api.basetlabs.com/auth/facebook/callback`.
3. App settings → Basic: App ID / App Secret → **secrets** `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`. Switch the app to **Live** mode (needs a privacy-policy URL; the write-up page works).

A provider whose two secrets are missing is simply not offered in the panel, so Google and Facebook can be added later.

### 5. Cloudflare

```bash
cd geno-api
npm install
npx wrangler login                              # once, opens the browser
npx wrangler kv namespace create KV             # paste the id into wrangler.jsonc
npx wrangler r2 bucket create geno-uploads
npm run deploy                                  # first deploy, so the secrets have somewhere to go
npm run secret SESSION_SECRET                   # any long random string, e.g. `openssl rand -base64 48`
npm run secret DISCORD_BOT_TOKEN
npm run secret DISCORD_CLIENT_ID
npm run secret DISCORD_CLIENT_SECRET
npm run secret GOOGLE_CLIENT_ID
npm run secret GOOGLE_CLIENT_SECRET
npm run secret FACEBOOK_APP_ID
npm run secret FACEBOOK_APP_SECRET
```

The custom domain `geno-api.basetlabs.com` is created automatically on the first deploy (the zone is already in Cloudflare).

After that, every push to `main` that touches `geno-api/` redeploys it through GitHub Actions (`.github/workflows/deploy-api.yml`). For that to work, add two repository secrets to **github.com/fabiomurillo-baset/geno → Settings → Secrets and variables → Actions**: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, the same values the murillo-sites repository uses. Until the placeholders in `wrangler.jsonc` are filled in, the workflow skips the deploy with a warning. Deploying by hand with `npm run deploy` always works too.

Check: `https://geno-api.basetlabs.com/config` should list the providers and the invite.

## Local development

```bash
cd geno-api
cp .dev.vars.example .dev.vars   # fill in the secrets; the file is git-ignored
npm run dev -- --port 8788       # http://localhost:8788
cd ../cartago-web && VITE_GENO_API=http://localhost:8788 npm run dev
```

For sign-in to work locally, add `http://localhost:8788/auth/<provider>/callback` to each provider's redirect URIs and set `SITE_URL` to `http://localhost:5173/` (e.g. `wrangler dev --var SITE_URL:http://localhost:5173/`).

## Limits and behaviour

- Messages up to 2 000 characters; up to 4 files per message, 10 MB each (Discord's cap), images and PDF only.
- One message every 5 s per user. Sessions last 30 days (token in the browser's localStorage).
- Posts are made through a webhook so they carry the contributor's own name and avatar ("Ana Mora (Google)" for non-Discord sign-ins). Replies written in Discord appear in the panel within ~5 s.
- Files land in Discord **and** in the `geno-uploads` R2 bucket under `records/<id>/…` with metadata (record, thread, message, user), ready for the pipeline to ingest.
- The bot's starter message in each post is the record reference; the panel hides it.
