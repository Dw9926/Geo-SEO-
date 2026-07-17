# Human-in-the-Loop Playbook: Real Estate Lead Response & Status Inquiries

**Role:** Operations design for a solo real estate operator who manages everything from a phone.
**Operating model:** AI agents draft, triage, and schedule; you review and approve. You are the managing broker of your own AI team.

## Why the D2C "returns" model doesn't transfer — and what does

In real estate the money isn't in resolving tickets, it's in **speed-to-lead**: a lead contacted within 5 minutes is many times more likely to convert than one contacted after 30. So this system inverts the usual human-in-the-loop order:

1. The agent responds **instantly** with a safe, warm acknowledgment (no facts, no commitments).
2. The *substantive* reply is drafted and queued for your approval.
3. You approve in batches — but the lead never experiences your batching as silence.

**The three inquiry streams this automates:**
- **New lead inquiries** (Zillow, Realtor.com, website form, IG DM, email)
- **Showing / viewing requests** ("Can I see 42 Oak St Saturday?")
- **Status inquiries** ("Is the house still available?" / "Where are we on the inspection?" — from active clients mid-transaction)

---

## 1. The Trigger

| Stream | Trigger event | Mechanism |
|---|---|---|
| Portal leads (Zillow, Realtor.com) | Lead notification email arrives in Gmail | Gmail filter (`from: zillow.com OR realtor.com`) applies label `AI-Lead-Queue` → label fires the Zap |
| Direct email inquiries | Email matching keywords (`showing, available, listing, offer, tour, interested`) | Gmail filter applies `AI-Support-Queue` → fires the Zap |
| Instagram / Facebook DMs | New DM on business profile | Manychat keyword automation (Meta-approved) |
| Website form | Form submission | Zapier native form trigger (Typeform/Jotform/Squarespace/Webflow all connect) |

**Master off-switch:** each Gmail filter and each Zap toggles independently from your phone. Pause a filter in the Gmail app → that stream stops instantly, the others keep running.

---

## 2. The Logic (Agent Decision Tree)

### Step 0 — Instant acknowledgment (sent WITHOUT approval, within 1 minute)
For any new-lead trigger, the agent immediately sends the speed-to-lead script (Section 5 variant A). This buys you hours of approval latency without losing the lead. Then it proceeds:

### Step 1 — Classify
```
Incoming inquiry
├─ NEW BUYER LEAD (asking about a listing, wants info/tour)
├─ NEW SELLER LEAD ("what's my home worth", "thinking of selling")
├─ SHOWING REQUEST (specific property + specific time intent)
├─ ACTIVE CLIENT STATUS ("where are we on…" — match sender to
│    your active-transaction list)
├─ VENDOR / RECRUITER / SPAM → label "Ignore-Review", no reply.
└─ UNCLEAR → FAILURE PROTOCOL (Section 5).
```

### Branch 1 — New buyer lead
```
1. Extract property address / MLS# from the inquiry.
2. Check listing status (your CRM or a listings sheet you maintain):
   ├─ ACTIVE → Draft: property highlights + 2–3 concrete tour slots
   │    pulled from your calendar + pre-qualification question
   │    ("Will you be financing or paying cash? Happy to connect
   │    you with a great lender either way.") → AI-Ready-Low.
   ├─ UNDER CONTRACT → Draft: "just went under contract" + offer
   │    2–3 comparable active listings → AI-Ready-Low.
   ├─ SOLD/OFF MARKET → Same comparable-listings draft → AI-Ready-Low.
   └─ NOT YOUR LISTING (portal lead on another agent's listing)
        → Draft: offer to show it anyway + buyer consult → AI-Ready-Low.
3. Lead mentions a price point ≥ your high-value threshold (e.g. $750k)
   OR mentions cash / 1031 exchange / buying multiple
        → AI-Review-High + immediate push alert. You may want to
          call this one personally within the hour.
```

