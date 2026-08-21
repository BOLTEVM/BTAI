/**
 * Canonical Circle-issued USDC deployments used by the BTAI x402 payment rail.
 *
 * These are the real, native USDC contracts — not bridged variants (USDC.e) and
 * not a locally deployed test token. Every entry is a 6-decimal FiatToken proxy.
 *
 * Keep this table in sync with `apps/frontend/src/lib/usdc.ts`, which the x402
 * challenge in the UI settles against.
 */
const USDC_REGISTRY = {
    base: { label: "Base", chainId: 8453, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    ethereum: { label: "Ethereum", chainId: 1, address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
    optimism: { label: "OP Mainnet", chainId: 10, address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6 },
    arbitrum: { label: "Arbitrum One", chainId: 42161, address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
    polygon: { label: "Polygon PoS", chainId: 137, address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6 },
    avalanche: { label: "Avalanche C-Chain", chainId: 43114, address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", decimals: 6 },
    monad: { label: "Monad", chainId: 143, address: "0x754704bc059F8c67012fEd69bc8A327A5AAfB603", decimals: 6 },
    baseSepolia: { label: "Base Sepolia", chainId: 84532, address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", decimals: 6 },
    sepolia: { label: "Ethereum Sepolia", chainId: 11155111, address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", decimals: 6 },
};

/** Minimal ERC-20 surface of USDC that the escrow rail touches. */
const USDC_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function totalSupply() view returns (uint256)",
    "function balanceOf(address account) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 value) returns (bool)",
    "function transfer(address to, uint256 value) returns (bool)",
    "function transferFrom(address from, address to, uint256 value) returns (bool)",
];

function getUsdc(network) {
    const entry = USDC_REGISTRY[network];
    if (!entry) {
        throw new Error(`Unknown USDC network "${network}". Known: ${Object.keys(USDC_REGISTRY).join(", ")}`);
    }
    return entry;
}

module.exports = { USDC_REGISTRY, USDC_ABI, getUsdc };
