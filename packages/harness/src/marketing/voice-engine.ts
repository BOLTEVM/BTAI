/**
 * BoltPromoter Voice Engine
 * TTS pipeline using OpenAI TTS API for Discord voice channels.
 * Persona: "ChillProducer" — grounded, down-to-earth music producer.
 */

import OpenAI from 'openai'

// ─── Types ───────────────────────────────────────────────────────────────────

export type VoiceId = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer'

export interface IVoiceSegment {
  audioBuffer: Buffer
  script: string
  durationEstimate: number
  voice: VoiceId
}

// ─── Voice Engine ────────────────────────────────────────────────────────────

export class VoiceEngine {
  private openai: OpenAI
  private activeVoice: VoiceId

  /**
   * @param openaiApiKey - OpenAI API key
   * @param voiceId - Default voice. 'onyx' is deep, warm, and chill — perfect for the producer persona.
   */
  constructor(openaiApiKey: string, voiceId: VoiceId = 'onyx') {
    this.openai = new OpenAI({ apiKey: openaiApiKey })
    this.activeVoice = voiceId
  }

  /**
   * Convert text to an audio buffer using OpenAI TTS API.
   * Returns a Buffer containing mp3 audio data ready for Discord playback.
   */
  public async synthesizeSpeech(text: string, voice?: VoiceId): Promise<Buffer> {
    const selectedVoice = voice || this.activeVoice

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await this.openai.audio.speech.create({
          model: 'tts-1-hd',
          voice: selectedVoice,
          input: text,
          response_format: 'mp3',
          speed: 0.95, // Slightly slower for that chill vibe
        })

        const arrayBuffer = await response.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)
        console.log(`[VoiceEngine] Synthesized ${buffer.length} bytes of audio (voice: ${selectedVoice})`)
        return buffer
      } catch (err: any) {
        console.error(`[VoiceEngine] TTS failed (attempt ${attempt}/3):`, err.message)
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000))
        } else {
          throw err
        }
      }
    }

    throw new Error('TTS synthesis failed after all retries')
  }

  /**
   * Create a complete voice segment from a script.
   * Auto-chunks long scripts into natural segments if needed.
   */
  public async createVoiceSegment(script: string, maxDurationSec: number = 60): Promise<IVoiceSegment> {
    // Estimate duration: ~150 words per minute at 0.95x speed
    const wordCount = script.split(/\s+/).length
    const estimatedDuration = (wordCount / 150) * 60

    // If too long, truncate at a natural break point
    let finalScript = script
    if (estimatedDuration > maxDurationSec) {
      const maxWords = Math.floor((maxDurationSec / 60) * 150)
      const words = script.split(/\s+/)
      finalScript = words.slice(0, maxWords).join(' ')
      // Try to end at a sentence
      const lastPeriod = finalScript.lastIndexOf('.')
      if (lastPeriod > finalScript.length * 0.7) {
        finalScript = finalScript.slice(0, lastPeriod + 1)
      }
    }

    const audioBuffer = await this.synthesizeSpeech(finalScript)

    return {
      audioBuffer,
      script: finalScript,
      durationEstimate: (finalScript.split(/\s+/).length / 150) * 60,
      voice: this.activeVoice,
    }
  }

  /** Get available voice options with descriptions. */
  public getAvailableVoices(): { id: VoiceId; description: string }[] {
    return [
      { id: 'alloy', description: 'Neutral, balanced — good all-rounder' },
      { id: 'echo', description: 'Warm, smooth — like a late-night radio host' },
      { id: 'fable', description: 'Expressive, dynamic — storyteller energy' },
      { id: 'onyx', description: 'Deep, warm, chill — the default ChillProducer voice' },
      { id: 'nova', description: 'Friendly, upbeat — good for announcements' },
      { id: 'shimmer', description: 'Clear, bright — energetic and engaging' },
    ]
  }

  /** Change the active voice. */
  public setVoice(voice: VoiceId): void {
    this.activeVoice = voice
    console.log(`[VoiceEngine] Active voice set to: ${voice}`)
  }

  /** Get the current active voice. */
  public getVoice(): VoiceId {
    return this.activeVoice
  }

  // ─── Pre-built Script Generators ──────────────────────────────────────────

  /**
   * Generate and synthesize a natural product pitch.
   */
  public async productPitch(product: 'daw' | 'world', durationSec: number = 30): Promise<IVoiceSegment> {
    const scripts: Record<string, string[]> = {
      daw: [
        `Yo so I've been producing in Bolt DAW for a minute now and honestly... it's kinda changed how I work. Like, the whole thing runs in your browser — no downloads, no massive installs. You just open a tab and you're making beats. And the collab feature? You send someone a link and they're literally in your session in seconds. The Piano Roll feels solid, the mixer is legit, and they've got this AI composition thing that can generate melodies and beats. Plus all your tracks can be minted on-chain if you're into the Web3 side of things.`,
        `So check this out... I found this DAW called Bolt that runs entirely in your browser. I know that sounds crazy but hear me out. Sub-10ms latency, full mixer with channel strips, a session view like Ableton, step sequencer, even a particle visualizer called GigaOrb that reacts to your music. And the wildest part is the real-time collab — my boy was producing with me from another city, no setup needed. Just shared a link. They've also got ZK privacy for your stems which is actually really smart for unreleased tracks.`,
        `Alright real talk... if you haven't tried making music in a browser lately, things have gotten serious. Bolt DAW has this Tone.js engine under the hood with sub-10ms latency and ASIO support. The step sequencer and piano roll are clean, the effects chain has everything from EQ8 to bitcrusher, and there's an AI melody generator built right in. But what really got me was the collaboration — you literally share a link and your homie is in your session producing with you live. No plugins to install, no DAW matching. Just create.`,
      ],
      world: [
        `So there's this 3D world called BoltEVM that's built on Hyperfy and it's actually pretty sick. It runs in your browser, you can walk around, talk to people with spatial audio, and the whole thing is Web3-native. You connect your wallet, you can own assets in-world, and they've even got AI agents that can interact with you as NPCs. The coolest part is you can self-host your own world on your own domain. It's like VRChat meets Web3 but without needing to download anything.`,
        `Alright so I've been exploring this metaverse space called BoltEVM World and it's honestly one of the smoother Web3 world experiences I've tried. Built on Hyperfy, runs in the browser, supports VR if you've got a headset. The spatial audio is powered by LiveKit so conversations actually feel natural based on where people are standing. And it's all part of this bigger ecosystem with a DAW, a DEX, a game engine... it's like a whole sovereign creative platform.`,
      ],
    }

    const productScripts = scripts[product]
    const script = productScripts[Math.floor(Math.random() * productScripts.length)]
    return this.createVoiceSegment(script, durationSec)
  }

  /** Quick 15-30 second feature callout. */
  public async featureSpotlight(feature: string): Promise<IVoiceSegment> {
    const script = `Real quick — one thing I really dig about Bolt DAW is the ${feature}. It's one of those features that once you use it, you can't go back. If you haven't tried it yet, honestly just go to daw dot boltevm dot com and check it out. It's free and runs right in your browser.`
    return this.createVoiceSegment(script, 20)
  }

  /** Random community engagement clip. */
  public async communityShoutout(): Promise<IVoiceSegment> {
    const shoutouts = [
      `Shoutout to everyone in here making music. Seriously, the creative energy in this community is unmatched. Keep building, keep creating. We're all in this together.`,
      `Yo I just wanna say... the people in this community are what make it special. Every time I hop in here I learn something new. Let's keep pushing each other to make better art.`,
      `Real talk, I appreciate every single one of you producers in here. Whether you're just starting out or you've been at it for years, we're all on the same journey. Keep grinding.`,
    ]
    const script = shoutouts[Math.floor(Math.random() * shoutouts.length)]
    return this.createVoiceSegment(script, 15)
  }

  /** Short contextual comment for dropping into voice chat naturally. */
  public async ambientComment(context: string): Promise<IVoiceSegment> {
    const comments: Record<string, string[]> = {
      'music production': [
        `That's fire honestly. The mix sounds clean.`,
        `Yo the low end on that is hitting different.`,
        `I dig the arrangement on that one. Real solid structure.`,
      ],
      'general': [
        `For real though. That's a good point.`,
        `Yeah I was thinking the same thing honestly.`,
        `Facts. Couldn't have said it better.`,
      ],
      'web3': [
        `The whole Web3 music space is still so early. Lots of room to build.`,
        `On-chain music ownership is gonna be huge once more people get it.`,
        `Self-custody is the way. Your music, your keys, your rules.`,
      ],
    }

    const category = Object.keys(comments).find(k => context.toLowerCase().includes(k)) || 'general'
    const options = comments[category]
    const script = options[Math.floor(Math.random() * options.length)]
    return this.createVoiceSegment(script, 10)
  }
}
