#!/usr/bin/env node
/**
 * Step 1 — Connect & Analyze Google Search Console Data
 * ------------------------------------------------------
 * Authenticates with the Google Search Console (Search Analytics) API using a
 * service-account key, pulls the top 100 search queries by impressions for the
 * last 30 days, isolates informational / conversational questions, and writes
 * the result to ./aeo_opportunities.json.
 *
 * RUN THIS LOCALLY — not in a shared sandbox — so your credentials stay on your
 * machine. Setup instructions: see docs/GSC_SETUP.md.
 *
 * Required environment variables (a .env.example is provided):
 *   GSC_SITE_URL              e.g. "https://cited.example/" or "sc-domain:cited.example"
 *   GOOGLE_APPLICATION_CREDENTIALS  absolute path to the service-account JSON key
 *
 * Usage:
 *   GSC_SITE_URL="sc-domain:cited.example" \
 *   GOOGLE_APPLICATION_CREDENTIALS="/path/to/key.json" \
 *   node scripts/gsc_pull.js
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractOpportunities } from "./lib/classify.js";

const OUTPUT_PATH = resolve(process.cwd(), "aeo_opportunities.json");
const ROW_LIMIT = 100;
const LOOKBACK_DAYS = 30;

function isoDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const siteUrl = process.env.GSC_SITE_URL;
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!siteUrl) {
    console.error("✗ GSC_SITE_URL is not set. Example: sc-domain:cited.example");
    process.exit(1);
  }
  if (!keyFile) {
    console.error("✗ GOOGLE_APPLICATION_CREDENTIALS is not set (path to service-account JSON).");
    process.exit(1);
  }

  // Lazy import so the audit pipeline does not require googleapis to be installed.
  let google;
  try {
    ({ google } = await import("googleapis"));
  } catch (err) {
    console.error("✗ The 'googleapis' package is not installed. Run: npm install");
    process.exit(1);
  }

  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  });

  const searchconsole = google.searchconsole({ version: "v1", auth });

  const startDate = isoDaysAgo(LOOKBACK_DAYS);
  const endDate = isoDaysAgo(0);

  console.log(`→ Pulling top ${ROW_LIMIT} queries for ${siteUrl} (${startDate} → ${endDate})`);

  const res = await searchconsole.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate,
      endDate,
      dimensions: ["query"],
      rowLimit: ROW_LIMIT,
      dataState: "all",
    },
  });

  const rows = (res.data.rows || []).map((r) => ({
    query: r.keys?.[0] ?? "",
    clicks: r.clicks ?? 0,
    impressions: r.impressions ?? 0,
    ctr: Number(((r.ctr ?? 0) * 100).toFixed(2)),
    position: Number((r.position ?? 0).toFixed(1)),
  }));

  const opportunities = extractOpportunities(rows);

  const payload = {
    generatedAt: new Date().toISOString(),
    source: "google-search-console",
    site: siteUrl,
    dateRange: { startDate, endDate, days: LOOKBACK_DAYS },
    totals: {
      queriesPulled: rows.length,
      opportunitiesFound: opportunities.length,
    },
    opportunities,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(
    `✓ Wrote ${opportunities.length} answer-engine opportunities (of ${rows.length} queries) → ${OUTPUT_PATH}`
  );
}

main().catch((err) => {
  console.error("✗ GSC pull failed:", err?.message || err);
  if (err?.response?.data) console.error(JSON.stringify(err.response.data, null, 2));
  process.exit(1);
});
