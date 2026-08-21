/**
 * BoltPromoter Marketing Agent
 * The main agent class that ties all marketing components together.
 * Extends AgentBase to integrate with the BAI Stack harness.
 */

import { AgentBase } from '../sdk'
import { IUnifiedState } from '../telemetry'
import { KnowledgeBase } from './knowledge-base'
import { ContentEngine } from './content-engine'
import { VoiceEngine, type VoiceId } from './voice-engine'
import { MarketingAnalytics, type IMarketingTelemetry } from './analytics'
import { CampaignScheduler } from './campaign-scheduler'
import { DiscordAdapter, type IDiscordConfig } from './adapters/discord-adapter'
import { RedditAdapter, type IRedditConfig } from './adapters/reddit-adapter'
import { TwitterAdapter, type ITwitterConfig } from './adapters/twitter-adapter'
import { TelegramAdapter, type ITelegramConfig } from './adapters/telegram-adapter'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IMarketingAgentConfig {
  harnessUrl?: string
  openaiApiKey: string
  discordConfig?: IDiscordConfig
  redditConfig?: IRedditConfig
  twitterConfig?: ITwitterConfig
  telegramConfig?: ITelegramConfig
  voicePersona?: string
  voiceId?: VoiceId
  postFrequency?: 'conservative' | 'optimal' | 'aggressive'
  dbPath?: string
}

// ─── Marketing Agent ─────────────────────────────────────────────────────────

export class BoltPromoterAgent extends AgentBase {
  private agentConfig: IMarketingAgentConfig
  private knowledgeBase!: KnowledgeBase
  private contentEngine!: ContentEngine
  private voiceEngine!: VoiceEngine
  private analytics!: MarketingAnalytics
  private scheduler!: CampaignScheduler
  private discordAdapter?: DiscordAdapter
  private redditAdapter?: RedditAdapter
  private twitterAdapter?: TwitterAdapter
  private telegramAdapter?: TelegramAdapter
  private lastReactivePost = 0
  private reactivePostCooldown = 10 * 60 * 1000 // 10 minutes between reactive posts

  constructor(config: IMarketingAgentConfig) {
    super(config.harnessUrl || 'ws://localhost:3700')
    this.agentConfig = config
  }

  /**
   * Initialize all marketing components.
   * Only initializes adapters for which config is provided.
   */
  private async initialize(): Promise<void> {
    console.log(`[BoltPromoter] Initializing marketing agent...`)

    // Core components
    this.knowledgeBase = new KnowledgeBase()
    this.contentEngine = new ContentEngine(this.agentConfig.openaiApiKey, this.knowledgeBase)
    this.voiceEngine = new VoiceEngine(
      this.agentConfig.openaiApiKey,
      this.agentConfig.voiceId || 'onyx'
    )
    this.analytics = new MarketingAnalytics(this.agentConfig.dbPath || 'marketing_analytics.db')
    this.analytics.initialize()

    // Platform adapters — only init what's configured
    if (this.agentConfig.discordConfig) {
      this.discordAdapter = new DiscordAdapter(this.agentConfig.discordConfig)
      await this.discordAdapter.initialize()
      console.log(`[BoltPromoter] ✅ Discord adapter active`)
    }

    if (this.agentConfig.redditConfig) {
      this.redditAdapter = new RedditAdapter(this.agentConfig.redditConfig)
      await this.redditAdapter.initialize()
      console.log(`[BoltPromoter] ✅ Reddit adapter active`)
    }

    if (this.agentConfig.twitterConfig) {
      this.twitterAdapter = new TwitterAdapter(this.agentConfig.twitterConfig)
      await this.twitterAdapter.initialize()
      console.log(`[BoltPromoter] ✅ Twitter/X adapter active`)
    }

    if (this.agentConfig.telegramConfig) {
      this.telegramAdapter = new TelegramAdapter(this.agentConfig.telegramConfig)
      await this.telegramAdapter.initialize()
      console.log(`[BoltPromoter] ✅ Telegram adapter active`)
    }

    // Campaign scheduler
    this.scheduler = new CampaignScheduler({
      contentEngine: this.contentEngine,
      voiceEngine: this.voiceEngine,
      analytics: this.analytics,
      knowledgeBase: this.knowledgeBase,
      discord: this.discordAdapter,
      reddit: this.redditAdapter,
      twitter: this.twitterAdapter,
      telegram: this.telegramAdapter,
    })

    console.log(`[BoltPromoter] Marketing agent initialized.`)
  }

