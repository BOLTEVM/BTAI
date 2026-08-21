/**
 * BoltPromoter Knowledge Base
 * Structured product intelligence for Bolt DAW and BoltEVM World.
 */

// ─── Product Profiles ────────────────────────────────────────────────────────

export interface IProductProfile {
  name: string
  url: string
  tagline: string
  description: string
  features: Record<string, string[]>
  usps: string[]
  targetAudiences: string[]
  competitors: { name: string; weakness: string; boltAdvantage: string }[]
}

export interface IBrandGuidelines {
  voiceTone: string[]
  keyPhrases: string[]
  colors: Record<string, string>
  links: Record<string, string>
  persona: string
}

export interface IPlatformAngles {
  discord: string[]
  reddit: string[]
  twitter: string[]
  telegram: string[]
}

const BOLT_DAW: IProductProfile = {
  name: 'Bolt DAW',
  url: 'https://daw.boltevm.com',
  tagline: 'Built for the future of music.',
  description:
    'Professional, web-based Digital Audio Workstation with real-time collaboration, Web3 ownership, AI-powered composition, and zero-knowledge privacy. Runs in your browser — no downloads.',
  features: {
    'Core Audio': [
      'Tone.js 15 audio engine with sub-10ms latency at 44.1kHz',
      'PolySynth, Sampler, Player, and full drum kit synthesis',
      'Multi-track sequencing with unlimited tracks',
      'Channel strips with filters, AUX sends/returns, sidechain compression',
      'Master bus with limiter and waveform/FFT analysers',
      'Hardware audio routing — native ASIO/WDM driver mapping',
    ],
    'UI & Editing': [
      'Performance View — Ableton Session-style grid with clip slots',
      'Piano Roll with advanced snap-to-grid quantization',
      'Step Sequencer for drum programming',
      'DJ Turntable Decks',
      'Full Mixer with volume faders, solo, mute',
      'GigaOrb — interactive particle-system visualizer/controller',
      'Tesla Engine — specialized synthesis modules',
      'Lyric Pad for writing alongside production',
      'Effects: Distortion, EQ8, EQ3, Gate, Chorus, Bitcrusher, Waveshaper, Stereoshaper, Guitar Amp',
      'Floating windows system for all panels',
    ],
    'AI Composition': [
      'ACE-Step 1.5 integration for AI melody and beat generation',
      'Supports CUDA, ROCm, Intel XPU, MPS, MLX, and CPU inference',
      'Graceful degradation — works without AI backend',
    ],
    Collaboration: [
      'Real-time collaborative editing via Yjs CRDT',
      'WebRTC peer-to-peer connections',
      'Video Portals for face-to-face collaboration',
      'SpacetimeDB for signaling and low-latency state sync',
    ],
    Web3: [
      'Lens Protocol social layer for musicians',
      'Decentralized storage to Arweave via Irys',
      'NFT minting for tracks and stems via smart contracts',
      'DeFi staking via Thirdweb',
      'Built-in Web3 browser',
      'Multi-chain: Ethereum, Polygon, Base, PulseChain, Soneium, Monad',
    ],
    Privacy: [
      'Semaphore Protocol 4.x for zero-knowledge proofs',
      'AnonCollab receipts — anonymous collaboration proofs',
      'ZK Audio Gating — gated stem access for unreleased tracks',
      'Soulbound DAO Credentials',
    ],
    'Cross-Platform': [
      'PWA with service worker for offline support',
      'Electron desktop builds for Windows, macOS, Linux',
      'Framework-agnostic core UI via Lit Web Components',
    ],
  },
  usps: [
    'Full professional DAW running entirely in your browser — zero downloads, zero installs',
    'Real-time collaboration with anyone, anywhere — just share a link',
    'Own your music on-chain — NFT minting, decentralized storage, Web3-native',
    'Zero-knowledge privacy — gate your stems, prove collabs anonymously',
    'AI-powered composition with ACE-Step 1.5 — generate melodies and beats on demand',
    '3D audio-reactive visualizer (GigaOrb) built right into the DAW',
    'Part of a 12-app sovereign creative ecosystem — not just a DAW, a whole platform',
    'Cross-platform — works in browser, desktop app, and offline via PWA',
  ],
  targetAudiences: [
    'Music producers and beatmakers',
    'Electronic music artists (EDM, hip-hop, experimental)',
    'Collaborative remote production teams',
    'Web3-native creators and artists',
    'Privacy-conscious musicians',
    'Record labels looking for modern tools',
    'Indie artists who want to own their work',
  ],
  competitors: [
    { name: 'Ableton Live', weakness: 'Expensive ($749), desktop-only, no collaboration', boltAdvantage: 'Free, browser-based, real-time collab, Web3-native' },
    { name: 'FL Studio', weakness: '$199-$499, Windows-focused, no real-time collab', boltAdvantage: 'Cross-platform browser app, live collab, AI composition' },
    { name: 'Logic Pro', weakness: 'Mac-only ($199), no Web3, no browser version', boltAdvantage: 'Runs everywhere, decentralized ownership, zero-knowledge privacy' },
    { name: 'BandLab', weakness: 'Limited features, ad-supported, no Web3', boltAdvantage: 'Professional-grade with full mixer/effects, Web3 ownership, ZK privacy' },
    { name: 'Soundtrap', weakness: 'Subscription model, owned by Spotify, limited effects', boltAdvantage: 'Self-sovereign, unlimited tracks, AI composition, NFT minting' },
  ],
}

