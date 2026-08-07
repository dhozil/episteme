import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Verifier,
  isExecutionSuccess,
  executionError,
  txReturnValue,
  POLICY_TEMPLATES,
} from "@verify/sdk";
import type {
  VerificationRecord,
  Challenge,
  Criterion,
  Dispute,
  PolicyTemplate,
  Policy,
  SourceAssessment,
} from "@verify/sdk";
import { accountAddress, connectWallet, disconnectWallet, getVerificationTx, getVerifier, saveVerificationTx, trySilentConnect, walletAvailable } from "./verifier";

type Flow = "idle" | "submitting" | "pending" | "done" | "error";

const MAX_QUESTION = 1000;
const MAX_URLS = 4;
const MAX_URL_LEN = 300;

const DECISION_COLORS: Record<string, string> = {
  PASS: "#2f8f5b",
  FAIL: "#c0443c",
  NEEDS_REVIEW: "#b98a2f",
  INSUFFICIENT_EVIDENCE: "#8a8f98",
};

const STAGES = [
  { key: "research", label: "Research" },
  { key: "sources", label: "Source assessment" },
  { key: "factcheck", label: "Fact-check" },
  { key: "analyst", label: "Analyst" },
  { key: "skeptic", label: "Skeptic challenge" },
  { key: "consensus", label: "GenLayer consensus" },
];

const CATEGORY_EXPLAIN: Record<string, string> = {
  PRIMARY: "Official documents, APIs, source repositories",
  SECONDARY: "Reputable reporting, independent analysis",
  TERTIARY: "Aggregators and derivative information",
  UNVERIFIED: "Social posts, anonymous claims",
};

function isValidHttpUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Render arbitrary on-chain data as a safe string (never crashes on objects). */
function toDisplay(x: unknown): string {
  if (typeof x === "string") return x;
  if (x === null || x === undefined) return "—";
  if (typeof x === "object") {
    const o = x as Record<string, unknown>;
    return String(o.claim ?? o.text ?? o.issue ?? o.description ?? JSON.stringify(x));
  }
  return String(x);
}

/** Coerce a raw contract record into a safe, well-shaped object. */
function normalizeRecord(r: any): VerificationRecord {
  return {
    verification_id: toDisplay(r.verification_id),
    owner: toDisplay(r.owner),
    question: toDisplay(r.question),
    policy_id: toDisplay(r.policy_id),
    decision: toDisplay(r.decision) as VerificationRecord["decision"],
    status: toDisplay(r.status) as VerificationRecord["status"],
    consensus: toDisplay(r.consensus),
    confidence: Number(r.confidence) || 0,
    created_at: toDisplay(r.created_at),
    expires_at: toDisplay(r.expires_at),
    version: Number(r.version) || 0,
    criteria: Array.isArray(r.criteria) ? r.criteria : [],
    sources: Array.isArray(r.sources) ? r.sources : [],
    challenges: Array.isArray(r.challenges) ? r.challenges : [],
    disputes: Array.isArray(r.disputes) ? r.disputes : [],
    revisions: Array.isArray(r.revisions) ? r.revisions : [],
    evidence:
      r.evidence && typeof r.evidence === "object"
        ? {
            summary: {
              sources_fetched: Number(r.evidence.summary?.sources_fetched) || 0,
              sources_ok: Number(r.evidence.summary?.sources_ok) || 0,
              primary_source: Boolean(r.evidence.summary?.primary_source),
              rules_satisfied: Boolean(r.evidence.summary?.rules_satisfied),
              min_sources: Number(r.evidence.summary?.min_sources) || 0,
            },
            fact_check: r.evidence.fact_check ?? {
              corroborated: [],
              contradictions: [],
              unverified: [],
            },
          }
        : {
            summary: {
              sources_fetched: 0,
              sources_ok: 0,
              primary_source: false,
              rules_satisfied: false,
              min_sources: 0,
            },
            fact_check: { corroborated: [], contradictions: [], unverified: [] },
          },
    reasoning_summary: toDisplay(r.reasoning_summary),
  };
}