  /**
   * Start the marketing agent.
   * Connects to the harness, initializes all components, and starts campaigns.
   */
  public override async start(): Promise<void> {
    await super.start()
    await this.initialize()

    // Start all campaigns
    this.scheduler.startAll()

    const activePlatforms = [
      this.discordAdapter && 'Discord',
      this.redditAdapter && 'Reddit',
      this.twitterAdapter && 'Twitter/X',
      this.telegramAdapter && 'Telegram',
    ].filter(Boolean)

    console.log(`[BoltPromoter] 🚀 Agent LIVE on: ${activePlatforms.join(', ')}`)
    console.log(`[BoltPromoter] 📅 Campaigns: ${this.scheduler.getActiveCampaigns().map(c => c.name).join(', ')}`)
    console.log(`[BoltPromoter] 🎙️ Voice: ${this.agentConfig.voiceId || 'onyx'} (${this.agentConfig.voicePersona || 'ChillProducer'})`)
  }

  /**
   * React to telemetry updates from the harness.
   * Generates reactive marketing content based on system activity.
   */
  async onTelemetryUpdate(state: IUnifiedState): Promise<void> {
    // Throttle reactive posts
    if (Date.now() - this.lastReactivePost < this.reactivePostCooldown) return

    try {
      // React to DAW activity — when someone starts playing
      if (state.daw.playing && state.daw.bpm > 0) {
        await this.reactivePost(
          `Live session vibes 🎹 ${state.daw.bpm} BPM on Bolt DAW right now. The session view is perfect for this kind of workflow. No setup, no installs — just open a tab and create.`,
          'discord'
        )
      }

      // React to high mining activity
      const totalHashrate = state.mining.fractal.hashrate + state.mining.quai.hashrate + state.mining.qrl.hashrate
      if (totalHashrate > 2000) {
        await this.reactivePost(
          `The mining rigs are humming 🔥 ${Math.round(totalHashrate)} H/s across the network. Mine-to-Create in action — every hash is fuel for creative compute.`,
          'twitter'
        )
      }
    } catch (err: any) {
      console.error(`[BoltPromoter] Reactive post error:`, err.message)
    }
  }

  /** React to betting events with Discord announcements. */
  async onBettingEvent(event: any): Promise<void> {
    if (event.type === 'GAME_CRASHED' && this.discordAdapter) {
      try {
        const multiplier = event.multiplier || 0
        if (multiplier > 5) {
          // Only announce big crashes
          console.log(`[BoltPromoter] BustaBolt crashed at ${multiplier}x — announcing on Discord`)
        }
      } catch (err: any) {
        console.error(`[BoltPromoter] Betting event handler error:`, err.message)
      }
    }
  }

  /** Handle marketing tasks from the orchestrator. */
  async onOrchestratorEvent(event: any): Promise<void> {
    if (event.type === 'TASK_ASSIGNED' && event.task?.name?.includes('Marketing')) {
      console.log(`[BoltPromoter] Received orchestrator marketing task: ${event.task.name}`)
      // Process the task via content engine and submit results
    }
  }

  /** Get current agent status. */
  public getStatus(): {
    running: boolean
    activePlatforms: string[]
    activeCampaigns: { name: string; description: string; schedule: string }[]
    analytics: IMarketingTelemetry
  } {
    return {
      running: this.scheduler?.isRunning() || false,
      activePlatforms: [
        this.discordAdapter && 'discord',
        this.redditAdapter && 'reddit',
        this.twitterAdapter && 'twitter',
        this.telegramAdapter && 'telegram',
      ].filter(Boolean) as string[],
      activeCampaigns: this.scheduler?.getActiveCampaigns() || [],
      analytics: this.analytics?.exportTelemetry() || {} as IMarketingTelemetry,
    }
  }

