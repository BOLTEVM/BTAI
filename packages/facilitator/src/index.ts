import { ChainAdapter, LocalEvmChainAdapter, QuaiChainAdapter } from "./chainAdapter";
import { loadConfig } from "./config";
import { NonceRegistry } from "./nonceRegistry";
import { createServer } from "./server";

/**
 * Dark Star Rail x402 facilitator entry point.
 *
 * FACILITATOR_ADAPTER=local uses ethers (Hardhat/Anvil dev). The default
 * "quai" path loads quais.js lazily so local dev never pays the import cost
 * and a missing/broken quais install fails with a clear message.
 */
async function main() {
  const config = loadConfig();
  if (!config.privateKey) {
    throw new Error("FACILITATOR_PRIVATE_KEY is required — this key is the escrow's agent.");
  }

  let adapter: ChainAdapter;
  if (config.adapter === "local") {
    adapter = new LocalEvmChainAdapter(config.rpcUrl, config.privateKey, config.escrowAddress);
  } else {
    const quais = await import("quais");
    adapter = new QuaiChainAdapter(config.rpcUrl, config.privateKey, config.escrowAddress, quais);
  }

  const registry = new NonceRegistry(config.nonceDbPath);
  const app = createServer(config, adapter, registry);

  app.listen(config.port, () => {
    console.log(
      `[facilitator] ${config.network} (${config.adapter}) listening on :${config.port} — ` +
        `facilitator ${adapter.getAddress()}, escrow ${config.escrowAddress}`
    );
  });
}

main().catch((err) => {
  console.error("[facilitator] fatal:", err.message);
  process.exit(1);
});
