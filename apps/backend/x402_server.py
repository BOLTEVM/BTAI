"""x402 resource-server logic for Dark Star Rail (the BTAI talent agency rail).

The backend plays the x402 *resource server* role: engagement requests get a
402 challenge; the client signs an EscrowAuthorization (EIP-712) and retries
with a PAYMENT-SIGNATURE header; the backend forwards to the self-hosted
facilitator for verification and on-chain settlement on QUAI.

Scheme: btai-escrow (receive-style `exact` variant) — see packages/facilitator.
"""

import base64
import hashlib
import json
import logging
import os
from typing import Optional

import requests
from fastapi import HTTPException

logger = logging.getLogger("btai-x402")

SCHEME = "btai-escrow"
X402_VERSION = 2
TOKEN_DECIMALS = 6  # bridged USDT / WQI-style settlement tokens


def normalize_facilitator_url(raw: str) -> str:
    """Accept schemeless host:port values (Render's fromService hostport property)."""
    url = raw.strip().rstrip("/")
    if url and "://" not in url:
        url = "http://" + url
    return url


def x402_config() -> dict:
    return {
        "facilitator_url": normalize_facilitator_url(os.getenv("FACILITATOR_URL", "http://localhost:3402")),
        "network": os.getenv("X402_NETWORK", "eip155:9"),
        "escrow": os.getenv("ESCROW_ADDRESS", ""),
        "settlement_token": os.getenv("SETTLEMENT_TOKEN", ""),
        "max_timeout_seconds": int(os.getenv("MAX_TIMEOUT_SECONDS", "300")),
        "dispute_window": int(os.getenv("DISPUTE_WINDOW_SECONDS", str(7 * 24 * 3600))),
    }


def rate_to_atomic(rate_usd_per_hour: float) -> str:
    """One milestone = one hour of the talent's rate, in token atomic units."""
    return str(int(round(rate_usd_per_hour * (10 ** TOKEN_DECIMALS))))


def build_requirements(talent: dict, resource: str) -> dict:
    cfg = x402_config()
    if not cfg["escrow"] or not cfg["settlement_token"]:
        raise HTTPException(status_code=503, detail="x402 rail is not configured (ESCROW_ADDRESS / SETTLEMENT_TOKEN)")
    amount = rate_to_atomic(talent["rate"])
    return {
        "scheme": SCHEME,
        "network": cfg["network"],
        "maxAmountRequired": amount,
        "resource": resource,
        "payTo": cfg["escrow"],
        "asset": cfg["settlement_token"],
        "maxTimeoutSeconds": cfg["max_timeout_seconds"],
        "extra": {
            # PINNED ON-CHAIN: the deployed TalentAgentQuai escrows verify the
            # EIP-712 domain name "BTAI Talent Agency" (NAME_HASH constant). The
            # public brand is Dark Star Rail; this string must never change.
            "name": "BTAI Talent Agency",
            "version": "1",
            "talent": talent["receive_address"],
            "amounts": [amount],
            "disputeWindow": str(cfg["dispute_window"]),
        },
    }


def decode_payment_signature(header_value: str) -> dict:
    try:
        return json.loads(base64.b64decode(header_value).decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=400, detail="Malformed PAYMENT-SIGNATURE header")


def idempotency_key_for(payload: dict) -> str:
    """Stable key: the (client, nonce) pair uniquely names a settlement."""
    try:
        auth = payload["payload"]["authorization"]
        raw = f"{auth['client'].lower()}:{auth['nonce'].lower()}"
    except (KeyError, TypeError):
        raw = json.dumps(payload, sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()


def verify_and_settle(payload: dict, requirements: dict) -> dict:
    """
    Calls the facilitator /verify then /settle. Raises HTTPException(402) with
    the failure reason when the payment cannot be accepted, so the client sees
    a renewed challenge rather than a generic 500.
    """
    cfg = x402_config()
    url = cfg["facilitator_url"].rstrip("/")
    try:
        verify_res = requests.post(f"{url}/verify", json=payload, timeout=30)
        verify_body = verify_res.json()
    except requests.RequestException as exc:
        logger.error("Facilitator unreachable: %s", exc)
        raise HTTPException(status_code=503, detail="Payment facilitator is unavailable")

    if verify_res.status_code != 200 or not verify_body.get("isValid"):
        raise HTTPException(
            status_code=402,
            detail=f"Payment verification failed: {verify_body.get('invalidReason', 'unknown')}",
        )

    try:
        settle_res = requests.post(
            f"{url}/settle",
            json=payload,
            headers={"Idempotency-Key": idempotency_key_for(payload)},
            timeout=60,
        )
        settle_body = settle_res.json()
    except requests.RequestException as exc:
        logger.error("Facilitator settlement call failed: %s", exc)
        raise HTTPException(status_code=503, detail="Payment settlement is unavailable")

    if settle_res.status_code != 200 or not settle_body.get("success"):
        raise HTTPException(
            status_code=402,
            detail=f"Payment settlement failed: {settle_body.get('errorReason', 'unknown')}",
        )
    return settle_body
