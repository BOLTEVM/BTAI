"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  formatUnits,
  Hex,
  parseEventLogs,
  parseUnits,
} from "viem";
import { DEFAULT_USDC_NETWORK, getUsdcDeployment, USDC_ABI, UsdcNetwork, USDC_REGISTRY } from "@/lib/usdc";
import {
  ESCROW_AUTH_TYPES,
  isCyprus1Address,
  isQuaiNetwork,
  QUAI_REGISTRY,
  QuaiNetwork,
} from "@/lib/quai";
import DeployTalentAgent from "@/components/DeployTalentAgent";
// Generated from TalentAgent.vy, so the ABI can never drift from the deployed
// bytecode the Deploy Escrow flow ships.
import { TALENT_AGENT_ABI } from "@/lib/talentAgent.generated";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
const CONFIGURED_ESCROW = process.env.NEXT_PUBLIC_TALENT_AGENT_ADDRESS as Hex | undefined;
const CONFIGURED_QUAI_ESCROW = process.env.NEXT_PUBLIC_TALENT_AGENT_QUAI_ADDRESS as Hex | undefined;

/** Any rail the escrow can settle on: legacy USDC chains or the QUAI x402 rail. */
type SettlementNetwork = UsdcNetwork | QuaiNetwork;

// A session-deployed escrow overrides the configured one, so a user can put
// their own TalentAgent on-chain and immediately route payments through it.
const DEPLOYED_ESCROW_KEY = "btai.deployedEscrow";

interface DeployedEscrow {
  address: Hex;
  network: SettlementNetwork;
}

interface TalentApiProfile {
  id: number;
  name: string;
  role: string;
  skills: string[];
  rate: number;
  bio: string;
  image_url?: string | null;
  receive_address: string;
}

interface Agent {
  id: number;
  name: string;
  role: string;
  rate: number;
  image: string;
  bio: string;
  receiveAddress: string;
  skills: string[];
}

interface ChatMessage {
  role: "agent" | "user";
  content: string;
  payment?: {
    amount: string;
    network: SettlementNetwork;
    recipient: string;
    /** Backend talent id — the QUAI x402 flow engages `/engage/{id}`. */
    agentId: number;
  };
}

/** x402 v2 payment-requirements body returned by the backend 402 challenge. */
interface X402Requirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  payTo: string;
  asset: string;
  maxTimeoutSeconds: number;
  extra: {
    name: string;
    version: string;
    talent: string;
    amounts: string[];
    disputeWindow: string;
  };
}

const emptyForm = {
  name: "",
  role: "",
  rate: "",
  bio: "",
  receiveAddress: "",
};

const DEFAULT_SETTLEMENT_NETWORK: SettlementNetwork = (() => {
  const configured = process.env.NEXT_PUBLIC_X402_NETWORK;
  if (configured && configured in QUAI_REGISTRY) return configured as QuaiNetwork;
  return DEFAULT_USDC_NETWORK;
})();

function settlementLabel(network: SettlementNetwork): string {
  return isQuaiNetwork(network) ? QUAI_REGISTRY[network].label : getUsdcDeployment(network).label;
}

function mapTalent(profile: TalentApiProfile): Agent {
  return {
    id: profile.id,
    name: profile.name,
    role: profile.role,
    rate: profile.rate,
    image: profile.image_url || "/0logov3.png",
    bio: profile.bio,
    receiveAddress: profile.receive_address,
    skills: profile.skills,
  };
}

