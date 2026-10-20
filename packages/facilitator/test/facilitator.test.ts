import { describe, expect, it, beforeEach } from "vitest";
import { ethers } from "ethers";
import { AddressInfo } from "node:net";
import { ChainAdapter, ChainState, SettleResult } from "../src/chainAdapter";
import { FacilitatorConfig } from "../src/config";
import { buildDomain, totalOf } from "../src/eip712";
import { Facilitator } from "../src/facilitator";
import { NonceRegistry } from "../src/nonceRegistry";
import { createServer } from "../src/server";
import { AUTH_TYPES, EscrowAuthorization, PaymentPayload, SCHEME, X402_VERSION } from "../src/types";

const CHAIN_ID = 1337;
const NETWORK = `eip155:${CHAIN_ID}`;
const ESCROW = "0x00" + "11".repeat(19);
const TOKEN = "0x00" + "22".repeat(19);

/**
 * QUAI-ledger Cyprus-1 test wallets: byte 0 must be rewritable to 0x00 (done
 * below) and byte 1 must be < 0x80 — a set MSB marks a Qi (UTXO) address,
 * which the shard guard rejects.
 */
function randomQuaiLedgerWallet(): ethers.Wallet {
  for (;;) {
    const w = ethers.Wallet.createRandom();
    if (parseInt(w.address.slice(4, 6), 16) < 0x80) return w;
  }
}

const clientWallet = randomQuaiLedgerWallet();
const talentWallet = randomQuaiLedgerWallet();

/** Shard-valid Cyprus-1 addresses (0x00 prefix) derived from the wallets. */
const CLIENT = "0x00" + clientWallet.address.slice(4).toLowerCase();
const TALENT = "0x00" + talentWallet.address.slice(4).toLowerCase();

function makeConfig(overrides: Partial<FacilitatorConfig> = {}): FacilitatorConfig {
  return {
    port: 0,
    network: NETWORK,
    chainId: CHAIN_ID,
    rpcUrl: "http://localhost:8545",
    privateKey: "0x" + "ab".repeat(32),
    escrowAddress: ESCROW,
    settlementTokens: [TOKEN.toLowerCase()],
    shardPrefix: "0x00",
    maxTimeoutSeconds: 600,
    nonceDbPath: ":memory:",
    adapter: "local",
    ...overrides,
  };
}

class FakeAdapter implements ChainAdapter {
  state: ChainState;
  settleCalls = 0;
  failNextSettle: string | null = null;

  constructor(state: Partial<ChainState> = {}) {
    this.state = {
      balance: ethers.utils.parseUnits("1000", 6),
      allowance: ethers.utils.parseUnits("1000", 6),
      authorizationUsed: false,
      paused: false,
      tokenAllowed: true,
      ...state,
    };
  }

  getAddress(): string {
    return "0x00" + "fa".repeat(19);
  }

  async getChainState(): Promise<ChainState> {
    return this.state;
  }

  async settle(_auth: EscrowAuthorization, _total: string, _signature: string): Promise<SettleResult> {
    this.settleCalls += 1;
    if (this.failNextSettle) {
      const reason = this.failNextSettle;
      this.failNextSettle = null;
      throw new Error(reason);
    }
    this.state.authorizationUsed = true;
    return { txHash: "0x" + "cd".repeat(32), agreementId: "0" };
  }
}

function makeAuthorization(now: number, overrides: Partial<EscrowAuthorization> = {}): EscrowAuthorization {
  return {
    client: CLIENT,
    talent: TALENT,
    token: TOKEN,
    amounts: ["1000000", "2000000"],
    disputeWindow: "604800",
    validBefore: String(now + 300),
    nonce: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
    ...overrides,
  };
}

/**
 * Signs an authorization. The typed-data `client` field is the shard-rewritten
 * address; the signature itself is produced by the wallet that owns the
 * underlying key, which is what `recoverAuthorizationSigner` checks against.
 * For happy-path tests we sign with a wallet whose address matches `client`.
 */
async function signPayload(
  signer: ethers.Wallet,
  auth: EscrowAuthorization,
  config: FacilitatorConfig
): Promise<PaymentPayload> {
  const total = totalOf(auth.amounts);
  const signature = await signer._signTypedData(buildDomain(config.chainId, config.escrowAddress), AUTH_TYPES, {
    client: auth.client,
    talent: auth.talent,
    token: auth.token,
    total,
    disputeWindow: auth.disputeWindow,
    validBefore: auth.validBefore,
    nonce: auth.nonce,
  });
  return {
    x402Version: X402_VERSION,
    scheme: SCHEME,
    network: config.network,
    payload: { signature, authorization: auth },
  };
}

const NOW = 1_800_000_000;

