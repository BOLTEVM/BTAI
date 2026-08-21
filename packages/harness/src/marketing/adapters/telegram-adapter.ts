/**
 * BoltPromoter Telegram Adapter
 * Bot commands, group engagement, channel broadcasts, and keyword monitoring via Telegraf.
 */

import { Telegraf, type Context } from 'telegraf'
import { EventEmitter } from 'events'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ITelegramConfig {
  botToken: string
}

export interface IEngagementResult {
  platform: 'telegram'
  action: string
  chatId?: string
  messageId?: number
  success: boolean
  timestamp: number
}

// ─── Rate Limiter ────────────────────────────────────────────────────────────

class TelegramRateLimiter {
  private chatTimestamps: Map<string, number[]> = new Map()

  /** Telegram allows 30 msgs/sec globally, but limit per-chat to avoid spam perception. */
  canSend(chatId: string, maxPerMinute: number = 8): boolean {
    const now = Date.now()
    const times = (this.chatTimestamps.get(chatId) || []).filter(t => now - t < 60000)
    this.chatTimestamps.set(chatId, times)
    return times.length < maxPerMinute
  }

  record(chatId: string): void {
    const times = this.chatTimestamps.get(chatId) || []
    times.push(Date.now())
    this.chatTimestamps.set(chatId, times)
  }
}

// ─── Telegram Adapter ────────────────────────────────────────────────────────

export class TelegramAdapter extends EventEmitter {
  private bot: Telegraf
  private config: ITelegramConfig
  private rateLimiter = new TelegramRateLimiter()
  private initialized = false
  private metrics = { messagesSent: 0, repliesMade: 0, commandsHandled: 0 }

  constructor(config: ITelegramConfig) {
    super()
    this.config = config
    this.bot = new Telegraf(config.botToken)
  }

  /** Start the bot, register command handlers. */
  public async initialize(): Promise<void> {
    if (this.initialized) return

    this.registerCommands()
    this.bot.launch()
    this.initialized = true

    // Get bot info
    const botInfo = await this.bot.telegram.getMe()
    console.log(`[TelegramAdapter] Bot launched as @${botInfo.username}`)

    // Graceful shutdown on signals
    process.once('SIGINT', () => this.bot.stop('SIGINT'))
    process.once('SIGTERM', () => this.bot.stop('SIGTERM'))
  }

  /** Send a text message to a chat. */
  public async sendMessage(chatId: string, content: string): Promise<IEngagementResult> {
    const result: IEngagementResult = { platform: 'telegram', action: 'sendMessage', chatId, success: false, timestamp: Date.now() }

    if (!this.rateLimiter.canSend(chatId)) {
      console.warn(`[TelegramAdapter] Rate limited for chat ${chatId}`)
      return result
    }

    try {
      const msg = await this.bot.telegram.sendMessage(chatId, content, { parse_mode: 'Markdown' })
      this.rateLimiter.record(chatId)
      this.metrics.messagesSent++
      result.success = true
      result.messageId = msg.message_id
      console.log(`[TelegramAdapter] Sent message to ${chatId}: "${content.slice(0, 60)}..."`)
    } catch (err: any) {
      console.error(`[TelegramAdapter] Failed to send message to ${chatId}:`, err.message)
    }
    return result
  }

  /** Send a photo with caption. */
  public async sendPhoto(chatId: string, photoUrl: string, caption: string): Promise<IEngagementResult> {
    const result: IEngagementResult = { platform: 'telegram', action: 'sendPhoto', chatId, success: false, timestamp: Date.now() }

    if (!this.rateLimiter.canSend(chatId)) return result

    try {
      const msg = await this.bot.telegram.sendPhoto(chatId, photoUrl, {
        caption,
        parse_mode: 'Markdown',
      })
      this.rateLimiter.record(chatId)
      this.metrics.messagesSent++
      result.success = true
      result.messageId = msg.message_id
      console.log(`[TelegramAdapter] Sent photo to ${chatId}`)
    } catch (err: any) {
      console.error(`[TelegramAdapter] Failed to send photo:`, err.message)
    }
    return result
  }

  /** Reply to a specific message in a group. */
  public async replyInGroup(chatId: string, messageId: number, content: string): Promise<IEngagementResult> {
    const result: IEngagementResult = { platform: 'telegram', action: 'reply', chatId, success: false, timestamp: Date.now() }

    if (!this.rateLimiter.canSend(chatId)) return result

    try {
      const msg = await this.bot.telegram.sendMessage(chatId, content, {
        reply_parameters: { message_id: messageId },
        parse_mode: 'Markdown',
      })
      this.rateLimiter.record(chatId)
      this.metrics.repliesMade++
      result.success = true
      result.messageId = msg.message_id
      console.log(`[TelegramAdapter] Replied in group ${chatId}`)
    } catch (err: any) {
      console.error(`[TelegramAdapter] Failed to reply in group:`, err.message)
    }
    return result
  }

  /** Broadcast a message to multiple channels. */
  public async broadcastToChannels(channelIds: string[], content: string): Promise<IEngagementResult[]> {
    const results: IEngagementResult[] = []
    for (const channelId of channelIds) {
      const result = await this.sendMessage(channelId, content)
      results.push(result)
      // Small delay between broadcasts
      await new Promise(r => setTimeout(r, 500 + Math.random() * 1000))
    }
    return results
  }

