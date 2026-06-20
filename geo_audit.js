#!/usr/bin/env node
/**
 * Step 3 — Automated Technical GEO/AEO Audit
 * ------------------------------------------
 * Scans local HTML and Markdown files and scores them against the metrics that
 * decide whether an LLM / answer engine can retrieve and quote a page:
 *
 *   1. Direct Answer Readiness — is there a clear, concise 2–3 sentence summary
 *      near the top that answers the page's primary user intent?
 *   2. Data Density — are claims backed by statistics, tables, or bulleted facts
 *      rather than vague adjectives?
 *   3. Information Architecture — are H2/H3 headers structured logically and do
 *      they mirror conversational / question-style query patterns?
 *
 * Writes a scannable report to ./geo_audit_report.md flagging pages that need a
 * rewrite to better fit RAG / answer-engine retrieval.
 *
 * Usage:
 *   node geo_audit.js                 # audit every .html/.md in the repo
 *   node geo_audit.js index.html      # audit specific file(s)
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, extname, join } from "node:path";
import { classifyQuery } from "./scripts/lib/classify.js";

const ROOT = process.cwd();
const REPORT_PATH = resolve(ROOT, "geo_audit_report.md");
const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next"]);
const VAGUE_TERMS = [
  "many", "most", "lots", "tons", "several", "various", "numerous",
  "very", "really", "incredibly", "leading", "world-class", "best-in-class",
  "cutting-edge", "robust", "seamless", "synergy", "a lot",
];

// ---------- file discovery ----------

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (IGNORE_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if ([".html", ".htm", ".md", ".markdown"].includes(extname(entry).toLowerCase())) {
      acc.push(full);
    }
  }
  return acc;
}

// ---------- parsing ----------

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseHtml(raw) {
  const headings = [];
  const headingRe = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m;
  while ((m = headingRe.exec(raw))) {
    headings.push({ level: Number(m[1]), text: stripTags(m[2]) });
  }

  const paragraphs = [];
  const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  while ((m = pRe.exec(raw))) {
    const t = stripTags(m[1]);
    if (t) paragraphs.push(t);
  }

  const listItems = (raw.match(/<li[^>]*>/gi) || []).length;
  const tables = (raw.match(/<table[^>]*>/gi) || []).length;
  const title = (raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];

  return {
    type: "html",
    title: title ? stripTags(title) : null,
    headings,
    paragraphs,
    listItems,
    tables,
    text: stripTags(raw),
  };
}

function parseMarkdown(raw) {
  const lines = raw.split(/\r?\n/);
  const headings = [];
  const paragraphs = [];
  let buf = [];
  let inCode = false;

  const flush = () => {
    const t = buf.join(" ").trim();
    if (t) paragraphs.push(t);
    buf = [];
  };

  for (const line of lines) {
    if (/^```/.test(line)) { inCode = !inCode; continue; }
    if (inCode) continue;
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) { flush(); headings.push({ level: h[1].length, text: h[2].trim() }); continue; }
    if (!line.trim()) { flush(); continue; }
    if (/^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line)) continue; // list lines counted separately
    buf.push(line.trim());
  }
  flush();

  const listItems = (raw.match(/^[ \t]*([-*+]|\d+\.)\s+/gm) || []).length;
  const tables = (raw.match(/^\|.*\|\s*$/gm) || []).length > 1 ? 1 : 0;

  return {
    type: "markdown",
    title: headings.find((h) => h.level === 1)?.text || null,
    headings,
    paragraphs,
    listItems,
    tables,
    text: raw.replace(/[#>*_`-]/g, " ").replace(/\s+/g, " ").trim(),
  };
}

// ---------- metric helpers ----------

function countSentences(text) {
  return (text.match(/[.!?](\s|$)/g) || []).length || (text.trim() ? 1 : 0);
}

function countStats(text) {
  const percent = (text.match(/\d+(\.\d+)?\s?%/g) || []).length;
  const money = (text.match(/\$\s?\d[\d,]*/g) || []).length;
  const ranges = (text.match(/\b\d+\s?[–\-]\s?\d+\b/g) || []).length;
  const plainNums = (text.match(/\b\d[\d,.]*\b/g) || []).length;
  return { percent, money, ranges, plainNums, total: percent + money + ranges + plainNums };
}

