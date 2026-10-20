import { ethers } from "ethers";
import { AUTH_TYPES, EIP712_NAME, EIP712_VERSION, EscrowAuthorization } from "./types";

export interface TypedDataDomain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

export function buildDomain(chainId: number, escrowAddress: string): TypedDataDomain {
  return {
    name: EIP712_NAME,
    version: EIP712_VERSION,
    chainId,
    verifyingContract: escrowAddress,
  };
}

/**
 * Recovers the signer of an EscrowAuthorization. Signature verification is
 * pure off-chain cryptography — identical on QUAI, since Pelagus/quais sign
 * EIP-712 with the same secp256k1 curve.
 */
export function recoverAuthorizationSigner(
  auth: EscrowAuthorization,
  total: string,
  signature: string,
  chainId: number,
  escrowAddress: string
): string {
  const value = {
    client: ethers.utils.getAddress(auth.client),
    talent: ethers.utils.getAddress(auth.talent),
    token: ethers.utils.getAddress(auth.token),
    total,
    disputeWindow: auth.disputeWindow,
    validBefore: auth.validBefore,
    nonce: auth.nonce,
  };
  return ethers.utils.verifyTypedData(buildDomain(chainId, escrowAddress), AUTH_TYPES, value, signature);
}

/** Splits a 65-byte signature into the (v, r, s) the contract expects. */
export function splitSignature(signature: string): { v: number; r: string; s: string } {
  const sig = ethers.utils.splitSignature(signature);
  return { v: sig.v, r: sig.r, s: sig.s };
}

/** Sums milestone amounts as BigNumber-safe decimal strings. */
export function totalOf(amounts: string[]): string {
  return amounts.reduce((acc, a) => acc.add(ethers.BigNumber.from(a)), ethers.BigNumber.from(0)).toString();
}