const BOLT_WORLD: IProductProfile = {
  name: 'BoltEVM World',
  url: 'https://boltevm.com',
  tagline: 'Sovereign Media Meets Local Compute.',
  description:
    'Dynamic 3D metaverse world built on Hyperfy — a persistent, multiplayer virtual environment with spatial audio, WebXR/VR support, Web3 wallet integration, and AI agent capabilities. The immersive spatial layer of the BOLTEVM ecosystem.',
  features: {
    'Multiplayer & Social': [
      'Persistent multiplayer 3D virtual environment',
      'LiveKit-powered spatial audio and voice chat',
      'Portable avatars across worlds',
      'Real-time content creation — build directly in-world',
      'Interactive app system with JavaScript scripting',
    ],
    '3D & Immersion': [
      'Three.js rendering engine with PhysX WASM physics',
      'WebXR/VR support for immersive experiences',
      'Particle systems and post-processing effects',
      'Vehicle systems, collectables, platformer mechanics',
      'Portal systems between worlds',
      'Custom 3D assets with Blender integration',
    ],
    Web3: [
      'EVM wallet connection (MetaMask, WalletConnect)',
      'StarkNet/Cartridge wallet integration',
      'ENS name resolution with caching',
      'On-chain game state via DojoEngine',
      'boltevm.eth ENS domain',
    ],
    AI: [
      'OpenAI, Anthropic (Claude), xAI (Grok), and Google AI model support',
      'AI agent integration for in-world NPCs and assistants',
      'WebView system for embedding apps on 3D surfaces',
    ],
    Ecosystem: [
      'Part of the 12-app BOLTEVM Multimedia Mine Suite',
      'Managed by BoltOS 10 desktop launcher',
      'Standalone worlds hosted on your own domain',
      'Open-source Hyperfy v2 foundation',
    ],
  },
  usps: [
    'Build and explore 3D worlds in your browser — no downloads, VR optional',
    'Spatial audio voice chat — talk to people as if you were in the same room',
    'Web3-native — connect your wallet, own assets, trade in-world',
    'AI-powered NPCs and assistants inside the world',
    'Self-hosted — run your own world on your own domain',
    'Part of a 12-app ecosystem including a DAW, DEX, game engine, and more',
    'Mine-to-Create flywheel — mine crypto to earn rendering credits',
    '84% reduction in cloud computing costs vs AWS',
  ],
  targetAudiences: [
    'Metaverse and VR enthusiasts',
    'Web3 developers and builders',
    'Game developers and 3D artists',
    'Musicians looking for immersive showcases',
    'Crypto communities wanting spatial social',
    'Remote teams wanting creative virtual offices',
  ],
  competitors: [
    { name: 'VRChat', weakness: 'Gaming-focused, not Web3-native, desktop app required', boltAdvantage: 'Browser-based, Web3 wallet integration, AI agents, self-hosted' },
    { name: 'Spatial.io', weakness: 'Limited customization, centralized, corporate-focused', boltAdvantage: 'Fully customizable, self-sovereign, open-source foundation, DePIN economics' },
    { name: 'Decentraland', weakness: 'Expensive land, poor performance, clunky UX', boltAdvantage: 'Smooth Three.js rendering, no land costs, integrated with creative tools' },
  ],
}

