# Cited — GEO / AEO Optimization Toolkit

Tooling that makes this site (and any content you add) retrievable and quotable
by AI answer engines — Perplexity, Google AI Overviews, and ChatGPT Search.

It does three things:

1. **Pull & classify search demand** from Google Search Console, isolating the
   informational / conversational queries answer engines actually serve.
2. **Inject JSON-LD structured data** into the site so AI can parse Cited's
   brand, service, pricing, and FAQ relationships explicitly.
3. **Audit pages** against AI-readiness metrics and emit a prioritized report.

## Quick start

```bash
npm install            # installs googleapis (only needed for the GSC pull)
npm run audit          # scans .html/.md → geo_audit_report.md
```

## Layout

| Path                       | What it is                                                                 |
| -------------------------- | -------------------------------------------------------------------------- |
| `index.html`               | The site. Now carries a JSON-LD `@graph` (Organization, Service, FAQPage). |
| `scripts/gsc_pull.js`      | **Step 1** — pulls top 100 GSC queries (30d) → `aeo_opportunities.json`.    |
| `scripts/lib/classify.js`  | Shared query classifier (informational / conversational).                  |
| `aeo_opportunities.json`   | Answer-engine query opportunities. Currently **sample** seed data.         |
| `geo_audit.js`             | **Step 3** — audits pages for AI retrieval readiness.                      |
| `geo_audit_report.md`      | Generated audit report.                                                    |
| `docs/GSC_SETUP.md`        | How to wire up real Google Search Console credentials.                     |

## Step 1 — Google Search Console

`aeo_opportunities.json` ships with **sample** data so the rest of the pipeline
is testable immediately. Replace it with live data:

```bash
export GSC_SITE_URL="sc-domain:cited.example"
export GOOGLE_APPLICATION_CREDENTIALS="/abs/path/key.json"
npm run gsc:pull
```

Run it locally — see [`docs/GSC_SETUP.md`](docs/GSC_SETUP.md). Credentials are
git-ignored and should never enter a shared sandbox.

## Step 2 — Structured data

The JSON-LD lives in the `<head>` of `index.html`. Before launch, replace every
`[TODO]` placeholder: the real domain (currently `https://cited.example`), the
`sameAs` profile URLs (Google Business Profile, Instagram, LinkedIn, Yelp), the
founder's full name/profile, and a real logo URL. Validate with Google's
[Rich Results Test](https://search.google.com/test/rich-results).

The eight `FAQPage` Q&As map directly to the informational queries in
`aeo_opportunities.json`, so the page answers in language AI can quote.

## Step 3 — The audit

```bash
npm run audit            # all .html/.md in the repo
node geo_audit.js index.html   # specific file(s)
```

Each page is scored 0–100 on:

- **Direct Answer Readiness** — a clear, self-contained 2–3 sentence summary up top.
- **Data Density** — claims backed by stats, tables, or bulleted facts (not vague adjectives).
- **Information Architecture** — logical H2/H3 hierarchy, with question-style headings.
- **Query Coverage** — how much of `aeo_opportunities.json` the visible copy answers.

Pages are graded 🟢 Strong / 🟡 Needs work / 🔴 Rewrite and sorted worst-first in
`geo_audit_report.md`.