### Branch 2 — New seller lead
```
ALWAYS → AI-Review-High. Never auto-quote value, never auto-send a CMA.
Agent drafts: warm reply + your scheduling link for a 15-min call +
one question ("What's prompting the move?"). You review and send.
Seller leads are your highest-value asset; the agent's job is only
to make sure they hear back fast (Step 0 ack) and to tee up the call.
```

### Branch 3 — Showing request
```
1. Agent checks your Google Calendar for conflicts.
   ├─ Requested slot free → Draft confirmation + calendar hold
   │    (tentative, not confirmed until you approve) → AI-Ready-Low.
   └─ Slot taken → Draft with 3 nearest alternatives → AI-Ready-Low.
2. Occupied listing (tenant/seller-occupied per your listing notes)
        → AI-Review-High (you coordinate access personally).
3. Same-day request → push alert + AI-Review-High (needs your
   real-time yes/no, not the 4pm batch).
```

### Branch 4 — Active client status inquiry
```
1. Match sender email to your active-transactions list (a simple
   Google Sheet: client / property / stage / next milestone / date).
2. Stage found → Draft a status update FROM THE SHEET ONLY — the
   agent never infers deal status → AI-Review-High (every time;
   transaction communications are too consequential to skim).
3. Sender not on the sheet, or sheet stage is stale (> 7 days old)
        → FAILURE PROTOCOL.
```

### Escalation overrides (checked on every message, all branches)
```
├─ Fair Housing risk: any question touching neighborhood demographics,
│    schools "quality", crime, "what kind of people live there",
│    religion/family-status steering
│      → Agent NEVER answers, not even a draft. Canned redirect only
│        (Section 5 variant C) + label "Compliance-Review".
├─ Legal/contract questions ("can I back out", earnest money disputes,
│    "my lawyer says") → NO auto-reply. Push alert. You respond.
├─ Angry or distressed tone → empathetic holding draft → AI-Review-High.
└─ Price negotiation or offer terms in any form → AI-Review-High.
     The agent never states, implies, or relays an offer position.
```