function fmtTime(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function useHash(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

function Icon({ d, size = 15 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

/** 3D glassy brand icon: guard (shield) + search (lens). */
function BrandIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="g-shield" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="#edf0f5" />
          <stop offset="1" stopColor="#cbd4e0" />
        </linearGradient>
        <linearGradient id="g-lens" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b98a2f" />
          <stop offset="1" stopColor="#8a6a20" />
        </linearGradient>
        <radialGradient id="g-gloss" cx="0.35" cy="0.2" r="0.95">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.12" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path
        d="M32 6 L50 16 V30 C50 44 42 50 32 54 C22 50 14 44 14 30 V16 Z"
        fill="url(#g-shield)"
      />
      <path
        d="M32 6 L50 16 V30 C50 44 42 50 32 54 C22 50 14 44 14 30 V16 Z"
        fill="url(#g-gloss)"
      />
      <path
        d="M32 6 L50 16 V30 C50 44 42 50 32 54 C22 50 14 44 14 30 V16 Z"
        fill="none"
        stroke="rgba(255,255,255,0.55)"
        strokeWidth="2"
      />
      <circle cx="32" cy="34" r="10.5" fill="url(#g-lens)" stroke="rgba(6,78,74,0.5)" strokeWidth="2" />
      <circle cx="28.2" cy="30.2" r="2.8" fill="#ffffff" opacity="0.95" />
      <path d="M40 42l8.5 8.5" stroke="#8a6a20" strokeWidth="6.5" strokeLinecap="round" />
      <path d="M40 42l8.5 8.5" stroke="rgba(255,255,255,0.55)" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

const ICON_SHIELD = "M12 2l8 4v6c0 5.5-3.4 9.2-8 11-4.6-1.8-8-5.5-8-11V6l8-4z";
const ICON_SEARCH = "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm10 2l-4.35-4.35";
const ICON_LIST = "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01";
const ICON_SPARK = "M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1";
const ICON_SCALE = "M12 3v18M5 21h14M8 3h8v4a4 4 0 0 1-8 0V3zM5.5 11c0 2-2 3-2 3s-2-1-2-3M20.5 11c0 2-2 3-2 3s-2-1-2-3";
const ICON_QUESTION = "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z";
const ICON_LENS = "M21 21l-4.35-4.35M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z";
const ICON_CHECK = "M20 6L9 17l-5-5";
const ICON_LAYERS = "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5";

const HOW_STEPS = [
  { icon: ICON_QUESTION, title: "Ask", text: "Submit a question, pick a policy, and attach evidence URLs." },
  { icon: ICON_LENS, title: "Investigate", text: "Five agent roles research sources: Research, Source quality, Fact-check, Analyst, Skeptic." },
  { icon: ICON_SHIELD, title: "Challenge", text: "The skeptic hunts for contradictions — and anyone can open a public dispute." },
  { icon: ICON_CHECK, title: "Verify", text: "Independent validators re-run the investigation and reach consensus on-chain." },
  { icon: ICON_LAYERS, title: "Use", text: "A versioned, shareable record with full provenance — for apps, DAOs, and agents." },
];

const GUIDE_STEPS = [
  <>Pick a <strong>policy</strong> from the catalog — grant, DAO, company status, or insurance.</>,
  <>Load a sample question or write your own.</>,
  <>Add <strong>evidence URLs</strong> — official pages, APIs, registries.</>,
  <>Click <strong>Verify</strong> and watch the investigation run on-chain.</>,
  <>Read the <strong>record</strong> — criteria, evidence explorer, skeptic challenges.</>,
  <>Challenge or <strong>re-verify</strong> anytime; share the permanent link.</>,
];

function routeOf(hash: string): string {
  const h = hash.replace(/^#/, "");
  if (h.startsWith("/verification/") || h === "/workspace") return "workspace";
  if (h === "/how") return "how";
  if (h === "/guide") return "guide";
  return "landing";
}

function StatusBadge({ status }: { status: unknown }) {
  return (
    <span className={`badge badge-${toDisplay(status).toLowerCase()}`}>
      {toDisplay(status)}
    </span>
  );
}

function ScoreRing({ value, color }: { value: unknown; color: string }) {
  const n = Number(value) || 0;
  const r = 26;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, n)) / 100);
  return (
    <svg width="76" height="76" viewBox="0 0 76 76">
      <circle cx="38" cy="38" r={r} fill="none" stroke="var(--border)" strokeWidth="7" />
      <circle
        cx="38"
        cy="38"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={off}
        transform="rotate(-90 38 38)"
        style={{ filter: `drop-shadow(0 0 6px ${color})` }}
      />
      <text x="38" y="43" textAnchor="middle" fontSize="16" fontWeight="700" fill="var(--text)">
        {n}%
      </text>
    </svg>
  );
}

export default function App() {
  const [verifier, setVerifier] = useState<Verifier | null>(null);
  const [policies, setPolicies] = useState<string[]>([]);
  const [account, setAccount] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [walletConnected, setWalletConnected] = useState(false);

  const [question, setQuestion] = useState("");
  const [policyId, setPolicyId] = useState("");
  const [urlsText, setUrlsText] = useState("");

  const [flow, setFlow] = useState<Flow>("idle");
  const [txHash, setTxHash] = useState("");
  const [startTime, setStartTime] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [record, setRecord] = useState<VerificationRecord | null>(null);
  const [recent, setRecent] = useState<VerificationRecord[]>([]);
  const [recordTx, setRecordTx] = useState("");
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [actionFlow, setActionFlow] = useState<"" | "challenge" | "reverify">("");
  const [actionMsg, setActionMsg] = useState("");
  const [disputeReason, setDisputeReason] = useState("");
  const [watch, setWatch] = useState(true);

  const hash = useHash();
  const page = routeOf(hash);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [page]);

  const loadRecent = useCallback(async (v: Verifier) => {
    try {
      setRecent((await v.getRecentVerifications(50)).map(normalizeRecord));
    } catch {
      /* ignore */
    }
  }, []);

  const onConnectWallet = async () => {
    setConnecting(true);
    try {
      const address = await connectWallet();
      if (address) {
        const v = getVerifier();
        setVerifier(v);
        setAccount(address);
        setWalletConnected(true);
        await loadRecent(v);
      }
    } catch {
      /* wallet rejected / unavailable */
    } finally {
      setConnecting(false);
    }
  };

  const onDisconnectWallet = () => {
    disconnectWallet();
    const v = getVerifier();
    setVerifier(v);
    setWalletConnected(false);
    setAccount("");
    loadRecent(v);
  };

  // Auto-refresh when the user switches accounts inside the wallet.
  useEffect(() => {
    const eth = (window as any).ethereum;
    if (!eth?.on) return;
    const onAccountsChanged = async (accounts: string[]) => {
      if (accounts?.length) {
        await onConnectWallet();
      } else {
        setWalletConnected(false);
        setAccount("");
      }
    };
    eth.on("accountsChanged", onAccountsChanged);
    return () => eth.removeListener?.("accountsChanged", onAccountsChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRecent]);

  useEffect(() => {
    const v = getVerifier();
    setVerifier(v);
    setAccount(accountAddress());
    v.getPolicyIds()
      .then((ids) => {
        setPolicies(ids);
        setPolicyId(ids[0] ?? "");
      })
      .catch(() => {});
    loadRecent(v);

    // Silent check on load: use the wallet only if already authorized.
    if (walletAvailable()) {
      trySilentConnect()
        .then((address) => {
          if (address) {
            const wv = getVerifier();
            setVerifier(wv);
            setAccount(address);
            setWalletConnected(true);
            loadRecent(wv);
          }
        })
        .catch(() => {
          /* ignore */
        });
    }
  }, [loadRecent]);

  // Hash routing: #/verification/<id>
  useEffect(() => {
    const m = hash.match(/^#\/verification\/(.+)$/);
    if (m && verifier) {
      verifier
        .getVerification(m[1])
        .then((r) => {
          // Only apply if the hash still points at this record (stale-guard).
          if (window.location.hash === hash) setRecord(normalizeRecord(r));
        })
        .catch(() => {});
    }
  }, [hash, verifier]);

  const parseUrls = (): string[] => {
    const parsed = JSON.parse(urlsText);
    return Array.isArray(parsed) ? parsed.filter((u) => typeof u === "string") : [];
  };

  const onSubmit = async () => {
    if (!verifier || !policyId) return;
    if (!walletConnected) {
      setErrorMsg("Connect your wallet first to run a verification.");
      setFlow("error");
      return;
    }

    const q = question.trim();
    if (!q) {
      setErrorMsg("Question is required");
      setFlow("error");
      return;
    }
    if (q.length > MAX_QUESTION) {
      setErrorMsg(`Question exceeds ${MAX_QUESTION} characters`);
      setFlow("error");
      return;
    }

    let urls: string[];
    if (!urlsText.trim()) {
      setErrorMsg("Add at least one evidence URL (JSON array).");
      setFlow("error");
      return;
    }
    try {
      urls = parseUrls();
    } catch {
      setErrorMsg("URLs must be a JSON array of strings");
      setFlow("error");
      return;
    }
    if (urls.length === 0) {
      setErrorMsg("At least one source URL is required");
      setFlow("error");
      return;
    }
    if (urls.length > MAX_URLS) {
      setErrorMsg(`At most ${MAX_URLS} source URLs are allowed`);
      setFlow("error");
      return;
    }
    if (urls.some((u) => u.length > MAX_URL_LEN)) {
      setErrorMsg(`Source URLs must be under ${MAX_URL_LEN} characters`);
      setFlow("error");
      return;
    }
    if (urls.some((u) => !isValidHttpUrl(u))) {
      setErrorMsg("All source URLs must be http(s)");
      setFlow("error");
      return;
    }

    setFlow("submitting");
    setErrorMsg("");
    setRecord(null);
    setStartTime(Date.now());
    try {
      const { txHash } = await verifier.verify({ question: q, policyId, urls });
      setTxHash(txHash);
      setFlow("pending");

      const receipt = await verifier.waitForReceipt(txHash);
      if (isExecutionSuccess(receipt)) {
        // Use the verification id returned by the transaction itself —
        // never "the newest record", which could be another concurrent submit.
        const vid =
          txReturnValue(receipt) ??
          (await verifier.getRecentVerifications(1))[0]?.verification_id ??
          null;
        if (vid) {
          const rec = await verifier.getVerification(vid);
          saveVerificationTx(vid, txHash);
          setRecord(normalizeRecord(rec));
          window.location.hash = `/verification/${vid}`;
        }
        setFlow("done");
      } else {
        setErrorMsg(executionError(receipt) ?? "Execution failed (consensus rejected)");
        setFlow("error");
      }
      await loadRecent(verifier);
    } catch (e: any) {
      setErrorMsg(String(e?.message ?? e));
      setFlow("error");
    }
  };

  const loadTemplate = (tpl: PolicyTemplate) => {
    setPolicyId(tpl.id);
    setQuestion(tpl.sampleQuestion);
    setUrlsText(JSON.stringify(tpl.sampleUrls, null, 2));
  };

  const openRecord = async (vid: string) => {
    window.location.hash = `/verification/${vid}`;
    if (verifier) {
      verifier
        .getVerification(vid)
        .then((r) => {
          // Only apply if the hash still points at this record (stale-guard).
          if (window.location.hash === `#/verification/${vid}`) {
            setRecord(normalizeRecord(r));
          }
        })
        .catch(() => {});
    }
  };

  const onCloseRecord = () => {
    setRecord(null);
    window.location.hash = "#/workspace";
  };

  const onClearForm = () => {
    setQuestion("");
    setUrlsText("");
    setPolicyId(policies[0] ?? "");
    setErrorMsg("");
    setTxHash("");
  };

  useEffect(() => {
    if (record) {
      verifier
        ?.getPolicy(record.policy_id)
        .then(setPolicy)
        .catch(() => {});
      setRecordTx(getVerificationTx(record.verification_id));
    }
  }, [record, verifier]);

  // Live refresh while a record is open.
  useEffect(() => {
    if (!watch || !verifier || !record) return;
    const timer = setInterval(async () => {
      try {
        const fresh = await verifier.getVerification(record.verification_id);
        setRecord(normalizeRecord(fresh));
        loadRecent(verifier);
      } catch {
        /* transient */
      }
    }, 20_000);
    return () => clearInterval(timer);
  }, [watch, verifier, record?.verification_id, loadRecent]);

  const onChallenge = async () => {
    if (!verifier || !record || !disputeReason.trim()) return;
    setActionFlow("challenge");
    setActionMsg("");
    try {
      const { txHash } = await verifier.challenge({
        verificationId: record.verification_id,
        reason: disputeReason,
      });
      setActionMsg(`Dispute submitted ${txHash.slice(0, 18)}… (waiting for consensus)`);
      const rx = await verifier.waitForReceipt(txHash);
      if (isExecutionSuccess(rx)) {
        setRecord(normalizeRecord(await verifier.getVerification(record.verification_id)));
        setActionMsg("Dispute opened ✓");
        loadRecent(verifier);
      } else {
        setActionMsg(executionError(rx) ?? "Challenge failed");
      }
    } catch (e: any) {
      setActionMsg(String(e?.message ?? e));
    } finally {
      setActionFlow("");
    }
  };

  const onReverify = async () => {
    if (!verifier || !record) return;
    setActionFlow("reverify");
    setActionMsg("");
    try {
      const urls = (record.sources ?? []).map((s) => s.url);
      if (!urls.length) {
        setActionMsg("No source URLs available to re-verify with");
        setActionFlow("");
        return;
      }
      const { txHash } = await verifier.reverify({ verificationId: record.verification_id, urls });
      setActionMsg(
        `Re-verification submitted ${txHash.slice(0, 18)}… (consensus may take minutes)`,
      );
      const rx = await verifier.waitForReceipt(txHash);
      if (isExecutionSuccess(rx)) {
        setRecord(normalizeRecord(await verifier.getVerification(record.verification_id)));
        setActionMsg("Re-verified ✓ (version bumped)");
        loadRecent(verifier);
      } else {
        setActionMsg(executionError(rx) ?? "Re-verify failed");
      }
    } catch (e: any) {
      setActionMsg(String(e?.message ?? e));
    } finally {
      setActionFlow("");
    }
  };

  const isOwner = !!record && record.owner.toLowerCase() === account.toLowerCase();
  const canChallenge =
    !!record &&
    !["CONTESTED"].includes(record.status.toUpperCase()) &&
    (!policy || policy.dispute_mode !== "parties" || isOwner);

  return (
    <div className="page">
      <nav className="nav">
        <div className="nav-inner">
        <a className="brand" href="#/">
          <div className="brand-mark">
            <BrandIcon size={21} />
          </div>
          <span className="wordmark">Episteme</span>
        </a>
        <div className="nav-links">
          <a href="#/" className={page === "landing" ? "active" : ""}>
            Overview
          </a>
          <a href="#/how" className={page === "how" ? "active" : ""}>
            How it works
          </a>
          <a href="#/guide" className={page === "guide" ? "active" : ""}>
            Guide
          </a>
          <a
            href="#/workspace"
            className={`nav-cta${page === "workspace" ? " active" : ""}`}
          >
            Workspace
          </a>
        </div>
        <div className="account">
          <span className="dot" />
          {walletConnected ? `${account.slice(0, 10)}…${account.slice(-6)}` : "not connected"}
        </div>
        {walletAvailable() && (
          <button
            className="connect-wallet"
            onClick={walletConnected ? onDisconnectWallet : onConnectWallet}
            disabled={connecting}
          >
            {connecting ? "Connecting…" : walletConnected ? "Disconnect" : "Connect wallet"}
          </button>
        )}
        </div>
      </nav>

      <div className="app">

      {page === "landing" && <LandingPage />}
      {page === "how" && <HowPage />}
      {page === "guide" && <GuidePage />}

      {page === "workspace" && (
      <section className="workspace">
        <div className="workspace-head">
          <h2>Verification workspace</h2>
        </div>
        <main className="grid">
        <div className="col">
          <section className="panel">
            <h2>
              <Icon d={ICON_SEARCH} /> Ask a question
            </h2>
            <label>
              Question
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                rows={4}
                placeholder="e.g. Is the genlayer-py repository actively maintained and eligible for grant funding?"
              />
            </label>
            <label>
              Policy
              <select value={policyId} onChange={(e) => setPolicyId(e.target.value)}>
                {policies.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Evidence URLs (JSON array)
              <textarea
                value={urlsText}
                onChange={(e) => setUrlsText(e.target.value)}
                rows={5}
                spellCheck={false}
                placeholder='["https://source1.example.com", "https://source2.example.com"]'
              />
            </label>
            <div className="form-actions">
              <button
                onClick={onSubmit}
                disabled={flow === "submitting" || flow === "pending" || !walletConnected}
              >
                {flow === "pending" ? "Verifying…" : "Verify"}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={onClearForm}
                disabled={flow === "submitting" || flow === "pending"}
              >
                Clear
              </button>
            </div>

            {!walletConnected && (
              <div className="wallet-warn">
                {walletAvailable()
                  ? "Connect your wallet to run a verification — decisions are attributed to your address."
                  : "No EVM wallet detected. Install MetaMask or Rabby, then connect to verify."}
              </div>
            )}

            {flow === "pending" && txHash && (
              <InvestigationProgress startTime={startTime} txHash={txHash} />
            )}
            {flow === "error" && <div className="error">✕ {errorMsg}</div>}
          </section>

          <section className="panel">
            <h2>
              <Icon d={ICON_SPARK} /> Policy catalog
            </h2>
            <div className="cards">
              {POLICY_TEMPLATES.map((tpl) => (
                <div className="card" key={tpl.id}>
                  <div className="card-title">
                    {tpl.name} <code>{tpl.id}</code>
                  </div>
                  <p className="card-desc">{tpl.description}</p>
                  <div className="card-actions">
                    <button onClick={() => loadTemplate(tpl)}>Load sample</button>
                    <button className="ghost" disabled>
                      built-in
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="panel">
          {record ? (
            <>
              <div className="panel-head">
                <h2>
                  <Icon d={ICON_SCALE} /> Decision record
                </h2>
                <button className="close-record" onClick={onCloseRecord} title="Close record">
                  ✕
                </button>
              </div>
              <VerificationView
                record={record}
                policy={policy}
                txHash={recordTx}
                actions={{
                  isOwner,
                  canChallenge,
                  busy: actionFlow !== "",
                  reason: disputeReason,
                  setReason: setDisputeReason,
                  message: actionMsg,
                  walletConnected,
                  onChallenge,
                  onReverify,
                }}
              />
            </>
          ) : (
            <div className="placeholder">
              {flow === "done"
                ? "No record returned."
                : "Submit a question to run a verification."}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>
              <Icon d={ICON_LIST} /> Verifications
            </h2>
            <label className="watch">
              <input type="checkbox" checked={watch} onChange={(e) => setWatch(e.target.checked)} />
              live
            </label>
          </div>
          <RecentList records={recent} onOpen={openRecord} />
        </section>
        </main>
      </section>
      )}

      <footer className="footer">
        <div className="footer-inner">
          <div className="brand">
            <div className="brand-mark">
              <BrandIcon size={19} />
            </div>
            <span className="wordmark">Episteme</span>
            <span className="tagline">
              The verification layer for AI decisions in an open and changing world.
            </span>
          </div>
          <span className="muted">On-chain · consensus-verified · evidence-backed</span>
        </div>
      </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Landing pages
// ---------------------------------------------------------------

function LandingPage() {
  return (
    <section id="hero" className="hero">
      <span className="eyebrow">Episteme · On-chain AI decision network</span>
      <h1>
        Turn complex real-world questions into <em>verifiable decisions</em>.
      </h1>
      <p className="hero-sub">
        Multiple independent AI agents investigate, cross-check, and reach consensus on
        real-world questions — producing decisions that humans, applications, DAOs, and
        autonomous agents can trust.
      </p>
      <div className="hero-actions">
        <a href="#/workspace" className="btn-primary">
          Open the workspace
        </a>
        <a href="#/how" className="btn-ghost">
          How it works
        </a>
      </div>
      <div className="hero-tags">
        <span>Grant verification</span>
        <span>DAO governance</span>
        <span>Company status</span>
        <span>Insurance claims</span>
      </div>
    </section>
  );
}

function HowPage() {
  return (
    <section className="landing page">
      <div className="landing-head">
        <span className="eyebrow">How it works</span>
        <h2>One question. Five roles. Verified by consensus.</h2>
        <p>
          A verification is never a single model's opinion. Independent agents investigate,
          a skeptic challenges, and the network must agree before anything is recorded.
        </p>
      </div>
      <div className="steps">
        {HOW_STEPS.map((s, i) => (
          <div className="step" key={s.title}>
            <div className="step-num">
              <Icon d={s.icon} size={22} />
            </div>
            <h3>
              {i + 1}. {s.title}
            </h3>
            <p>{s.text}</p>
          </div>
        ))}
      </div>
      <div className="landing-head note">
        <p>
          Every decision is <strong>versioned</strong>, <strong>challengeable</strong>, and{" "}
          <strong>auditable</strong> — and can be re-verified as the world changes.
        </p>
      </div>
    </section>
  );
}

function GuidePage() {
  return (
    <section className="landing page">
      <div className="landing-head">
        <span className="eyebrow">Guide</span>
        <h2>Use it in six steps</h2>
        <p>From a question to a consensus-verified decision — in under a minute of setup.</p>
      </div>
      <ol className="guide-list">
        {GUIDE_STEPS.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
      <div className="hero-actions" style={{ marginTop: 32 }}>
        <a href="#/workspace" className="btn-primary">
          Open the workspace
        </a>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------
// Investigation progress
// ---------------------------------------------------------------

const STAGE_CUMULATIVE_S = [8, 16, 28, 42, 58, 9999];

function InvestigationProgress({ startTime, txHash }: { startTime: number; txHash: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed((Date.now() - startTime) / 1000), 1000);
    return () => clearInterval(t);
  }, [startTime]);

  let activeIdx = 0;
  for (let i = 0; i < STAGES.length; i++) {
    if (elapsed >= STAGE_CUMULATIVE_S[i]) activeIdx = i;
  }

  return (
    <div className="progress">
      <div className="progress-head">
        <span className="spinner" />
        <span>
          Investigating on-chain — tx{" "}
          <a
            className="tx-link"
            href={`https://explorer-studio.genlayer.com/tx/${txHash}`}
            target="_blank"
            rel="noreferrer"
            title="Open transaction in the explorer"
          >
            {txHash.slice(0, 18)}…
          </a>
        </span>
      </div>
      <ul className="stages">
        {STAGES.map((s, i) => {
          const done = i < activeIdx;
          const active = i === activeIdx;
          return (
            <li
              key={s.key}
              className={done ? "st-done" : active ? "st-active" : "st-pending"}
            >
              {done ? "✓" : active ? <span className="mini-spin" /> : "·"}
              {s.label}
            </li>
          );
        })}
      </ul>
      <div className="progress-note">
        Leader + 5 independent validators re-run the investigation and must agree.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Record view
// ---------------------------------------------------------------

function VerificationView({
  record,
  policy,
  txHash,
  actions,
}: {
  record: VerificationRecord;
  policy: Policy | null;
  txHash?: string;
  actions: {
    isOwner: boolean;
    canChallenge: boolean;
    busy: boolean;
    reason: string;
    setReason: (v: string) => void;
    message: string;
    walletConnected: boolean;
    onChallenge: () => void;
    onReverify: () => void;
  };
}) {
  const [tab, setTab] = useState("overview");
  const color = DECISION_COLORS[record.decision] ?? "#333";

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "evidence", label: "Evidence" },
    { key: "challenges", label: "Challenges" },
    { key: "timeline", label: "Timeline & Policy" },
  ];

  return (
    <div className="record">
      <div className="record-head">
        <div>
          <code>{record.verification_id}</code>
          <StatusBadge status={record.status} />
          <span className="muted">v{record.version}</span>
          {txHash && (
            <a
              className="tx-link"
              href={`https://explorer-studio.genlayer.com/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              title="View transaction in the explorer"
            >
              View transaction ↗
            </a>
          )}
        </div>
        <div className="verdict">
          <div className="decision-big" style={{ color }}>
            {record.decision}
          </div>
          <ScoreRing value={record.confidence} color={color} />
        </div>
      </div>
      <p className="question">{toDisplay(record.question)}</p>

      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`tab${tab === t.key ? " active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <>
          <dl className="meta">
            <div>
              <dt>Consensus</dt>
              <dd>{record.consensus}</dd>
            </div>
            <div>
              <dt>Policy</dt>
              <dd>{record.policy_id}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{fmtTime(record.created_at)}</dd>
            </div>
            <div>
              <dt>Expires</dt>
              <dd>{fmtTime(record.expires_at)}</dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd className="mono">{toDisplay(record.owner).slice(0, 12)}…</dd>
            </div>
          </dl>

          {record.reasoning_summary && (
            <p className="reasoning">{toDisplay(record.reasoning_summary)}</p>
          )}

          <h3>Criteria</h3>
          <table className="criteria">
            <thead>
              <tr>
                <th>#</th>
                <th>Description</th>
                <th>Result</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {record.criteria.map((c: Criterion) => (
                <tr key={toDisplay(c.id)}>
                  <td className="mono">{toDisplay(c.id)}</td>
                  <td>
                    {toDisplay(c.description)}{" "}
                    {c.mandatory && <span className="req">mandatory</span>}
                  </td>
                  <td>
                    <span
                      className="decision"
                      style={{
                        color:
                          toDisplay(c.result) === "PASS"
                            ? "#2f8f5b"
                            : toDisplay(c.result) === "FAIL"
                              ? "#c0443c"
                              : "#b98a2f",
                      }}
                    >
                      {toDisplay(c.result)}
                    </span>
                  </td>
                  <td className="small">{toDisplay(c.reason)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <ActionsPanel actions={actions} />
        </>
      )}

      {tab === "evidence" && (
        <>
          <h3>Evidence explorer</h3>
          <div className="evid-summary">
            {record.evidence.summary.sources_ok}/{record.evidence.summary.sources_fetched} sources ok
            {" · "}
            {record.evidence.summary.primary_source ? "primary ✓" : "no primary"}
            {" · "}
            rules {record.evidence.summary.rules_satisfied ? "satisfied ✓" : "not satisfied"}
          </div>
          <div className="sources">
            {record.sources.map((s: SourceAssessment, i) => (
              <SourceCard key={i} source={s} />
            ))}
          </div>
          <div className="columns">
            <FactCheckBox
              title="Corroborated"
              items={record.evidence.fact_check.corroborated}
              tone="ok"
            />
            <FactCheckBox
              title="Contradictions"
              items={record.evidence.fact_check.contradictions}
              tone="bad"
            />
            <FactCheckBox
              title="Unverified"
              items={record.evidence.fact_check.unverified}
              tone="warn"
            />
          </div>
        </>
      )}

      {tab === "challenges" && (
        <>
          {record.challenges.length > 0 ? (
            <>
              <h3>Skeptic challenges</h3>
              <ul className="challenges">
                {record.challenges.map((c: Challenge, i) => (
                  <li key={i}>
                    <span className={`sev sev-${toDisplay(c.severity).toLowerCase()}`}>
                      {toDisplay(c.severity)}
                    </span>{" "}
                    {toDisplay(c.issue)}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="placeholder">No skeptic challenges.</div>
          )}

          {record.disputes.length > 0 ? (
            <>
              <h3>Disputes</h3>
              <ul className="disputes">
                {record.disputes.map((d: Dispute, i) => (
                  <li key={i}>
                    v{d.version} · {fmtTime(d.timestamp)} — {toDisplay(d.reason)}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="placeholder">No disputes opened.</div>
          )}
        </>
      )}

      {tab === "timeline" && (
        <>
          {policy && (
            <>
              <h3>Policy — {policy.name ?? policy.policy_id}</h3>
              <ul className="sources">
                {policy.criteria.map((c) => (
                  <li key={c.id}>
                    <span className="mono">{c.id}</span> {toDisplay(c.description)}
                    {c.mandatory && <span className="req"> mandatory</span>}
                  </li>
                ))}
              </ul>
              <div className="evid-summary">
                min sources {policy.evidence_rules?.min_sources ?? "—"} · primary required{" "}
                {policy.evidence_rules?.primary_source_required ? "✓" : "no"}
                {policy.allowed_origins?.length
                  ? ` · origins ${policy.allowed_origins.join(", ")}`
                  : ""}
              </div>
            </>
          )}

          <h3>Timeline</h3>
          <ul className="timeline">
            <li>
              <span className="tl-dot" /> created v1 · {fmtTime(record.created_at)}
            </li>
            {record.disputes.map((d: Dispute, i) => (
              <li key={i}>
                <span className="tl-dot tl-contested" /> contested (v{d.version}) ·{" "}
                {fmtTime(d.timestamp)} — {toDisplay(d.reason)}
              </li>
            ))}
            <li>
              <span className="tl-dot tl-now" /> now · v{record.version} — {record.decision} (
              {record.status})
            </li>
          </ul>

          {record.revisions.length > 0 && (
            <>
              <h3>Revision history</h3>
              <ul className="disputes">
                {record.revisions.map((rev, i) => (
                  <li key={i}>
                    v{rev.version} · {fmtTime(rev.timestamp)} — {toDisplay(rev.decision)} (
                    {toDisplay(rev.status)})
                    <div className="muted">
                      sources {Number(rev.sources?.length) || 0} · confidence{" "}
                      {Number(rev.confidence) || 0}%
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}


function SourceCard({ source }: { source: SourceAssessment }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="source-card">
      <button className="source-head" onClick={() => setOpen(!open)}>
        <span className={`badge badge-primary`}>{toDisplay(source.category)}</span>
        <span className="mono src-url">{toDisplay(source.url)}</span>
        <span className="muted">({toDisplay(source.authority)})</span>
        <span className="chev">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="source-body">
          <div>
            <b>Category:</b> {toDisplay(source.category)} —{" "}
            {CATEGORY_EXPLAIN[toDisplay(source.category)] ?? "—"}
          </div>
          <div>
            <b>Authority:</b> {toDisplay(source.authority)}
          </div>
          <div>
            <b>Notes:</b> {toDisplay(source.notes)}
          </div>
          <div>
            <b>Role:</b>{" "}
            {source.category === "PRIMARY"
              ? "counts toward primary-source requirement"
              : "supplementary evidence"}
          </div>
        </div>
      )}
    </div>
  );
}

function FactCheckBox({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "ok" | "bad" | "warn";
}) {
  return (
    <div className={`factbox factbox-${tone}`}>
      <h4>{title}</h4>
      {!items || items.length === 0 ? (
        <div className="muted">none</div>
      ) : (
        <ul className="tiny">
          {(items as unknown[]).map((x, i) => (
            <li key={i}>{toDisplay(x)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActionsPanel({
  actions,
}: {
  actions: {
    isOwner: boolean;
    canChallenge: boolean;
    busy: boolean;
    reason: string;
    setReason: (v: string) => void;
    message: string;
    walletConnected: boolean;
    onChallenge: () => void;
    onReverify: () => void;
  };
}) {
  if (!actions.isOwner && !actions.canChallenge) return null;
  if (!actions.walletConnected) {
    return (
      <div className="actions">
        <h3>Actions</h3>
        <div className="wallet-warn">
          Connect your wallet to challenge or re-verify a decision.
        </div>
      </div>
    );
  }
  return (
    <div className="actions">
      <h3>Actions</h3>
      {actions.isOwner && (
        <button onClick={actions.onReverify} disabled={actions.busy} className="ghost">
          Re-verify (refresh evidence)
        </button>
      )}
      {actions.canChallenge && (
        <>
          <textarea
            placeholder="Dispute reason…"
            value={actions.reason}
            onChange={(e) => actions.setReason(e.target.value)}
            rows={2}
          />
          <button
            onClick={actions.onChallenge}
            disabled={actions.busy || !actions.reason.trim()}
            className="ghost danger"
          >
            Challenge this decision
          </button>
        </>
      )}
      {actions.message && <div className="muted">{actions.message}</div>}
    </div>
  );
}

// ---------------------------------------------------------------
// Recent list with filters
// ---------------------------------------------------------------

function RecentList({
  records,
  onOpen,
}: {
  records: VerificationRecord[];
  onOpen: (vid: string) => void;
}) {
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState("all");
  const [fDecision, setFDecision] = useState("all");

  const statuses = useMemo(() => Array.from(new Set(records.map((r) => r.status))), [records]);
  const decisions = useMemo(() => Array.from(new Set(records.map((r) => r.decision))), [records]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return records.filter((r) => {
      if (fStatus !== "all" && r.status !== fStatus) return false;
      if (fDecision !== "all" && r.decision !== fDecision) return false;
      if (query) {
        const hay = `${r.verification_id} ${r.question} ${r.policy_id}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
  }, [records, q, fStatus, fDecision]);

  return (
    <div className="recent">
      <div className="filters">
        <input
          placeholder="Search id, question, policy…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="filter-row">
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="all">any status</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select value={fDecision} onChange={(e) => setFDecision(e.target.value)}>
            <option value="all">any decision</option>
            {decisions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="placeholder">No verifications match.</div>
      ) : (
        <ul className="list">
          {filtered.map((r) => (
            <li key={r.verification_id} onClick={() => onOpen(r.verification_id)}>
              <div className="list-row">
                <code>{r.verification_id}</code>
                <span
                  className="decision"
                  style={{ color: DECISION_COLORS[r.decision] ?? "#333" }}
                >
                  {r.decision}
                </span>
                <StatusBadge status={r.status} />
                <span className="conf">{r.confidence}%</span>
              </div>
              <div className="list-question">{toDisplay(r.question)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
