"""Backend test suite: wallet auth, shard validation, x402 engage flow.

Run from apps/backend:  python -m pytest test_api.py -v
Uses an isolated SQLite DB per run and a stubbed facilitator — no network.
"""

import base64
import json
import os
import sys
import tempfile

import pytest

# Isolate the test database BEFORE importing the app modules (main.py reads
# BTAI_DB_PATH at import time).
_tmpdir = tempfile.mkdtemp(prefix="btai-test-")
os.environ["BTAI_DB_PATH"] = os.path.join(_tmpdir, "test-talent.db")
os.environ["BTAI_CHAIN"] = "quai"
os.environ["X402_NETWORK"] = "eip155:9"
os.environ["ESCROW_ADDRESS"] = "0x00" + "aa" * 19
os.environ["SETTLEMENT_TOKEN"] = "0x00" + "bb" * 19
os.environ["FACILITATOR_URL"] = "http://facilitator.test"

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi.testclient import TestClient

import auth
import main
from main import app

client = TestClient(app)

# Test wallets. QUAI mode requires a QUAI-ledger Cyprus-1 address: byte 0 is
# 0x00 (shard) and byte 1 < 0x80 (MSB set would mark a Qi UTXO address).
def _shard_account():
    while True:
        acct = Account.create()
        if acct.address.lower().startswith("0x00") and int(acct.address[4:6], 16) < 0x80:
            return acct


ALICE = _shard_account()  # talent
BOB = Account.create()    # client (no shard constraint for auth tests on writes)

PROFILE = {
    "name": "Alice Agent",
    "role": "smart-contract auditor",
    "rate": 120.0,
    "bio": "Vyper and Solidity audits for escrow systems.",
    "skills": ["vyper", "solidity"],
    "image_url": None,
}


def _signed_headers(account, address=None):
    """Fresh nonce + personal_sign over the canonical message."""
    address = address or account.address
    nonce = client.get("/auth/nonce").json()["nonce"]
    message = auth.build_message(address, nonce)
    signed = Account.sign_message(encode_defunct(text=message), account.key)
    return {
        "X-BTAI-Address": address,
        "X-BTAI-Nonce": nonce,
        "X-BTAI-Signature": signed.signature.hex(),
    }


@pytest.fixture(autouse=True)
def fresh_db():
    # Re-init schema on the shared test DB path between tests.
    with main.closing(main.get_connection()) as conn:
        conn.execute("DROP TABLE IF EXISTS talents")
    main.init_db()
    yield


def test_health():
    assert client.get("/health").json()["status"] == "ok"


def test_shard_prefix_enforced_in_quai_mode():
    payload = {**PROFILE, "receive_address": BOB.address}  # not 0x00-prefixed
    res = client.post("/talent", json=payload, headers=_signed_headers(BOB))
    assert res.status_code == 422  # pydantic validation rejects the address


def test_register_requires_matching_signature():
    payload = {**PROFILE, "receive_address": ALICE.address}
    # Bob signs but claims Alice's payout address — must be rejected.
    res = client.post("/talent", json=payload, headers=_signed_headers(BOB, address=ALICE.address))
    assert res.status_code in (401, 403)


def test_register_and_get_talent():
    payload = {**PROFILE, "receive_address": ALICE.address}
    res = client.post("/talent", json=payload, headers=_signed_headers(ALICE))
    assert res.status_code == 201, res.text
    talent = res.json()
    assert talent["receive_address"] == ALICE.address

    listed = client.get("/talent").json()
    assert len(listed) == 1


def test_nonce_cannot_be_replayed():
    payload = {**PROFILE, "receive_address": ALICE.address}
    headers = _signed_headers(ALICE)
    assert client.post("/talent", json=payload, headers=headers).status_code == 201
    # Same headers again: the nonce is burned.
    assert client.post("/talent", json=payload, headers=headers).status_code == 401


