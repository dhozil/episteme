"""Direct-mode tests for the generic VERIFY engine.

These run in-memory (no Studio) using web/LLM mocks and validate the
whole pipeline: 5-agent investigation, web evidence, equivalence-based
aggregation, decision states, disputes and re-verification.
"""

import json
import re

from tests.direct.conftest import to_hex

URLS = [
    "https://github.com/example/repo",
    "https://api.github.com/repos/example/milestones",
]

DEFAULT_RESEARCH = {
    "findings": ["Repository is public"],
    "summary": "Repository is public with active development.",
}
DEFAULT_SOURCE = {
    "sources": [
        {
            "url": URLS[0],
            "category": "PRIMARY",
            "authority": "HIGH",
            "notes": "Official repository",
        }
    ],
    "overall_quality": "high quality primary source",
}
DEFAULT_FACT_CHECK = {
    "claims": ["repo public"],
    "corroborated": ["repo public"],
    "contradictions": [],
    "unverified": [],
}
DEFAULT_ANALYST = {
    "criteria": [
        {"id": "c1", "result": "PASS", "reason": "public"},
        {"id": "c2", "result": "PASS", "reason": "active"},
        {"id": "c3", "result": "PASS", "reason": "milestones present"},
        {"id": "c4", "result": "PASS", "reason": "eligible"},
        {"id": "c5", "result": "PASS", "reason": "reasonable"},
    ],
    "decision": "PASS",
    "confidence": 90,
    "summary": "All criteria satisfied",
}
DEFAULT_SKEPTIC = {
    "challenges": [],
    "critical_found": False,
    "recommendation": "ACCEPT",
}


def _url_pattern(url):
    return re.escape(url)


def _payload(
    research=None,
    source=None,
    fact_check=None,
    analyst=None,
    skeptic=None,
):
    return {
        "research": research or DEFAULT_RESEARCH,
        "source": source or DEFAULT_SOURCE,
        "fact_check": fact_check or DEFAULT_FACT_CHECK,
        "analyst": analyst or DEFAULT_ANALYST,
        "skeptic": skeptic or DEFAULT_SKEPTIC,
    }


def _setup_mocks(vm, urls=URLS, payload=None):
    for u in urls:
        vm.mock_web(
            _url_pattern(u),
            {"status": 200, "body": "Example content containing verifiable facts."},
        )
    vm.mock_llm(r"five agent roles", json.dumps(payload or _payload()))


def _verify(direct_vm, contract, question=None, urls=None, policy_id="grant-v1"):
    q = question or "Is Example Repo eligible for the grant?"
    urls_json = json.dumps(urls or URLS)
    return contract.verify_with_policy(q, policy_id, urls_json)


# ----------------------------------------------------------------------
# Policy management
# ----------------------------------------------------------------------


def test_default_policy_registered(direct_vm, direct_deploy):
    contract = direct_deploy("contracts/verification_engine.py")
    ids = contract.get_policy_ids()
    assert "grant-v1" in ids
    for builtin in (
        "grant-v1",
        "dao-proposal-v1",
        "company-status-v1",
        "insurance-claim-v1",
        "service-status-v1",
    ):
        assert builtin in ids
    assert len(ids) == 5
    policy = contract.get_policy("grant-v1")
    assert policy["policy_id"] == "grant-v1"
    assert len(policy["criteria"]) == 5
    dao = contract.get_policy("dao-proposal-v1")
    assert len(dao["criteria"]) == 5
    company = contract.get_policy("company-status-v1")
    assert len(company["criteria"]) == 3
    insurance = contract.get_policy("insurance-claim-v1")
    assert len(insurance["criteria"]) == 3
    status = contract.get_policy("service-status-v1")
    assert len(status["criteria"]) == 1
    assert "https://github.com" in policy.get("allowed_origins", [])
    assert "https://gov.uniswap.org" in dao.get("allowed_origins", [])
    assert "https://api.open-meteo.com" in status.get("allowed_origins", [])


# ----------------------------------------------------------------------
# Decision states
# ----------------------------------------------------------------------


