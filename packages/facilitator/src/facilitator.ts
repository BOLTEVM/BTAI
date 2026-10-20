import { ethers } from "ethers";
import { ChainAdapter } from "./chainAdapter";
import { FacilitatorConfig } from "./config";
import { recoverAuthorizationSigner, totalOf } from "./eip712";
import { NonceRegistry } from "./nonceRegistry";
import {
  EscrowAuthorization,
  PaymentPayload,
  SCHEME,
  SettleResponse,
  VerifyResponse,
  X402_VERSION,
} from "./types";

const MIN_DISPUTE_WINDOW = 259200; // keep in sync with TalentAgentQuai.vy
const MAX_DISPUTE_WINDOW = 2592000;
const MAX_MILESTONES = 32;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL_RE = /^[0-9]+$/;

/**
 * Facilitator core: verifies signed escrow authorizations and settles them
 * on-chain. Pure logic — the HTTP surface lives in server.ts.
 */
export class Facilitator {
  constructor(
    private config: FacilitatorConfig,
    private adapter: ChainAdapter,
    private registry: NonceRegistry,
    private now: () => number = () => Math.floor(Date.now() / 1000)
  ) {}

  /** Validates a payment payload without touching the chain state machine. */
  async verify(payload: PaymentPayload, opts: { checkRegistryNonce?: boolean } = {}): Promise<VerifyResponse> {
    const shapeError = this.checkShape(payload);
    if (shapeError) return { isValid: false, invalidReason: shapeError };

    const auth = payload.payload.authorization;
    const total = totalOf(auth.amounts);

    let payer: string;
    try {
      payer = recoverAuthorizationSigner(
        auth,
        total,
        payload.payload.signature,
        this.config.chainId,
        this.config.escrowAddress
      );
    } catch {
      return { isValid: false, invalidReason: "malformed_signature" };
    }
    if (payer.toLowerCase() !== auth.client.toLowerCase()) {
      return { isValid: false, invalidReason: "signature_mismatch" };
    }

    // The local registry check is skipped on the settle path: settle() owns
    // replay protection through the idempotency key + UNIQUE(client, nonce),
    // and must be able to retry a previously failed settlement.
    if (opts.checkRegistryNonce !== false && this.registry.isNonceUsed(auth.client, auth.nonce)) {
      return { isValid: false, invalidReason: "nonce_already_used" };
    }

    let state;
    try {
      state = await this.adapter.getChainState(auth.client, auth.token, auth.nonce);
    } catch (err) {
      return { isValid: false, invalidReason: `chain_read_failed: ${(err as Error).message}` };
    }
    if (!state.tokenAllowed) return { isValid: false, invalidReason: "token_not_allowlisted" };
    if (state.paused) return { isValid: false, invalidReason: "escrow_paused" };
    if (state.authorizationUsed) return { isValid: false, invalidReason: "nonce_already_used_onchain" };
    if (state.balance.lt(total)) return { isValid: false, invalidReason: "insufficient_balance" };
    if (state.allowance.lt(total)) return { isValid: false, invalidReason: "insufficient_allowance" };

    return { isValid: true, payer };
  }

  /**
   * Verifies, then settles on-chain. Idempotent: the Idempotency-Key and the
   * (client, nonce) UNIQUE constraint make double-settlement impossible across
   * retries, races, and restarts.
   */
  async settle(payload: PaymentPayload, idempotencyKey: string): Promise<SettleResponse> {
    const auth = payload.payload.authorization;
    const existing = this.registry.getByIdempotencyKey(idempotencyKey);
    if (existing) {
      if (existing.status === "settled") {
        return {
          success: true,
          transaction: existing.txHash,
          network: this.config.network,
          agreementId: existing.agreementId,
        };
      }
      if (existing.status === "pending") {
        return { success: false, errorReason: "settlement_in_progress", network: this.config.network };
      }
      // failed → fall through and retry under the same key.
    }

    const verification = await this.verify(payload, { checkRegistryNonce: false });
    if (!verification.isValid) {
      return { success: false, errorReason: verification.invalidReason, network: this.config.network };
    }

    if (!existing) {
      const begun = this.registry.beginSettlement(idempotencyKey, auth.client, auth.nonce);
      if (!begun) {
        // Lost a race or nonce replayed between verify and insert.
        return { success: false, errorReason: "duplicate_settlement", network: this.config.network };
      }
    }

    const total = totalOf(auth.amounts);
    try {
      const result = await this.adapter.settle(auth, total, payload.payload.signature);
      this.registry.markSettled(idempotencyKey, result.txHash, result.agreementId);
      return {
        success: true,
        transaction: result.txHash,
        network: this.config.network,
        agreementId: result.agreementId,
      };
    } catch (err) {
      const reason = (err as Error).message;
      this.registry.markFailed(idempotencyKey, reason);
      return { success: false, errorReason: `onchain_settlement_failed: ${reason}`, network: this.config.network };
    }
  }

  /** Structural and policy checks — everything decidable without chain reads. */
  private checkShape(payload: PaymentPayload): string | undefined {
    if (!payload || payload.x402Version !== X402_VERSION) return "unsupported_x402_version";
    if (payload.scheme !== SCHEME) return "unsupported_scheme";
    if (payload.network !== this.config.network) return "unsupported_network";

    const auth: EscrowAuthorization = payload.payload?.authorization;
    const signature = payload.payload?.signature;
    if (!auth || typeof signature !== "string" || !signature.startsWith("0x")) return "malformed_payload";

    for (const addr of [auth.client, auth.talent, auth.token]) {
      if (!ADDRESS_RE.test(addr || "")) return "invalid_address";
    }
    if (this.config.shardPrefix) {
      for (const addr of [auth.client, auth.talent]) {
        // Cyprus-1 shard guard: cross-shard payouts are stuck payouts.
        if (!addr.toLowerCase().startsWith(this.config.shardPrefix)) return "address_wrong_shard";
        // QUAI-ledger guard: MSB of byte 1 set means a Qi (UTXO) address,
        // which the escrow cannot pay out.
        if (parseInt(addr.slice(4, 6), 16) >= 0x80) return "address_wrong_shard";
      }
    }
    if (this.config.settlementTokens.length > 0) {
      if (!this.config.settlementTokens.includes(auth.token.toLowerCase())) return "token_not_configured";
    }

    if (!Array.isArray(auth.amounts) || auth.amounts.length === 0 || auth.amounts.length > MAX_MILESTONES) {
      return "invalid_amounts";
    }
    for (const a of auth.amounts) {
      if (!DECIMAL_RE.test(a) || ethers.BigNumber.from(a).isZero()) return "invalid_amounts";
    }

    if (!DECIMAL_RE.test(auth.disputeWindow || "")) return "invalid_dispute_window";
    const window = Number(auth.disputeWindow);
    if (window < MIN_DISPUTE_WINDOW || window > MAX_DISPUTE_WINDOW) return "dispute_window_out_of_bounds";

    if (!DECIMAL_RE.test(auth.validBefore || "")) return "invalid_valid_before";
    if (Number(auth.validBefore) <= this.now()) return "authorization_expired";
    if (Number(auth.validBefore) > this.now() + this.config.maxTimeoutSeconds) {
      return "validity_window_too_long";
    }

    if (!BYTES32_RE.test(auth.nonce || "")) return "invalid_nonce";

    return undefined;
  }
}