describe("NonceRegistry", () => {
  it("enforces idempotency key and (client, nonce) uniqueness", () => {
    const registry = new NonceRegistry(":memory:");
    expect(registry.beginSettlement("key-1", CLIENT, "0x" + "01".repeat(32))).toBe(true);
    expect(registry.beginSettlement("key-1", CLIENT, "0x" + "01".repeat(32))).toBe(false);
    expect(registry.beginSettlement("key-2", CLIENT, "0x" + "01".repeat(32))).toBe(false);
    expect(registry.isNonceUsed(CLIENT, "0x" + "01".repeat(32))).toBe(true);
    expect(registry.isNonceUsed(CLIENT, "0x" + "02".repeat(32))).toBe(false);

    registry.markSettled("key-1", "0x" + "cd".repeat(32), "3");
    const record = registry.getByIdempotencyKey("key-1");
    expect(record?.status).toBe("settled");
    expect(record?.agreementId).toBe("3");
    expect(registry.stats()).toEqual({ pending: 0, settled: 1, failed: 0 });
    registry.close();
  });

  it("persists across reopen (file-backed)", () => {
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nonce-")), "test.db");
    const a = new NonceRegistry(dbPath);
    a.beginSettlement("key-x", CLIENT, "0x" + "09".repeat(32));
    a.close();
    const b = new NonceRegistry(dbPath);
    expect(b.isNonceUsed(CLIENT, "0x" + "09".repeat(32))).toBe(true);
    b.close();
  });
});

describe("Facilitator.verify", () => {
  let config: FacilitatorConfig;
  let adapter: FakeAdapter;
  let registry: NonceRegistry;
  let facilitator: Facilitator;

  // A wallet whose address literally starts with 0x00 (Cyprus-1) and sits on
  // the QUAI ledger (byte 1 < 0x80) is brute-forced once for the suite so the
  // shard guard and signature recovery can both pass.
  let shardWallet: ethers.Wallet;

  beforeEach(() => {
    if (!shardWallet) {
      for (;;) {
        const w = ethers.Wallet.createRandom();
        if (w.address.toLowerCase().startsWith("0x00") && parseInt(w.address.slice(4, 6), 16) < 0x80) {
          shardWallet = w;
          break;
        }
      }
    }
    config = makeConfig();
    adapter = new FakeAdapter();
    registry = new NonceRegistry(":memory:");
    facilitator = new Facilitator(config, adapter, registry, () => NOW);
  });

  const validPayload = () =>
    signPayload(shardWallet, makeAuthorization(NOW, { client: shardWallet.address }), config);

  it("accepts a valid authorization", async () => {
    const result = await facilitator.verify(await validPayload());
    expect(result.isValid).toBe(true);
    expect(result.payer).toBe(shardWallet.address);
  });

  it("rejects wrong scheme / network / version", async () => {
    const payload = await validPayload();
    expect((await facilitator.verify({ ...payload, scheme: "exact" })).invalidReason).toBe("unsupported_scheme");
    expect((await facilitator.verify({ ...payload, network: "eip155:8453" })).invalidReason).toBe("unsupported_network");
    expect((await facilitator.verify({ ...payload, x402Version: 1 })).invalidReason).toBe("unsupported_x402_version");
  });

  it("rejects expired and over-long validity windows", async () => {
    const expired = await signPayload(
      shardWallet,
      makeAuthorization(NOW, { client: shardWallet.address, validBefore: String(NOW - 1) }),
      config
    );
    expect((await facilitator.verify(expired)).invalidReason).toBe("authorization_expired");

    const tooLong = await signPayload(
      shardWallet,
      makeAuthorization(NOW, { client: shardWallet.address, validBefore: String(NOW + 9999) }),
      config
    );
    expect((await facilitator.verify(tooLong)).invalidReason).toBe("validity_window_too_long");
  });

  it("rejects cross-shard addresses", async () => {
    const payload = await signPayload(
      shardWallet,
      makeAuthorization(NOW, { client: shardWallet.address, talent: talentWallet.address }), // no 0x00 prefix
      config
    );
    expect((await facilitator.verify(payload)).invalidReason).toBe("address_wrong_shard");
  });

  it("rejects a token outside the configured set", async () => {
    const payload = await signPayload(
      shardWallet,
      makeAuthorization(NOW, { client: shardWallet.address, token: "0x00" + "99".repeat(19) }),
      config
    );
    expect((await facilitator.verify(payload)).invalidReason).toBe("token_not_configured");
  });

  it("rejects a signature from the wrong key", async () => {
    const payload = await signPayload(
      clientWallet, // wrong signer for the 0x00-prefixed client field
      makeAuthorization(NOW, { client: shardWallet.address }),
      config
    );
    expect((await facilitator.verify(payload)).invalidReason).toBe("signature_mismatch");
  });

  it("rejects insufficient balance, allowance, pause, and used on-chain nonce", async () => {
    adapter.state.balance = ethers.BigNumber.from(1);
    expect((await facilitator.verify(await validPayload())).invalidReason).toBe("insufficient_balance");

    adapter.state.balance = ethers.utils.parseUnits("1000", 6);
    adapter.state.allowance = ethers.BigNumber.from(1);
    expect((await facilitator.verify(await validPayload())).invalidReason).toBe("insufficient_allowance");

    adapter.state.allowance = ethers.utils.parseUnits("1000", 6);
    adapter.state.paused = true;
    expect((await facilitator.verify(await validPayload())).invalidReason).toBe("escrow_paused");

    adapter.state.paused = false;
    adapter.state.authorizationUsed = true;
    expect((await facilitator.verify(await validPayload())).invalidReason).toBe("nonce_already_used_onchain");

    adapter.state.authorizationUsed = false;
    adapter.state.tokenAllowed = false;
    expect((await facilitator.verify(await validPayload())).invalidReason).toBe("token_not_allowlisted");
  });

  it("rejects a nonce already spent in the local registry", async () => {
    const payload = await validPayload();
    registry.beginSettlement("k", payload.payload.authorization.client, payload.payload.authorization.nonce);
    expect((await facilitator.verify(payload)).invalidReason).toBe("nonce_already_used");
  });
});

