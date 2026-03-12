"use client";
import Image from "next/image";
import { useState, useCallback, useMemo } from "react";
import { usePrivy } from "@privy-io/react-auth";

interface Agent {
  id: string | number;
  name: string;
  role: string;
  rate: string;
  image: string;
  bio: string;
  isCommunity?: boolean;
}

export default function Home() {
  const { login, logout, authenticated, user } = usePrivy();
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<any[]>([
    { role: "agent", content: "Hello! I am BTAI, the orchestrator of the Talent Agent Protocol. How can I facilitate your talent acquisition today?" }
  ]);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);

  const [communityAgents, setCommunityAgents] = useState<Agent[]>([]);
  const [formData, setFormData] = useState({ name: "", role: "", rate: "", bio: "" });

  const staticTalents: Agent[] = [
    {
      id: 1,
      name: "BTAIZERO",
      role: "AI Systems Engineer",
      rate: "$150/hr",
      image: "/0.png",
      bio: "Master of agentic workflows and smart contract integration."
    },
    {
      id: 2,
      name: "Neon Designer",
      role: "Creative Director",
      rate: "$120/hr",
      image: "/BOLTM.jpeg",
      bio: "Specializing in high-end digital aesthetics and immersive UI."
    }
  ];

  const allTalents = useMemo(() => [...staticTalents, ...communityAgents], [communityAgents]);

  const handleSendMessage = useCallback(async (text?: string) => {
    const input = text || chatInput;
    if (!input.trim()) return;

    const userMsg = { role: "user", content: input };
    setMessages(prev => [...prev, userMsg]);
    setChatInput("");

    // Simulated agentic protocol logic
    setTimeout(() => {
      let reply = "I'm analyzing the protocol parameters for your request.";
      let metadata: any = null;
      const lowInput = input.toLowerCase();

      if (lowInput.includes("talent") || lowInput.includes("architect") || lowInput.includes("designer")) {
        reply = "Our protocol identifies top-tier agentic talent. Would you like me to initiate a preliminary consultation with one of our specialized engineers?";
      } else if (lowInput.includes("protocol") || lowInput.includes("how it works")) {
        reply = "The BTAI Talent Protocol uses AI-mediated verification and automated escrow to ensure seamless collaboration between high-end talent and visionary clients.";
      } else if (lowInput.includes("cost") || lowInput.includes("rate") || lowInput.includes("hire") || lowInput.includes("escrow")) {
        reply = "To proceed with this engagement, the protocol requires an initial escrow deposit. Status: 402 Payment Required.";
        metadata = {
          type: "x402",
          amount: "150",
          token: "USDC",
          recipient: "BTAI_VAULT_0x71...f3",
          challenge: "DEPOSIT_ESCROW_V1"
        };
      }

      setMessages(prev => [...prev, { role: "agent", content: reply, metadata }]);
    }, 800);
  }, [chatInput]);

  const consultAgent = (talentName: string) => {
    setIsChatOpen(true);
    const introMsg = `I'm interested in the BTAI Protocol's orchestration for the ${talentName}.`;
    handleSendMessage(introMsg);
  };

  const fulfillPayment = async (amount: string) => {
    setIsProcessingPayment(true);
    // Simulate smart contract interaction
    await new Promise(r => setTimeout(r, 2000));
    setIsProcessingPayment(false);

    setMessages(prev => [...prev, {
      role: "agent",
      content: `✅ Payment of ${amount} USDC verified. The x402 challenge has been cleared. Initializing secure talent channel... Status: 200 OK.`
    }]);
  };

  const handleRegisterAgent = (e: React.FormEvent) => {
    e.preventDefault();
    const newAgent: Agent = {
      id: Date.now(),
      name: formData.name,
      role: formData.role,
      rate: `$${formData.rate}/hr`,
      image: "/0.png", // Default for community
      bio: formData.bio,
      isCommunity: true
    };
    setCommunityAgents(prev => [newAgent, ...prev]);
    setIsRegistering(false);
    setFormData({ name: "", role: "", rate: "", bio: "" });
  };

  return (
    <div className="relative min-h-screen px-6 py-12 md:px-24">
      <div className="hero-gradient" />

      {/* Header */}
      <nav className="flex items-center justify-between mb-20 relative z-10">
        <div className="flex items-center gap-3">
          <Image src="/0.png" alt="BTAI Logo" width={40} height={40} className="rounded-full border border-white/20 shadow-lg shadow-cyan-500/20" />
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
          <span className="text-cyan-400 text-xs font-bold tracking-[0.2em] uppercase">V1.0 Agentic Framework</span>
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
                    src={talent.image || "/0.png"}
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

              <div className="mt-auto flex items-center justify-between pt-6 border-t border-white/5">
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
            </div>
          ))}
        </div>
      </section>

      {/* Registration Modal */}
      {isRegistering && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-6">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setIsRegistering(false)} />
          <div className="glass w-full max-w-lg p-10 relative z-10 border-cyan-500/30 animate-in fade-in zoom-in duration-300">
            <h2 className="text-3xl font-black uppercase tracking-tighter mb-2 gradient-text">Register Your Node</h2>
            <p className="text-white/40 text-sm mb-8 font-light italic">Establish your AI Agent within the BTAI Talent Protocol.</p>

            <form onSubmit={handleRegisterAgent} className="flex flex-col gap-6">
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
                  onClick={() => setIsRegistering(false)}
                  className="flex-grow py-4 text-xs font-black uppercase tracking-widest text-white/40 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-grow bg-cyan-500 text-black py-4 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-white transition-all shadow-xl shadow-cyan-500/20"
                >
                  Activate Node
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Chatbox UI */}
      {!isChatOpen ? (
        <button
          onClick={() => setIsChatOpen(true)}
          className="fixed bottom-10 right-10 w-16 h-16 glass border-cyan-500/30 rounded-full flex items-center justify-center shadow-2xl shadow-cyan-500/10 hover:scale-105 hover:border-cyan-500 transition-all z-50 text-white"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z" /></svg>
          <div className="absolute -top-1 -right-1 w-4 h-4 bg-cyan-500 rounded-full border-2 border-black" />
        </button>
      ) : (
        <div className="chat-container glass z-50 overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.5)] border-white/10 w-[400px] h-[600px] right-10 bottom-10 rounded-2xl">
          <div className="p-6 border-b border-white/10 flex justify-between items-center bg-white/5">
            <div className="flex items-center gap-3">
              <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse ring-4 ring-cyan-400/20" />
              <span className="font-black text-xs uppercase tracking-[0.2em] text-white">Protocol Orchestrator</span>
            </div>
            <button onClick={() => setIsChatOpen(false)} className="text-white/20 hover:text-white transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
            </button>
          </div>
          <div className="flex-grow overflow-y-auto p-6 flex flex-col gap-6 scrollbar-hide">
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
                        <span>PAYMENT-REQUIRED:</span>
                        <span className="text-cyan-400">{msg.metadata.amount} {msg.metadata.token}</span>
                      </div>
                      <button
                        disabled={isProcessingPayment}
                        onClick={() => fulfillPayment(msg.metadata.amount)}
                        className={`w-full py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${isProcessingPayment
                            ? 'bg-white/5 text-white/20 cursor-wait'
                            : 'bg-white text-black hover:bg-cyan-400'
                          }`}
                      >
                        {isProcessingPayment ? "Settling on Chain..." : "Authorize x402 Payment"}
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
