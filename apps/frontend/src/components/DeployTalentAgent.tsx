"use client";

import { useCallback, useMemo, useState } from "react";
import { ConnectedWallet, useConnectWallet, useWallets } from "@privy-io/react-auth";
import { BaiPipelineProgress, BaiPipelineStage, BaiWalletPipeline } from "@/lib/WalletPipeline";
import { TALENT_AGENT_BYTECODE, TALENT_AGENT_COMPILER } from "@/lib/talentAgent.generated";
import { DEFAULT_USDC_NETWORK, getUsdcDeployment, USDC_REGISTRY, UsdcNetwork } from "@/lib/usdc";

/** Ordered stages, so the UI can render a checklist rather than one status line. */
const STAGE_SEQUENCE: { stage: BaiPipelineStage; label: string }[] = [
  { stage: "resolving-account", label: "Resolve signing account" },
  { stage: "switching-chain", label: "Switch wallet network" },
  { stage: "awaiting-signature", label: "Approve in wallet" },
  { stage: "awaiting-confirmation", label: "Await on-chain confirmation" },
  { stage: "confirmed", label: "Escrow live" },
];

function stageIndex(stage?: BaiPipelineStage) {
  if (!stage) return -1;
  return STAGE_SEQUENCE.findIndex((entry) => entry.stage === stage);
}

/** Short, stable identity for a connected wallet. */
function walletLabel(wallet: ConnectedWallet) {
  if (wallet.walletClientType === "privy") return "Privy embedded wallet";
  return wallet.meta?.name || wallet.walletClientType || "External wallet";
}

