import { ethers } from "ethers";
import { EscrowAuthorization } from "./types";

/**
 * On-chain state the facilitator needs before/while settling.
 */
export interface ChainState {
  /** Client's settlement-token balance. */
  balance: ethers.BigNumber;
  /** Client's allowance to the escrow. */
  allowance: ethers.BigNumber;
  /** Whether the escrow has already spent this authorization nonce. */
  authorizationUsed: boolean;
  /** Whether the escrow currently blocks new deposits. */
  paused: boolean;
  /** Whether the escrow allowlists this settlement token. */
  tokenAllowed: boolean;
}

export interface SettleResult {
  txHash: string;
  agreementId?: string;
}

/**
 * Chain access is isolated behind this interface so the facilitator core is
 * testable without a node, and so the QUAI (protobuf) path and the local EVM
 * dev path can coexist. `QuaiChainAdapter` is the production adapter; it signs
 * and broadcasts through quais.js because QUAI does not accept RLP-encoded
 * transactions.
 */
export interface ChainAdapter {
  getChainState(client: string, token: string, nonce: string): Promise<ChainState>;
  settle(auth: EscrowAuthorization, total: string, signature: string): Promise<SettleResult>;
  getAddress(): string;
}

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

const ESCROW_ABI = [
  "function authorization_used(address, bytes32) view returns (bool)",
  "function paused() view returns (bool)",
  "function allowed_tokens(address) view returns (bool)",
  "function create_and_deposit_for(address client, address talent, address token, uint256[] amounts, uint256 dispute_window, uint256 valid_before, bytes32 nonce, uint256 v, uint256 r, uint256 s) returns (uint256)",
];

/** QUAI mainnet/testnet adapter — quais.js, protobuf transactions. */
export class QuaiChainAdapter implements ChainAdapter {
  private wallet: any;
  private escrow: any;
  private escrowAddress: string;
  private quais: any;

  constructor(rpcUrl: string, privateKey: string, escrowAddress: string, quais: any) {
    const provider = new quais.JsonRpcProvider(rpcUrl, undefined, { usePathing: true });
    this.quais = quais;
    this.wallet = new quais.Wallet(privateKey, provider);
    this.escrowAddress = escrowAddress;
    this.escrow = new quais.Contract(escrowAddress, ESCROW_ABI, this.wallet);
  }

  getAddress(): string {
    return this.wallet.address;
  }

  async getChainState(client: string, token: string, nonce: string): Promise<ChainState> {
    const tokenContract = new (this.escrow.constructor as any)(token, ERC20_ABI, this.wallet);
    const [balance, allowance, authorizationUsed, paused, tokenAllowed] = await Promise.all([
      tokenContract.balanceOf(client),
      tokenContract.allowance(client, this.escrowAddress),
      this.escrow.authorization_used(client, nonce),
      this.escrow.paused(),
      this.escrow.allowed_tokens(token),
    ]);
    return {
      balance: ethers.BigNumber.from(balance.toString()),
      allowance: ethers.BigNumber.from(allowance.toString()),
      authorizationUsed: Boolean(authorizationUsed),
      paused: Boolean(paused),
      tokenAllowed: Boolean(tokenAllowed),
    };
  }

  async settle(auth: EscrowAuthorization, total: string, signature: string): Promise<SettleResult> {
    const sig = ethers.utils.splitSignature(signature);
    // QUAI node quirks worked around here (observed on Orchard):
    //  - estimateGas executes against a lagging snapshot, so we pin the gas
    //    limit (measured mainline ~370k; 600k is safe cold-slot headroom);
    //  - NEVER attach an explicit EMPTY access list to a legacy QUAI tx:
    //    go-quai's mined execution burns the entire gas limit (INVALID-style,
    //    no revert data) for such txs, while eth_call succeeds. Leaving the
    //    field unset lets quais populate a real access list, which mines fine.
    const data = this.escrow.interface.encodeFunctionData("create_and_deposit_for", [
      auth.client,
      auth.talent,
      auth.token,
      auth.amounts,
      auth.disputeWindow,
      auth.validBefore,
      auth.nonce,
      sig.v,
      sig.r,
      sig.s,
    ]);
    const txReq = new this.quais.QuaiTransaction(this.wallet.address);
    txReq.to = this.escrowAddress;
    txReq.data = data;
    txReq.gasLimit = 600000n;
    const tx = await this.wallet.sendTransaction(txReq);
    const receipt = await tx.wait();
    if (receipt.status !== 1) {
      throw new Error(`Settlement transaction reverted: ${receipt.transactionHash ?? tx.hash}`);
    }
    return { txHash: receipt.transactionHash ?? tx.hash };
  }
}

/** Local EVM adapter (ethers) — Hardhat/Anvil dev and integration tests. */
export class LocalEvmChainAdapter implements ChainAdapter {
  private wallet: ethers.Wallet;
  private escrow: ethers.Contract;
  private escrowAddress: string;

  constructor(rpcUrl: string, privateKey: string, escrowAddress: string) {
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    this.wallet = new ethers.Wallet(privateKey, provider);
    this.escrowAddress = escrowAddress;
    this.escrow = new ethers.Contract(escrowAddress, ESCROW_ABI, this.wallet);
  }

  getAddress(): string {
    return this.wallet.address;
  }

  async getChainState(client: string, token: string, nonce: string): Promise<ChainState> {
    const tokenContract = new ethers.Contract(token, ERC20_ABI, this.wallet);
    const [balance, allowance, authorizationUsed, paused, tokenAllowed] = await Promise.all([
      tokenContract.balanceOf(client),
      tokenContract.allowance(client, this.escrowAddress),
      this.escrow.authorization_used(client, nonce),
      this.escrow.paused(),
      this.escrow.allowed_tokens(token),
    ]);
    return { balance, allowance, authorizationUsed, paused, tokenAllowed };
  }

  async settle(auth: EscrowAuthorization, _total: string, signature: string): Promise<SettleResult> {
    const sig = ethers.utils.splitSignature(signature);
    const tx = await this.escrow.create_and_deposit_for(
      auth.client,
      auth.talent,
      auth.token,
      auth.amounts,
      auth.disputeWindow,
      auth.validBefore,
      auth.nonce,
      sig.v,
      sig.r,
      sig.s
    );
    const receipt = await tx.wait();
    if (receipt.status !== 1) {
      throw new Error(`Settlement transaction reverted: ${receipt.transactionHash}`);
    }
    return { txHash: receipt.transactionHash };
  }
}
