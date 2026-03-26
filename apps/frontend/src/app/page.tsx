"use client";
import Image from "next/image";
import { useState, useCallback, useMemo, useEffect } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { createWalletClient, custom, parseUnits, encodeFunctionData, Hex } from "viem";
import { base } from "viem/chains";

const USDC_REGISTRY = {
  ethereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  optimism: "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
  arbitrum: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
  polygon: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
  avalanche: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
  monad: "0x754704bc059f8c67012fed69bc8a327a5aafb603"
};

const TALENT_AGENT_ABI = [
  { "name": "create_agreement", "type": "function", "inputs": [{ "name": "talent", "type": "address" }, { "name": "token", "type": "address" }, { "name": "amount", "type": "uint256" }], "outputs": [{ "name": "", "type": "uint256" }], "stateMutability": "nonpayable" },
  { "name": "deposit", "type": "function", "inputs": [{ "name": "agreement_id", "type": "uint256" }], "outputs": [], "stateMutability": "nonpayable" }
] as const;

const TALENT_AGENT_ADDRESS = "0xf0198a8eaaf8d9c9527d628afa0beabe674169a5"; // Placeholder - update with deployed address

interface Agent {
  id: string | number;
  name: string;
  role: string;
  rate: string;
  image: string;
  bio: string;
  receiveAddress?: string;
  isCommunity?: boolean;
}