  /**
   * Monitor group messages for keywords and trigger a callback.
   */
  public monitorGroups(
    keywords: string[],
    callback: (ctx: Context, matchedKeywords: string[]) => void
  ): void {
    this.bot.on('text', (ctx) => {
      // Skip private chats and bot messages
      if (ctx.chat?.type === 'private') return
      const text = (ctx.message as any)?.text?.toLowerCase() || ''
      const matched = keywords.filter(kw => text.includes(kw.toLowerCase()))
      if (matched.length > 0) {
        callback(ctx, matched)
      }
    })
    console.log(`[TelegramAdapter] Monitoring groups for keywords: ${keywords.join(', ')}`)
  }

  /** Get engagement metrics. */
  public getMetrics() {
    return { ...this.metrics }
  }

  /** Graceful shutdown. */
  public async shutdown(): Promise<void> {
    this.bot.stop()
    this.initialized = false
    console.log(`[TelegramAdapter] Shut down.`)
  }

  // ─── Command Registration ─────────────────────────────────────────────────

  private registerCommands(): void {
    this.bot.command('daw', async (ctx) => {
      this.metrics.commandsHandled++
      await ctx.reply(
        `🎹 *Bolt DAW* — Professional Digital Audio Workstation\n\n` +
        `The DAW that lives in your browser. No downloads, no installs — just open a tab and start creating.\n\n` +
        `⚡ *Highlights:*\n` +
        `• Tone.js engine with sub-10ms latency\n` +
        `• Real-time collaboration — share a link and produce together\n` +
        `• AI composition with ACE-Step 1.5\n` +
        `• Web3 native — mint tracks, own your music on-chain\n` +
        `• ZK privacy for unreleased stems\n` +
        `• Piano Roll, Step Sequencer, Mixer, 9+ effects\n\n` +
        `🔗 [Open Bolt DAW](https://daw.boltevm.com)\n\n` +
        `_Built for the future of music._`,
        { parse_mode: 'Markdown' }
      )
    })

    this.bot.command('world', async (ctx) => {
      this.metrics.commandsHandled++
      await ctx.reply(
        `🌐 *BoltEVM World* — Dynamic 3D Metaverse\n\n` +
        `Explore, create, and connect in persistent 3D worlds built on Hyperfy.\n\n` +
        `⚡ *Highlights:*\n` +
        `• Multiplayer 3D environments in your browser\n` +
        `• Spatial audio with LiveKit voice chat\n` +
        `• WebXR/VR support\n` +
        `• Web3 wallet integration\n` +
        `• AI-powered in-world agents\n` +
        `• Self-host your own world\n\n` +
        `🔗 [Enter the World](https://boltevm.com)\n\n` +
        `_Sovereign Media Meets Local Compute._`,
        { parse_mode: 'Markdown' }
      )
    })

    this.bot.command('features', async (ctx) => {
      this.metrics.commandsHandled++
      await ctx.reply(
        `⚡ *Bolt DAW Feature Breakdown*\n\n` +
        `🔊 *Audio Engine*\nTone.js 15 · Sub-10ms latency · ASIO/WDM · Unlimited tracks\n\n` +
        `🎹 *Production*\nPiano Roll · Step Sequencer · Performance View · DJ Decks\n\n` +
        `🎛️ *Effects*\nEQ8 · Distortion · Chorus · Bitcrusher · Gate · Waveshaper · Guitar Amp\n\n` +
        `🤖 *AI*\nACE-Step 1.5 melody & beat generation · GPU accelerated\n\n` +
        `🤝 *Collab*\nYjs CRDT · WebRTC · Video Portals · SpacetimeDB sync\n\n` +
        `🔗 *Web3*\nNFT minting · Arweave storage · Multi-chain · Lens Protocol\n\n` +
        `🔒 *Privacy*\nSemaphore ZK proofs · Anonymous collab · Gated stems\n\n` +
        `🔗 [Try it now](https://daw.boltevm.com)`,
        { parse_mode: 'Markdown' }
      )
    })

    this.bot.command('roadmap', async (ctx) => {
      this.metrics.commandsHandled++
      await ctx.reply(
        `🗺️ *BOLTEVM Roadmap*\n\n` +
        `✅ *2025 — Foundation*\nCore DAW Web Components · Semaphore hooks · SQLite telemetry\n\n` +
        `✅ *2026 Q1-Q2 — Orchestrator*\nBoltOS 10 desktop · Process spawners · Self-updater\n\n` +
        `🚀 *2026 Q3-Q4 — DePIN Flight*\nQRL/Quai miner integration · BTAI mainnet · 5,000-user alpha\n\n` +
        `_Join us on this journey — we're building the future of sovereign media._`,
        { parse_mode: 'Markdown' }
      )
    })

    this.bot.command('community', async (ctx) => {
      this.metrics.commandsHandled++
      await ctx.reply(
        `🤝 *Join the BOLTEVM Community*\n\n` +
        `🎹 DAW: https://daw.boltevm.com\n` +
        `🌐 World: https://boltevm.com\n` +
        `💻 GitHub: https://github.com/BOLTEVM\n` +
        `📧 Collab: collab@boltevm.com\n\n` +
        `_We're creators building for creators. Pull up._`,
        { parse_mode: 'Markdown' }
      )
    })

    this.bot.command('start', async (ctx) => {
      this.metrics.commandsHandled++
      await ctx.reply(
        `👋 What's good! I'm BoltPromoter — your guide to the BOLTEVM ecosystem.\n\n` +
        `Here's what I can help with:\n` +
        `/daw — Learn about Bolt DAW\n` +
        `/world — Explore BoltEVM World\n` +
        `/features — Full feature breakdown\n` +
        `/roadmap — Development roadmap\n` +
        `/community — Links and socials\n\n` +
        `_Or just ask me anything about music production and Web3._`,
        { parse_mode: 'Markdown' }
      )
    })

    console.log(`[TelegramAdapter] Commands registered: /start, /daw, /world, /features, /roadmap, /community`)
  }
}