// ─── Brand Guidelines ────────────────────────────────────────────────────────

const BRAND: IBrandGuidelines = {
  voiceTone: [
    'Chill and grounded — like a producer friend, not a corporate account',
    'Knowledgeable but never condescending',
    'Genuinely enthusiastic about the tech without being hype-y',
    'Down to earth — real talk about real tools',
    'Community-first — we build with creators, not just for them',
    'Confident without being arrogant',
  ],
  keyPhrases: [
    'Built for the future of music',
    'Sovereign Media Meets Local Compute',
    'Mine-to-Create',
    '100% Self-Custody',
    'Own your sound',
    'No downloads. No installs. Just create.',
    'The DAW that lives in your browser',
    'Real-time collab — just share a link',
    'Your music, your chain, your rules',
  ],
  colors: {
    premiumOrange: '#EA580C',
    boltOrange: '#ff6a00',
    cyan: '#00ffcc',
    neonCyan: '#00f2ff',
    darkBg: '#0a0a0b',
    ultraDark: '#07090e',
    gold: '#f0c32d',
  },
  links: {
    daw: 'https://daw.boltevm.com',
    world: 'https://boltevm.com',
    github: 'https://github.com/BOLTEVM',
    contact: 'collab@boltevm.com',
  },
  persona:
    'You are a chill, grounded music producer who genuinely uses Bolt DAW and hangs out in the BoltEVM World. You\'re not a marketer — you\'re a creator who loves these tools and naturally recommends them when they\'re relevant. You speak like a real person in the studio, not a press release.',
}

// ─── Platform Angles ─────────────────────────────────────────────────────────

const PLATFORM_ANGLES: IPlatformAngles = {
  discord: [
    'Community vibes — share what you made, ask for feedback, hype each other up',
    'Drop links to live sessions and invite people to collab in real-time',
    'Voice channel presence — hop in, play beats, chat about production',
    'React to people\'s tracks with genuine feedback + "yo you should try this feature"',
    'Memes, inside jokes, and studio culture references',
    'Announce new features casually like telling your friends about a new plugin',
  ],
  reddit: [
    'Lead with VALUE — answer questions, share production tips, explain techniques',
    'Only mention Bolt DAW when it genuinely solves the person\'s problem',
    'Write detailed posts about production workflows that happen to use Bolt',
    'Engage in browser-DAW comparison threads with honest, balanced takes',
    'Share "I built this" posts showing what you made in Bolt DAW',
    'Participate in Web3/crypto discussions about creator economy and ownership',
    'Be a respected community member first, promoter never',
  ],
  twitter: [
    'Punchy, quotable takes on music production and creator economy',
    'Reply to popular music production tweets with genuine insights',
    'Thread breakdowns of features and workflows',
    'Hop on trending music and Web3 topics with relevant Bolt angles',
    'Retweet and engage with community members who mention Bolt',
    'Drop one-liner gems about the state of music tech',
    'Use relevant hashtags: #MusicProduction #DAW #Web3Music #BeatMaking',
  ],
  telegram: [
    'Crypto/Web3-savvy audience — emphasize decentralization and ownership',
    'Share development updates and roadmap progress',
    'Engage in crypto music and DePIN community groups',
    'Quick updates with links — this audience clicks through',
    'Alpha drops about upcoming features for the community',
    'Bridge conversations between crypto and music production worlds',
  ],
}

// ─── FAQ & Objection Handling ────────────────────────────────────────────────