/** Random 32-byte x402 authorization nonce. */
function randomNonce(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export default function Home() {
  const { login, logout, authenticated } = usePrivy();
  const { wallets } = useWallets();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [formData, setFormData] = useState(emptyForm);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isEditing, setIsEditing] = useState<Agent | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isDeployOpen, setIsDeployOpen] = useState(false);
  const [deployedEscrow, setDeployedEscrow] = useState<DeployedEscrow | null>(null);
  const [selectedNetwork, setSelectedNetwork] = useState<SettlementNetwork | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "agent",
      content: "Dark Star Rail interface is online. Select verified talent to start an escrow flow.",
    },
  ]);

  const fetchTalents = useCallback(async () => {
    const response = await fetch(`${API_BASE_URL}/talent`);
    if (!response.ok) {
      throw new Error(`Talent API returned ${response.status}`);
    }
    const data = (await response.json()) as TalentApiProfile[];
    setAgents(data.map(mapTalent));
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem(DEPLOYED_ESCROW_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as DeployedEscrow;
      // Guard against a stale entry naming a network this build no longer ships.
      if (parsed.address?.startsWith("0x") && (parsed.network in USDC_REGISTRY || parsed.network in QUAI_REGISTRY)) {
        setDeployedEscrow(parsed);
      } else {
        window.localStorage.removeItem(DEPLOYED_ESCROW_KEY);
      }
    } catch {
      window.localStorage.removeItem(DEPLOYED_ESCROW_KEY);
    }
  }, []);

  const adoptDeployedEscrow = useCallback((address: string, network: SettlementNetwork) => {
    const escrow: DeployedEscrow = { address: address as Hex, network };
    setDeployedEscrow(escrow);
    setSelectedNetwork(null);
    window.localStorage.setItem(DEPLOYED_ESCROW_KEY, JSON.stringify(escrow));
    setMessages((prev) => [
      ...prev,
      {
        role: "agent",
        content: `Escrow node deployed to ${settlementLabel(network)} at ${address}. Payments now settle through it.`,
      },
    ]);
  }, []);

  // A session-deployed escrow pins the rail it lives on; an explicit manual
  // selection wins next; otherwise the configured default.
  const settlementNetwork: SettlementNetwork =
    selectedNetwork ?? deployedEscrow?.network ?? DEFAULT_SETTLEMENT_NETWORK;

  const escrowAddress =
    deployedEscrow && deployedEscrow.network === settlementNetwork
      ? deployedEscrow.address
      : isQuaiNetwork(settlementNetwork)
        ? CONFIGURED_QUAI_ESCROW
        : CONFIGURED_ESCROW;

  useEffect(() => {
    fetchTalents().catch((error) => {
      console.error("DarkStarRail: Failed to fetch talents", error);
      setStatusMessage("Talent API is unavailable. Check NEXT_PUBLIC_API_BASE_URL and backend health.");
    });
  }, [fetchTalents]);

  const resetModal = () => {
    setFormData(emptyForm);
    setIsRegistering(false);
    setIsEditing(null);
  };

  const submitTalent = async (event: FormEvent) => {
    event.preventDefault();
    const payload = {
      name: formData.name,
      role: formData.role,
      rate: Number(formData.rate),
      bio: formData.bio,
      receive_address: formData.receiveAddress,
      skills: [],
      image_url: isEditing?.image === "/0logov3.png" ? null : isEditing?.image ?? null,
    };
    const endpoint = isEditing ? `${API_BASE_URL}/talent/${isEditing.id}` : `${API_BASE_URL}/talent`;
    const response = await fetch(endpoint, {
      method: isEditing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      setStatusMessage(`Talent save failed with status ${response.status}.`);
      return;
    }
    await fetchTalents();
    resetModal();
  };

  const startEditing = (agent: Agent) => {
    setFormData({
      name: agent.name,
      role: agent.role,
      rate: String(agent.rate),
      bio: agent.bio,
      receiveAddress: agent.receiveAddress,
    });
    setIsEditing(agent);
  };

  const consultAgent = (agent: Agent) => {
    setIsChatOpen(true);
    setMessages((prev) => [
      ...prev,
      {
        role: "agent",
        content: `Escrow is ready for ${agent.name} on ${settlementLabel(settlementNetwork)}. Review the hourly rate and authorize when you are ready.`,
        payment: {
          amount: String(agent.rate),
          network: settlementNetwork,
          recipient: agent.receiveAddress,
          agentId: agent.id,
        },
      },
    ]);
  };

  const handleSendMessage = async (text?: string) => {
    const input = text ?? chatInput;
    if (!input.trim()) return;
    setMessages((prev) => [...prev, { role: "user", content: input }]);
    setChatInput("");

    try {
      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: input }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || `Chat API returned ${response.status}`);
      }
      setMessages((prev) => [...prev, { role: "agent", content: data.reply }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Protocol chat is unavailable.";
      setMessages((prev) => [...prev, { role: "agent", content: message }]);
    }
  };

  /**
   * QUAI x402 flow — gasless for the client:
   *   1. one-time token approval to the escrow (the only client transaction);
   *   2. GET /engage/{id} → 402 payment requirements;
   *   3. sign an EIP-712 EscrowAuthorization in Pelagus;
   *   4. retry with PAYMENT-SIGNATURE — the facilitator settles on-chain.
   */
  const fulfillQuaiPayment = async (amount: string, network: QuaiNetwork, recipient: string, agentId: number) => {
    const quai = QUAI_REGISTRY[network];
    const say = (content: string) => setMessages((prev) => [...prev, { role: "agent", content }]);

    if (!quai.tokenAddress) {
      say(`No settlement token configured for ${quai.label}. Set NEXT_PUBLIC_QUAI_SETTLEMENT_TOKEN.`);
      return;
    }
    if (!isCyprus1Address(recipient)) {
      say("Protocol error: the talent address is not in the active Cyprus-1 shard (0x00...). Payment halted.");
      return;
    }

    const wallet = wallets[0]!;
    try {
      // Pelagus knows the QUAI chains natively; a failed switch is not fatal —
      // the signing request will surface the mismatch to the user.
      await wallet.switchChain(quai.chain.id);
    } catch {
      // continue
    }
    const provider = await wallet.getEthereumProvider();
    const transport = custom(provider);
    const publicClient = createPublicClient({ chain: quai.chain, transport });
    const walletClient = createWalletClient({ chain: quai.chain, transport });
    const account = wallet.address as Hex;

    if (!isCyprus1Address(account)) {
      say("This wallet's address is not in the Cyprus-1 shard (0x00...). Pick a Cyprus-1 account in Pelagus.");
      return;
    }

    const parsedAmount = parseUnits(amount, quai.decimals);

    const balance = await publicClient.readContract({
      address: quai.tokenAddress,
      abi: USDC_ABI,
      functionName: "balanceOf",
      args: [account],
    });
    if (balance < parsedAmount) {
      say(
        `Insufficient settlement-token balance on ${quai.label}: the escrow needs ${amount} but this wallet holds ` +
          `${formatUnits(balance, quai.decimals)}.`
      );
      return;
    }

    // The escrow pulls tokens via transferFrom when the facilitator settles.
    const allowance = await publicClient.readContract({
      address: quai.tokenAddress,
      abi: USDC_ABI,
      functionName: "allowance",
      args: [account, escrowAddress as Hex],
    });
    if (allowance < parsedAmount) {
      const approvalHash = await walletClient.sendTransaction({
        account,
        to: quai.tokenAddress,
        data: encodeFunctionData({
          abi: USDC_ABI,
          functionName: "approve",
          args: [escrowAddress as Hex, parsedAmount],
        }),
      });
      say(`${quai.label} token allowance approved. TX: ${approvalHash.slice(0, 10)}...`);
      await publicClient.waitForTransactionReceipt({ hash: approvalHash });
    }

    // x402 challenge: fetch the payment requirements from the resource server.
    const challenge = await fetch(`${API_BASE_URL}/engage/${agentId}`);
    if (challenge.status !== 402) {
      const body = await challenge.json().catch(() => ({}));
      throw new Error(body.detail || `Engagement challenge failed with status ${challenge.status}`);
    }
    const challengeBody = (await challenge.json()) as { accepts: X402Requirements[] };
    const reqs = challengeBody.accepts?.[0];
    if (!reqs || reqs.scheme !== "btai-escrow") {
      throw new Error("The backend did not offer a btai-escrow payment requirement.");
    }
    if ( reqs.payTo.toLowerCase() !== (escrowAddress as string).toLowerCase()) {
      throw new Error("Backend escrow address does not match the configured escrow. Refusing to sign.");
    }

    // EIP-712 EscrowAuthorization — the message total must equal the sum of
    // the milestone amounts the facilitator will pass on-chain.
    const amounts = reqs.extra.amounts;
    const total = amounts.reduce((sum, a) => sum + BigInt(a), 0n);
    const validBefore = Math.floor(Date.now() / 1000) + reqs.maxTimeoutSeconds;
    const nonce = randomNonce();

    const typedData = {
      domain: {
        name: reqs.extra.name,
        version: reqs.extra.version,
        chainId: quai.chain.id,
        verifyingContract: reqs.payTo as Hex,
      },
      types: ESCROW_AUTH_TYPES,
      primaryType: "EscrowAuthorization",
      message: {
        client: account,
        talent: reqs.extra.talent as Hex,
        token: reqs.asset as Hex,
        total: total.toString(),
        disputeWindow: reqs.extra.disputeWindow,
        validBefore: String(validBefore),
        nonce,
      },
    };

    say("Sign the EscrowAuthorization in your wallet — no gas, no transaction.");
    const signature = (await provider.request({
      method: "eth_signTypedData_v4",
      params: [account, JSON.stringify(typedData)],
    })) as string;

    const paymentPayload = {
      x402Version: 2,
      scheme: reqs.scheme,
      network: reqs.network,
      payload: {
        signature,
        authorization: {
          client: account,
          talent: reqs.extra.talent,
          token: reqs.asset,
          amounts,
          disputeWindow: reqs.extra.disputeWindow,
          validBefore: String(validBefore),
          nonce,
        },
      },
    };

    const settleRes = await fetch(`${API_BASE_URL}/engage/${agentId}`, {
      headers: { "PAYMENT-SIGNATURE": btoa(JSON.stringify(paymentPayload)) },
    });
    const settleBody = await settleRes.json().catch(() => ({}));
    if (!settleRes.ok) {
      say(`Payment rejected: ${settleBody.detail ?? `status ${settleRes.status}`}`);
      return;
    }

    const settlement = settleBody.settlement ?? {};
    say(
      settlement.agreementId !== undefined
        ? `Agreement #${settlement.agreementId} funded with ${amount} on ${quai.label} — settled gaslessly via x402. ` +
          `TX: ${String(settlement.transaction ?? "").slice(0, 10)}...`
        : `${amount} settled on ${quai.label} via x402.`
    );
  };

  const fulfillPayment = async (amount: string, network: SettlementNetwork, recipient: string, agentId: number) => {
    if (!wallets[0]) return alert("Please connect your wallet first.");
    if (!escrowAddress) {
      return alert("No escrow contract configured. Deploy one, or set the escrow env var for this network.");
    }
    if (!recipient) return alert("Talent receive address is missing.");

    const say = (content: string) => setMessages((prev) => [...prev, { role: "agent", content }]);

    setIsProcessingPayment(true);
    try {
      if (isQuaiNetwork(network)) {
        await fulfillQuaiPayment(amount, network, recipient, agentId);
        return;
      }

      const usdc = getUsdcDeployment(network);
      const wallet = wallets[0];
      // Real USDC only exists on its own chain, so the wallet has to be there
      // before anything is signed.
      await wallet.switchChain(usdc.chain.id);
      const provider = await wallet.getEthereumProvider();
      const transport = custom(provider);
      const publicClient = createPublicClient({ chain: usdc.chain, transport });
      const walletClient = createWalletClient({ chain: usdc.chain, transport });
      const account = wallet.address as Hex;
      const parsedAmount = parseUnits(amount, usdc.decimals);

      const balance = await publicClient.readContract({
        address: usdc.address,
        abi: USDC_ABI,
        functionName: "balanceOf",
        args: [account],
      });
      if (balance < parsedAmount) {
        say(
          `Insufficient ${usdc.label} USDC: the escrow needs ${amount} but this wallet holds ` +
            `${formatUnits(balance, usdc.decimals)}.`
        );
        return;
      }

      // x402 Input, step 1: the escrow pulls USDC via transferFrom, so it needs
      // an allowance. Skip the approval entirely if one already covers this.
      const allowance = await publicClient.readContract({
        address: usdc.address,
        abi: USDC_ABI,
        functionName: "allowance",
        args: [account, escrowAddress],
      });
      if (allowance < parsedAmount) {
        const approvalHash = await walletClient.sendTransaction({
          account,
          to: usdc.address,
          data: encodeFunctionData({
            abi: USDC_ABI,
            functionName: "approve",
            args: [escrowAddress, parsedAmount],
          }),
        });
        say(`${usdc.label} USDC allowance approved. TX: ${approvalHash.slice(0, 10)}...`);
        // The escrow call reverts if it lands before the approval is mined.
        await publicClient.waitForTransactionReceipt({ hash: approvalHash });
      }

      // x402 Input, step 2: open and fund the escrow in one transaction. The
      // caller is recorded as the client, so no orchestrator round-trip is
      // needed and there is no unfunded agreement for anyone else to claim.
      const escrowHash = await walletClient.sendTransaction({
        account,
        to: escrowAddress,
        data: encodeFunctionData({
          abi: TALENT_AGENT_ABI,
          functionName: "create_and_deposit",
          args: [recipient as Hex, usdc.address, parsedAmount],
        }),
      });
      say(`Escrow funding submitted. TX: ${escrowHash.slice(0, 10)}...`);

      const receipt = await publicClient.waitForTransactionReceipt({ hash: escrowHash });
      if (receipt.status !== "success") {
        say("Protocol error: the escrow transaction reverted on-chain. No USDC was moved.");
        return;
      }

      // Read the agreement id back off the contract's own event rather than
      // guessing it from agreement_count, which another client can advance.
      const [deposited] = parseEventLogs({
        abi: TALENT_AGENT_ABI,
        eventName: "FundsDeposited",
        logs: receipt.logs,
      });
      const agreementId = deposited?.args.agreement_id;

      say(
        agreementId === undefined
          ? `${amount} ${usdc.label} USDC is held in escrow (x402 input cleared).`
          : `Agreement #${agreementId.toString()} funded with ${amount} ${usdc.label} USDC. ` +
            `x402 input cleared — funds release to the talent on completion.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Transaction rejected";
      say(`Protocol error: ${message}`);
    } finally {
      setIsProcessingPayment(false);
    }
  };

  return (
    <div className="relative min-h-screen px-6 py-12 md:px-24">
      <div className="hero-gradient" />

      <nav className="relative z-10 mb-20 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Image src="/0logov3.png" alt="Dark Star Rail logo" width={40} height={40} className="rounded-full border border-white/20 shadow-lg shadow-cyan-500/20" />
          <span className="text-xl font-bold tracking-tighter gradient-text uppercase">Dark Star Rail</span>
        </div>
        <div className="flex items-center gap-4">
          {authenticated ? (
            <>
              <button onClick={() => setIsRegistering(true)} className="text-xs font-bold uppercase tracking-widest text-cyan-400 hover:text-white">
                + Register Agent
              </button>
              <button onClick={() => setIsDeployOpen(true)} className="text-xs font-bold uppercase tracking-widest text-cyan-400 hover:text-white">
                + Deploy Escrow
              </button>
              <button onClick={logout} className="glass px-5 py-2 text-xs font-bold uppercase tracking-widest text-red-400 hover:bg-red-500/20">
                Disconnect
              </button>
            </>
          ) : (
            <button onClick={login} className="glass px-5 py-2 text-xs font-bold uppercase tracking-widest text-cyan-400 hover:bg-cyan-500/20">
              Access Protocol
            </button>
          )}
        </div>
      </nav>

      <header className="relative z-10 mb-32 max-w-4xl">
        <div className="mb-6 inline-block rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1">
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-400">Production Data Path</span>
        </div>
        <h1 className="mb-10 text-6xl font-black leading-[0.9] tracking-tighter text-white md:text-8xl">
          THE <span className="gradient-text">AGENTIC</span> TALENT PROTOCOL.
        </h1>
        <p className="max-w-2xl text-xl font-light leading-relaxed text-white/50">
          Dark Star Rail mediates high-end collaboration with registered talent profiles, wallet authentication, and smart contract escrow on Quai Network.
        </p>

        <div className="mt-8 flex items-center gap-3">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30">Settlement Rail</span>
          <select
            value={settlementNetwork}
            disabled={Boolean(deployedEscrow)}
            onChange={(e) => setSelectedNetwork(e.target.value as SettlementNetwork)}
            className="rounded-lg border border-white/10 bg-black/60 px-3 py-2 font-mono text-xs text-cyan-300 disabled:opacity-50"
          >
            <optgroup label="QUAI x402 rail (gasless)">
              {(Object.keys(QUAI_REGISTRY) as QuaiNetwork[]).map((key) => (
                <option key={key} value={key}>
                  {QUAI_REGISTRY[key].label}
                </option>
              ))}
            </optgroup>
            <optgroup label="USDC rail">
              {(Object.keys(USDC_REGISTRY) as UsdcNetwork[]).map((key) => (
                <option key={key} value={key}>
                  {USDC_REGISTRY[key].label}
                </option>
              ))}
            </optgroup>
          </select>
        </div>

        {statusMessage && <p className="mt-6 text-sm text-red-300">{statusMessage}</p>}
        {escrowAddress ? (
          <p className="mt-6 font-mono text-[11px] text-white/30">
            Escrow {deployedEscrow && deployedEscrow.network === settlementNetwork ? "deployed this session" : "from configuration"} on{" "}
            <span className="text-cyan-400">{settlementLabel(settlementNetwork)}</span> ·{" "}
            <span className="text-white/50">{escrowAddress}</span>
          </p>
        ) : (
          <p className="mt-6 text-sm text-amber-300/70">
            No escrow contract on {settlementLabel(settlementNetwork)} yet. Deploy one to start settling.
          </p>
        )}
      </header>

      <section className="relative z-10">
        <div className="mb-12 flex items-center justify-between">
          <h2 className="text-sm font-black uppercase tracking-[0.3em] text-white/30">Verified Node Talent</h2>
          <div className="ml-12 h-px flex-grow bg-gradient-to-r from-white/10 to-transparent" />
        </div>

        {agents.length === 0 ? (
          <div className="glass p-8 text-sm text-white/50">No registered talent profiles are available yet.</div>
        ) : (
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => (
              <div key={agent.id} className="glass group flex flex-col overflow-hidden border-white/5 p-8 text-white transition-all hover:border-cyan-500/40">
                <div className="mb-6 flex items-start gap-6">
                  <Image src={agent.image} alt={agent.name} width={80} height={80} className="rounded-xl border border-white/10 grayscale transition-all duration-700 group-hover:grayscale-0" />
                  <div>
                    <h3 className="mb-1 text-xl font-bold tracking-tight">{agent.name}</h3>
                    <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-cyan-400">{agent.role}</p>
                  </div>
                </div>

                <p className="mb-8 line-clamp-3 text-sm font-light italic leading-relaxed text-white/40">&quot;{agent.bio}&quot;</p>

                <div className="mb-6 flex flex-col gap-1">
                  <span className="text-[8px] font-bold uppercase tracking-widest text-white/20">Node Address</span>
                  <span className="truncate font-mono text-[9px] text-cyan-400">{agent.receiveAddress}</span>
                </div>

                <div className="mt-auto space-y-4 border-t border-white/5 pt-6">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="mb-1 text-[9px] uppercase tracking-widest text-white/30">Base Rate</span>
                      <span className="font-mono text-xl text-white/90">${agent.rate}/hr</span>
                    </div>
                    <button onClick={() => consultAgent(agent)} className="rounded-lg border border-white/10 bg-white/5 px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest text-white transition-all hover:bg-cyan-500 hover:text-black">
                      Start Escrow
                    </button>
                  </div>

                  {authenticated && (
                    <button onClick={() => startEditing(agent)} className="w-full rounded border border-dashed border-white/10 bg-white/5 py-2 text-[9px] font-black uppercase tracking-widest text-white/30 transition-all hover:border-cyan-500/50 hover:text-cyan-400">
                      Config Node Parameters
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {(isRegistering || isEditing) && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-6">
          <button aria-label="Close modal" className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={resetModal} />
          <div className="glass relative z-10 w-full max-w-lg border-cyan-500/30 p-10">
            <h2 className="mb-2 text-3xl font-black uppercase tracking-tighter gradient-text">
              {isEditing ? "Config Node Parameters" : "Register Your Node"}
            </h2>
            <form onSubmit={submitTalent} className="mt-8 flex flex-col gap-6">
              <input required value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white" placeholder="Agent name" />
              <input required value={formData.receiveAddress} onChange={(e) => setFormData({ ...formData, receiveAddress: e.target.value })} className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 font-mono text-sm text-white" placeholder="0x..." />
              <div className="grid grid-cols-2 gap-4">
                <input required value={formData.role} onChange={(e) => setFormData({ ...formData, role: e.target.value })} className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white" placeholder="Specialization" />
                <input required type="number" min="0" step="0.01" value={formData.rate} onChange={(e) => setFormData({ ...formData, rate: e.target.value })} className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 font-mono text-sm text-white" placeholder="Hourly rate" />
              </div>
              <textarea required rows={4} value={formData.bio} onChange={(e) => setFormData({ ...formData, bio: e.target.value })} className="min-h-[100px] rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white" placeholder="Protocol bio" />
              <div className="mt-4 flex gap-4">
                <button type="button" onClick={resetModal} className="flex-grow py-4 text-xs font-black uppercase tracking-widest text-white/40 hover:text-white">
                  Cancel
                </button>
                <button type="submit" className="flex-grow rounded-xl bg-cyan-500 py-4 text-xs font-black uppercase tracking-widest text-black hover:bg-white">
                  {isEditing ? "Update Node" : "Activate Node"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isDeployOpen && (
        <DeployTalentAgent
          activeAddress={escrowAddress}
          onDeployed={adoptDeployedEscrow}
          onClose={() => setIsDeployOpen(false)}
        />
      )}

      {isChatOpen && (
        <div className="chat-container glass fixed bottom-10 right-10 z-50 h-[600px] w-[400px] overflow-hidden rounded-2xl border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.5)]">
          <div className="flex items-center justify-between border-b border-white/10 bg-white/5 p-6">
            <span className="text-xs font-black uppercase tracking-[0.2em] text-white">Protocol Orchestrator</span>
            <button onClick={() => setIsChatOpen(false)} className="text-white/40 hover:text-white">Close</button>
          </div>
          <div className="flex h-[400px] flex-col gap-6 overflow-y-auto p-6">
            {messages.map((msg, index) => (
              <div key={`${msg.role}-${index}`} className={`flex ${msg.role === "agent" ? "justify-start" : "justify-end"}`}>
                <div className={`max-w-[85%] rounded-2xl px-5 py-3 text-sm leading-relaxed ${msg.role === "agent" ? "rounded-tl-none border border-white/10 bg-white/5 text-white/80" : "rounded-tr-none bg-cyan-500 font-medium text-black"}`}>
                  {msg.content}
                  {msg.payment && (
                    <div className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-4">
                      <div className="flex items-center justify-between font-mono text-[10px] text-white/40">
                        <span>{settlementLabel(msg.payment.network)}{isQuaiNetwork(msg.payment.network) ? "" : " USDC"}</span>
                        <span className="text-cyan-400">{msg.payment.amount}</span>
                      </div>
                      <button disabled={isProcessingPayment} onClick={() => fulfillPayment(msg.payment!.amount, msg.payment!.network, msg.payment!.recipient, msg.payment!.agentId)} className="w-full rounded-lg bg-white py-2.5 text-[10px] font-black uppercase tracking-widest text-black transition-all hover:bg-cyan-400 disabled:cursor-wait disabled:bg-white/10 disabled:text-white/30">
                        {isProcessingPayment ? "Settling on Chain..." : "Authorize Escrow"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-3 border-t border-white/10 bg-black/20 p-6">
            <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSendMessage()} placeholder="Query the protocol..." className="flex-grow rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white" />
            <button onClick={() => handleSendMessage()} className="h-12 w-12 rounded-xl bg-white text-black hover:bg-cyan-400">Send</button>
          </div>
        </div>
      )}

      <footer className="mt-40 flex flex-col items-center justify-between gap-6 border-t border-white/5 pb-12 pt-12 md:flex-row">
        <span className="text-[10px] font-bold uppercase tracking-[0.4em] text-white/20">Powered by Dark Star Rail</span>
        <span className="text-[10px] font-light uppercase tracking-[0.2em] text-white/10">
          &copy; 2026 Dark Star Rail | A DarkCircle Suite app
        </span>
      </footer>
    </div>
  );
}
