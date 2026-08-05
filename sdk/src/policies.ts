export interface PolicyTemplate {
  id: string;
  name: string;
  description: string;
  policy: Record<string, unknown>;
  sampleQuestion: string;
  sampleUrls: string[];
}

const GRANT_V1: PolicyTemplate = {
  id: "grant-v1",
  name: "Grant Eligibility",
  description: "Does a project satisfy grant / bounty requirements?",
  policy: {
    policy_id: "grant-v1",
    name: "Grant Eligibility v1",
    criteria: [
      { id: "c1", description: "Open-source repository", mandatory: true },
      { id: "c2", description: "Active development", mandatory: true },
      { id: "c3", description: "Minimum milestone completion", mandatory: true },
      { id: "c4", description: "Team eligibility", mandatory: false },
      { id: "c5", description: "Budget compliance", mandatory: false },
    ],
    evidence_rules: { min_sources: 2, primary_source_required: true },
    allowed_origins: [
      "https://github.com",
      "https://api.github.com",
      "https://gitlab.com",
      "https://docs.genlayer.com",
    ],
    confidence_tolerance: 20,
    expires_in_days: 7,
  },
  sampleQuestion: "Is the genlayer-py repository actively maintained and eligible for grant funding?",
  sampleUrls: [
    "https://github.com/genlayerlabs/genlayer-py",
    "https://docs.genlayer.com/developers",
  ],
};

const DAO_PROPOSAL_V1: PolicyTemplate = {
  id: "dao-proposal-v1",
  name: "DAO Governance Proposal",
  description: "Should the treasury allocate funds to this proposal?",
  policy: {
    policy_id: "dao-proposal-v1",
    name: "DAO Governance Proposal v1",
    criteria: [
      { id: "d1", description: "Proposal is active and clearly states what it requests", mandatory: true },
      { id: "d2", description: "Proposal is publicly discussed with verifiable details", mandatory: true },
      { id: "d3", description: "Proposal states expected impact and rationale", mandatory: true },
      { id: "d4", description: "Risks and trade-offs are addressed", mandatory: false },
      { id: "d5", description: "Community sentiment is considered", mandatory: false },
    ],
    evidence_rules: { min_sources: 2, primary_source_required: true },
    allowed_origins: [
      "https://gov.uniswap.org",
      "https://snapshot.org",
      "https://forum.makerdao.com",
      "https://commonwealth.im",
    ],
    confidence_tolerance: 20,
    expires_in_days: 14,
  },
  sampleQuestion: "Is the Uniswap DAO UNIfication proposal active and substantiated for treasury funding?",
  sampleUrls: [
    "https://gov.uniswap.org/t/unification-proposal/25881",
    "https://gov.uniswap.org/t/temp-check-activate-v4-protocol-fees/26162",
  ],
};

const COMPANY_STATUS_V1: PolicyTemplate = {
  id: "company-status-v1",
  name: "Company Status",
  description: "Is this company still actively operating?",
  policy: {
    policy_id: "company-status-v1",
    name: "Company Status v1",
    criteria: [
      { id: "s1", description: "Company has an active official registration record", mandatory: true },
      { id: "s2", description: "No insolvency or closure signals", mandatory: true },
      { id: "s3", description: "Recent verifiable business activity", mandatory: true },
    ],
    evidence_rules: { min_sources: 2, primary_source_required: true },
    confidence_tolerance: 20,
    expires_in_days: 30,
  },
  sampleQuestion: "Is the open-meteo weather service actively operating?",
  sampleUrls: [
    "https://api.open-meteo.com/v1/forecast?latitude=-6.2088&longitude=106.8456&current=temperature_2m,relative_humidity_2m&timezone=auto",
    "https://open-meteo.com/en",
  ],
};

const INSURANCE_CLAIM_V1: PolicyTemplate = {
  id: "insurance-claim-v1",
  name: "Insurance Claim",
  description: "Did the claimed event actually occur under coverage?",
  policy: {
    policy_id: "insurance-claim-v1",
    name: "Insurance Claim v1",
    criteria: [
      { id: "i1", description: "Claimed event actually occurred (independent tracker)", mandatory: true },
      { id: "i2", description: "Event matches policy coverage conditions per issuer policy document", mandatory: true },
      { id: "i3", description: "Claim corroborated by independent official sources (issuer, billing, licensing)", mandatory: true },
    ],
    evidence_rules: { min_sources: 3, primary_source_required: true },
    allowed_origins: [
      "https://www.flightradar24.com",
      "https://www.flightaware.com",
    ],
    required_origin: "https://www.flightradar24.com",
    dispute_mode: "parties",
    confidence_tolerance: 15,
    expires_in_days: 3,
  },
  sampleQuestion: "Was flight BA123 cancelled on 2026-08-03?",
  sampleUrls: [
    "https://www.flightradar24.com/data/flights/ba123",
    "https://www.flightaware.com/live/flight/BAW123",
  ],
};

const SERVICE_STATUS_V1: PolicyTemplate = {
  id: "service-status-v1",
  name: "Service Status",
  description: "Is a service reachable and returning valid data?",
  policy: {
    policy_id: "service-status-v1",
    name: "Service Status Verification v1",
    criteria: [
      {
        id: "s1",
        description: "The service is reachable and returns valid, current data",
        mandatory: true,
      },
    ],
    evidence_rules: { min_sources: 1, primary_source_required: true },
    allowed_origins: ["https://api.open-meteo.com", "https://open-meteo.com"],
    confidence_tolerance: 20,
    expires_in_days: 1,
  },
  sampleQuestion:
    "Is the open-meteo weather API reachable and returning valid, current data right now?",
  sampleUrls: [
    "https://api.open-meteo.com/v1/forecast?latitude=-6.2088&longitude=106.8456&current=temperature_2m,relative_humidity_2m&timezone=auto",
    "https://open-meteo.com/en",
  ],
};

export const POLICY_TEMPLATES: PolicyTemplate[] = [
  GRANT_V1,
  DAO_PROPOSAL_V1,
  COMPANY_STATUS_V1,
  INSURANCE_CLAIM_V1,
  SERVICE_STATUS_V1,
];
