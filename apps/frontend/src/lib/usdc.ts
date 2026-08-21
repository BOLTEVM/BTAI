import type { Chain, Hex } from "viem";
import { arbitrum, avalanche, base, baseSepolia, mainnet, monad, optimism, polygon, sepolia } from "viem/chains";

/**
 * Canonical Circle-issued USDC deployments used by the BTAI x402 payment rail.
 *
 * These are the real, native USDC contracts — not bridged variants (USDC.e) and
 * not a locally deployed test token. Every entry is a 6-decimal FiatToken proxy.
 *
 * Keep this table in sync with `packages/contracts/usdc.js`, which the Hardhat
 * fork tests use to exercise the escrow against the same deployments.
 */
export interface UsdcDeployment {
  /** Human label rendered in the x402 payment challenge. */
  label: string;
  /** viem chain definition used to build the wallet client. */
  chain: Chain;
  /** Canonical USDC token contract. */
  address: Hex;
  /** USDC is 6 decimals on every canonical deployment. */
  decimals: 6;
  /** Testnets are settlement-safe for rehearsal; mainnets move real value. */
  testnet: boolean;
}

export const USDC_REGISTRY = {
  base: {
    label: "Base",
    chain: base,
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
    testnet: false,
  },
  ethereum: {
    label: "Ethereum",
    chain: mainnet,
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    decimals: 6,
    testnet: false,
  },
  optimism: {
    label: "OP Mainnet",
    chain: optimism,
    address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    decimals: 6,
    testnet: false,
  },
  arbitrum: {
    label: "Arbitrum One",
    chain: arbitrum,
    address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    decimals: 6,
    testnet: false,
  },
  polygon: {
    label: "Polygon PoS",
    chain: polygon,
    address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    decimals: 6,
    testnet: false,
  },
  avalanche: {
    label: "Avalanche C-Chain",
    chain: avalanche,
    address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    decimals: 6,
    testnet: false,
  },
  monad: {
    label: "Monad",
    chain: monad,
    address: "0x754704bc059F8c67012fEd69bc8A327A5AAfB603",
    decimals: 6,
    testnet: false,
  },
  baseSepolia: {
    label: "Base Sepolia",
    chain: baseSepolia,
    address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    decimals: 6,
    testnet: true,
  },
  sepolia: {
    label: "Ethereum Sepolia",
    chain: sepolia,
    address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    decimals: 6,
    testnet: true,
  },
} as const satisfies Record<string, UsdcDeployment>;

export type UsdcNetwork = keyof typeof USDC_REGISTRY;

/**
 * Network the x402 challenge settles on. Defaults to Base — the cheapest
 * canonical USDC rail — and is overridable per deployment.
 */
export const DEFAULT_USDC_NETWORK = ((): UsdcNetwork => {
  const configured = process.env.NEXT_PUBLIC_X402_NETWORK;
  if (configured && configured in USDC_REGISTRY) {
    return configured as UsdcNetwork;
  }
  return "base";
})();

export function getUsdcDeployment(network: UsdcNetwork): UsdcDeployment {
  return USDC_REGISTRY[network];
}

/**
 * Minimal ERC-20 surface of USDC that the escrow rail touches. USDC's FiatToken
 * returns a bool from `approve`, so callers can rely on the return value.
 */
export const USDC_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;