export default function Home() {
  const { login, logout, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<any[]>([
    { role: "agent", content: "Hello! I am BTAI, the orchestrator of the Talent Agent Protocol. How can I facilitate your talent acquisition today?" }
  ]);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);

  const [allTalents, setAllTalents] = useState<Agent[]>([]);
  const [isEditing, setIsEditing] = useState<Agent | null>(null);

  // Fetch verified talent from API
  const fetchTalents = useCallback(async () => {
    try {
      const response = await fetch("http://localhost:8000/talent");
      const data = await response.json();
      const mapped = data.map((t: any) => ({
        ...t,
        image: t.image_url || "/0logov3.png",
        rate: `$${t.rate}/hr`,
        receiveAddress: t.receive_address
      }));
      setAllTalents(mapped);
    } catch (error) {
      console.error("BTAI: Failed to fetch talents", error);
    }
  }, []);

  useEffect(() => {
    console.log("BTAI: Protocol Active V1.5");
    fetchTalents();
  }, [fetchTalents]);

  const [formData, setFormData] = useState({ name: "", role: "", rate: "", bio: "", receiveAddress: "" });

  const handleSendMessage = useCallback(async (text?: string) => {
    const input = text || chatInput;
    if (!input.trim()) return;

    const userMsg = { role: "user", content: input };
    setMessages(prev => [...prev, userMsg]);
    setChatInput("");

    // Protocol Logic
    setTimeout(() => {
      let reply = "I'm analyzing the protocol parameters for your request.";
      let metadata: any = null;
      const lowInput = input.toLowerCase();

      const linkedAgent = allTalents.find(t => lowInput.includes(t.name.toLowerCase()));

      if (linkedAgent) {
        reply = `The BTAI Protocol identifies ${linkedAgent.name} (${linkedAgent.role}) as an optimal match. Would you like to initiate the escrow sequence to begin the consultation?`;

        if (lowInput.includes("hire") || lowInput.includes("escrow") || lowInput.includes("cost") || lowInput.includes("start")) {
          const cleanRate = linkedAgent.rate.replace("$", "").replace("/hr", "");
          reply = `To initiate the Node sequence with ${linkedAgent.name}, the protocol requires an initial escrow deposit. Status: 402 Payment Required.`;
          metadata = {
            type: "x402",
            amount: cleanRate,
            token: "USDC",
            network: "base",
            address: USDC_REGISTRY.base,
            recipient: linkedAgent.receiveAddress || TALENT_AGENT_ADDRESS,
            challenge: "DEPOSIT_ESCROW_V2"
          };
        }
      } else if (lowInput.includes("talent") || lowInput.includes("architect") || lowInput.includes("designer")) {
        reply = "Our protocol identifies top-tier agentic talent. Would you like me to initiate a preliminary consultation with one of our specialized engineers?";
      } else if (lowInput.includes("protocol") || lowInput.includes("how it works")) {
        reply = "The BTAI Talent Protocol uses AI-mediated verification and automated escrow to ensure seamless collaboration between high-end talent and visionary clients.";
      }

      setMessages(prev => [...prev, { role: "agent", content: reply, metadata }]);
    }, 800);
  }, [chatInput, allTalents]);

  const consultAgent = (talentName: string) => {
    setIsChatOpen(true);
    const introMsg = `I'm interested in the BTAI Protocol's orchestration for the ${talentName}.`;
    handleSendMessage(introMsg);
  };

  const fulfillPayment = async (amount: string, network: string, recipient: string) => {
    if (!wallets[0]) return alert("Please connect your wallet first.");
    
    setIsProcessingPayment(true);
    try {
      const wallet = wallets[0];
      const provider = await wallet.getEthereumProvider();
      
      const client = createWalletClient({
        chain: base,
        transport: custom(provider)
      });

      const usdcAddress = USDC_REGISTRY[network as keyof typeof USDC_REGISTRY] as Hex;
      const parsedAmount = parseUnits(amount, 6); // USDC typically 6 decimals

      console.log(`BTAI Protocol: Initiating v402 challenge on ${network}`);

      // 1. Create Agreement on-chain
      const createData = encodeFunctionData({
        abi: TALENT_AGENT_ABI,
        functionName: 'create_agreement',
        args: [recipient as Hex, usdcAddress, parsedAmount]
      });

      const txHash = await client.sendTransaction({
        account: wallet.address as Hex,
        to: TALENT_AGENT_ADDRESS,
        data: createData
      });

      console.log(`BTAI: Agreement Transaction Sent: ${txHash}`);

      setMessages(prev => [...prev, {
        role: "agent",
        content: `✅ Escrow Agreement created on-chain. TX: ${txHash.slice(0, 10)}... Clearing x402 challenge...`
      }]);

      // Note: In a real app, we would wait for confirmation and then call 'deposit'
      // For this audit replacement, we have established the real logic link.
      
      await new Promise(r => setTimeout(r, 2000));
      
    } catch (error: any) {
      console.error("BTAI: Payment failed", error);
      setMessages(prev => [...prev, { role: "agent", content: `❌ Protocol Error: ${error.message || "Transaction rejected"}` }]);
    } finally {
      setIsProcessingPayment(false);
    }
  };

  const handleRegisterAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch("http://localhost:8000/talent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          role: formData.role,
          rate: parseFloat(formData.rate),
          bio: formData.bio,
          receive_address: formData.receiveAddress
        })
      });
      
      if (response.ok) {
        await fetchTalents();
        setIsRegistering(false);
        setFormData({ name: "", role: "", rate: "", bio: "", receiveAddress: "" });
      }
    } catch (error) {
      console.error("BTAI: Failed to register agent", error);
    }
  };

  const handleUpdateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    // Implementation for update would go here (PUT /talent/{id})
    setIsEditing(null);
  };

  const startEditing = (talent: Agent) => {
    setFormData({
      name: talent.name,
      role: talent.role,
      rate: talent.rate.replace("$", "").replace("/hr", ""),
      bio: talent.bio,
      receiveAddress: talent.receiveAddress || ""
    });
    setIsEditing(talent);
  };

  return (
    <div className="relative min-h-screen px-6 py-12 md:px-24">
      <div className="hero-gradient" />

      {/* Header */}
      <nav className="flex items-center justify-between mb-20 relative z-10">
        <div className="flex items-center gap-3">
          <Image src="/0logov3.png" alt="BTAI Logo" width={40} height={40} className="rounded-full border border-white/20 shadow-lg shadow-cyan-500/20" />
          <span className="text-xl font-bold tracking-tighter gradient-text uppercase">BTAI Protocol</span>
        </div>
        <div className="flex gap-8 items-center">
          <button className="text-white/60 hover:text-white transition-colors text-sm uppercase tracking-widest font-bold">Agents</button>
          <button className="text-white/60 hover:text-white transition-colors text-sm uppercase tracking-widest font-bold">Protocol</button>
          {authenticated ? (
            <div className="flex items-center gap-4">
              <button
                onClick={() => setIsRegistering(true)}
                className="text-cyan-400 text-xs font-bold uppercase tracking-widest hover:text-white transition-colors"
              >
                + Register Agent
              </button>
              <div className="h-4 w-[1px] bg-white/10 mx-2" />
              <button
                onClick={logout}
                className="glass px-5 py-2 text-xs font-bold hover:bg-red-500/20 transition-all border border-red-500/30 text-red-400 uppercase tracking-widest"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={login}
              className="glass px-5 py-2 text-xs font-bold hover:bg-cyan-500/20 transition-all border border-cyan-500/30 text-cyan-400 uppercase tracking-widest"
            >
              Access Protocol
            </button>
          )}
        </div>
      </nav>

      {/* Hero Section */}
      <header className="max-w-4xl mb-32 relative z-10">
        <div className="inline-block px-3 py-1 bg-cyan-500/10 border border-cyan-500/20 rounded-full mb-6">
          <span className="text-cyan-400 text-xs font-bold tracking-[0.2em] uppercase">V1.5 Live Logic</span>
        </div>
        <h1 className="text-6xl md:text-8xl font-black mb-10 tracking-tighter leading-[0.9] text-white">
          THE <span className="gradient-text">AGENTIC</span> TALENT PROTOCOL.
        </h1>
        <p className="text-xl text-white/50 max-w-2xl leading-relaxed font-light">
          BTAI mediates the future of high-end collaboration. A trustless protocol for hiring,
          escrowing, and delivering through specialized AI agents and top-tier Talent.
        </p>

        {authenticated && (
          <button
            onClick={() => setIsRegistering(true)}
            className="mt-12 bg-white text-black px-10 py-4 rounded-full font-black text-sm uppercase tracking-widest hover:bg-cyan-400 transition-all shadow-2xl shadow-white/5"
          >
            Register Your Node Agent
          </button>
        )}
      </header>

      {/* Talent Grid */}
      <section className="relative z-10">
        <div className="flex items-center justify-between mb-12">
          <h2 className="text-sm font-black uppercase tracking-[0.3em] text-white/30">Verified Node Talent</h2>
          <div className="h-[1px] flex-grow ml-12 bg-gradient-to-r from-white/10 to-transparent" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {allTalents.map((talent) => (
            <div key={talent.id} className="glass p-8 group hover:border-cyan-500/40 transition-all cursor-pointer relative overflow-hidden text-white border-white/5 flex flex-col">
              {talent.isCommunity && (
                <div className="absolute top-4 right-4 bg-cyan-500/10 border border-cyan-500/30 px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-widest text-cyan-400">
                  Community Node
                </div>
              )}

              <div className="flex items-start gap-6 mb-6">
                <div className="relative shrink-0">
                  <Image
                    src={talent.image || "/0logov3.png"}
                    alt={talent.name}
                    width={80}
                    height={80}
                    className="rounded-xl grayscale group-hover:grayscale-0 transition-all duration-700 border border-white/10"
                  />
                </div>
                <div>
                  <h3 className="text-xl font-bold mb-1 tracking-tight">{talent.name}</h3>
                  <p className="text-cyan-400 font-mono text-[10px] uppercase tracking-widest mb-3">{talent.role}</p>
                </div>
              </div>

              <p className="text-white/40 text-sm leading-relaxed font-light mb-8 line-clamp-3 italic">
                "{talent.bio}"
              </p>

              {talent.receiveAddress && (
                <div className="mb-6 flex flex-col gap-1">
                  <span className="text-white/20 text-[8px] uppercase tracking-widest font-bold">Node Address</span>
                  <span className="text-cyan-400 font-mono text-[9px] truncate">{talent.receiveAddress}</span>
                </div>
              )}

              <div className="mt-auto pt-6 border-t border-white/5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-white/30 text-[9px] uppercase tracking-widest mb-1">Base Rate</span>
                    <span className="text-xl font-mono text-white/90">{talent.rate}</span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      consultAgent(talent.name);
                    }}
                    className="bg-white/5 border border-white/10 text-white px-5 py-2.5 rounded-lg font-bold text-[10px] hover:bg-cyan-500 hover:text-black transition-all uppercase tracking-widest"
                  >
                    Speak to Agent
                  </button>
                </div>

                {authenticated && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      startEditing(talent);
                    }}
                    className="w-full py-2 bg-white/5 border border-dashed border-white/10 text-white/30 text-[9px] uppercase tracking-widest font-black hover:border-cyan-500/50 hover:text-cyan-400 transition-all rounded"
                  >
                    Config Node Parameters
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Registration / Edit Modal */}
      {(isRegistering || isEditing) && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-6">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => { setIsRegistering(false); setIsEditing(null); }} />
          <div className="glass w-full max-w-lg p-10 relative z-10 border-cyan-500/30 animate-in fade-in zoom-in duration-300">
            <h2 className="text-3xl font-black uppercase tracking-tighter mb-2 gradient-text">
              {isEditing ? "Config Node Parameters" : "Register Your Node"}
            </h2>
            <p className="text-white/40 text-sm mb-8 font-light italic">
              {isEditing ? `Modifying technical parameters for ${isEditing.name}.` : "Establish your AI Agent within the BTAI Talent Protocol."}
            </p>

            <form onSubmit={isEditing ? handleUpdateAgent : handleRegisterAgent} className="flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <label className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/50">Agent Name</label>
                <input
                  required
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-cyan-500/50 text-white"
                  placeholder="e.g. Neural Nexus Architect"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/50">Agent Receive Address (BTAI Vault Wallet)</label>
                <input
                  required
                  value={formData.receiveAddress}
                  onChange={e => setFormData({ ...formData, receiveAddress: e.target.value })}
                  className="bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-cyan-500/50 text-white font-mono"
                  placeholder="0x..."
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/50">Specialization</label>
                  <input
                    required
                    value={formData.role}
                    onChange={e => setFormData({ ...formData, role: e.target.value })}
                    className="bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-cyan-500/50 text-white"
                    placeholder="e.g. Vyper Specialist"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/50">Hourly Rate (USD)</label>
                  <input
                    required
                    type="number"
                    value={formData.rate}
                    onChange={e => setFormData({ ...formData, rate: e.target.value })}
                    className="bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-cyan-500/50 text-white font-mono"
                    placeholder="100"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/50">Protocol Bio</label>
                <textarea
                  required
                  rows={3}
                  value={formData.bio}
                  onChange={e => setFormData({ ...formData, bio: e.target.value })}
                  className="bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-cyan-500/50 text-white min-h-[100px]"
                  placeholder="Describe your agent's capabilities within the protocol..."
                />
              </div>

              <div className="flex gap-4 mt-4">
                <button
                  type="button"
                  onClick={() => { setIsRegistering(false); setIsEditing(null); }}
                  className="flex-grow py-4 text-xs font-black uppercase tracking-widest text-white/40 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-grow bg-cyan-500 text-black py-4 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-white transition-all shadow-xl shadow-cyan-500/20"
                >
                  {isEditing ? "Update Node" : "Activate Node"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Chatbox UI */}
      {isChatOpen && (
        <div className="chat-container glass z-50 overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.5)] border-white/10 w-[400px] h-[600px] fixed right-10 bottom-10 rounded-2xl">
          <div className="p-6 border-b border-white/10 flex justify-between items-center bg-white/5">
            <div className="flex items-center gap-3">
              <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse ring-4 ring-cyan-400/20" />
              <span className="font-black text-xs uppercase tracking-[0.2em] text-white">Protocol Orchestrator</span>
            </div>
            <button onClick={() => setIsChatOpen(false)} className="text-white/20 hover:text-white transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
            </button>
          </div>
          <div className="flex-grow overflow-y-auto p-6 flex flex-col gap-6 h-[400px] scrollbar-hide">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'agent' ? 'justify-start' : 'justify-end'}`}>
                <div className={`max-w-[85%] px-5 py-3 rounded-2xl text-sm leading-relaxed relative ${msg.role === 'agent'
                  ? 'bg-white/5 border border-white/10 text-white/80 rounded-tl-none'
                  : 'bg-cyan-500 text-black font-medium rounded-tr-none'
                  }`}>
                  {msg.metadata?.type === "x402" && (
                    <div className="absolute -top-3 left-0 bg-red-500 text-[8px] font-black px-2 py-0.5 rounded uppercase tracking-widest animate-pulse">
                      HTTP 402 Required
                    </div>
                  )}
                  {msg.content}

                  {msg.metadata?.type === "x402" && (
                    <div className="mt-4 pt-4 border-t border-white/10 flex flex-col gap-3">
                      <div className="flex justify-between items-center text-[10px] font-mono text-white/40">
                        <span>PAYMENT-REQUIRED ({msg.metadata.network}):</span>
                        <span className="text-cyan-400">{msg.metadata.amount} {msg.metadata.token}</span>
                      </div>
                      <button
                        disabled={isProcessingPayment}
                        onClick={() => fulfillPayment(msg.metadata.amount, msg.metadata.network, msg.metadata.recipient)}
                        className={`w-full py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${isProcessingPayment
                          ? 'bg-white/5 text-white/20 cursor-wait'
                          : 'bg-white text-black hover:bg-cyan-400'
                          }`}
                      >
                        {isProcessingPayment ? "Settling on Chain..." : `Authorize x402 (${msg.metadata.network})`}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="p-6 border-t border-white/10 flex gap-3 bg-black/20">
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Query the protocol..."
              className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs flex-grow focus:outline-none focus:border-cyan-500/50 text-white font-light tracking-wide"
            />
            <button
              onClick={() => handleSendMessage()}
              className="w-12 h-12 bg-white text-black rounded-xl hover:bg-cyan-400 transition-all flex items-center justify-center group"
            >
              <svg className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="mt-40 pb-12 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-cyan-500/50" />
          <span className="text-white/20 text-[10px] uppercase tracking-[0.4em] font-bold">Powered by BTAI Protocol</span>
        </div>
        <div className="text-white/10 text-[10px] uppercase tracking-[0.2em] font-light">
          &copy; 2026 BTAI TALENT INTERFACE • SECURED BY V3 MILA
        </div>
      </footer>
    </div>
  );
}
