/**
 * x402 wire types for the BTAI escrow settlement scheme.
 *
 * Scheme `btai-escrow` is a receive-style variant of `exact`: instead of an
 * EIP-3009 transferWithAuthorization directly to payTo (which no QUAI token
 * implements), the client signs an EIP-712 `EscrowAuthorization` and the
 * facilitator settles it by calling `TalentAgentQuai.create_and_deposit_for`
 * on-chain, which pulls the tokens into escrow and opens the agreement
 * atomically. The client never pays gas.
 */

export interface EscrowAuthorization {
  /** Payer — the client whose tokens are escrowed. */
  client: string;
  /** Agreement beneficiary. */
  talent: string;
  /** Allowlisted QRC-20/ERC-20 settlement token. */
  token: string;
  /** Milestone amounts in atomic units, decimal strings. 1..32 entries. */
  amounts: string[];
  /** Dispute window in seconds (contract enforces 3–30 days). */
  disputeWindow: string;
  /** Unix seconds after which the authorization is void. */
  validBefore: string;
  /** Random 32-byte nonce, 0x-hex. Single-use per client. */
  nonce: string;
}

export interface PaymentPayload {
  x402Version: number;
  scheme: string;
  /** CAIP-2 identifier, e.g. "eip155:9" for QUAI mainnet. */
  network: string;
  payload: {
    signature: string;
    authorization: EscrowAuthorization;
  };
}

export interface PaymentRequirements {
  scheme: string;
  network: string;
  /** Total of amounts, atomic units, decimal string. */
  maxAmountRequired: string;
  /** Always the escrow contract in the btai-escrow scheme. */
  payTo: string;
  asset: string;
  maxTimeoutSeconds: number;
  extra: {
    name: string;
    version: string;
    talent: string;
    amounts: string[];
    disputeWindow: string;
  };
}

export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

export interface SettleResponse {
  success: boolean;
  errorReason?: string;
  transaction?: string;
  network: string;
  agreementId?: string;
}

export const SCHEME = "btai-escrow";
export const X402_VERSION = 2;
export const EIP712_NAME = "BTAI Talent Agency";
export const EIP712_VERSION = "1";

export const AUTH_TYPES = {
  EscrowAuthorization: [
    { name: "client", type: "address" },
    { name: "talent", type: "address" },
    { name: "token", type: "address" },
    { name: "total", type: "uint256" },
    { name: "disputeWindow", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};
