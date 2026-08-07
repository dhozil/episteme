export type Decision = "PASS" | "FAIL" | "NEEDS_REVIEW" | "INSUFFICIENT_EVIDENCE";

export type VerificationStatus =
  | "VERIFIED"
  | "REJECTED"
  | "REVIEW"
  | "INSUFFICIENT_EVIDENCE"
  | "CONTESTED"
  | "EXPIRED";

export type CriterionResult = "PASS" | "FAIL" | "UNKNOWN";

export interface Criterion {
  id: string;
  description: string;
  mandatory: boolean;
  result: CriterionResult;
  reason: string;
}

export interface SourceAssessment {
  url: string;
  category: string;
  authority: string;
  notes: string;
}

export interface Challenge {
  issue: string;
  severity: string;
}

export interface Dispute {
  version: number;
  reason: string;
  timestamp: string;
}

export interface Revision {
  version: number;
  decision: Decision;
  confidence: number;
  status: string;
  consensus: string;
  sources: SourceAssessment[];
  criteria: Criterion[];
  evidence: {
    summary: EvidenceSummary;
    fact_check: FactCheck;
  };
  reasoning_summary: string;
  timestamp: string;
}

export interface EvidenceSummary {
  sources_fetched: number;
  sources_ok: number;
  primary_source: boolean;
  rules_satisfied: boolean;
  min_sources: number;
}

export interface FactCheck {
  corroborated: string[];
  contradictions: string[];
  unverified: string[];
}

export interface VerificationRecord {
  verification_id: string;
  owner: string;
  question: string;
  policy_id: string;
  decision: Decision;
  confidence: number;
  status: VerificationStatus;
  consensus: string;
  sources: SourceAssessment[];
  criteria: Criterion[];
  evidence: {
    summary: EvidenceSummary;
    fact_check: FactCheck;
  };
  challenges: Challenge[];
  disputes: Dispute[];
  revisions: Revision[];
  reasoning_summary: string;
  /** The exact URLs that were submitted and fetched for this record. */
  submitted_urls: string[];
  created_at: string;
  expires_at: string;
  version: number;
}

export interface PolicyCriterion {
  id: string;
  description: string;
  mandatory: boolean;
}

export interface Policy {
  policy_id: string;
  name?: string;
  decision_states?: string[];
  criteria: PolicyCriterion[];
  evidence_rules?: {
    min_sources?: number;
    primary_source_required?: boolean;
  };
  allowed_origins?: string[];
  required_origin?: string;
  dispute_mode?: "public" | "parties";
  confidence_tolerance?: number;
  expires_in_days?: number;
}

export interface VerifyOptions {
  question: string;
  policyId: string;
  urls: string[];
}

export interface ChallengeOptions {
  verificationId: string;
  reason: string;
}

export interface ReverifyOptions {
  verificationId: string;
  urls: string[];
}

export interface WriteResult {
  txHash: string;
}

export interface TxReceipt {
  status: string;
  consensus_data?: {
    leader_receipt?: Array<{
      execution_result?: string;
      genvm_result?: {
        raw_error?: string | null;
        error_description?: string | null;
      };
      /** Decoded return value of the executed contract method. */
      result?: {
        payload?: {
          readable?: string;
        };
      };
    }>;
  };
}

export interface VerifierConfig {
  contractAddress: string;
  endpoint?: string;
  chain?: unknown;
  account?: unknown;
  provider?: unknown;
  waitTimeoutMs?: number;
  pollIntervalMs?: number;
}
