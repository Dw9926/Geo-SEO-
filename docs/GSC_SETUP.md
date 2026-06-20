# Google Search Console setup (Step 1)

`scripts/gsc_pull.js` pulls your top 100 queries from the last 30 days, isolates
the informational / conversational ones, and writes `aeo_opportunities.json`.

> Run it **locally**, not in a shared cloud sandbox, so your service-account key
> never leaves your machine.

## 1. Create a service account

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) → create
   (or pick) a project.
2. Enable the **Google Search Console API** for the project.
3. **APIs & Services → Credentials → Create credentials → Service account.**
4. Create a JSON key for that service account and download it.

## 2. Grant it access to your property

1. Open [Search Console](https://search.google.com/search-console) → your
   property → **Settings → Users and permissions → Add user.**
2. Add the service account's email (the `client_email` in the JSON key) with at
   least **Restricted** / read access.

## 3. Configure and run

```bash
npm install                       # installs googleapis
cp .env.example .env              # then edit .env

# either export the vars or rely on .env (the script reads process.env):
export GSC_SITE_URL="sc-domain:cited.example"
export GOOGLE_APPLICATION_CREDENTIALS="/absolute/path/to/key.json"

npm run gsc:pull
```

This overwrites `aeo_opportunities.json` with live data. Then re-run the audit so
its query-coverage scoring reflects your real search demand:

```bash
npm run audit
```

## Property URL formats

| Property type in GSC | `GSC_SITE_URL` value         |
| -------------------- | ---------------------------- |
| Domain               | `sc-domain:cited.example`    |
| URL-prefix           | `https://cited.example/`     |

## Classification logic

A query is flagged as an answer-engine opportunity when it:

- starts with a question opener (`how to`, `what is`, `why does`, `how much`, …), **or**
- contains a `?`, **or**
- carries conversational/local intent (`near me`, `best`, `vs`, `worth it`, …), **or**
- is a long-tail phrase of 5+ words.

The shared rules live in `scripts/lib/classify.js` and are used by both the GSC
pull and the audit's query-coverage check.