  /** Get today's analytics summary. */
  public getAnalyticsSummary() {
    return this.analytics?.getTodayStats() || null
  }

  /** Graceful shutdown. */
  public async shutdown(): Promise<void> {
    console.log(`[BoltPromoter] Shutting down...`)
    this.scheduler?.stopAll()
    await this.discordAdapter?.shutdown()
    await this.redditAdapter?.shutdown()
    await this.twitterAdapter?.shutdown()
    await this.telegramAdapter?.shutdown()
    this.analytics?.close()
    this.disconnect()
    console.log(`[BoltPromoter] Shutdown complete.`)
  }

  // ─── Static Factory ───────────────────────────────────────────────────────

  /**
   * Create a BoltPromoterAgent from environment variables.
   * Reads all config from process.env.
   */
  public static fromEnv(harnessUrl?: string): BoltPromoterAgent {
    const config: IMarketingAgentConfig = {
      harnessUrl: harnessUrl || process.env.HARNESS_URL || 'ws://localhost:3700',
      openaiApiKey: process.env.OPENAI_API_KEY || '',
      voicePersona: process.env.MARKETING_VOICE_PERSONA || 'ChillProducer',
      voiceId: (process.env.MARKETING_VOICE_ID as VoiceId) || 'onyx',
      postFrequency: (process.env.MARKETING_POST_FREQUENCY as any) || 'optimal',
      dbPath: process.env.MARKETING_DB_PATH || 'marketing_analytics.db',
    }

    // Discord config
    if (process.env.DISCORD_BOT_TOKEN) {
      config.discordConfig = {
        botToken: process.env.DISCORD_BOT_TOKEN,
        guildIds: (process.env.DISCORD_GUILD_IDS || '').split(',').filter(Boolean),
        voiceEnabled: process.env.DISCORD_VOICE_ENABLED !== 'false',
      }
    }

    // Reddit config
    if (process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET) {
      config.redditConfig = {
        clientId: process.env.REDDIT_CLIENT_ID,
        clientSecret: process.env.REDDIT_CLIENT_SECRET,
        refreshToken: process.env.REDDIT_REFRESH_TOKEN || '',
        username: process.env.REDDIT_USERNAME || '',
      }
    }

    // Twitter config
    if (process.env.TWITTER_API_KEY && process.env.TWITTER_API_SECRET) {
      config.twitterConfig = {
        apiKey: process.env.TWITTER_API_KEY,
        apiSecret: process.env.TWITTER_API_SECRET,
        accessToken: process.env.TWITTER_ACCESS_TOKEN || '',
        accessSecret: process.env.TWITTER_ACCESS_SECRET || '',
      }
    }

    // Telegram config
    if (process.env.TELEGRAM_BOT_TOKEN) {
      config.telegramConfig = {
        botToken: process.env.TELEGRAM_BOT_TOKEN,
      }
    }

    if (!config.openaiApiKey) {
      console.warn(`[BoltPromoter] ⚠️  OPENAI_API_KEY not set. Content generation will fail.`)
    }

    return new BoltPromoterAgent(config)
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  /** Post reactive content to a platform with cooldown enforcement. */
  private async reactivePost(content: string, platform: 'discord' | 'twitter'): Promise<void> {
    this.lastReactivePost = Date.now()

    if (platform === 'twitter' && this.twitterAdapter) {
      await this.twitterAdapter.postTweet(content.slice(0, 280))
      await this.analytics.recordPost('twitter', 'post', content.slice(0, 100))
    }

    if (platform === 'discord' && this.discordAdapter) {
      // Discord reactive posts would need a target channel — log for now
      console.log(`[BoltPromoter] Reactive Discord post: "${content.slice(0, 80)}..."`)
      await this.analytics.recordPost('discord', 'post', content.slice(0, 100))
    }
  }
}

// Re-export as MarketingAgent for backward compatibility
export { BoltPromoterAgent as MarketingAgent }