describe("Facilitator.settle", () => {
  let config: FacilitatorConfig;
  let adapter: FakeAdapter;
  let registry: NonceRegistry;
  let facilitator: Facilitator;
  let shardWallet: ethers.Wallet;

  beforeEach(() => {
    if (!shardWallet) {
      for (;;) {
        const w = ethers.Wallet.createRandom();
        if (w.address.toLowerCase().startsWith("0x00") && parseInt(w.address.slice(4, 6), 16) < 0x80) {
          shardWallet = w;
          break;
        }
      }
    }
    config = makeConfig();
    adapter = new FakeAdapter();
    registry = new NonceRegistry(":memory:");
    facilitator = new Facilitator(config, adapter, registry, () => NOW);
  });

  it("settles once and replays the recorded outcome under the same key", async () => {
    const payload = await signPayload(shardWallet, makeAuthorization(NOW, { client: shardWallet.address }), config);
    const first = await facilitator.settle(payload, "idem-1");
    expect(first.success).toBe(true);
    expect(first.transaction).toMatch(/^0x/);
    expect(adapter.settleCalls).toBe(1);

    // Retry with the same key must NOT hit the chain again.
    const replay = await facilitator.settle(payload, "idem-1");
    expect(replay.success).toBe(true);
    expect(adapter.settleCalls).toBe(1);

    // Same nonce under a different key is a duplicate.
    const dup = await facilitator.settle(payload, "idem-2");
    expect(dup.success).toBe(false);
    expect(adapter.settleCalls).toBe(1);
  });

  it("marks failed settlements and allows retry under the same key", async () => {
    const payload = await signPayload(shardWallet, makeAuthorization(NOW, { client: shardWallet.address }), config);
    adapter.failNextSettle = "tx reverted";
    const failed = await facilitator.settle(payload, "idem-9");
    expect(failed.success).toBe(false);
    expect(failed.errorReason).toContain("onchain_settlement_failed");

    const retried = await facilitator.settle(payload, "idem-9");
    expect(retried.success).toBe(true);
    expect(adapter.settleCalls).toBe(2);
  });
});

describe("HTTP surface", () => {
  it("serves /supported, /health, /verify and /settle", async () => {
    const config = makeConfig();
    const adapter = new FakeAdapter();
    const registry = new NonceRegistry(":memory:");
    const app = createServer(config, adapter, registry);

    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    try {
      const supported = (await (await fetch(`${base}/supported`)).json()) as any;
      expect(supported.kinds[0].scheme).toBe("btai-escrow");
      expect(supported.kinds[0].network).toBe(NETWORK);

      const health = (await (await fetch(`${base}/health`)).json()) as any;
      expect(health.status).toBe("ok");

      // Find a shard-valid signer (Cyprus-1 prefix + QUAI-ledger byte).
      let shardWallet = ethers.Wallet.createRandom();
      while (
        !shardWallet.address.toLowerCase().startsWith("0x00") ||
        parseInt(shardWallet.address.slice(4, 6), 16) >= 0x80
      ) {
        shardWallet = ethers.Wallet.createRandom();
      }
      const payload = await signPayload(shardWallet, makeAuthorization(Math.floor(Date.now() / 1000), { client: shardWallet.address }), config);

      const verifyRes = await fetch(`${base}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(verifyRes.status).toBe(200);
      expect(((await verifyRes.json()) as any).isValid).toBe(true);

      const noKey = await fetch(`${base}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(noKey.status).toBe(400);

      const settleRes = await fetch(`${base}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "http-1" },
        body: JSON.stringify(payload),
      });
      expect(settleRes.status).toBe(200);
      const settled = (await settleRes.json()) as any;
      expect(settled.success).toBe(true);
      expect(settled.network).toBe(NETWORK);
    } finally {
      server.close();
    }
  });
});

describe("loadConfig port precedence", () => {
  it("honors FACILITATOR_PORT, then Render's injected PORT, then 3402", async () => {
    process.env.ESCROW_ADDRESS = "0x0000000000000000000000000000000000000001";
    try {
      const { loadConfig } = await import("../src/config");
      const base = {} as NodeJS.ProcessEnv;
      expect(loadConfig(base).port).toBe(3402);
      expect(loadConfig({ PORT: "10000" }).port).toBe(10000);
      expect(loadConfig({ PORT: "10000", FACILITATOR_PORT: "3403" }).port).toBe(3403);
    } finally {
      delete process.env.ESCROW_ADDRESS;
    }
  });
});
