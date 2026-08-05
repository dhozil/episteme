<p align="center">
  <img src="frontend/public/favicon.svg" width="72" height="72" alt="Episteme" />
</p>

<h1 align="center">Episteme</h1>

<p align="center">
  <em>The verification layer for AI decisions in an open and changing world.</em>
</p>

<p align="center">
  <strong>Ask · Investigate · Challenge · Verify · Use</strong>
</p>

<p align="center">
  <img alt="Consensus" src="https://img.shields.io/badge/consensus-MAJORITY__AGREE-2f8f5b" />
  <img alt="Accuracy" src="https://img.shields.io/badge/accuracy-8%2F8%20eval-2f8f5b" />
  <img alt="Tests" src="https://img.shields.io/badge/tests-31%20passing-2f8f5b" />
  <img alt="Chain" src="https://img.shields.io/badge/chain-GenLayer%20Studionet-243a5e" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-243a5e" />
</p>

---

## The thesis

> AI is becoming a decision-making layer for the internet. As AI agents become
> more autonomous, decisions become more consequential. As decisions become more
> consequential, **verification becomes essential**.

A single AI answer is useful — but usefulness is not verification. A model can
misunderstand a question, hallucinate, rely on stale sources, or overstate
confidence. And information changes: a fact that is true today can be false six
months from now.

So Episteme does not ask *"What does AI think?"* It asks:

> **"Can an AI-generated conclusion survive independent investigation and challenge?"**

That question changes the architecture. Instead of `user → AI → answer`, Episteme
produces a **verifiable decision** — evidence-backed, independently challenged,
consensus-verified, and versioned — that humans, applications, DAOs, protocols,
and autonomous agents can consume.

We are **not** building a feature. We are building an **infrastructure primitive**:
the verification layer for AI decisions.

---

## What we built

**Episteme** is a persistent on-chain verification network on GenLayer where
independent AI agents investigate real-world questions, collect evidence,
challenge one another, and reach consensus on a verifiable decision.

The core primitive:

```
QUESTION
    ↓
AI INVESTIGATION          → 5 agent roles, live web evidence
    ↓
CHALLENGE / CROSS-CHECK   → a skeptic hunts contradictions; anyone can dispute
    ↓
GENLAYER CONSENSUS        → independent validators re-run & must agree
    ↓
VERIFIABLE DECISION       → versioned, auditable, consumable, re-verifiable
```

Every decision is an **object**, not a sentence:

```json
{
  "verification_id": "VG-000042",
  "question": "Is the genlayer-py repository actively maintained?",
  "decision": "PASS",
  "confidence": 91,
  "status": "VERIFIED",
  "consensus": "CONSENSUS",
  "criteria": [ { "id": "c1", "result": "PASS", "reason": "..." } ],
  "sources": [ { "url": "...", "category": "PRIMARY", "authority": "HIGH" } ],
  "challenges": [ { "issue": "...", "severity": "MAJOR" } ],
  "revisions": [ { "version": 1, "decision": "PASS", "timestamp": "..." } ],
  "disputes": [ { "version": 2, "reason": "...", "timestamp": "..." } ],
  "expires_at": "2026-08-11T15:43:59+00:00"
}
```

A decision has provenance. It can be challenged, appealed, re-verified, and
referenced — not just displayed.

---

## How it works

### The pipeline

1. **Ask** — a user or application submits a question, a policy, and evidence URLs.
2. **Investigate** — five agent roles run inside the contract and read live web
   content: **Research**, **Source quality**, **Fact-check**, **Analyst**, **Skeptic**.
3. **Aggregate** — evidence is scored against the policy's criteria and rules
   (`min_sources`, primary-source requirement, allowed origins).
4. **Challenge** — the skeptic actively hunts for contradictions, weak sources,
   and manipulation; anyone can open a public dispute.
5. **Verify** — GenLayer validators independently re-run the investigation and
   must reach consensus before any state changes.
6. **Use** — a versioned, shareable record with full provenance.

### Consensus, the way GenLayer designed it

Episteme implements the **Equivalence Principle**: a leader proposes a result and
validators independently re-run the task and compare. Comparison is strict but
realistic:

- **Decision class** must agree (with tolerance between close states).
- **Confidence** must fall within a per-policy tolerance.
- **Criteria results** use direction tolerance — `UNKNOWN` is compatible with
  `PASS`/`FAIL`, but a `PASS ↔ FAIL` flip is never accepted.
- **Evidence counters** (sources fetched, primary-source presence) must be
  consistent.

All non-deterministic helpers live at **module level**, so no storage is ever
pickled inside a non-deterministic block — matching the GenLayer rule that
storage reads must not happen inside `leader_fn`/`validator_fn`.

The verdict is a genuine majority agreement of independent models, not one model
talking to itself.

---

## Built for the real world

One engine, many verticals — policies are **baked in at deploy time** (immutable),
so users pick a feature and go, with no two-step setup:

| Policy | What it verifies | Evidence sources |
|---|---|---|
| `grant-v1` | Open-source grant eligibility | GitHub, GitLab, docs |
| `dao-proposal-v1` | DAO treasury proposals | gov.uniswap.org, snapshot.org |
| `company-status-v1` | Is an organization still operating? | registries, official sites |
| `insurance-claim-v1` | Did the claimed event occur? | flight trackers (required) |
| `service-status-v1` | Is a service live and returning valid data? | live APIs |

