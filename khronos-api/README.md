# khronos-api

Bridge between the Khronos explorer ([basetlabs.com/khronos](https://basetlabs.com/khronos/)) and the Discord server **Historia Documental Costa Rica**. The "Aportar" panel in the explorer signs people in (Discord, Google or Facebook), shows the conversation about a record and lets them post messages, images and PDFs. Discord is the source of truth: every record that receives a contribution becomes one post in the `#aportes` forum, and the panel reads and writes that post.

```
Khronos (browser) ──► khronos-api.basetlabs.com (this Worker) ──► Discord REST API
                       │  KV: record → thread, OAuth state, rate limit
                       └► R2: copy of every uploaded file, with record/author metadata
```

Endpoints: `GET /config`, `GET /auth/:provider/start?return=<hash>`, `GET /auth/:provider/callback`, `GET /me`, `GET|POST /records/:id/messages`, `GET /files/:key`, `GET|POST /curation`, `POST /curation/:id/undo`, `GET|POST /records/:id/proposals`, `POST /proposals/:id/vote`, `POST /proposals/:id/withdraw`, `GET|POST /works`, `GET|POST /refs`, `POST /refs/:id/undo`.

It also stores **curation**: the community's decisions about people and places (merging spelling variants of the same person or place, renaming an entry). They live in a D1 database so every visitor sees the same canonical names, each one is attributed to the signed-in user, can be undone from the profile page, and is optionally logged to a Discord channel.

## One-time setup

Everything below is done once. Values marked **var** go in `wrangler.jsonc`; values marked **secret** are set with
`npm run secret NAME` inside `khronos-api/` (wrangler asks for the value; nothing is written to the repo).

### 1. Discord server

1. Create a **forum channel** named `#aportes` (Server Settings → Channels → Create → Forum). Optional tags: `documento`, `foto`, `corrección`, `genealogía`, `lugar`.
2. Turn on Developer Mode (User Settings → Advanced) and right-click → **Copy ID** on the server icon and on the `#aportes` channel → **vars** `DISCORD_GUILD_ID`, `DISCORD_FORUM_CHANNEL_ID`.
3. Create a permanent invite (channel → Invite → Edit: never expires, no use limit) → **var** `DISCORD_INVITE`.

### 2. Discord application (bot + sign-in)

1. https://discord.com/developers/applications → **New Application** → name "Khronos".
2. **OAuth2** page: copy *Client ID* and *Client Secret* → **secrets** `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`. Add the redirect `https://khronos-api.basetlabs.com/auth/discord/callback`.
3. **Bot** page: *Reset Token* → **secret** `DISCORD_BOT_TOKEN`. Under *Privileged Gateway Intents* enable **Message Content Intent**.
4. Invite the bot to the server: **OAuth2 → URL Generator**, scope `bot`, permissions *View Channels, Send Messages, Send Messages in Threads, Create Public Threads, Manage Webhooks, Attach Files, Read Message History*. Open the generated URL and pick the server.
5. Make sure the bot's role can see and post in `#aportes`.

### 3. Google sign-in

1. https://console.cloud.google.com → a project (any) → **APIs & Services → OAuth consent screen**: External, app name "Khronos · Historia Documental Costa Rica", support e-mail, then publish the app (otherwise only test users can sign in).
2. **Credentials → Create credentials → OAuth client ID** → Web application. Authorized redirect URI: `https://khronos-api.basetlabs.com/auth/google/callback`.
3. Client ID / secret → **secrets** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

### 4. Facebook sign-in

1. https://developers.facebook.com → **Create App** → "Consumer" → add the **Facebook Login** product.
2. Facebook Login → Settings → *Valid OAuth Redirect URIs*: `https://khronos-api.basetlabs.com/auth/facebook/callback`.
3. App settings → Basic: App ID / App Secret → **secrets** `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`. Switch the app to **Live** mode (needs a privacy-policy URL; the write-up page works).

A provider whose two secrets are missing is simply not offered in the panel, so Google and Facebook can be added later.

### 5. GitHub (proposed corrections → pull requests)

From the Aportar panel anyone signed in can **propose a correction** to one field of a record (year, date, people, places, Spanish or English summary) with a reason and evidence; the proposal is announced in the record's Discord thread and the community votes. When a proposal reaches `PROPOSAL_VOTES` net votes (default 3; the author's vote counts), khronos-api opens a **pull request** on `GITHUB_REPO` that appends one line to `scripts/data/corrections.jsonl`. Nothing changes until a maintainer approves and merges it; then the app reads the file from `main` and the record shows "Corregido por la comunidad".

1. Create a fine-grained personal access token at https://github.com/settings/personal-access-tokens → *Generate new token*: resource owner `fabiomurillo-baset`, repository access **only `khronos`**, permissions **Contents: Read and write** and **Pull requests: Read and write**. → **secret** `GITHUB_TOKEN`.
2. Recommended: protect `main` (Settings → Branches → Add rule: require a pull request before merging, require 1 approval) so corrections always go through review. Add a `CODEOWNERS` file if you want specific reviewers requested automatically.
3. Optional: change `PROPOSAL_VOTES` in `wrangler.jsonc`.

### 6. Cloudflare

```bash
cd khronos-api
npm install
npx wrangler login                              # once, opens the browser
npx wrangler kv namespace create KV             # paste the id into wrangler.jsonc
npx wrangler d1 create khronos                     # paste the database_id into wrangler.jsonc (curation)
npx wrangler r2 bucket create khronos-uploads      # optional: copies of uploaded files
npm run deploy                                  # first deploy, so the secrets have somewhere to go
npm run secret SESSION_SECRET                   # any long random string, e.g. `openssl rand -base64 48`
npm run secret DISCORD_BOT_TOKEN
npm run secret DISCORD_CLIENT_ID
npm run secret DISCORD_CLIENT_SECRET
npm run secret GOOGLE_CLIENT_ID
npm run secret GOOGLE_CLIENT_SECRET
npm run secret FACEBOOK_APP_ID
npm run secret FACEBOOK_APP_SECRET
npm run secret GITHUB_TOKEN
```

The custom domain `khronos-api.basetlabs.com` is created automatically on the first deploy (the zone is already in Cloudflare).

After that, every push to `main` that touches `khronos-api/` redeploys it through GitHub Actions (`.github/workflows/deploy-api.yml`). For that to work, add two repository secrets to **github.com/fabiomurillo-baset/khronos → Settings → Secrets and variables → Actions**: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, the same values the murillo-sites repository uses. Until the placeholders in `wrangler.jsonc` are filled in, the workflow skips the deploy with a warning. Deploying by hand with `npm run deploy` always works too.

Check: `https://khronos-api.basetlabs.com/config` should list the providers and the invite.

## Local development

```bash
cd khronos-api
cp .dev.vars.example .dev.vars   # fill in the secrets; the file is git-ignored
npm run dev -- --port 8788       # http://localhost:8788
cd ../cartago-web && VITE_KHRONOS_API=http://localhost:8788 npm run dev
```

For sign-in to work locally, add `http://localhost:8788/auth/<provider>/callback` to each provider's redirect URIs and set `SITE_URL` to `http://localhost:5173/` (e.g. `wrangler dev --var SITE_URL:http://localhost:5173/`).

Optional extras in `wrangler.jsonc`:

- `DISCORD_CURATION_CHANNEL_ID`: a text channel (e.g. `#curaduría`) where every merge, rename and undo is posted as one line. Leave empty to skip.
- `r2_buckets`: remove the line to keep uploaded files only in Discord; the API works the same without it.

## Limits and behaviour

- Messages up to 2 000 characters; up to 4 files per message, 10 MB each (Discord's cap), images and PDF only.
- One message every 5 s per user. Sessions last 30 days (token in the browser's localStorage).
- Posts are made through a webhook so they carry the contributor's own name and avatar ("Ana Mora (Google)" for non-Discord sign-ins). Replies written in Discord appear in the panel within ~5 s.
- Files land in Discord **and** in the `khronos-uploads` R2 bucket under `records/<id>/…` with metadata (record, thread, message, user), ready for the pipeline to ingest.
- The bot's starter message in each post is the record reference; the panel hides it.
- Proposals: votes are one per user and can be changed or withdrawn while the proposal is open; a proposal's PR state is re-read from GitHub at most every two minutes when someone opens the record. PR branches are named `proposal-<id>`.
- Curation: anyone signed in can merge, rename or undo; nothing is destructive (the raw names stay in the data and a merge is a row that can be reverted). The curation table is created automatically on first use.
