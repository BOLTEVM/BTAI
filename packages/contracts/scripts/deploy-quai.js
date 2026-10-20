/**
 * Deploys TalentAgentQuai (and optionally a TestSettlementToken on Orchard)
 * to the QUAI Network using quais.js — QUAI transactions are
 * protobuf-encoded, so deployment must go through quais, never raw ethers.
 *
 * QUAI deploy transactions must carry the IPFS CID of the contract metadata
 * (Quaiscan source verification), so this is a Hardhat script: the
 * @quai/hardhat-deploy-metadata plugin pushes the metadata to ipfs.qu.ai and
 * returns the CID.
 *
 * Usage (from packages/contracts):
 *   DEPLOYER_PRIVATE_KEY=0x... SETTLEMENT_TOKEN=0x00... \
 *     TARGET=cyprus1 FEE_BPS=250 npx hardhat run scripts/deploy-quai.js
 *
 *   # Orchard testnet with a fresh test token:
 *   DEPLOYER_PRIVATE_KEY=0x... TARGET=orchard DEPLOY_TEST_TOKEN=1 npx hardhat run scripts/deploy-quai.js
 *
 * Env:
 *   TARGET <orchard|cyprus1>  target network (default: orchard)
 *   FEE_BPS <n>               protocol fee in basis points (default: 250, cap 1000)
 *   FEE_RECIPIENT <0x..>      fee recipient (default: deployer)
 *   DEPLOY_TEST_TOKEN=1       deploy TestSettlementToken first and use it
 *
 * Safety checks performed before broadcasting:
 *   - deployer is a QUAI-ledger Cyprus-1 address (0x00 shard, byte1 < 0x80)
 *   - fee bps within the contract's hard cap
 *   - settlement token is a QUAI-ledger Cyprus-1 address
 *   - deployer has a QUAI balance for gas
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const NETWORKS = {
    cyprus1: { chainId: 9, rpc: "https://rpc.quai.network", label: "QUAI Mainnet (Cyprus-1)" },
    orchard: { chainId: 15000, rpc: "https://orchard.rpc.quai.network", label: "QUAI Orchard Testnet" },
};

const SHARD_PREFIX = "0x00";
const MAX_FEE_BPS = 1000;

function parseArgs() {
    return {
        target: process.env.TARGET || "orchard",
        feeBps: process.env.FEE_BPS === undefined ? 250 : Number(process.env.FEE_BPS),
        feeRecipient: process.env.FEE_RECIPIENT || null,
        deployTestToken: process.env.DEPLOY_TEST_TOKEN === "1",
    };
}

function assertQuaiCyprus1(address, label) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address) || !address.toLowerCase().startsWith(SHARD_PREFIX)) {
        throw new Error(`${label} ${address} is not a Cyprus-1 (0x00...) address — cross-shard escrow funds get stuck.`);
    }
    // QUAI accounts live on the EVM ledger: the MSB of byte 1 must be clear.
    // A set bit marks a Qi (UTXO) address, which neither faucets nor this
    // escrow can pay.
    if (parseInt(address.slice(4, 6), 16) >= 0x80) {
        throw new Error(`${label} ${address} is a Qi-ledger address — need a QUAI account address (byte 1 < 0x80).`);
    }
}

const IPFS_URL = "https://ipfs.qu.ai/api/v0";

/** Pins contract metadata to QUAI's IPFS node; returns the 46-char CID. */
async function pinMetadata(metadataJson) {
    const { create } = await import("kubo-rpc-client");
    const client = create({ url: IPFS_URL });
    const { cid } = await client.add(metadataJson);
    await client.pin.add(cid);
    const hash = cid.toString();
    if (hash.length !== 46) throw new Error(`Unexpected CID "${hash}" — quais requires a 46-char v0 CID.`);
    return hash;
}

/**
 * Resolves the metadata JSON for a compiled contract. Solidity contracts take
 * the exact compiler metadata from the build info (so the CID matches the
 * hash embedded in the bytecode); hardhat-vyper strips auxdata, so Vyper
 * contracts get a self-contained metadata document built here.
 */
async function metadataFor(contractName) {
    const artifact = await hre.artifacts.readArtifact(contractName);
    const sourceName = artifact.sourceName;

    if (sourceName.endsWith(".sol")) {
        for (const fqn of await hre.artifacts.getAllFullyQualifiedNames()) {
            const buildInfo = await hre.artifacts.getBuildInfo(fqn).catch(() => undefined);
            const metadata = buildInfo?.output?.contracts?.[sourceName]?.[contractName]?.metadata;
            if (metadata) return metadata;
        }
        throw new Error(`No compiler metadata found for ${contractName}.`);
    }

    const source = fs.readFileSync(path.join(__dirname, "..", sourceName), "utf8");
    return JSON.stringify({
        compiler: { version: "0.3.10" },
        language: "Vyper",
        output: { abi: artifact.abi },
        settings: { evmVersion: "paris", optimize: true },
        sources: { [sourceName]: { content: source } },
    });
}

