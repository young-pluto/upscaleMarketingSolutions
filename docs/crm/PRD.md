# CRM — Product Requirements Document

> Internal, mobile-first **decision layer** for managing hundreds of Instagram clients for a one-person agency.
> Route: `upscalemarketingsolutions.com/crm`. Status: **design — not yet approved for build.**

---

## 0. Reality check & challenges to the brief

Before the design, three corrections where the brief and the actual codebase disagree. These matter because they change the whole build.

**0.1 Tech stack — do NOT introduce Next.js/React/Tailwind/TS.**
The entire existing app is vanilla **HTML + CSS + ES modules**, deployed on Vercel with tiny serverless functions in `api/`, plus a local Express server (`server.js`). The `lead-outreach` module is a clean, modern example of this pattern working well. Introducing a React/Next build for one more screen means two toolchains, two mental models, and a build step, for a one-person shop. **Recommendation: build `/crm` in the exact same stack** — one `public/crm.html`, one `public/js/crm.js` (class-based, like `LeadOutreachBoard`), one `public/css/crm.css` reusing the existing token set, one serverless endpoint `api/crm-admin.js`. This is faster to ship and trivial to maintain. React can come later only if the UI genuinely outgrows vanilla (it won't at this scale).

**0.2 Database — it's Realtime Database, not Firestore.**
The brief asks for a "Firestore schema." The live database is **Firebase Realtime Database (RTDB)**. The README's Firestore mention is a known documentation bug (see `docs/integrations/firebase.md`). Section 4 gives the RTDB schema as the real deliverable, with a Firestore mapping noted for a possible future migration. **Recommendation: stay on RTDB for Phase 1.**

**0.3 At this scale, "powerful filtering/sorting" argues _against_ server queries, not for them.**
Hundreds — even a few thousand — clients is a small dataset. The fastest possible UX is: **load the whole client list once into memory, then filter/sort/search client-side.** Every filter is instant, every sort is instant, fuzzy search is instant, and there are zero Firestore composite indexes to maintain. This is already the proven pattern in `lead-outreach` (`limitToLast(500)` → render). Server-side querying (the usual reason to prefer Firestore) only becomes worthwhile past ~5,000 clients or when you need true pagination. We are nowhere near that. This single decision is why RTDB + in-memory beats Firestore here.

---

## 1. Product philosophy

Instagram is the **communication layer**. This app is the **decision layer**. It exists to answer one question faster than Instagram ever could: **"Who is this person, and what should I do about them right now?"**

Design principles, in priority order:

1. **Remembering > everything.** The product's job is memory, not messaging. The `Remember` line and Highlights are the heart of the app.
2. **2-second comprehension.** Opening the app or a client must surface context in one glance — no reading, no scrolling to understand.
3. **One-tap mutation.** The common state changes (contacted, checked, follow-up done, status) are single taps with optimistic UI. Editing is rare; tapping is constant.
4. **Density without clutter.** The list is used 90% of the time and must be dense, but every pixel must earn its place. Colour is used only when it changes a decision.
5. **One thumb, one hand.** Everything reachable and tappable at the bottom of a phone screen.
6. **Not a CRM.** No pipelines-for-pipelines'-sake, no hundred fields, no forms. If a field doesn't help decide "should I open this DM," it doesn't exist in Phase 1.

**What this is not:** HubSpot/Salesforce/Zoho. No deals module, no email sequences, no lead scoring dashboards, no reports. Those add cognitive load, which is the exact problem we're solving.

---

## 2. User workflow

The canonical loop the whole UI is optimised for:

```
Open app
  → Today screen shows what needs action (or open Clients)
  → Find the right client (view chips / search — instant)
  → Understand in 2s (status pill + Highlights + Remember line + last-contacted)
  → Tap "Open Instagram" (deep link to profile)
  → Send DM in Instagram
  → Return to app
  → One tap: "Mark Contacted" (+ optionally change status / set follow-up)
  → Done
```

Secondary loops: **triage** (new lead → set status/tags/remember), **revive** (browse Dormant/Reconnect → pick → contact), **plan** (Today → clear overdue follow-ups).

The design target: the full "open → understand → act → update" loop takes **under 15 seconds and 3 taps**.

---

## 3. Information architecture

**Navigation = 3 bottom tabs + one floating Add button.** (Not folders — a client belongs to many buckets at once, so folders are the wrong model. Buckets are expressed as *views/filters*, section 6.)

| Tab | Purpose |
|---|---|
| **Today** | The action queue. Overdue follow-ups, due today, missed promises, urgent flags. Answers "what must I do now." This is the home screen. |
| **Clients** | The full list — the 90% screen. Persistent search bar, view chips, filter/sort. |
| **Settings** | Tags manager, canned messages, account. Rarely visited. |
| **+ (FAB)** | Quick-add a client from anywhere. |

Why `Today` is the default tab, not `Clients`: the brief's core pain is *remembering what needs doing*. Opening straight into a prioritised action list delivers the product's promise before the user does anything. Clients is one tap away.

Within **Clients**, buckets are horizontal **view chips** (saved filters), never separate pages — so switching is instant and state (scroll, search) is preserved.

---

## 4. Data model (RTDB) + Firestore mapping

Namespaced under `crm/`, mirroring the `leadOutreach/` convention. Auth + writes go through `api/crm-admin.js` (same Bearer-ID-token pattern as `api/lead-outreach-admin.js`).

### 4.1 `crm/clients/{clientId}`
```jsonc
{
  "instagramUsername": "creatorname",       // display, original case
  "instagramUsernameKey": "creatorname",    // lowercased, for dedup/search
  "instagramUrl": "https://instagram.com/creatorname",
  "displayName": "Creator Name",            // optional

  "status": "warm",                          // enum, section 5
  "remember": "Reach out after July upload.",// the ONE-LINER, always visible

  "tags": {                                  // map: tagId -> { visible }
    "tag_bought": { "visible": true },
    "tag_music":  { "visible": false }
  },

  "notes": "",                               // optional longer freeform (detail only)

  "followUpAt": 1752710400000,               // next-action date (ms) or null
  "followUpNote": "check after upload",      // optional
  "urgent": false,                           // manual priority flag

  "lastContactedAt": 1750000000000,          // ms or null
  "lastCheckedAt":   1750500000000,          // "I looked at their profile" (no DM)
  "createdAt": 1749000000000,
  "updatedAt": 1750500000000,

  "revenue": 0,                              // optional
  "orderCount": 0,                           // optional

  "source": "manual",                        // manual | lead-outreach (Phase 2 bridge)
  "sourceLeadKey": null,
  "createdBy": "you@email", "updatedBy": "you@email"
}
```

### 4.2 `crm/clients/{clientId}/timeline/{eventId}`
Loaded **lazily** only when a client detail opens — never in the list load.
```jsonc
{ "type": "contacted", "note": "", "at": 1750000000000, "by": "you@email" }
// type ∈ status_change | contacted | checked | note | reminder_set |
//        reminder_done | order | created | archived
```

### 4.3 `crm/tags/{tagId}` — global tag registry
```jsonc
{ "name": "Bought x3", "createdAt": 1749000000000 }
```
Why a registry (not just strings on the client): lets you **rename** a tag everywhere at once, powers a consistent filter-chip list, and prevents typo-duplicates ("VIP" vs "vip"). Clients reference `tagId`s.

### 4.4 `crm/clientInstagramIndex/{base64url(usernameKey)}` → `{ clientId }`
Dedup guard so you can't add the same handle twice. Directly mirrors `leadOutreach/leadInstagramIndex`.

### 4.5 Firestore mapping (future, if ever needed)
`crm/clients/*` → `clients` collection (1 doc/client, timeline as a subcollection); `crm/tags/*` → `tags` collection. Composite indexes would then be needed on `(status, followUpAt)`, `(status, lastContactedAt)`, `(revenue)`. **Not built in Phase 1** — in-memory sort/filter needs none of them.

---

## 5. Status system (challenged & redesigned)

The brief's list (Lead, Warm, Active Client, Trial, Waiting, Follow-up Scheduled, Inactive, Stale, Dead, Archived) has two problems:

- **"Follow-up Scheduled" is not a status** — it's a scheduling attribute. An *Active Client* can also have a follow-up scheduled. Baking a date-concept into a mutually-exclusive enum is a category error → **removed**, handled by `followUpAt` + the red dot (section 12).
- **Inactive / Stale / Dead / Waiting are four near-synonyms** for "not doing anything right now," which causes tap-time paralysis → **collapsed**.

**Proposed status set (7 active + Archived).** Each maps to *one clear decision*:

| Status | Meaning | Your next decision | Colour (§12) |
|---|---|---|---|
| **Lead** | New, unqualified, barely engaged | Qualify | slate |
| **Warm** | Engaged / interested, hasn't paid | Nurture & close | text-2 (neutral) |
| **Trial** | Running a first/small paid test | Deliver + upsell | amber |
| **Client** | Active paying relationship | Maintain & deliver | green |
| **Waiting** | Ball is in *their* court, expected (payment, upload) | Wait, then nudge on date | slate + follow-up |
| **Dormant** | Lost momentum, worth reviving | Re-engage later | text-3 (dim) |
| **Dead** | Not worth pursuing | Ignore | text-3 (dim) |
| **Archived** | Hidden from all default views | None | — |

Notes:
- **"Repeat buyer" is deliberately NOT a status** — it's a Highlight/tag derived from `orderCount`. A repeat buyer who's currently idle is still a `Client` or `Dormant`; temperature and purchase-history are different axes and shouldn't collapse into one enum.
- Status is **temperature of the relationship right now**. Everything else (bought x3, upcoming upload, high budget) is a **tag/Highlight**.

---

## 6. Categories / buckets (as saved views, not folders)

Expressed as **view chips** in the Clients tab. Each is a preset filter over the in-memory list:

| View | Definition | Why it exists |
|---|---|---|
| **Needs Action** | red-dot set (overdue / due today / missed / urgent) | The "do this now" bucket — mirrors Today, but browsable |
| **Hot** | status Warm or Trial | Closest to converting/upselling |
| **Clients** | status Client | Your active book of business |
| **Reconnect** | status Dormant, OR any client `lastContactedAt > 45d` | "Old clients worth reconnecting with" — the brief's key revenue bucket |
| **New** | `createdAt < 7d` | Freshly added, needs triage |
| **Repeat** | `orderCount ≥ 2` | Highest-LTV relationships |
| **All** | everything except Archived | Default |

Why views over folders: a single client is simultaneously "a Client," "repeat," and "needs action." Folders force a false single home; views let the same client appear wherever it's relevant, with zero data duplication.

---

## 7. Tags

- **Unlimited, user-created**, stored in the global registry (§4.3). No hardcoded tags shipped — but a small **starter set** is offered on first run (Bought, Upcoming Upload, Stopped Uploading, High Budget, VIP, Needs Editor, Interested), each deletable.
- Adding a tag to a client is a one-tap toggle from a searchable tag sheet; creating a new tag happens inline in that same sheet ("+ Create 'high budget'").
- Every tag carries a per-client **`visible`** flag → that's what promotes it to a Highlight (§8).

---

## 8. Highlights

The single most important memory feature after `Remember`.

- A Highlight = a tag marked **visible** on a given client. Only Highlights render on the client card.
- **Hard cap: 3 visible per client.** (Brief said 2–4; 3 is the sweet spot for a 2-line row — enough to characterise, few enough to stay scannable. Attempting a 4th prompts you to unpin one.)
- Purpose: instant recognition — *"Bought x4 · Stopped Uploading · High Budget"* tells you who this is before you read anything.
- Toggling visible/hidden is one tap in the detail sheet; the card updates optimistically.

---

## 9. `Remember` field

One concise sentence for your future self. **Not** an activity log (the timeline is that).

- Always visible at the **top of the client detail**, and shown **truncated on the card** when set (with a 📌 glyph) — because a good Remember line ("Only replies at night", "Waiting for sponsor payment") is often more useful than any tag.
- Single-line, edited inline (tap → edit → blur to save, optimistic).
- If both Highlights and a Remember line exist, the card shows Highlights on one line and the Remember snippet on the next; density stays at 2 content lines.

---

## 10. Filters

All client-side over the in-memory set, all **combinable** (AND across categories, OR within a category):

- **Status** (multi-select chips)
- **Tags / Highlights** (multi-select)
- **Needs follow-up** (`followUpAt` set) · **Overdue** (`followUpAt < today`)
- **Created recently** (7/30d)
- **Reconnect** (dormant or `lastContactedAt > 45d`)
- **Repeat buyers** (`orderCount ≥ 2`) · **Revenue** (has revenue / ranges)
- **Has Remember note**
- *(Phase 2)* Instagram account used to contact

A filter bar shows active filters as removable chips; "Clear" resets. Combining is the point — "Warm + High Budget + not contacted in 30d" is a single, instant query.

---

## 11. Sorting

First-class, one-tap from a sort sheet. Brief's list plus additions:

- **Needs action first** *(new — default)*: red-dot clients on top, then by follow-up date
- **Follow-up soonest** *(new)*
- Longest since contact · Recently contacted
- Newest added · Oldest added
- Recently updated · Recently checked
- Highest revenue · Most orders
- Alphabetical

Default = **Needs action first**, because it aligns the list with the product's core question without any user effort.

---

## 12. Colour system

Constraint honoured: **black-and-red identity, no blue accents** — using the tokens already in `public/css/admin.css` (`--bg:#0f0f10`, `--accent:#ff3b30`). The `--blue` token exists in the sheet but is **deliberately unused** here. Colour appears only when it changes a decision.

**Urgency dot (the "red dot system"):**

| Dot | Trigger | Meaning |
|---|---|---|
| 🔴 **Red** `--accent #ff3b30` | follow-up overdue, due today, missed promised date, or `urgent` flag | **Act now** |
| 🟡 **Amber** `--amber` | follow-up due within 2–3 days | Coming up |
| 🟢 **Green** `--green` | active paying `Client` in good standing | Money — reassurance, used sparingly |
| ⚪ **Grey/none** `--slate`/none | neutral, nothing pending | No action |

Rules: **most rows show no dot.** Red is reserved strictly for action-now — if everything is red, nothing is. Green is a quiet marker on Client rows only, not a loud badge. No blue anywhere. Status pills use muted tinted backgrounds (`*-soft` tokens), never fully saturated fills, to keep the list calm.

---

## 13. Client row UX

Fixed ~64px, two content lines, one thumb-width tap target:

```
┌───────────────────────────────────────────────┐
│ 🔴  @creatorname            [Warm]         5d  │
│     Bought x3 · High Budget · 📌 replies@night │
└───────────────────────────────────────────────┘
```
- **Leading:** urgency dot (only when it means something).
- **Line 1:** `@username` (bold) · status pill (muted) · relative last-contacted, right-aligned ("5d", "3w", "—").
- **Line 2:** up to 3 Highlight chips; if a Remember note exists it appears here (📌, truncated). Highlights take precedence; overflow truncates gracefully.
- **Whole row tap → detail bottom sheet** (list scroll position preserved).
- **Optional gestures (progressive enhancement):** swipe-right → Open Instagram; swipe-left → quick status change. Baseline works without them.

Challenge to brief: brief listed a chevron. A chevron wastes ~24px of horizontal space on every row for zero information — the whole row is obviously tappable. **Dropped in favour of the last-contacted timestamp**, which actually helps the "should I open this DM" decision.

---

## 14. Client detail UX

**Bottom sheet** (not a route change) so the list stays put — matches iOS `Things`/`Apple Reminders` and the existing `lead-outreach` sheet pattern. Drag-down or backdrop-tap to dismiss.

Order, top to bottom (most-decision-relevant first):
1. **Header:** `@username` + display name · status pill (**tap → status picker**, no full edit needed).
2. **Primary action:** big **Open Instagram** button (deep link) + inline **Copy username** / **Copy link**.
3. **Remember** line — prominent, editable inline.
4. **Highlights / Tags** — visible ones first (tap to unpin), "+ tag" to add/toggle.
5. **Quick facts row:** last contacted · last checked · follow-up date · created · revenue/orders (if set).
6. **Quick actions** (§15).
7. **Timeline** — lazy-loaded reverse-chronological activity (auto events + manual notes). Collapsed by default; expand on demand.
8. **Edit** (full form) and **Archive** at the bottom — the rare actions live furthest away.

---

## 15. Quick actions

One tap each, optimistic, each writes a timeline event:

- **Mark Contacted** → `lastContactedAt = now`
- **Mark Checked** → `lastCheckedAt = now` ("I looked at their profile, no DM")
- **Change Status** → picker
- **Set / Snooze Follow-up** → Today · Tomorrow · +1w · pick date; snooze presets on existing ones
- **Complete Follow-up** → clears `followUpAt`, logs done
- **Add Tag** · **Toggle Highlight**
- **Flag Urgent** (forces red dot) / **Unflag**
- **Add Note** (timeline) · **Log Order / Revenue** *(if money tracking on)*
- **Open Instagram** · **Copy username / link**
- **Archive**

Suggested additions beyond the brief: **Snooze follow-up**, **Flag Urgent**, **Mark Checked** (distinct from Contacted — huge for "I keep looking but haven't messaged"), and **Log Order** as a lightweight revenue capture.

---

## 16. Navigation

- **Bottom tab bar:** Today · Clients · Settings, with a centered **+** FAB (reuses `--tabbar-h`, safe-area aware — note commit `2a8199e` already fixed Safari URL-bar overlap; reuse that fix).
- **Clients** owns: persistent search bar (sticky top) → view chips → active-filter bar → the list.
- **Detail, status picker, tag sheet, filter/sort, add-client** are all **bottom sheets/overlays** — the list never unmounts, so returning from Instagram lands you exactly where you were.
- Back = dismiss sheet. No deep navigation stacks.

---

## 17. Mobile UX principles

- **One-hand, bottom-heavy:** primary actions and nav sit in the lower third; sheets rise from the bottom.
- **Thumb targets ≥ 44px;** row height comfortable, chips tappable.
- **Optimistic everything:** UI updates instantly; the network write reconciles/rolls back on failure with a toast (existing `showToast` pattern).
- **Subtle motion:** sheet spring-in, chip press states, dot fades. Nothing decorative.
- **Offline-tolerant:** RTDB SDK offline persistence + last-known cache so the app opens and reads even on a flaky connection; writes queue.
- **Instant feel:** no spinners on navigation — data is already in memory. A loader appears only on the very first cold load.
- **Reachable dark UI:** the existing `#0f0f10` dark theme is the default and only theme (matches Instagram context, easy on eyes at night).

---

## 18. Performance strategy

- **Load-all-once, operate-in-memory** (§0.3). One realtime subscription to `crm/clients` (via RTDB `.on('value')`) → true realtime sync + offline cache, upgrading on the `lead-outreach` 20s-poll pattern.
- **Timeline is lazy** — never part of the list payload; fetched per client on detail open.
- **Filter/sort/search run on the in-memory array** → sub-millisecond, no indexes.
- **Fuzzy search** is a tiny hand-rolled scorer (subsequence + field weighting over username, displayName, remember, tags, notes) — no library, no bundle cost.
- **Virtualise only if needed:** rendering a few hundred lightweight rows is fine; add simple windowing only past ~800 visible rows.
- **Optimistic writes** via the single `api/crm-admin.js` PATCH endpoint; server stamps `updatedAt`/`updatedBy`.
- **Minimal reads:** one subscription for the whole session; per-client timeline reads only on demand.

---

## 19. Phase 1 MVP

Ship this, nothing more:

- [ ] `public/crm.html`, `public/js/crm.js`, `public/css/crm.css`; `api/crm-admin.js`; `/crm` rewrite in `vercel.json`; Firebase-Auth gate (reuse existing).
- [ ] Manual **add client** (username/url/display) with dedup index.
- [ ] **Clients list** — dense rows, urgency dot, status pill, Highlights, last-contacted, Remember snippet.
- [ ] **Detail bottom sheet** — Remember, tags/Highlights, quick facts, timeline, actions.
- [ ] **Status system** (§5), **tags + Highlights** (cap 3), **global tag registry**.
- [ ] **Follow-up** (single `followUpAt` + note) and **red-dot logic** (§12).
- [ ] **Quick actions** (§15): contacted, checked, status, follow-up set/complete/snooze, tag, urgent, note, archive, open IG, copy.
- [ ] **Filters + sort + fuzzy search** (in-memory).
- [ ] **Today** dashboard: overdue / due today / due soon / urgent / recently added.
- [ ] Optimistic writes, realtime subscription, offline cache, toasts.

Explicitly **out** of Phase 1: orders/revenue module (a single optional number field only), multi-account, WhatsApp/email, AI, team, Instagram API, reports/graphs.

---

## 20. Phase 2 roadmap

Designed-for but not built now (no Phase 1 architecture depends on these):

1. **lead-outreach → CRM bridge:** a "converted" lead graduates into `crm/clients` with `source: "lead-outreach"` + `sourceLeadKey`. Unifies the acquisition → relationship funnel.
2. **Orders & revenue module:** real order records, LTV, repeat-buyer analytics — feeding the Repeat view and revenue sort.
3. **Multiple Instagram accounts:** track which account contacted whom (`contactedFromAccountId`); filter by it.
4. **WhatsApp / Email** as additional communication channels + deep links.
5. **AI summaries:** condense a client's timeline into an updated Remember suggestion.
6. **Team members:** per-user assignment, `createdBy`/`updatedBy` already captured.
7. **Instagram API:** auto profile pics, follower counts, last-post date → could auto-flag "Upcoming Upload"/"Stopped Uploading" Highlights. Kept strictly optional; nothing in Phase 1 assumes it.
8. **Firestore migration:** only if client count crosses ~5k or true server pagination is needed (§4.5).

---

### Open questions for approval
1. Status set (§5) — approve the 7+Archived, or keep/rename any of the collapsed ones (Waiting? Dormant vs Dead)?
2. Confirm stack decision (§0.1) — vanilla JS + RTDB, matching the existing app? (Strong recommendation: yes.)
3. Money in Phase 1 — a single optional `revenue`/`orderCount` field per client, or defer entirely to Phase 2?
4. Default landing tab — `Today`, or straight into `Clients`?