def test_verify_pass(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/verification_engine.py")
    direct_vm.sender = direct_alice
    _setup_mocks(direct_vm)

    vid = _verify(direct_vm, contract)
    v = contract.get_verification(vid)

    assert v["decision"] == "PASS"
    assert v["status"] == "VERIFIED"
    assert v["consensus"] == "CONSENSUS"
    assert v["version"] == 1
    assert v["confidence"] >= 80
    assert v["evidence"]["summary"]["rules_satisfied"] is True
    assert len(v["criteria"]) == 5
    assert all(c["result"] == "PASS" for c in v["criteria"])
    assert v["submitted_urls"] == URLS


def test_record_binds_sources_to_submitted_urls(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/verification_engine.py")
    direct_vm.sender = direct_alice
    _setup_mocks(direct_vm)
    vid = _verify(direct_vm, contract)
    v = contract.get_verification(vid)
    # Source category/authority are derived from the policy origins + actual
    # fetched URL, never from LLM claims.
    s = v["sources"][0]
    assert s["url"] == URLS[0]
    assert s["category"] == "PRIMARY"
    assert s["authority"] == "HIGH"
    # Evidence counters reflect what was actually fetched.
    assert v["evidence"]["summary"]["sources_ok"] >= 1


def test_verify_rejects_fabricated_source(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/verification_engine.py")
    direct_vm.sender = direct_alice
    _setup_mocks(
        direct_vm,
        payload=_payload(
            source={
                "sources": [
                    {
                        "url": "https://evil-example.com/fake-repo",
                        "category": "PRIMARY",
                        "authority": "HIGH",
                        "notes": "Fabricated",
                    }
                ],
                "overall_quality": "x",
            }
        ),
    )
    with direct_vm.expect_revert("not in submitted evidence set"):
        _verify(direct_vm, contract)


def test_verify_rejects_fabricated_citation(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/verification_engine.py")
    direct_vm.sender = direct_alice
    _setup_mocks(
        direct_vm,
        payload=_payload(
            research={
                "findings": [],
                "summary": "Corroborated at https://evil-example.com/claim",
            }
        ),
    )
    with direct_vm.expect_revert("cited URL not in submitted evidence set"):
        _verify(direct_vm, contract)


def test_verify_insufficient_evidence(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/verification_engine.py")
    direct_vm.sender = direct_alice
    _setup_mocks(direct_vm, urls=[URLS[0]])

    vid = _verify(direct_vm, contract, urls=[URLS[0]])
    v = contract.get_verification(vid)

    assert v["decision"] == "INSUFFICIENT_EVIDENCE"
    assert v["status"] == "INSUFFICIENT_EVIDENCE"
    assert v["confidence"] <= 30


def test_verify_missing_primary_source(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/verification_engine.py")
    direct_vm.sender = direct_alice
    # gitlab.com is an allowed origin but not the policy's primary origin.
    secondary_url = "https://gitlab.com/example/group"
    _setup_mocks(
        direct_vm,
        urls=[secondary_url],
        payload=_payload(
            source={
                "sources": [
                    {
                        "url": secondary_url,
                        "category": "SECONDARY",
                        "authority": "MEDIUM",
                        "notes": "Reputable reporting",
                    }
                ],
                "overall_quality": "reliable but secondary",
            }
        ),
    )

    vid = _verify(direct_vm, contract, urls=[secondary_url])
    v = contract.get_verification(vid)

    assert v["decision"] == "INSUFFICIENT_EVIDENCE"
    assert v["evidence"]["summary"]["primary_source"] is False


def test_verify_skeptic_requests_review(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/verification_engine.py")
    direct_vm.sender = direct_alice
    skeptic = {
        "challenges": [
            {"issue": "Commits may be low-impact", "severity": "MAJOR"}
        ],
        "critical_found": False,
        "recommendation": "REVIEW",
    }
    _setup_mocks(direct_vm, payload=_payload(skeptic=skeptic))

    vid = _verify(direct_vm, contract)
    v = contract.get_verification(vid)

    assert v["decision"] == "NEEDS_REVIEW"
    assert v["status"] == "REVIEW"
    assert len(v["challenges"]) == 1


def test_verify_fail_mandatory_criterion(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/verification_engine.py")
    direct_vm.sender = direct_alice
    analyst = json.loads(json.dumps(DEFAULT_ANALYST))
    for c in analyst["criteria"]:
        if c["id"] == "c2":
            c["result"] = "FAIL"
            c["reason"] = "no commits in 6 months"
    _setup_mocks(direct_vm, payload=_payload(analyst=analyst))

    vid = _verify(direct_vm, contract)
    v = contract.get_verification(vid)

    assert v["decision"] == "FAIL"
    assert v["status"] == "REJECTED"
    assert v["confidence"] <= 60


def test_irrelevant_evidence_not_pass(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/verification_engine.py")
    direct_vm.sender = direct_alice
    # Arbitrary/irrelevant evidence: every criterion UNKNOWN, skeptic REJECT.
    payload = _payload(
        analyst={
            "criteria": [
                {"id": f"c{i}", "result": "UNKNOWN", "reason": "no relevant evidence in source"}
                for i in range(1, 6)
            ],
            "decision": "NEEDS_REVIEW",
            "confidence": 20,
            "summary": "Sources do not address the question",
        },
        skeptic={
            "challenges": [
                {"issue": "No relevant evidence found in the provided sources", "severity": "CRITICAL"}
            ],
            "critical_found": True,
            "recommendation": "REJECT",
        },
    )
    _setup_mocks(direct_vm, payload=payload)
    vid = _verify(direct_vm, contract)
    v = contract.get_verification(vid)
    assert v["decision"] == "FAIL"
    assert v["status"] == "REJECTED"


# ----------------------------------------------------------------------
# Records, disputes, re-verification
# ----------------------------------------------------------------------


def test_my_and_recent_verifications(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/verification_engine.py")
    direct_vm.sender = direct_alice
    _setup_mocks(direct_vm)

    vid = _verify(direct_vm, contract)

    assert vid in contract.get_my_verifications()
    recent = contract.get_recent_verifications(5)
    assert any(r["verification_id"] == vid for r in recent)
    summary = contract.get_verification_summary(vid)
    assert vid in summary and "PASS" in summary


def test_challenge_marks_contested(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/verification_engine.py")
    direct_vm.sender = direct_alice
    _setup_mocks(direct_vm)

    vid = _verify(direct_vm, contract)
    contract.challenge(vid, "Official milestone doc was published after evidence snapshot")

    v = contract.get_verification(vid)
    assert v["status"] == "CONTESTED"
    assert v["consensus"] == "DISPUTED"
    assert v["version"] == 2
    assert len(v["disputes"]) == 1
    assert v["disputes"][0]["reason"].startswith("Official milestone")


def test_reverify_updates_version(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/verification_engine.py")
    direct_vm.sender = direct_alice
    _setup_mocks(direct_vm)

    vid = _verify(direct_vm, contract)
    assert contract.get_verification(vid)["version"] == 1

    contract.reverify(vid, json.dumps(URLS))
    v = contract.get_verification(vid)
    assert v["version"] == 2
    assert v["decision"] == "PASS"
    assert v["consensus"] == "CONSENSUS"


# ----------------------------------------------------------------------
# Failure handling
# ----------------------------------------------------------------------


def test_verify_unknown_policy_fails(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/verification_engine.py")
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("Policy 'nope' is not registered"):
        contract.verify_with_policy("question", "nope", json.dumps(URLS))


def test_verify_empty_question_fails(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/verification_engine.py")
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("question is required"):
        contract.verify_with_policy("  ", "grant-v1", json.dumps(URLS))


def test_verify_no_urls_fails(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/verification_engine.py")
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("at least one source URL is required"):
        contract.verify_with_policy("question", "grant-v1", "[]")


# ----------------------------------------------------------------------
# Security hardening
# ----------------------------------------------------------------------


def test_register_policy_removed(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/verification_engine.py")
    direct_vm.sender = direct_alice
    # open registration is disabled — policies are seeded at deploy only
    assert not hasattr(contract, "register_policy")


def test_verify_inline_removed(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/verification_engine.py")
    direct_vm.sender = direct_alice
    assert not hasattr(contract, "verify")


def test_owner_stored_in_record(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/verification_engine.py")
    direct_vm.sender = direct_alice
    _setup_mocks(direct_vm)
    vid = _verify(direct_vm, contract)
    v = contract.get_verification(vid)
    assert v["owner"] == to_hex(direct_alice)


def test_reverify_only_owner(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/verification_engine.py")
    direct_vm.sender = direct_alice
    _setup_mocks(direct_vm)
    vid = _verify(direct_vm, contract)

    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("only the verification owner"):
        contract.reverify(vid, json.dumps(URLS))

    direct_vm.sender = direct_alice
    contract.reverify(vid, json.dumps(URLS))
    assert contract.get_verification(vid)["version"] == 2


def test_challenge_only_once(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/verification_engine.py")
    direct_vm.sender = direct_alice
    _setup_mocks(direct_vm)
    vid = _verify(direct_vm, contract)

    direct_vm.sender = direct_bob
    contract.challenge(vid, "First dispute")
    with direct_vm.expect_revert("already under dispute"):
        contract.challenge(vid, "Second dispute")


def test_question_too_long_fails(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/verification_engine.py")
    direct_vm.sender = direct_alice
    long_question = "x" * 1001
    with direct_vm.expect_revert("question exceeds"):
        contract.verify_with_policy(long_question, "grant-v1", json.dumps(URLS))


def test_url_too_long_fails(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/verification_engine.py")
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("exceeds"):
        contract.verify_with_policy("q", "grant-v1", json.dumps(["https://" + "a" * 400]))


def test_allowed_origins_enforced(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/verification_engine.py")
    direct_vm.sender = direct_alice
    # insurance-claim-v1 restricts sources to its allowed_origins
    with direct_vm.expect_revert("not in policy allowed_origins"):
        contract.verify_with_policy(
            "Was BA123 cancelled?",
            "insurance-claim-v1",
            json.dumps(["https://www.docs.example.org/not-allowed"]),
        )


def test_reverify_enforces_allowed_origins(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/verification_engine.py")
    direct_vm.sender = direct_alice
    _insurance_mocks(direct_vm)
    vid = contract.verify_with_policy(
        "Was BA123 cancelled?",
        "insurance-claim-v1",
        json.dumps(INS_URLS),
    )
    with direct_vm.expect_revert("not in policy allowed_origins"):
        contract.reverify(vid, json.dumps(["https://www.docs.example.org/not-allowed"]))


def test_grant_allowed_origins_enforced(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/verification_engine.py")
    direct_vm.sender = direct_alice
    # grant-v1 only accepts sources from its allowed_origins
    with direct_vm.expect_revert("not in policy allowed_origins"):
        contract.verify_with_policy(
            "Is the project eligible?",
            "grant-v1",
            json.dumps(["https://www.evil-example.com/fake-repo"]),
        )


# ----------------------------------------------------------------------
# Insurance hardening: authoritative origins, revision history, parties
# ----------------------------------------------------------------------

INS_URLS = [
    "https://www.flightradar24.com/data/flights/ba123",
    "https://www.flightaware.com/live/flight/BAW123",
]


def _insurance_mocks(vm):
    for u in INS_URLS:
        vm.mock_web(_url_pattern(u), {"status": 200, "body": "Flight status data."})
    vm.mock_llm(
        r"five agent roles",
        json.dumps(
            _payload(
                source={
                    "sources": [
                        {
                            "url": INS_URLS[0],
                            "category": "PRIMARY",
                            "authority": "HIGH",
                            "notes": "Required flight tracker",
                        },
                        {
                            "url": INS_URLS[1],
                            "category": "SECONDARY",
                            "authority": "MEDIUM",
                            "notes": "Secondary flight tracker",
                        },
                    ],
                    "overall_quality": "good",
                }
            )
        ),
    )


def test_insurance_policy_hardened(direct_vm, direct_deploy):
    contract = direct_deploy("contracts/verification_engine.py")
    policy = contract.get_policy("insurance-claim-v1")
    assert policy.get("allowed_origins") is not None
    assert "https://www.flightradar24.com" in policy["allowed_origins"]
    assert policy.get("required_origin") == "https://www.flightradar24.com"
    assert policy.get("dispute_mode") == "parties"
    assert len(policy["criteria"]) == 3


def test_required_origin_enforced(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/verification_engine.py")
    direct_vm.sender = direct_alice
    # airline.example is allowed but not the required origin
    with direct_vm.expect_revert("required_origin"):
        contract.verify_with_policy(
            "Was BA123 cancelled?",
            "insurance-claim-v1",
            json.dumps([INS_URLS[1]]),
        )


def test_insurance_verify_accepts_required_origin(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/verification_engine.py")
    direct_vm.sender = direct_alice
    _insurance_mocks(direct_vm)
    vid = contract.verify_with_policy(
        "Was BA123 cancelled?",
        "insurance-claim-v1",
        json.dumps(INS_URLS),
    )
    v = contract.get_verification(vid)
    assert v["decision"] in ("PASS", "FAIL", "NEEDS_REVIEW", "INSUFFICIENT_EVIDENCE")


def test_challenge_parties_only_owner(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/verification_engine.py")
    direct_vm.sender = direct_alice
    _insurance_mocks(direct_vm)
    vid = contract.verify_with_policy(
        "Was BA123 cancelled?",
        "insurance-claim-v1",
        json.dumps(INS_URLS),
    )

    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("only authorized parties"):
        contract.challenge(vid, "Not authorized")

    direct_vm.sender = direct_alice
    contract.challenge(vid, "Official notice published later")
    v = contract.get_verification(vid)
    assert v["status"] == "CONTESTED"


def test_reverify_preserves_revision_history(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/verification_engine.py")
    direct_vm.sender = direct_alice
    _setup_mocks(direct_vm)
    vid = _verify(direct_vm, contract)
    v1 = contract.get_verification(vid)
    assert v1["version"] == 1

    contract.reverify(vid, json.dumps(URLS))
    v2 = contract.get_verification(vid)
    assert v2["version"] == 2
    assert isinstance(v2["revisions"], list)
    assert len(v2["revisions"]) == 1
    rev = v2["revisions"][0]
    assert rev["version"] == 1
    assert rev["decision"] == v1["decision"]
    assert rev["sources"] == v1["sources"]
    assert rev["evidence"] == v1["evidence"]
    assert rev["submitted_urls"] == URLS
    assert v2["submitted_urls"] == URLS


# ----------------------------------------------------------------------
# Consensus detail equivalence (doc Patterns 1 & 2)
# ----------------------------------------------------------------------

def _policy(conf_tol=20):
    return {"confidence_tolerance": conf_tol}


def _result(decision="PASS", confidence=80, criteria=None, sources_ok=2, primary=True):
    return {
        "decision": decision,
        "confidence": confidence,
        "criteria": criteria or [{"id": "c1", "result": "PASS"}],
        "evidence_summary": {
            "sources_ok": sources_ok,
            "primary_source": primary,
            "rules_satisfied": True,
        },
    }


def _consensus_fn(contract):
    """Resolve the module-level consensus_equivalent function."""
    import sys

    return sys.modules[type(contract).__module__].consensus_equivalent


def test_consensus_equivalent_basics(direct_vm, direct_deploy):
    contract = direct_deploy("contracts/verification_engine.py")
    consensus_equivalent = _consensus_fn(contract)
    policy = _policy()
    leader = _result()
    assert consensus_equivalent(leader, _result(), policy) is True
    # confidence within tolerance
    assert consensus_equivalent(leader, _result(confidence=95), policy) is True
    # confidence beyond tolerance
    assert consensus_equivalent(leader, _result(confidence=50), policy) is False
    # criteria direction tolerance: UNKNOWN ~ PASS / FAIL
    assert (
        consensus_equivalent(
            leader, _result(criteria=[{"id": "c1", "result": "UNKNOWN"}]), policy
        )
        is True
    )
    # criteria flip PASS vs FAIL must be rejected
    assert (
        consensus_equivalent(
            leader, _result(criteria=[{"id": "c1", "result": "FAIL"}]), policy
        )
        is False
    )


def test_consensus_equivalent_evidence(direct_vm, direct_deploy):
    contract = direct_deploy("contracts/verification_engine.py")
    consensus_equivalent = _consensus_fn(contract)
    policy = _policy()
    leader = _result()
    # sources_ok drift within ±1 accepted
    assert consensus_equivalent(leader, _result(sources_ok=3), policy) is True
    # sources_ok drift beyond ±1 rejected
    assert consensus_equivalent(leader, _result(sources_ok=0), policy) is False
    # primary_source mismatch rejected
    assert consensus_equivalent(leader, _result(primary=False), policy) is False
    # decision class disagreement rejected
    assert consensus_equivalent(leader, _result(decision="FAIL"), policy) is False


def test_expired_status_after_expiry(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/verification_engine.py")
    direct_vm.sender = direct_alice
    _setup_mocks(direct_vm)
    vid = _verify(direct_vm, contract)
    rec = contract.verifications[vid]
    assert contract._display_status(rec, now="2026-08-04T00:00:00Z") != "EXPIRED"
    assert contract._display_status(rec, now="2030-01-01T00:00:00Z") == "EXPIRED"
