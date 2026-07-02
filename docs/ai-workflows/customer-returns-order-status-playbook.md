# Human-in-the-Loop Playbook: Customer Returns & Order Status

**Role:** Operations design for a solo D2C founder who manages everything from a phone.
**Operating model:** AI agents draft and execute; you review and approve. You are the manager, not the worker.

> **Fill in your specifics** (this plan uses the bracketed defaults until you replace them):
>
> | Field | Your value |
> |---|---|
> | Business / niche | Luxury Pet Accessories |
> | Key platforms | Shopify, Gmail, Instagram |
> | Primary pain point | Customer support inquiries taking ~3 hrs/day |
> | Brand voice | Warm, professional, concise, empathetic |
> | Automated task | Customer Returns & Order Status |

---

## 1. The Trigger

Two entry points start the workflow. Both are passive — you never initiate anything.

**Trigger A — Inbound email (Gmail):**
A new email arrives in your support inbox (or an email matching a Gmail filter such as `subject contains: return, refund, order, where is, tracking, exchange`). The filter applies a label (e.g., `AI-Support-Queue`), and that label being applied is the trigger event for the automation platform.

**Trigger B — Instagram DM:**
A new DM arrives on your business Instagram account. (Handled natively by an inbox tool — see Section 4 — because Instagram's API restricts third-party automation more than email does.)

**Why label-based triggering matters:** it makes the system modular. Pause the Gmail filter → the whole email automation stops, without touching anything else. That's your master off-switch, controllable from the Gmail mobile app.

---

## 2. The Logic (Agent Decision Tree)

The agent's first job is always **classification**, then **data lookup**, then **draft**.

### Step 0 — Classify the inquiry
```
Incoming message
├─ ORDER STATUS ("where is my order", tracking, delivery)
├─ RETURN / EXCHANGE ("want to return", wrong size, refund)
├─ BOTH / UNCLEAR
└─ NOT SUPPORT (sales, wholesale, influencer pitch, spam)
     → Label "Needs-Founder" and stop. No auto-reply.
```

### Branch 1 — Order Status
```
1. Extract order number or match customer email to Shopify order.
   └─ No match found? → FAILURE PROTOCOL (Section 5).
2. Look up fulfillment status in Shopify:
   ├─ UNFULFILLED, < 3 business days old
   │    → Draft: warm confirmation + expected ship window.
   ├─ UNFULFILLED, ≥ 3 business days old
   │    → Flag "Possible fulfillment problem" → HUMAN REVIEW (always).
   ├─ FULFILLED, in transit
   │    → Draft: tracking link + carrier ETA.
   ├─ FULFILLED, delivered per carrier but customer says not received
   │    → Draft "delivery investigation" template → HUMAN REVIEW (always).
   └─ FULFILLED, stuck in transit > 7 days with no scan
        → Draft carrier-delay apology + offer to open a trace → HUMAN REVIEW.
```

### Branch 2 — Returns / Exchanges
```
1. Match customer to Shopify order and check order age.
2. Order age gate:
   ├─ ≤ 30 days since delivery → return window OPEN, continue.
   └─ > 30 days since delivery → do NOT auto-approve.
        ├─ Repeat customer (2+ lifetime orders) OR order value > $150
        │    → Draft a goodwill exception offer → HUMAN REVIEW (always).
        └─ Otherwise → Draft polite "outside window" reply offering
             store credit as a courtesy → HUMAN REVIEW.
3. Inside window — check reason:
   ├─ Wrong size / changed mind
   │    → Draft: exchange-first reply (free exchange before refund),
   │      include return instructions. AUTO-QUEUE for approval.
   ├─ Item damaged / defective
   │    → Ask for a photo if none attached (agent may send this
   │      request WITHOUT approval — it's a safe, information-
   │      gathering step). Once photo received:
   │      ├─ Order value ≤ $75 → draft replacement-or-refund offer.
   │      └─ Order value > $75 → HUMAN REVIEW (always).
   └─ "Not as described" / unhappy with quality
        → HUMAN REVIEW (always). These are brand-reputation moments.
4. Escalation overrides (checked on every message, any branch):
   ├─ Customer mentions chargeback, dispute, lawyer, "reporting you"
   │    → STOP all drafting → notify founder immediately (push alert).
   ├─ Sentiment is angry/distressed
   │    → Draft empathetic holding reply → HUMAN REVIEW (always).
   └─ Third+ message on same thread with no resolution
        → HUMAN REVIEW (always).
```

**Design principle:** the agent *never* moves money or approves exceptions on its own. It moves information (tracking links, return instructions, photo requests) freely, and drafts everything else.

---

## 3. The Human-in-the-Loop Point

**One checkpoint, one place, twice a day.** Every draft the agent produces lands as a **Gmail draft on the original thread**, labeled by risk tier:

| Label | Meaning | Your action |
|---|---|---|
| `AI-Ready-Low` | Routine (tracking info, in-window size exchange) | Skim → hit Send. ~10 sec each. |
| `AI-Review-High` | Money, exceptions, angry customers, >$75 damage claims | Read fully, edit if needed, then send. |
| `Needs-Founder` | Agent couldn't classify or hit failure protocol | You handle personally. |

**Your ritual:** open Gmail on your phone at, say, 9am and 4pm, tap the `AI-Ready-Low` label, fire off approved drafts in a batch, then give `AI-Review-High` real attention. Target: 3 hours/day → ~20 minutes/day.

**Why drafts instead of a separate approval app:** the approval action *is* the send action, in an app you already have, on the thread the customer will receive. Nothing to copy-paste, no context switching, no way for an approved-but-unsent reply to fall through a crack between two tools.

**Optional upgrade:** for `AI-Review-High` items, also send yourself a push notification (Zapier → Slack DM or SMS via the automation) so urgent items don't wait for the 4pm batch.

---

## 4. Mobile-Friendly Implementation (No Laptop, No Code)

### Recommended stack

| Layer | Tool | Why | Phone control |
|---|---|---|---|
| Automation backbone | **Zapier** | Best mobile app of the no-code platforms; native Gmail, Shopify, OpenAI/Claude connectors; each Zap has an on/off toggle | Toggle any Zap on/off from the Zapier mobile app |
| The AI brain | **Claude (via Zapier's AI step)** or Zapier Agents | Handles classification, Shopify-data-to-draft writing, and tone. You paste your brand voice + decision tree (Section 2) into the prompt once | Edit the prompt from the Zapier app |
| Store data | **Shopify mobile app** | Order lookup, fulfillment status, and refund/return approval are all first-class in the mobile app | Approve refunds/returns natively |
| Returns engine | **Shopify's native self-serve returns** (Settings → Customer accounts) or the **Loop Returns / AfterShip Returns** app for exchanges-first flows | Enforces the 30-day window and generates labels automatically, so many return requests never even reach the inbox | Approve/deny each return request from the Shopify app |
| Order-status deflection | **Shopify Inbox + order-status page**, or **AfterShip tracking page** | A branded "track your order" page linked in every confirmation email deflects 40–60% of WISMO ("where is my order") emails before they're written | Set-and-forget |
| Instagram DMs | **Manychat** (official Meta partner) | Auto-replies to DM keywords ("order", "return") with your tracking page / returns portal link; anything else goes to your unified inbox | Full mobile app |
| Approval surface | **Gmail app** (drafts + labels, per Section 3) | Already on your phone | Native |

### The three Zaps (each independently on/off — this is your modularity)

1. **Zap 1 — Order Status:** Trigger: Gmail label `AI-Support-Queue` applied → Find order in Shopify by customer email → AI step classifies + drafts per Branch 1 → Create Gmail draft on thread + apply `AI-Ready-Low` or `AI-Review-High` label.
2. **Zap 2 — Returns:** Same trigger, Branch 2 logic → draft + label. (Kept separate so you can turn returns automation off during sales/holiday exception periods without losing order-status coverage.)
3. **Zap 3 — Escalation alarm:** Trigger on chargeback/anger keywords → push notification to you + label `Needs-Founder`. This one you never turn off.

### Setup notes (all doable from a phone browser)
- Zapier's editor works in mobile Chrome/Safari; it's not luxurious but it's fully functional for building these once. After setup, day-to-day management happens in the Zapier mobile app.
- Start with **Zap 1 only** for a week. Add Zap 2 once you trust the drafts. Add self-serve returns last. Modular rollout = modular trust.
- Cost ballpark: Zapier Starter (~$20–30/mo), Manychat free tier, AfterShip Returns free tier, Shopify apps as needed. Under $50/mo total to reclaim ~2.5 hrs/day.

---

## 5. Failure Protocols

**Rule: the agent never guesses, and never goes silent.** When it can't confidently proceed, it does two things: (1) sends a safe holding reply so the customer isn't hanging, (2) labels the thread `Needs-Founder` and stops.

### Situations that trigger the protocol
- No matching order found in Shopify (typo'd order number, different email, guest checkout).
- Message doesn't fit any branch (wholesale inquiry, product question, multi-issue message).
- Classification confidence is low (instruct the AI step: *"If you are less than ~90% sure which category this is, do not draft a resolution — use the fallback script."*).
- Any Shopify or Zapier step errors out.
- Customer replies something the decision tree doesn't cover.

### The fallback script (agent may send this one WITHOUT approval — it commits you to nothing)

> Hi {first name},
>
> Thanks so much for reaching out — I want to make sure you get exactly the right answer, so I've flagged your message for {your name}, our founder, to look at personally. You'll hear back within one business day.
>
> In the meantime, if your question is about an order, replying with your order number (it starts with #) will help us resolve this even faster.
>
> Warmly,
> {Business name} Support

Two things this script does deliberately: it sets a concrete expectation (**one business day** — adjust to what you can actually honor), and it asks for the one piece of data (order number) that most often unblocks the agent, so by the time you open the thread it may be auto-resolvable again.

### Escalation ladder
1. **Unknown situation** → fallback script + `Needs-Founder` label.
2. **Legal/chargeback keywords** → NO reply sent at all; immediate push alert to you. (An auto-reply to a legal threat is a liability.)
3. **System failure** (Zap errors) → Zapier's built-in error notification emails you; the customer's email simply sits unlabeled in the inbox exactly as it would have pre-automation. Failure mode = the old manual process, never a black hole.

---

## Weekly manager habit (15 minutes, from your phone)

Once a week, skim the threads the agent handled and ask: which `Needs-Founder` items keep recurring? Each recurring one is a new branch to add to the decision tree in the AI prompt. The system gets smarter because *you* manage it — that's the leverage: you're not answering tickets, you're training your team of one agent.