function clamp(n) { return Math.max(0, Math.min(100, Math.round(n))); }

// ---------- metric scorers ----------

function scoreDirectAnswer(doc) {
  const flags = [];
  const lead = doc.paragraphs.find((p) => p.length >= 40) || doc.paragraphs[0] || "";
  const sentences = countSentences(lead);
  const len = lead.length;

  let score = 0;
  if (!lead) {
    flags.push("No substantive opening paragraph — nothing for an answer engine to lift as a summary.");
  } else {
    if (sentences >= 2 && sentences <= 4) score += 55;
    else if (sentences === 1) { score += 25; flags.push("Opening is a single sentence — aim for a self-contained 2–3 sentence answer."); }
    else { score += 20; flags.push(`Opening summary is ${sentences} sentences — too long to be quoted cleanly (target 2–3).`); }

    if (len >= 120 && len <= 420) score += 30;
    else if (len < 120) { score += 12; flags.push("Opening summary is thin (<120 chars) — add a concrete, standalone answer."); }
    else { score += 15; flags.push("Opening summary is long (>420 chars) — tighten it so it can be excerpted."); }

    // Does it actually state something, vs. pure marketing tease?
    const stats = countStats(lead);
    if (stats.total > 0 || /\b(is|are|means|works by|costs?|takes?|includes?)\b/i.test(lead)) score += 15;
    else flags.push("Opening reads as a hook, not an answer — lead with a declarative statement of what/why/how.");
  }

  return { score: clamp(score), flags, sample: lead.slice(0, 200) };
}

function scoreDataDensity(doc) {
  const flags = [];
  const stats = countStats(doc.text);
  const paragraphCount = Math.max(1, doc.paragraphs.length);
  const evidence = stats.total + doc.listItems + doc.tables * 5;
  const density = evidence / paragraphCount;

  let score = clamp(density * 22);

  if (stats.total === 0) flags.push("No numbers, percentages, or prices found — AI prefers quotable, specific figures.");
  if (doc.listItems === 0 && doc.tables === 0) flags.push("No lists or tables — structured facts are far easier for RAG to extract.");

  const lowered = doc.text.toLowerCase();
  const vagueHits = VAGUE_TERMS.filter((t) => lowered.includes(t));
  if (vagueHits.length >= 3) {
    score = clamp(score - vagueHits.length * 3);
    flags.push(`Vague/unsupported language (${vagueHits.slice(0, 6).join(", ")}) — replace with specifics or cite a figure.`);
  }
  if (doc.tables > 0) flags.length === 0;

  return { score: clamp(score), flags, stats, lists: doc.listItems, tables: doc.tables };
}

