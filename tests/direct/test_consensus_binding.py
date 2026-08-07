"""Unit tests for consensus & evidence-binding rules (pure module functions).

These import the contract source directly with a minimal `genlayer` stub so
the module-level helpers can be tested in isolation. The stub is installed
only for this import and removed afterwards so the VM-backed direct tests
still load the real runtime namespace.
"""

import importlib.util
import json
import sys
import types

import pytest


def _install_genlayer_stub() -> types.ModuleType:
    mod = types.ModuleType("genlayer")

    class _UserError(Exception):
        pass

    def _generic(name: str):
        return type(
            name,
            (),
            {"__class_getitem__": classmethod(lambda cls, *a, **k: cls)},
        )

    vm = types.SimpleNamespace(
        UserError=_UserError,
        Result=type("Result", (), {}),
        Return=type("Return", (), {}),
        run_nondet_unsafe=lambda *a, **k: None,
    )
    gl = types.SimpleNamespace(
        vm=vm,
        nondet=types.SimpleNamespace(
            exec_prompt=lambda *a, **k: {},
            web=types.SimpleNamespace(get=lambda *a, **k: None),
        ),
        public=types.SimpleNamespace(
            write=lambda fn: fn, view=lambda fn: fn, init=lambda fn: fn
        ),
        message=None,
        message_raw={},
        Event=type("Event", (), {}),
        Contract=type("Contract", (), {}),
    )
    mod.gl = gl
    mod.Address = _generic("Address")
    mod.TreeMap = _generic("TreeMap")
    mod.DynArray = _generic("DynArray")
    mod.u256 = int
    mod.allow_storage = lambda fn: fn
    sys.modules["genlayer"] = mod
    return mod


_prev_genlayer = sys.modules.get("genlayer")
_install_genlayer_stub()
_spec = importlib.util.spec_from_file_location(
    "_contract_verification_engine", "contracts/verification_engine.py"
)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
if _prev_genlayer is None:
    sys.modules.pop("genlayer", None)
else:
    sys.modules["genlayer"] = _prev_genlayer
sys.modules.pop("_contract_verification_engine", None)

consensus_equivalent = _mod.consensus_equivalent
aggregate = _mod.aggregate
_url_bound = _mod._url_bound
_source_category = _mod._source_category
DEFAULT_POLICY_JSON = _mod.DEFAULT_POLICY_JSON


def _policy():
    return json.loads(DEFAULT_POLICY_JSON)


def _verdict(criteria_ids=("c1", "c2", "c3", "c4", "c5"), decision="PASS"):
    return {
        "decision": decision,
        "confidence": 80,
        "criteria": [{"id": cid, "result": "PASS"} for cid in criteria_ids],
        "evidence_summary": {"sources_ok": 2, "primary_source": True},
    }


def test_consensus_agrees_when_all_mandatory_present():
    policy = _policy()
    assert consensus_equivalent(_verdict(), _verdict(), policy) is True


def test_consensus_rejects_missing_mandatory_criterion():
    policy = _policy()
    # c1 is mandatory; the validator omits it entirely.
    mine = _verdict(criteria_ids=("c2", "c3", "c4", "c5"))
    assert consensus_equivalent(_verdict(), mine, policy) is False


def test_consensus_allows_missing_non_mandatory_criterion():
    policy = _policy()
    # c4/c5 are not mandatory; omitting them is allowed.
    mine = _verdict(criteria_ids=("c1", "c2", "c3"))
    assert consensus_equivalent(_verdict(), mine, policy) is True


def test_consensus_rejects_pass_fail_flip_on_mandatory():
    policy = _policy()
    mine = _verdict(criteria_ids=("c1", "c2", "c3", "c4", "c5"))
    for c in mine["criteria"]:
        if c["id"] == "c1":
            c["result"] = "FAIL"
    assert consensus_equivalent(_verdict(), mine, policy) is False


def test_url_bound_exact_and_prefix():
    submitted = [
        "https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41",
        "https://www.flightradar24.com/data/flights/ba123",
    ]
    assert _url_bound(submitted[0], submitted) is True
    # Path-boundary prefix of a submitted URL is allowed.
    assert _url_bound("https://api.open-meteo.com/v1/forecast", submitted) is True
    assert _url_bound("https://www.flightradar24.com", submitted) is True
    assert _url_bound("https://evil-example.com/claim", submitted) is False


def test_aggregate_rejects_source_not_submitted():
    policy = _policy()
    with pytest.raises(Exception, match="not in submitted evidence set"):
        aggregate(
            policy,
            {},
            {"sources": [{"url": "https://evil-example.com/fake-repo"}]},
            {},
            {},
            {},
            [],
            ["https://github.com/example/repo"],
        )


def test_aggregate_rejects_cited_url_not_submitted():
    policy = _policy()
    with pytest.raises(Exception, match="cited URL not in submitted evidence set"):
        aggregate(
            policy,
            {"findings": [], "summary": "See https://evil-example.com/claim for proof."},
            {"sources": []},
            {},
            {},
            {},
            [],
            ["https://github.com/example/repo"],
        )


def test_source_category_deterministic():
    insurance = {
        "allowed_origins": [
            "https://www.flightradar24.com",
            "https://www.flightaware.com",
        ],
        "required_origin": "https://www.flightradar24.com",
    }
    assert _source_category("https://www.flightradar24.com/data/x", insurance, True) == (
        "PRIMARY",
        "HIGH",
    )
    assert _source_category("https://www.flightaware.com/x", insurance, True) == (
        "SECONDARY",
        "MEDIUM",
    )
    assert _source_category("https://evil.com/x", insurance, True) == (
        "UNVERIFIED",
        "LOW",
    )

    service = {"allowed_origins": ["https://api.open-meteo.com", "https://open-meteo.com"]}
    assert _source_category("https://api.open-meteo.com/v1/forecast", service, True) == (
        "PRIMARY",
        "HIGH",
    )

    # No origin constraints in the policy: an ok fetch is the primary evidence.
    assert _source_category("https://company.example/about", {}, True) == ("PRIMARY", "HIGH")
    assert _source_category("https://company.example/about", {}, False) == ("UNVERIFIED", "LOW")
