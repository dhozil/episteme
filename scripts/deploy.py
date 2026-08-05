"""Deploy the VerificationEngine to GenLayer Studio and save the address.

Usage: python scripts/deploy.py [--account-key KEY]
Saves the deployed address to artifacts/deployed_address.txt
"""

import json
import os
import sys
import time
from pathlib import Path

from genlayer_py import create_client, create_account
from genlayer_py.chains import studionet
from genlayer_py.types.transactions import is_decided_state

ROOT = Path(__file__).resolve().parent.parent
CONTRACT_PATH = ROOT / "contracts" / "verification_engine.py"
ARTIFACTS = ROOT / "artifacts"
ADDRESS_FILE = ARTIFACTS / "deployed_address.txt"
ENDPOINT = "https://studio.genlayer.com/api"


def load_account():
    key = os.environ.get("ACCOUNT_PRIVATE_KEY_1") or os.environ.get("PRIVATE_KEY")
    if key:
        return create_account(key)
    return create_account()


def wait_for_finality(client, tx_id, timeout_s=1800, interval_s=20):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        tx = client.get_transaction(tx_id)
        status = str(tx.get("status"))
        print(
            f"  status={status} ({tx.get('status_name')}) "
            f"result={tx.get('result_name')} rounds={tx.get('num_of_rounds')}",
            flush=True,
        )
        if is_decided_state(status):
            return tx
        time.sleep(interval_s)
    raise TimeoutError(f"transaction {tx_id} not decided within {timeout_s}s")


def main():
    code = CONTRACT_PATH.read_text(encoding="utf-8")
    account = load_account()
    client = create_client(chain=studionet, endpoint=ENDPOINT, account=account)
    print(f"Deploying from: {account.address}")

    tx_hash = client.deploy_contract(code=code, args=[])
    print(f"Deploy tx: {tx_hash}")
    tx = wait_for_finality(client, tx_hash)

    decoded = tx.get("tx_data_decoded") or {}
    recipient = tx.get("recipient") or tx.get("to_address")
    print("status:", tx.get("status_name"), "result:", tx.get("result_name"))
    print("decoded:", json.dumps(decoded, default=str)[:400])
    print("recipient:", recipient)

    # Contract address candidates
    candidates = []
    if decoded.get("contract_address"):
        candidates.append(decoded["contract_address"])
    if recipient and recipient.lower() not in ("0x0000000000000000000000000000000000000000", "0x"):
        candidates.append(recipient)

    if not candidates:
        raise SystemExit("Could not determine deployed contract address from receipt")

    address = candidates[0]
    ARTIFACTS.mkdir(exist_ok=True)
    ADDRESS_FILE.write_text(address.strip(), encoding="utf-8")
    print(f"\nDeployed contract address: {address}")
    print(f"Saved to: {ADDRESS_FILE}")


if __name__ == "__main__":
    main()