function shorten(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

interface DeployTalentAgentProps {
  /** Escrow currently in use, from env or a previous deploy. */
  activeAddress?: string;
  /** Called once a deployment is confirmed, so the escrow rail can adopt it. */
  onDeployed: (address: string, network: UsdcNetwork) => void;
  onClose: () => void;
}

export default function DeployTalentAgent({ activeAddress, onDeployed, onClose }: DeployTalentAgentProps) {
  const { wallets } = useWallets();
  const { connectWallet } = useConnectWallet();

  const [selectedWalletAddress, setSelectedWalletAddress] = useState<string | null>(null);
  const [network, setNetwork] = useState<UsdcNetwork>(DEFAULT_USDC_NETWORK);
  const [progress, setProgress] = useState<BaiPipelineProgress | null>(null);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployed, setDeployed] = useState<{ address: string; txHash?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Default to the first connected wallet, but let the user override — someone
  // with both an embedded wallet and an extension needs to choose the signer.
  const selectedWallet = useMemo(
    () => wallets.find((w) => w.address === selectedWalletAddress) ?? wallets[0],
    [wallets, selectedWalletAddress]
  );

  const usdc = getUsdcDeployment(network);
  const explorerBase = usdc.chain.blockExplorers?.default?.url;

  // Track the furthest stage reached rather than the current one, so a failure
  // (which is outside the sequence) leaves the checklist showing how far it got.
  const [reachedStage, setReachedStage] = useState(-1);
  const handleProgress = useCallback((update: BaiPipelineProgress) => {
    setProgress(update);
    const index = stageIndex(update.stage);
    if (index >= 0) setReachedStage((previous) => Math.max(previous, index));
  }, []);

  const deploy = useCallback(async () => {
    if (!selectedWallet) {
      setError("Connect a wallet before deploying.");
      return;
    }

    setIsDeploying(true);
    setError(null);
    setDeployed(null);
    setProgress(null);
    setReachedStage(-1);

    try {
      const provider = await selectedWallet.getEthereumProvider();

      // Privy's own switch handles embedded wallets, which do not implement the
      // wallet_* RPCs the pipeline falls back to. If it fails, keep going — the
      // pipeline's ensureChain covers extension wallets and is a no-op when the
      // wallet is already on the target chain.
      try {
        await selectedWallet.switchChain(usdc.chain.id);
      } catch {
        // Handled by the pipeline below.
      }

      // The pipeline resolves only once the receipt is confirmed, so this await
      // covers the whole lifecycle: chain switch, signature, mining, receipt.
      const result = await BaiWalletPipeline.deployAndAwaitContract({
        bytecode: TALENT_AGENT_BYTECODE,
        contractName: "TalentAgent",
        provider,
        from: selectedWallet.address,
        chainId: usdc.chain.id,
        rpcUrl: usdc.chain.rpcUrls.default.http[0],
        confirmations: usdc.testnet ? 1 : 2,
        timeoutMs: 300_000,
        agentId: "BTAI_ORCHESTRATOR",
        onProgress: handleProgress,
      });

      if (!result.success || !result.contractAddress) {
        setError(result.error || "Deployment failed for an unknown reason.");
        return;
      }

      setDeployed({ address: result.contractAddress, txHash: result.txHash });
      onDeployed(result.contractAddress, network);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deployment failed.");
    } finally {
      setIsDeploying(false);
    }
  }, [selectedWallet, usdc, network, onDeployed, handleProgress]);

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center px-6">
      <button aria-label="Close deploy panel" className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

      <div className="glass relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto border-cyan-500/30 p-10">
        <h2 className="mb-2 text-3xl font-black uppercase tracking-tighter gradient-text">Deploy Escrow Node</h2>
        <p className="mb-8 text-sm font-light leading-relaxed text-white/40">
          Puts your own <span className="font-mono text-cyan-400">TalentAgent</span> escrow on-chain. You become its
          orchestrator, and the x402 rail settles into it. Compiled with {TALENT_AGENT_COMPILER}.
        </p>

        {/* Step 1 — signer */}
        <section className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30">1 · Signing Wallet</span>
            <button
              onClick={() => connectWallet()}
              className="text-[10px] font-bold uppercase tracking-widest text-cyan-400 hover:text-white"
            >
              + Connect another
            </button>
          </div>

          {wallets.length === 0 ? (
            <button
              onClick={() => connectWallet()}
              className="w-full rounded-lg border border-dashed border-white/20 bg-white/5 py-6 text-xs font-bold uppercase tracking-widest text-white/50 hover:border-cyan-500/50 hover:text-cyan-400"
            >
              Connect a browser extension or modal wallet
            </button>
          ) : (
            <div className="flex flex-col gap-2">
              {wallets.map((wallet) => {
                const isSelected = selectedWallet?.address === wallet.address;
                return (
                  <button
                    key={wallet.address}
                    disabled={isDeploying}
                    onClick={() => setSelectedWalletAddress(wallet.address)}
                    className={`flex items-center gap-4 rounded-lg border px-4 py-3 text-left transition-all disabled:opacity-40 ${
                      isSelected ? "border-cyan-500/60 bg-cyan-500/10" : "border-white/10 bg-white/5 hover:border-white/30"
                    }`}
                  >
                    {wallet.meta?.icon ? (
                      // Wallet icons are data/remote URIs from the connector, not bundled assets.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={wallet.meta.icon} alt="" width={24} height={24} className="rounded" />
                    ) : (
                      <div className="h-6 w-6 rounded bg-white/10" />
                    )}
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-white">{walletLabel(wallet)}</span>
                      <span className="font-mono text-[10px] text-white/40">{shorten(wallet.address)}</span>
                    </div>
                    {isSelected && <span className="ml-auto text-[9px] font-black uppercase tracking-widest text-cyan-400">Signer</span>}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Step 2 — network */}
        <section className="mb-8">
          <span className="mb-3 block text-[10px] font-black uppercase tracking-[0.2em] text-white/30">
            2 · Settlement Network
          </span>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {(Object.keys(USDC_REGISTRY) as UsdcNetwork[]).map((key) => {
              const entry = getUsdcDeployment(key);
              const isSelected = key === network;
              return (
                <button
                  key={key}
                  disabled={isDeploying}
                  onClick={() => setNetwork(key)}
                  className={`rounded-lg border px-3 py-2.5 text-left transition-all disabled:opacity-40 ${
                    isSelected ? "border-cyan-500/60 bg-cyan-500/10" : "border-white/10 bg-white/5 hover:border-white/30"
                  }`}
                >
                  <span className="block text-[11px] font-bold text-white">{entry.label}</span>
                  <span className="block text-[9px] uppercase tracking-widest text-white/30">
                    {entry.testnet ? "Testnet" : "Mainnet"}
                  </span>
                </button>
              );
            })}
          </div>
          {!usdc.testnet && (
            <p className="mt-3 text-[11px] leading-relaxed text-amber-300/70">
              {usdc.label} is a mainnet — deployment spends real gas and the escrow will hold real USDC.
            </p>
          )}
        </section>

        {/* Step 3 — the awaited pipeline */}
        <section className="mb-8">
          <span className="mb-3 block text-[10px] font-black uppercase tracking-[0.2em] text-white/30">3 · Pipeline</span>
          <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-black/30 p-4">
            {STAGE_SEQUENCE.map((entry, index) => {
              const isDone = deployed ? true : reachedStage > index;
              const isActive = !deployed && reachedStage === index;
              return (
                <div key={entry.stage} className="flex items-center gap-3">
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[9px] font-black ${
                      isDone
                        ? "border-cyan-500 bg-cyan-500 text-black"
                        : isActive
                          ? "animate-pulse border-cyan-400 text-cyan-400"
                          : "border-white/15 text-white/25"
                    }`}
                  >
                    {isDone ? "✓" : index + 1}
                  </span>
                  <span className={`text-xs ${isDone || isActive ? "text-white/80" : "text-white/25"}`}>{entry.label}</span>
                </div>
              );
            })}

            {progress && !deployed && (
              <p className="mt-2 border-t border-white/10 pt-3 text-[11px] leading-relaxed text-cyan-300/80">
                {progress.message}
              </p>
            )}
          </div>
        </section>

        {error && (
          <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-xs leading-relaxed text-red-300">
            {error}
          </div>
        )}

        {deployed && (
          <div className="mb-6 rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-4">
            <span className="mb-2 block text-[9px] font-black uppercase tracking-widest text-cyan-400">
              Escrow live on {usdc.label}
            </span>
            <span className="block break-all font-mono text-[11px] text-white">{deployed.address}</span>
            <div className="mt-3 flex flex-wrap gap-4">
              <button
                onClick={() => navigator.clipboard?.writeText(deployed.address)}
                className="text-[10px] font-bold uppercase tracking-widest text-white/50 hover:text-cyan-400"
              >
                Copy address
              </button>
              {explorerBase && deployed.txHash && (
                <a
                  href={`${explorerBase}/tx/${deployed.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-bold uppercase tracking-widest text-white/50 hover:text-cyan-400"
                >
                  View transaction
                </a>
              )}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-white/40">
              This escrow is now active for the session. To make it permanent, set{" "}
              <span className="font-mono text-cyan-400">NEXT_PUBLIC_TALENT_AGENT_ADDRESS</span> to it.
            </p>
          </div>
        )}

        {activeAddress && !deployed && (
          <p className="mb-6 text-[11px] leading-relaxed text-white/30">
            Currently routing escrow through <span className="font-mono text-white/50">{shorten(activeAddress)}</span>.
            Deploying replaces it for this session only.
          </p>
        )}

        <div className="flex gap-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-grow py-4 text-xs font-black uppercase tracking-widest text-white/40 hover:text-white"
          >
            {deployed ? "Done" : "Cancel"}
          </button>
          <button
            type="button"
            disabled={isDeploying || !selectedWallet || Boolean(deployed)}
            onClick={deploy}
            className="flex-grow rounded-xl bg-cyan-500 py-4 text-xs font-black uppercase tracking-widest text-black transition-all hover:bg-white disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
          >
            {isDeploying ? "Deploying..." : deployed ? "Deployed" : `Deploy to ${usdc.label}`}
          </button>
        </div>
      </div>
    </div>
  );
}