function scoreInfoArchitecture(doc) {
  const flags = [];
  const h1 = doc.headings.filter((h) => h.level === 1);
  const h2 = doc.headings.filter((h) => h.level === 2);
  const h3 = doc.headings.filter((h) => h.level === 3);

  let score = 0;

  if (h1.length === 1) score += 20;
  else if (h1.length === 0) flags.push("No H1 — every page needs one clear primary heading.");
  else { score += 8; flags.push(`Multiple H1s (${h1.length}) — keep a single primary heading.`); }

  if (h2.length >= 3) score += 25;
  else if (h2.length >= 1) { score += 12; flags.push("Few H2 sections — break content into more scannable, retrievable sections."); }
  else flags.push("No H2 headings — the page has no section structure for AI to navigate.");

  if (h3.length >= 1) score += 10;

  // Heading-level skips (e.g. H1 → H3) hurt machine parsing.
  let prev = 0, skipped = false;
  for (const h of doc.headings) {
    if (prev && h.level > prev + 1) skipped = true;
    prev = h.level;
  }
  if (!skipped) score += 10;
  else flags.push("Heading levels skip (e.g. H2 → H4) — keep the hierarchy sequential.");

  // Conversational / question phrasing in headings is gold for AEO.
  const questiony = doc.headings.filter((h) => {
    const c = classifyQuery(h.text);
    return c.isInformational || /\?$/.test(h.text);
  });
  const ratio = doc.headings.length ? questiony.length / doc.headings.length : 0;
  score += clamp(ratio * 100) * 0.35;
  if (questiony.length === 0) {
    flags.push("No question-style headings — phrase some H2/H3s the way customers ask AI (\"How do I…\", \"What is…\").");
  }

  return {
    score: clamp(score),
    flags,
    counts: { h1: h1.length, h2: h2.length, h3: h3.length },
    questionHeadings: questiony.map((h) => h.text),
  };
}

// ---------- opportunity coverage (cross-ref Step 1) ----------

function loadOpportunities() {
  try {
    const raw = readFileSync(resolve(ROOT, "aeo_opportunities.json"), "utf8");
    return JSON.parse(raw).opportunities || [];
  } catch { return null; }
}

function scoreCoverage(doc, opportunities) {
  if (!opportunities || !opportunities.length) return null;
  const text = doc.text.toLowerCase();
  const covered = [];
  const missing = [];
  for (const o of opportunities) {
    // Heuristic: a query is "covered" if most of its meaningful words appear.
    const words = o.query.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const hits = words.filter((w) => text.includes(w)).length;
    if (words.length && hits / words.length >= 0.6) covered.push(o.query);
    else missing.push(o.query);
  }
  const score = clamp((covered.length / opportunities.length) * 100);
  return { score, covered, missing };
}

// ---------- audit one file ----------

function auditFile(path, opportunities) {
  const raw = readFileSync(path, "utf8");
  const doc = extname(path).toLowerCase().startsWith(".htm")
    ? parseHtml(raw)
    : parseMarkdown(raw);

  const directAnswer = scoreDirectAnswer(doc);
  const dataDensity = scoreDataDensity(doc);
  const infoArch = scoreInfoArchitecture(doc);
  const coverage = scoreCoverage(doc, opportunities);

  const parts = [directAnswer.score, dataDensity.score, infoArch.score];
  if (coverage) parts.push(coverage.score);
  const overall = clamp(parts.reduce((a, b) => a + b, 0) / parts.length);

  return { path, doc, directAnswer, dataDensity, infoArch, coverage, overall };
}

// ---------- report ----------

function grade(score) {
  if (score >= 85) return "🟢 Strong";
  if (score >= 65) return "🟡 Needs work";
  return "🔴 Rewrite";
}

function bar(score) {
  const filled = Math.round(score / 10);
  return "█".repeat(filled) + "░".repeat(10 - filled) + ` ${score}`;
}

