require("@nomicfoundation/hardhat-toolbox");
require("@nomiclabs/hardhat-vyper");
// Adds hre.deployMetadata.pushMetadataToIPFS — QUAI deploy transactions must
// carry the contract metadata CID for Quaiscan source verification.
require("@quai/hardhat-deploy-metadata");

const fs = require("fs");
const path = require("path");

// Minimal .env loader so `cp .env.example .env` works without pulling in dotenv.
// Anything already exported in the shell wins.
(() => {
    const envPath = path.join(__dirname, ".env");
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
        const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
        if (!match || line.trim().startsWith("#")) continue;
        const value = match[2].replace(/^["']|["']$/g, "");
        if (value && process.env[match[1]] === undefined) process.env[match[1]] = value;
    }
})();

// The x402 rail settles in real USDC, so the escrow suite runs against a fork of
// a live chain rather than a locally minted stand-in token. Set BASE_RPC_URL to
// any Base mainnet RPC endpoint to enable it; without it the suite is skipped.
const BASE_RPC_URL = process.env.BASE_RPC_URL || "";
const BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const FORK_BLOCK_NUMBER = process.env.FORK_BLOCK_NUMBER ? Number(process.env.FORK_BLOCK_NUMBER) : undefined;

// QUAI Network: single global chain ID 9 (mainnet, Cyprus-1 zone) and 15000
// (Orchard testnet). Transactions are protobuf-encoded, not RLP — deploy and
// interact through quais.js scripts, never through plain ethers hardhat
// broadcast helpers.
const QUAI_RPC_URL = process.env.QUAI_RPC_URL || "https://rpc.quai.network";
const QUAI_ORCHARD_RPC_URL = process.env.QUAI_ORCHARD_RPC_URL || "https://orchard.rpc.quai.network";

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const accounts = DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
    solidity: {
        version: "0.8.24",
        settings: {
            // QUAI's EVM ceiling is London-class: pin paris so the Solidity
            // helper contracts never emit Shanghai+ opcodes (PUSH0 etc.).
            evmVersion: "paris",
            optimizer: { enabled: true, runs: 200 },
        },
    },
    vyper: {
        // Matches the `^0.3.7` pragma in TalentAgent.vy / TalentAgentQuai.vy.
        // Pinned exactly so the bytecode exported to the frontend deploy flow
        // is reproducible.
        version: "0.3.10",
        settings: {
            // QUAI's EVM ceiling is London-class: compile to paris (the closest
            // Vyper target) so no Shanghai+ opcodes (PUSH0, MCOPY, TSTORE) can
            // appear in bytecode destined for QUAI.
            evmVersion: "paris",
        },
    },
    networks: {
        hardhat: BASE_RPC_URL
            ? {
                  chainId: 8453,
                  forking: { url: BASE_RPC_URL, blockNumber: FORK_BLOCK_NUMBER },
                  // Hardhat ships no hardfork history for Base, so forked blocks
                  // fail with "No known hardfork for execution on historical
                  // block". Declaring Cancun from genesis is enough for the
                  // ERC-20 calls the escrow suite makes.
                  chains: {
                      8453: { hardforkHistory: { cancun: 0 } },
                  },
              }
            : {
                  chainId: 1337,
              },
        base: {
            url: BASE_RPC_URL || "https://mainnet.base.org",
            chainId: 8453,
            accounts,
        },
        baseSepolia: {
            url: BASE_SEPOLIA_RPC_URL,
            chainId: 84532,
            accounts,
        },
        // QUAI mainnet — Cyprus-1 zone (0x00 address prefix), global chain ID 9.
        cyprus1: {
            url: QUAI_RPC_URL,
            chainId: 9,
            accounts,
        },
        // QUAI Orchard testnet.
        orchard: {
            url: QUAI_ORCHARD_RPC_URL,
            chainId: 15000,
            accounts,
        },
    },
};
