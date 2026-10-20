"""SIWE-style wallet authentication for talent-registry writes.

Flow: GET /auth/nonce issues a single-use nonce (5-minute TTL). The client
signs the canonical message below with personal_sign (EIP-191) and sends
X-BTAI-Address + X-BTAI-Signature headers with the write request. The server
recovers the signer, binds it to the address being registered/updated, and
burns the nonce, so a captured signature can never be replayed.

Signature recovery is chain-agnostic secp256k1/EIP-191 — identical on QUAI.
"""

import logging
import os
import secrets
import time
from typing import Dict, Optional, Tuple

from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi import Header, HTTPException

logger = logging.getLogger("btai-auth")

NONCE_TTL_SECONDS = 300
ISSUED_AT_GRACE_SECONDS = 300

# nonce -> (expiry, issued_at), unix seconds. In-memory by design: a nonce
# that survives a restart is a nonce an attacker could replay, so process
# restarts safely invalidate outstanding challenges.
_nonces: Dict[str, Tuple[float, int]] = {}


def _purge() -> None:
    now = time.time()
    expired = [n for n, (exp, _) in _nonces.items() if exp < now]
    for n in expired:
        del _nonces[n]


def issue_nonce() -> dict:
    _purge()
    nonce = secrets.token_hex(16)
    issued_at = int(time.time())
    _nonces[nonce] = (issued_at + NONCE_TTL_SECONDS, issued_at)
    return {"nonce": nonce, "expires_in": NONCE_TTL_SECONDS}


def build_message(address: str, nonce: str, issued_at: Optional[int] = None) -> str:
    """
    Canonical SIWE-style message. The Issued At line is bound to the server's
    nonce record — callers sign the message returned by /auth/nonce verbatim,
    so verification never depends on wall-clock agreement between two calls.
    """
    if issued_at is None:
        record = _nonces.get(nonce)
        if record is None:
            raise HTTPException(status_code=401, detail="Nonce is invalid, expired, or already used")
        issued_at = record[1]
    return (
        "BTAI Talent Agency wants you to sign in with your account:\n"
        f"{address}\n\n"
        "URI: btai://talent-registry\n"
        "Version: 1\n"
        f"Nonce: {nonce}\n"
        f"Issued At: {issued_at}"
    )


def verify_signature(address: str, nonce: str, signature: str) -> None:
    """Raises HTTPException(401) on any failure; burns the nonce on success."""
    record = _nonces.pop(nonce, None)
    if record is None or record[0] < time.time():
        raise HTTPException(status_code=401, detail="Nonce is invalid, expired, or already used")
    if not address or not address.startswith("0x") or len(address) != 42:
        raise HTTPException(status_code=401, detail="Invalid address")
    try:
        recovered = Account.recover_message(
            encode_defunct(text=build_message(address, nonce, issued_at=record[1])), signature=signature
        )
    except Exception as exc:
        logger.warning("Signature recovery failed: %s", exc)
        raise HTTPException(status_code=401, detail="Malformed signature")
    if recovered.lower() != address.lower():
        raise HTTPException(status_code=401, detail="Signature does not match the claimed address")


def require_wallet_auth(
    x_btai_address: str = Header(default=""),
    x_btai_nonce: str = Header(default=""),
    x_btai_signature: str = Header(default=""),
) -> str:
    """FastAPI dependency: returns the verified lowercase signer address."""
    if not x_btai_address or not x_btai_nonce or not x_btai_signature:
        raise HTTPException(
            status_code=401,
            detail="Wallet authentication required: X-BTAI-Address, X-BTAI-Nonce, X-BTAI-Signature",
        )
    verify_signature(x_btai_address, x_btai_nonce, x_btai_signature)
    return x_btai_address.lower()


def validate_address_for_chain(address: str) -> Tuple[bool, str]:
    """
    Validates an EVM-format address and, when BTAI_CHAIN=quai, enforces the
    Cyprus-1 shard prefix (0x00). Cross-shard payouts are stuck payouts.
    """
    if not address.startswith("0x") or len(address) != 42:
        return False, "Address must be a 42-char 0x-prefixed EVM address"
    try:
        int(address[2:], 16)
    except ValueError:
        return False, "Address is not valid hex"
    chain = os.getenv("BTAI_CHAIN", "quai")
    if chain == "quai":
        prefix = os.getenv("BTAI_QUAI_SHARD_PREFIX", "0x00")
        if not address.lower().startswith(prefix):
            return False, f"Address is not in the active QUAI shard (must start with {prefix})"
        # QUAI-ledger guard: MSB of byte 1 set marks a Qi (UTXO) address,
        # which cannot receive escrow payouts.
        if int(address[4:6], 16) >= 0x80:
            return False, "Address is a Qi-ledger address; need a QUAI account address"
    return True, ""