Policies define their own **allowed origins** and **required origins**, so a
claim cannot be substantiated by evidence hosted on an arbitrary server.

---

## Robust by construction

A verification network earns trust from process, not marketing. Episteme is
designed so **no party — not even the deployer — can manipulate a result**:

- **No open policy registration.** Policies are immutable and seeded at deploy;
  updating a policy means deploying a new contract version. Nothing can be
  overwritten, and no one can impersonate a policy.
- **Owner-only re-verification.** An external caller cannot replace a record's
  evidence; only the record owner can refresh it, and every prior version's
  evidence is **preserved in revision history**.
- **Dispute modes.** `public` (anyone can dispute) and `parties` (only the record
  owner) — insurance uses `parties` so appeals are limited to authorized parties.
- **Evidence provenance.** Every criterion and challenge points to fetched
  sources with category, authority, and timestamps — not a summary.
- **Anti-fake-evidence.** `allowed_origins` / `required_origin` reject URLs outside
  approved domains, and `primary_source_required` forces authoritative sources.
- **Honest failure.** A decision may be `NEEDS_REVIEW` or `INSUFFICIENT_EVIDENCE`
  — the system would rather say *"we don't know"* than manufacture certainty.
- **Expiry.** Verifications are living objects: status surfaces `EXPIRED` past
  the policy's validity window, and `reverify` refreshes them.
- **Events.** `VerificationCreated`, `VerificationChallenged`, and
  `VerificationReverified` events are emitted on-chain for off-chain indexers.
- **Hard input limits.** Question, URL count and length, and dispute caps prevent
  storage and griefing attacks.

---

## Measured, not claimed

We test like the platform deserves:

- **31 direct-mode tests**, run 3× consecutively — including adversarial cases
  (duplicate register rejected, non-owner re-verify rejected, double dispute
  rejected, irrelevant evidence → `FAIL`, `allowed_origins` enforcement).
- **On-chain consensus probe:** every evaluated case reached **`MAJORITY_AGREE`**
  in round 1 with 4–5 validator votes.
- **Accuracy evaluation against ground truth (8/8):** positive cases → `PASS` /
  `NEEDS_REVIEW`; negative cases → `FAIL` / `INSUFFICIENT_EVIDENCE` — all with
  unanimous consensus.
- **`genvm-lint check`** passes; no forbidden patterns.

---

## Architecture

```
                        VERIFICATION CORE (GenLayer)
                       ┌─────────────────────────────┐
                       │  Intelligent Contract        │
                       │  - 5 agent investigation     │
                       │  - evidence aggregation      │
                       │  - Equivalence consensus     │
                       │  - immutable policies        │
                       │  - revision / dispute history│
                       └──────────────┬──────────────┘
                                      │
        ┌──────────────┬──────────────┼──────────────┬──────────────┐
        │              │              │              │              │
  ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐
  │   SDK      │  │  REST API │  │  Monitor  │  │ Frontend  │  │  dApps /  │
  │ (TS)       │  │ (Node)    │  │ (Node)    │  │ (React)   │  │  Agents   │
  └───────────┘  └───────────┘  └───────────┘  └───────────┘  └───────────┘
```

## Repository structure

```
contracts/verification_engine.py   # the Intelligent Contract (source of truth)
sdk/                               # TypeScript SDK (Verifier)
server/                            # REST API over the SDK
monitor/                           # continuous verification watcher
frontend/                          # Vite + React workspace (office-style UI)
tests/direct/                      # 31 direct-mode tests
scripts/                           # deploy + on-chain test probes
```

---

## Getting started

**Prerequisites:** Python 3.12+, Node 18+, a wallet (MetaMask/Rabby).

```bash
# Install JS workspaces
npm install

# Run the frontend (localhost:5173)
npm run dev --workspace @verify/frontend

# Run the REST API (localhost:8787)
npm run start --workspace @verify/server

# Run the continuous monitor
npm run start --workspace @verify/monitor

# Contract tests (in-memory, fast)
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt
.venv/Scripts/python -m pytest tests/direct -v
```

In the frontend, **connect your wallet** — writes (verify, challenge, re-verify)
require it; reads are open. Pick a policy, load a sample, and verify. Track the
transaction in the explorer directly from the decision record.

**Deploy the contract:**

```bash
genlayer deploy --contract contracts/verification_engine.py
```

Then set `VITE_CONTRACT_ADDRESS` (frontend), `SERVER_CONTRACT` (API), and
`MONITOR_CONTRACT` (monitor) to the deployed address.

---

## Security & trust model

- **No admin keys.** The deployer has no special power after deploy.
- **No open write surface beyond verification.** The only writes are
  `verify_with_policy`, `challenge`, and owner-gated `reverify`.
- **No silent rewriting.** Re-verification appends to revision history; disputes
  are append-only.
- **Prompt-injection aware.** Evidence is treated as data, validators are diverse
  (greyboxing), and source origins are constrained per policy.
- **XSS-safe frontend.** All on-chain data is escaped and normalized; production
  builds ship a strict Content-Security-Policy.

---

## Roadmap

- Event-driven indexing & webhooks (consume emitted events).
- Deeper accuracy benchmarking across more verticals.
- `allowed_origins` profiles for every high-stakes policy.
- Public verification registry & search.
- Economic design (fees, bonds, dispute staking) for mainnet.

---

## License

MIT — use it, fork it, ship it.

*"AI will make decisions. Episteme makes them verifiable."*