**Design principles:** the agent moves *logistics* freely (acknowledgments, scheduling options, listing facts you've pre-loaded). It never touches **valuation, negotiation, deal status it can't read from your sheet, or anything Fair-Housing-adjacent.**

---

## 3. The Human-in-the-Loop Point

Same single-checkpoint pattern, tuned for real estate's urgency tiers:

| Label | Contents | Your action |
|---|---|---|
| `AI-Ready-Low` | Tour-slot offers, comparable-listing suggestions, availability answers | Skim → Send. Batch at 9am / 1pm / 5pm. |
| `AI-Review-High` | Seller leads, transaction status updates, high-value buyers, occupied-showing coordination | Read fully, edit, send. Same batches. |
| **Push alert (real-time)** | Same-day showings, cash/high-value buyers, legal keywords | Interrupt-worthy. Respond within the hour. |
| `Compliance-Review` | Fair Housing–adjacent questions | Only the pre-approved redirect went out; you decide any follow-up. |
| `Needs-Founder` | Unclassifiable | You handle personally. |

Because Step 0 already acknowledged every lead instantly, your three daily batch windows are invisible to the customer — they got a reply in one minute and a substantive answer within a few hours. That's better than most fully-human agents deliver.

**Approval surface is Gmail drafts on the original thread** — the approve action *is* the send action, no separate app, nothing falls between tools.

---

## 4. Mobile-Friendly Implementation (No Laptop, No Code)

| Layer | Tool | Why | Phone control |
|---|---|---|---|
| Automation backbone | **Zapier** | Native Gmail, Google Calendar, Google Sheets, Manychat, Calendly connectors; per-Zap on/off toggles | Zapier mobile app |
| AI brain | **Claude via Zapier AI step** | Classification + drafting; you paste the Section 2 tree and your voice guide into the prompt once | Edit prompt in-app |
| Lead inbox | **Gmail app** | Portal leads already arrive here; labels = your dashboard | Native |
| Scheduling | **Calendly (or Google Calendar appointment slots)** | Showing slots become self-serve links; kills the back-and-forth entirely | Full mobile app |
| Source of truth for deals | **Google Sheet** ("Active Transactions": client, property, stage, next milestone, date) | The agent only ever reports what this sheet says — updating one row from your phone updates every status reply | Sheets mobile app |
| Listings status | Second tab on the same Sheet (address, status, occupied?, notes) | Same principle | Sheets app |
| Instagram/Facebook DMs | **Manychat** | Keyword auto-replies route "showing"/"available" DMs into the flow | Full mobile app |
| CRM (optional, later) | **Follow Up Boss** or **kvCORE** — both mobile-first, both Zapier-native | Add once volume justifies it; the Sheet is enough to start | Full mobile apps |

### The four Zaps (independently toggleable — your modularity)

1. **Zap 1 — Speed-to-lead ack:** New `AI-Lead-Queue` label → instant acknowledgment email + push notification to you. *Never turn this off.*
2. **Zap 2 — Buyer/showing drafts:** Same trigger → AI classify → lookup Sheet + Calendar → create labeled Gmail draft.
3. **Zap 3 — Client status drafts:** `AI-Support-Queue` label + sender matches Transactions sheet → draft from sheet data → `AI-Review-High`.
4. **Zap 4 — Escalation alarm:** legal/Fair-Housing/high-value keywords → push alert + hold. *Never turn this off.*

### Rollout order (build trust modularly)
Week 1: Zap 1 + 4 only (instant acks + alarms — zero risk, immediate speed-to-lead win).
Week 2: Zap 2 for buyer leads.
Week 3: Zap 3 once your Transactions sheet habit is solid.
Cost: Zapier Starter ~$20–30/mo, Calendly free tier, Manychat free tier, Sheets free. **Under $40/mo.**

---

## 5. Failure Protocols & Scripts

**Rule: never guess, never go silent, never touch compliance topics.**

### Variant A — Instant speed-to-lead acknowledgment (auto-sends, no approval)
> Hi {first name} — thanks for reaching out about {property address / "your search"}! I've got your message and I'm pulling the details together now. You'll hear back from me personally within a few hours (usually much sooner). If it's time-sensitive, reply "URGENT" and I'll jump on it right away.
>
> — {Your name}, {Brokerage}

*(A reply of "URGENT" is a keyword trigger for a push alert to you.)*

### Variant B — Unknown / unclassifiable situation (auto-sends, commits to nothing)
> Hi {first name} — thanks for your message. I want to make sure you get an accurate answer rather than a fast-but-wrong one, so I'm looking into this personally and will get back to you by {end of next business day}. If your question is about a specific property, replying with the address will help me move faster.
>
> — {Your name}

### Variant C — Fair Housing redirect (the ONLY thing the agent may say on these topics)
> That's the kind of question I'd encourage you to research directly so you get objective information — great starting points are {city/county open-data portal} and GreatSchools.org for school details. What I *can* do is tell you everything about the property itself and the transaction — happy to dig into any of that!

### Escalation ladder
1. **Unclassifiable** → Variant B + `Needs-Founder` label.
2. **Fair Housing–adjacent** → Variant C only + `Compliance-Review` label. No drafts, no improvisation.
3. **Legal/contract/offer content** → *no* auto-reply at all; immediate push alert. (An automated reply about contract terms is a liability, and in some states an unlicensed-practice problem.)
4. **Stale data** (Transactions sheet not updated in 7+ days for that deal) → agent refuses to send a status update, drafts nothing, alerts you: "Sheet stale for {client} — update row before I can reply."
5. **System failure** (Zap errors) → Zapier error email to you; inquiries sit in your inbox exactly as they did pre-automation. Failure mode = your old manual process, never a black hole.

---

## Weekly manager habit (15 minutes, from your phone)

Every Sunday: (1) update the Transactions sheet stages, (2) skim the week's `Needs-Founder` and `Compliance-Review` threads, (3) any recurring unclassifiable pattern becomes a new branch you add to the AI prompt. You're not answering inquiries anymore — you're managing the agent that does, and the 5-minute speed-to-lead response is now something you deliver 24/7 without holding your phone.
