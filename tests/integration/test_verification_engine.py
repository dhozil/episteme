"""Integration tests for the VERIFY engine.

Run against a GenLayer environment (Studio local/hosted or GLSim):

    gltest tests/integration/ -v -s --network localnet

These use real consensus (leader/validator) and real web/LLM calls, so
they are slower and cost gas. Keep them to one happy-path flow.
"""

import json
import pytest

from gltest import get_contract_factory
from gltest.assertions import tx_execution_succeeded

pytestmark = pytest.mark.integration


def test_verify_live_flow():
    factory = get_contract_factory("VerificationEngine")
    contract = factory.deploy(args=[])

    policy_ids = contract.get_policy_ids().call()
    assert "grant-v1" in policy_ids

    urls = json.dumps([
        "https://github.com/genlayerlabs/genlayer-py",
        "https://docs.genlayer.com/developers",
    ])
    receipt = contract.verify_with_policy(
        args=["Is genlayer-py actively maintained?", "grant-v1", urls]
    ).transact()
    assert tx_execution_succeeded(receipt)

    vid = contract.get_recent_verifications(args=[1]).call()[0]["verification_id"]
    record = contract.get_verification(args=[vid]).call()
    assert record["decision"] in (
        "PASS",
        "FAIL",
        "NEEDS_REVIEW",
        "INSUFFICIENT_EVIDENCE",
    )
    assert record["status"] in (
        "VERIFIED",
        "REJECTED",
        "REVIEW",
        "INSUFFICIENT_EVIDENCE",
    )