async function main() {
    const args = parseArgs();
    const network = NETWORKS[args.target];
    if (!network) throw new Error(`Unknown target "${args.target}" — use orchard or cyprus1.`);

    const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
    if (!privateKey) throw new Error("DEPLOYER_PRIVATE_KEY is not set.");
    if (!Number.isInteger(args.feeBps) || args.feeBps < 0 || args.feeBps > MAX_FEE_BPS) {
        throw new Error(`--fee-bps must be an integer in [0, ${MAX_FEE_BPS}].`);
    }

    const quais = require("quais");
    const provider = new quais.JsonRpcProvider(
        process.env.QUAI_RPC_URL || network.rpc,
        undefined,
        { usePathing: true }
    );
    const wallet = new quais.Wallet(privateKey, provider);

    assertQuaiCyprus1(wallet.address, "Deployer");
    console.log(`Network:  ${network.label} (chain ${network.chainId})`);
    console.log(`Deployer: ${wallet.address}`);

    const balance = await provider.getBalance(wallet.address);
    if (balance === 0n) throw new Error("Deployer has no QUAI for gas. Fund it (Orchard: use the faucet) first.");
    console.log(`Balance:  ${quais.formatQuai(balance)} QUAI`);

    // Artifacts must be current — the metadata CID is derived from the exact
    // deployed bytecode.
    await hre.run("compile");

    // --- settlement token ---------------------------------------------------
    let settlementToken = process.env.SETTLEMENT_TOKEN || null;
    if (args.deployTestToken) {
        const tokenCid = await pinMetadata(await metadataFor("TestSettlementToken"));
        if (!tokenCid) throw new Error("IPFS metadata push for TestSettlementToken failed.");
        const tokenArtifact = await hre.artifacts.readArtifact("TestSettlementToken");
        const tokenFactory = new quais.ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode, wallet, tokenCid);
        console.log("Deploying TestSettlementToken...");
        const token = await tokenFactory.deploy();
        await token.waitForDeployment();
        settlementToken = await token.getAddress();
        console.log(`TestSettlementToken: ${settlementToken}`);
    }
    if (!settlementToken) {
        throw new Error("SETTLEMENT_TOKEN is not set (or pass --deploy-test-token on Orchard).");
    }
    assertQuaiCyprus1(settlementToken, "Settlement token");

    // --- escrow ---------------------------------------------------------------
    const feeRecipient = args.feeRecipient || wallet.address;
    assertQuaiCyprus1(feeRecipient, "Fee recipient");

    const escrowCid = await pinMetadata(await metadataFor("TalentAgentQuai"));
    if (!escrowCid) throw new Error("IPFS metadata push for TalentAgentQuai failed.");
    const artifact = await hre.artifacts.readArtifact("TalentAgentQuai");
    const factory = new quais.ContractFactory(artifact.abi, artifact.bytecode, wallet, escrowCid);
    console.log(`Deploying TalentAgentQuai (token=${settlementToken}, fee=${args.feeBps}bps -> ${feeRecipient})...`);
    const escrow = await factory.deploy(settlementToken, feeRecipient, args.feeBps);
    await escrow.waitForDeployment();
    const escrowAddress = await escrow.getAddress();
    assertQuaiCyprus1(escrowAddress, "Deployed escrow");

    console.log("\n=== Deployment complete ===");
    console.log(`TalentAgentQuai: ${escrowAddress}`);
    console.log(`Network:         eip155:${network.chainId}`);
    console.log("\nWire-up:");
    console.log(`  backend:    ESCROW_ADDRESS=${escrowAddress} SETTLEMENT_TOKEN=${settlementToken} X402_NETWORK=eip155:${network.chainId}`);
    console.log(`  facilitator: ESCROW_ADDRESS=${escrowAddress} FACILITATOR_ADAPTER=quai`);
    console.log(`  frontend:   NEXT_PUBLIC_TALENT_AGENT_QUAI_ADDRESS=${escrowAddress}`);

    // Persist a deployment record for ops/audit trails.
    const record = {
        network: `eip155:${network.chainId}`,
        escrow: escrowAddress,
        settlementToken,
        feeBps: args.feeBps,
        feeRecipient,
        deployer: wallet.address,
        deployedAt: new Date().toISOString(),
    };
    const outDir = path.join(__dirname, "..", "deployments");
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `${args.target}-${Date.now()}.json`);
    fs.writeFileSync(outFile, JSON.stringify(record, null, 2));
    console.log(`Record:       ${outFile}`);
}

main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
});
