/**
 * Facilitator configuration from environment. Everything operational is
 * env-driven; nothing secret lives in source.
 */
export interface FacilitatorConfig {
  port: number;
  /** CAIP-2 network this instance serves, e.g. "eip155:9" or "eip155:15000". */
  network: string;
  chainId: number;
  rpcUrl: string;
  /** Settlement key — the escrow's `agent`. Hot wallet: keep its balance capped. */
  privateKey: string;
  escrowAddress: string;
  /** Allowlisted settlement tokens (lowercase), csv in env. */
  settlementTokens: string[];
  /** Cyprus-1 shard prefix ("0x00"). Empty string disables the check (local dev). */
  shardPrefix: string;
  maxTimeoutSeconds: number;
  nonceDbPath: string;
  /** "quai" uses quais.js (protobuf txs); "local" uses ethers (Hardhat/Anvil dev). */
  adapter: "quai" | "local";
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): FacilitatorConfig {
  const chainId = Number(env.FACILITATOR_CHAIN_ID || "9");
  return {
    // Render injects PORT=10000 for Docker services and reports the service address
    // with it; FACILITATOR_PORT wins when set explicitly, then PORT, then 3402.
    port: Number(env.FACILITATOR_PORT || env.PORT || "3402"),
    network: env.FACILITATOR_NETWORK || `eip155:${chainId}`,
    chainId,
    rpcUrl: env.QUAI_RPC_URL || env.FACILITATOR_RPC_URL || "https://rpc.quai.network",
    privateKey: env.FACILITATOR_PRIVATE_KEY || "",
    escrowAddress: required("ESCROW_ADDRESS"),
    settlementTokens: (env.SETTLEMENT_TOKENS || "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
    shardPrefix: env.QUAI_SHARD_PREFIX === undefined ? "0x00" : env.QUAI_SHARD_PREFIX,
    maxTimeoutSeconds: Number(env.MAX_TIMEOUT_SECONDS || "300"),
    nonceDbPath: env.NONCE_DB_PATH || "facilitator-nonces.db",
    adapter: env.FACILITATOR_ADAPTER === "local" ? "local" : "quai",
  };
}