const FAQ_MAP: Record<string, string> = {
  'is it free':
    'Bolt DAW is built for creators — the core DAW experience runs right in your browser. No subscription traps, no hidden fees. The Web3 features like NFT minting have gas costs on-chain, but the creative tools themselves are yours to use.',
  'why browser based':
    'Because you should be able to open a tab and start making music. No 2GB downloads, no compatibility issues, no "sorry, Mac only." Plus, real-time collaboration is built in — just share a link and you\'re producing together. The Electron desktop app is there too if you want offline mode.',
  'how does web3 help music':
    'Web3 gives you actual ownership. Mint your tracks as NFTs, store stems on Arweave (decentralized, permanent), gate access to unreleased work with ZK proofs. Your music lives on-chain — no platform can take it down or change the terms on you.',
  'is it professional enough':
    'We\'re talking unlimited tracks, full mixer with channel strips, Piano Roll, Step Sequencer, a stack of effects (EQ8, Distortion, Chorus, Bitcrusher, etc.), hardware audio routing with ASIO support, and AI composition. It\'s not a toy — it\'s a production environment.',
  'latency':
    'Sub-10ms buffer at 44.1kHz with native ASIO/WDM driver mapping. The Tone.js engine is optimized for real-time performance. For collaboration, SpacetimeDB handles low-latency state sync.',
  'what about plugins':
    'Built-in effects and synths cover a lot of ground — PolySynth, Sampler, Tesla Engine, plus Distortion, EQ8, Gate, Chorus, Bitcrusher, Waveshaper, and more. The Lit Web Components architecture means the plugin system is extensible.',
  'who made this':
    'BOLTEVM Labs — an independent team building sovereign creative tools. Previously backed by $4.5M seed from Provenance Inc. We\'re creators building for creators.',
  'what is boltevm world':
    'It\'s a 3D metaverse space built on Hyperfy where you can hang out, showcase your music, collaborate in virtual studios, and connect your wallet. Think VRChat meets Web3, but it runs in your browser and you can host your own world.',
  'what chains':
    'Ethereum, Polygon, Base, PulseChain, Soneium, and Monad. The smart contracts handle NFT minting, escrow, and DAO governance across these chains.',
}

// ─── Hooks & Openers ─────────────────────────────────────────────────────────

const HOOKS: Record<string, string[]> = {
  discord: [
    'yo just finished a session in Bolt — the collab feature is actually insane 🔥',
    'anyone else producing in-browser? I can\'t go back to desktop DAWs honestly',
    'dropped a beat using the AI composition tool and I\'m lowkey shook at how good it sounds',
    'the GigaOrb visualizer is mesmerizing while you\'re producing, ngl',
    'just shared a link and my homie was in my session in 3 seconds. no downloads. this is the future.',
    'minted my first track as an NFT straight from the DAW. wild times we live in 🎵',
  ],
  reddit: [
    'I\'ve been testing browser-based DAWs for the past few months, here\'s what I found...',
    'For anyone looking for a collab-friendly DAW that doesn\'t cost $500...',
    'Interesting development in the DAW space — Web3 integration for music ownership',
    'PSA: You can now make professional-quality beats in a browser tab. Here\'s how.',
    'My experience producing an EP entirely in a web-based DAW',
    'The case for decentralized music production tools',
  ],
  twitter: [
    'The future of music production is in your browser. No cap. 🎹',
    'Why are we still downloading 2GB DAW installers in 2026?',
    'Made a beat, shared a link, my collaborator was producing with me in 3 seconds. That\'s the workflow.',
    'Hot take: The next Ableton won\'t be a desktop app.',
    'Your music should live on-chain. Your DAW should too.',
    'Browser DAWs used to be toys. Not anymore. 🔥',
  ],
  telegram: [
    '🎵 New alpha: a full DAW with Web3 integration just dropped',
    'DePIN + Music Production = something interesting is cooking',
    '🔊 Imagine minting your tracks as NFTs directly from your DAW',
    'The intersection of crypto and music production is here',
    'Self-sovereign music production — no subscriptions, no gatekeepers',
    '⚡ Mine-to-Create: use your GPU to mine AND render audio simultaneously',
  ],
}

// ─── Hashtags ────────────────────────────────────────────────────────────────