function buildReport(results) {
  const now = new Date().toISOString();
  const lines = [];
  lines.push("# GEO / AEO Audit Report");
  lines.push("");
  lines.push(`_Generated ${now} · ${results.length} file(s) scanned_`);
  lines.push("");
  lines.push("Scores rate how readily an answer engine (Perplexity, Google AI Overviews, ChatGPT Search) can **retrieve and quote** each page. Lower = higher priority for a rewrite.");
  lines.push("");

  // Summary table
  lines.push("## Summary");
  lines.push("");
  lines.push("| Page | Overall | Direct Answer | Data Density | Info Architecture | Query Coverage |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const r of [...results].sort((a, b) => a.overall - b.overall)) {
    const rel = relative(ROOT, r.path) || r.path;
    const cov = r.coverage ? `${r.coverage.score}` : "—";
    lines.push(`| \`${rel}\` | ${grade(r.overall)} (${r.overall}) | ${r.directAnswer.score} | ${r.dataDensity.score} | ${r.infoArch.score} | ${cov} |`);
  }
  lines.push("");

  // Per-file detail
  for (const r of [...results].sort((a, b) => a.overall - b.overall)) {
    const rel = relative(ROOT, r.path) || r.path;
    lines.push("---");
    lines.push("");
    lines.push(`## \`${rel}\` — ${grade(r.overall)} (${r.overall}/100)`);
    lines.push("");
    if (r.doc.title) lines.push(`**Title:** ${r.doc.title}  `);
    lines.push(`**Headings:** ${r.infoArch.counts.h1}× H1 · ${r.infoArch.counts.h2}× H2 · ${r.infoArch.counts.h3}× H3`);
    lines.push("");

    lines.push("```");
    lines.push(`Direct Answer Readiness   ${bar(r.directAnswer.score)}`);
    lines.push(`Data Density              ${bar(r.dataDensity.score)}`);
    lines.push(`Information Architecture  ${bar(r.infoArch.score)}`);
    if (r.coverage) lines.push(`Query Coverage (Step 1)   ${bar(r.coverage.score)}`);
    lines.push("```");
    lines.push("");

    const allFlags = [
      ...r.directAnswer.flags.map((f) => ["Direct Answer", f]),
      ...r.dataDensity.flags.map((f) => ["Data Density", f]),
      ...r.infoArch.flags.map((f) => ["Info Architecture", f]),
    ];
    if (allFlags.length) {
      lines.push("**Flags to fix:**");
      lines.push("");
      for (const [cat, f] of allFlags) lines.push(`- **${cat}:** ${f}`);
      lines.push("");
    } else {
      lines.push("_No structural flags raised._");
      lines.push("");
    }

    if (r.directAnswer.sample) {
      lines.push("<details><summary>Opening the AI would try to quote</summary>");
      lines.push("");
      lines.push("> " + r.directAnswer.sample + (r.directAnswer.sample.length >= 200 ? "…" : ""));
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }

    if (r.coverage) {
      if (r.coverage.missing.length) {
        lines.push("**Uncovered answer-engine queries** (from `aeo_opportunities.json`) — add content/FAQ that answers these in quotable language:");
        lines.push("");
        for (const q of r.coverage.missing.slice(0, 12)) lines.push(`- ${q}`);
        lines.push("");
      }
      if (r.coverage.covered.length) {
        lines.push(`<details><summary>${r.coverage.covered.length} queries already covered</summary>`);
        lines.push("");
        for (const q of r.coverage.covered) lines.push(`- ${q}`);
        lines.push("");
        lines.push("</details>");
        lines.push("");
      }
    }
  }

  return lines.join("\n") + "\n";
}

// ---------- main ----------

function main() {
  const args = process.argv.slice(2);
  let files;
  if (args.length) {
    files = args.map((a) => resolve(ROOT, a));
  } else {
    files = walk(ROOT);
  }

  if (!files.length) {
    console.error("✗ No .html or .md files found to audit.");
    process.exit(1);
  }

  const opportunities = loadOpportunities();
  if (!opportunities) {
    console.warn("⚠ aeo_opportunities.json not found — skipping query-coverage scoring. Run `npm run gsc:pull` first.");
  }

  const results = files.map((f) => auditFile(f, opportunities));
  const report = buildReport(results);
  writeFileSync(REPORT_PATH, report, "utf8");

  console.log(`✓ Audited ${results.length} file(s) → ${relative(ROOT, REPORT_PATH)}`);
  for (const r of [...results].sort((a, b) => a.overall - b.overall)) {
    console.log(`  ${grade(r.overall).padEnd(16)} ${r.overall.toString().padStart(3)}  ${relative(ROOT, r.path)}`);
  }
}

main();
