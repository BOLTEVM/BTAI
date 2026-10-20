import type { Chain, Hex } from "viem";

/**
 * QUAI Network settlement configuration for the BTAI x402 rail.
 *
 * QUAI differs from every legacy rail in this app:
 *  - Transactions are protobuf-encoded — signing and broadcasting must go
 *    through the Pelagus wallet's EIP-1193 provider (it encodes internally),
 *    never through raw RLP tooling.
 *  - Settlement is gasless for the client: they sign an EIP-712
 *    EscrowAuthorization and the BTAI facilitator settles on-chain via
 *    `TalentAgentQuai.create_and_deposit_for`. The client only needs a
 *    one-time token approval to the escrow.
 *  - Only the Cyprus-1 zone is active: every address must carry the 0x00
 *    shard prefix. Cross-shard payouts are stuck payouts.
 */

export const quai: Chain = {
  id: 9,
  name: "Quai Network",
  nativeCurrency: { name: "QUAI", symbol: "QUAI", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.quai.network"] } },
  blockExplorers: { default: { name: "Quaiscan", url: "https://quaiscan.io" } },
};

export const quaiOrchard: Chain = {
  id: 15000,
  name: "Quai Orchard Testnet",
  nativeCurrency: { name: "QUAI", symbol: "QUAI", decimals: 18 },
  rpcUrls: { default: { http: ["https://orchard.rpc.quai.network"] } },
  blockExplorers: { default: { name: "Quaiscan", url: "https://orchard.quaiscan.io" } },
  testnet: true,
};

export const QUAI_SHARD_PREFIX = "0x00";

/**
 * True when the address is a spendable QUAI (EVM-ledger) account in the
 * active Cyprus-1 shard:
 *  - byte 0 === 0x00  (Cyprus-1 zone)
 *  - byte 1 < 0x80    (QUAI account ledger; MSB set means a Qi UTXO address,
 *                      which faucets, Pelagus QUAI sends, and this escrow
 *                      cannot pay)
 */
export function isCyprus1Address(address: string): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return false;
  if (!address.toLowerCase().startsWith(QUAI_SHARD_PREFIX)) return false;
  return parseInt(address.slice(4, 6), 16) < 0x80;
}

export interface QuaiSettlementDeployment {
  label: string;
  chain: Chain;
  /** Allowlisted settlement token on the escrow (bridged USDT / WQI). */
  tokenAddress: Hex | null;
  decimals: 6;
  testnet: boolean;
  /** x402 network identifier (CAIP-2). */
  caip2: `eip155:${number}`;
}

export const QUAI_REGISTRY = {
  quai: {
    label: "Quai",
    chain: quai,
    tokenAddress: (process.env.NEXT_PUBLIC_QUAI_SETTLEMENT_TOKEN || null) as Hex | null,
    decimals: 6,
    testnet: false,
    caip2: "eip155:9",
  },
  quaiOrchard: {
    label: "Quai Orchard",
    chain: quaiOrchard,
    tokenAddress: (process.env.NEXT_PUBLIC_QUAI_ORCHARD_SETTLEMENT_TOKEN || null) as Hex | null,
    decimals: 6,
    testnet: true,
    caip2: "eip155:15000",
  },
} as const satisfies Record<string, QuaiSettlementDeployment>;

export type QuaiNetwork = keyof typeof QUAI_REGISTRY;

export function isQuaiNetwork(network: string): network is QuaiNetwork {
  return network in QUAI_REGISTRY;
}

/** EIP-712 typed-data definition for the escrow authorization. */
export const ESCROW_AUTH_TYPES = {
  EscrowAuthorization: [
    { name: "client", type: "address" },
    { name: "talent", type: "address" },
    { name: "token", type: "address" },
    { name: "total", type: "uint256" },
    { name: "disputeWindow", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export const ESCROW_AUTH_DOMAIN_NAME = "BTAI Talent Agency";
export const ESCROW_AUTH_DOMAIN_VERSION = "1";
