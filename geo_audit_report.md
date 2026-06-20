# GEO / AEO Audit Report

_Generated 2026-06-20T22:01:30.532Z · 2 file(s) scanned_

Scores rate how readily an answer engine (Perplexity, Google AI Overviews, ChatGPT Search) can **retrieve and quote** each page. Lower = higher priority for a rewrite.

## Summary

| Page | Overall | Direct Answer | Data Density | Info Architecture | Query Coverage |
| --- | --- | --- | --- | --- | --- |
| `docs/GSC_SETUP.md` | 🔴 Rewrite (60) | 70 | 77 | 55 | 36 |
| `index.html` | 🟢 Strong (88) | 100 | 91 | 68 | 93 |

---

## `docs/GSC_SETUP.md` — 🔴 Rewrite (60/100)

**Title:** Google Search Console setup (Step 1)  
**Headings:** 1× H1 · 5× H2 · 0× H3

```
Direct Answer Readiness   ███████░░░ 70
Data Density              ████████░░ 77
Information Architecture  ██████░░░░ 55
Query Coverage (Step 1)   ████░░░░░░ 36
```

**Flags to fix:**

- **Direct Answer:** Opening is a single sentence — aim for a self-contained 2–3 sentence answer.
- **Info Architecture:** No question-style headings — phrase some H2/H3s the way customers ask AI ("How do I…", "What is…").

<details><summary>Opening the AI would try to quote</summary>

> `scripts/gsc_pull.js` pulls your top 100 queries from the last 30 days, isolates the informational / conversational ones, and writes `aeo_opportunities.json`.

</details>

**Uncovered answer-engine queries** (from `aeo_opportunities.json`) — add content/FAQ that answers these in quotable language:

- how to get my business cited in ai search results
- why is my business not showing up in ai overviews
- difference between seo and geo
- how to get cited by chatgpt and perplexity
- what is schema markup for local business
- how to rank in google ai overviews
- why does reddit get cited in ai answers
- do i need schema markup for ai search
- loyalty sms system for small retail shop

<details><summary>5 queries already covered</summary>

- what is answer engine optimization
- how much does an ai visibility audit cost
- best local seo agency in long beach
- is an ai visibility audit worth it
- how long does a local seo audit take

</details>

---

## `index.html` — 🟢 Strong (88/100)

**Title:** Cited — Be the answer AI gives.  
**Headings:** 1× H1 · 6× H2 · 4× H3

```
Direct Answer Readiness   ██████████ 100
Data Density              █████████░ 91
Information Architecture  ███████░░░ 68
Query Coverage (Step 1)   █████████░ 93
```

**Flags to fix:**

- **Data Density:** Vague/unsupported language (many, most, very) — replace with specifics or cite a figure.

<details><summary>Opening the AI would try to quote</summary>

> Google used to send you customers. Now its AI answers their question and keeps them on the page. When a local asks "best yoga studio in Long Beach" or "smoke shop near me with rewards," one or two bus…

</details>

**Uncovered answer-engine queries** (from `aeo_opportunities.json`) — add content/FAQ that answers these in quotable language:

- difference between seo and geo

<details><summary>13 queries already covered</summary>

- how to get my business cited in ai search results
- what is answer engine optimization
- why is my business not showing up in ai overviews
- how much does an ai visibility audit cost
- best local seo agency in long beach
- how to get cited by chatgpt and perplexity
- what is schema markup for local business
- how to rank in google ai overviews
- is an ai visibility audit worth it
- how long does a local seo audit take
- why does reddit get cited in ai answers
- do i need schema markup for ai search
- loyalty sms system for small retail shop

</details>