const HASHTAGS: Record<string, string[]> = {
  daw: ['#MusicProduction', '#DAW', '#BeatMaking', '#ProducerLife', '#Web3Music', '#BoltDAW', '#StudioFlow', '#MusicTech', '#AudioProduction', '#IndieMusic'],
  world: ['#Metaverse', '#Web3', '#VirtualWorlds', '#GameDev', '#3DArt', '#BoltEVM', '#DePIN', '#CryptoCreator', '#SpatialAudio', '#VR'],
  both: ['#BoltEVM', '#CreatorEconomy', '#SovereignMedia', '#DecentralizedCreation', '#FutureOfMusic', '#Web3Creator'],
}

// ─── Knowledge Base Class ────────────────────────────────────────────────────

export class KnowledgeBase {
  private products: Record<string, IProductProfile> = {
    daw: BOLT_DAW,
    world: BOLT_WORLD,
  }

  /** Get the full product profile for a product. */
  public getProductInfo(product: 'daw' | 'world'): IProductProfile {
    return this.products[product]
  }

  /** Get platform-optimized talking points for a given platform and product. */
  public getTalkingPoints(platform: keyof IPlatformAngles): string[] {
    return PLATFORM_ANGLES[platform] || []
  }

  /** Get unique selling points for a product. */
  public getUSPs(product: 'daw' | 'world'): string[] {
    return this.products[product]?.usps || []
  }

  /** Get differentiation points against a named competitor. */
  public getCompetitorResponse(competitor: string): { name: string; weakness: string; boltAdvantage: string } | null {
    const lc = competitor.toLowerCase()
    for (const p of Object.values(this.products)) {
      const match = p.competitors.find(c => c.name.toLowerCase().includes(lc))
      if (match) return match
    }
    return null
  }

  /** Find a FAQ response matching a question keyword. */
  public getFAQ(question: string): string | null {
    const lc = question.toLowerCase()
    for (const [key, answer] of Object.entries(FAQ_MAP)) {
      if (lc.includes(key) || key.split(' ').every(w => lc.includes(w))) {
        return answer
      }
    }
    return null
  }

  /** Get a random attention-grabbing opener for a platform. */
  public getRandomHook(platform: keyof typeof HOOKS): string {
    const hooks = HOOKS[platform] || HOOKS.discord
    return hooks[Math.floor(Math.random() * hooks.length)]
  }

  /** Get relevant hashtags for a product. */
  public getHashtags(product: 'daw' | 'world' | 'both'): string[] {
    return HASHTAGS[product] || HASHTAGS.both
  }

  /** Get the full brand guidelines. */
  public getBrand(): IBrandGuidelines {
    return BRAND
  }

  /** Get a random USP for a product. */
  public getRandomUSP(product: 'daw' | 'world'): string {
    const usps = this.getUSPs(product)
    return usps[Math.floor(Math.random() * usps.length)]
  }

  /** Get a random key phrase from brand guidelines. */
  public getRandomKeyPhrase(): string {
    return BRAND.keyPhrases[Math.floor(Math.random() * BRAND.keyPhrases.length)]
  }

  /** Get features for a product, optionally filtered by category. */
  public getFeatures(product: 'daw' | 'world', category?: string): Record<string, string[]> | string[] {
    const profile = this.products[product]
    if (!profile) return {}
    if (category) {
      return profile.features[category] || []
    }
    return profile.features
  }

  /** Build a context string for LLM prompts containing product knowledge. */
  public buildContextForLLM(product: 'daw' | 'world' | 'both'): string {
    const parts: string[] = []
    const products = product === 'both' ? ['daw', 'world'] as const : [product] as const
    for (const p of products) {
      const info = this.products[p]
      parts.push(`## ${info.name}`)
      parts.push(`URL: ${info.url}`)
      parts.push(`Tagline: ${info.tagline}`)
      parts.push(`Description: ${info.description}`)
      parts.push('')
      parts.push('### Key Features')
      for (const [cat, feats] of Object.entries(info.features)) {
        parts.push(`**${cat}**: ${feats.join('; ')}`)
      }
      parts.push('')
      parts.push('### Unique Selling Points')
      info.usps.forEach(u => parts.push(`- ${u}`))
      parts.push('')
    }
    return parts.join('\n')
  }
}