def test_update_requires_owner():
    payload = {**PROFILE, "receive_address": ALICE.address}
    created = client.post("/talent", json=payload, headers=_signed_headers(ALICE)).json()

    stranger = _shard_account()
    update = {**PROFILE, "bio": "hijacked", "receive_address": ALICE.address}
    res = client.put(f"/talent/{created['id']}", json=update, headers=_signed_headers(stranger))
    assert res.status_code == 403

    res = client.put(f"/talent/{created['id']}", json=update, headers=_signed_headers(ALICE))
    assert res.status_code == 200
    assert res.json()["bio"] == "hijacked"


def _register_alice():
    payload = {**PROFILE, "receive_address": ALICE.address}
    return client.post("/talent", json=payload, headers=_signed_headers(ALICE)).json()


def test_engage_returns_402_challenge():
    talent = _register_alice()
    res = client.get(f"/engage/{talent['id']}")
    assert res.status_code == 402
    body = res.json()
    assert body["x402Version"] == 2
    req = body["accepts"][0]
    assert req["scheme"] == "btai-escrow"
    assert req["network"] == "eip155:9"
    assert req["payTo"] == os.environ["ESCROW_ADDRESS"]
    assert req["extra"]["talent"] == ALICE.address
    assert req["maxAmountRequired"] == str(int(120.0 * 10**6))
    # PAYMENT-REQUIRED header mirrors the body.
    header = json.loads(base64.b64decode(res.headers["PAYMENT-REQUIRED"]).decode())
    assert header["accepts"][0]["scheme"] == "btai-escrow"


def test_engage_full_flow_with_stubbed_facilitator(monkeypatch):
    talent = _register_alice()

    calls = {"verify": 0, "settle": 0}

    class FakeResponse:
        def __init__(self, status_code, body):
            self.status_code = status_code
            self._body = body

        def json(self):
            return self._body

    def fake_post(url, json=None, headers=None, timeout=None):
        if url.endswith("/verify"):
            calls["verify"] += 1
            return FakeResponse(200, {"isValid": True, "payer": BOB.address})
        if url.endswith("/settle"):
            calls["settle"] += 1
            assert headers and headers.get("Idempotency-Key")
            return FakeResponse(200, {"success": True, "transaction": "0x" + "cd" * 32, "agreementId": "0"})
        raise AssertionError(f"unexpected URL {url}")

    monkeypatch.setattr("x402_server.requests.post", fake_post)

    payload = {
        "x402Version": 2,
        "scheme": "btai-escrow",
        "network": "eip155:9",
        "payload": {
            "signature": "0x" + "11" * 65,
            "authorization": {
                "client": BOB.address,
                "talent": ALICE.address,
                "token": os.environ["SETTLEMENT_TOKEN"],
                "amounts": [str(int(120.0 * 10**6))],
                "disputeWindow": "604800",
                "validBefore": "9999999999",
                "nonce": "0x" + "42" * 32,
            },
        },
    }
    header = base64.b64encode(json.dumps(payload).encode()).decode()
    res = client.get(f"/engage/{talent['id']}", headers={"PAYMENT-SIGNATURE": header})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "engaged"
    assert body["settlement"]["transaction"] == "0x" + "cd" * 32
    assert calls == {"verify": 1, "settle": 1}


def test_engage_propagates_facilitator_rejection(monkeypatch):
    talent = _register_alice()

    class FakeResponse:
        def __init__(self, status_code, body):
            self.status_code = status_code
            self._body = body

        def json(self):
            return self._body

    monkeypatch.setattr(
        "x402_server.requests.post",
        lambda url, **kwargs: FakeResponse(422, {"isValid": False, "invalidReason": "insufficient_balance"}),
    )

    payload = {"x402Version": 2, "scheme": "btai-escrow", "network": "eip155:9", "payload": {}}
    header = base64.b64encode(json.dumps(payload).encode()).decode()
    res = client.get(f"/engage/{talent['id']}", headers={"PAYMENT-SIGNATURE": header})
    assert res.status_code == 402
    assert "insufficient_balance" in res.json()["detail"]
