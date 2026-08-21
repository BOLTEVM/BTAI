/**
 * BoltPromoter Campaign Scheduler
 * 24/7 automated campaign orchestration with cron scheduling, human-like delays,
 * and coordinated multi-platform posting.
 */

import cron from 'node-cron'
import { ContentEngine, type Platform } from './content-engine'
import { VoiceEngine } from './voice-engine'
import { MarketingAnalytics } from './analytics'
import { DiscordAdapter } from './adapters/discord-adapter'
import { RedditAdapter } from './adapters/reddit-adapter'
import { TwitterAdapter } from './adapters/twitter-adapter'
import { TelegramAdapter } from './adapters/telegram-adapter'
import { KnowledgeBase } from './knowledge-base'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ICampaignConfig {
  contentEngine: ContentEngine
  voiceEngine?: VoiceEngine
  analytics: MarketingAnalytics
  knowledgeBase: KnowledgeBase
  discord?: DiscordAdapter
  reddit?: RedditAdapter
  twitter?: TwitterAdapter
  telegram?: TelegramAdapter
  timezone?: string
}

interface ICampaignJob {
  name: string
  task: cron.ScheduledTask
  description: string
  schedule: string
}

// ─── Reply Keywords ──────────────────────────────────────────────────────────

const REPLY_KEYWORDS = {
  music: ['daw', 'music production', 'beat making', 'producer', 'mixing', 'mastering', 'ableton', 'fl studio', 'logic pro', 'synthesizer', 'midi', 'audio workstation', 'make beats', 'producing music'],
  web3: ['web3 music', 'nft music', 'music nft', 'decentralized music', 'crypto music', 'blockchain music', 'on-chain music'],
  metaverse: ['metaverse', 'virtual world', 'vr world', 'hyperfy', 'spatial audio', '3d world', 'virtual reality'],
  collab: ['real-time collaboration', 'collab daw', 'online daw', 'browser daw', 'web daw', 'collaborate music', 'produce together'],
}

const ALL_KEYWORDS = Object.values(REPLY_KEYWORDS).flat()

// ─── Campaign Topics ─────────────────────────────────────────────────────────

const DAILY_TOPICS = [
  'music production tip using Bolt DAW',
  'why browser-based DAWs are the future',
  'real-time collaboration workflow in Bolt DAW',
  'Web3 music ownership and why it matters',
  'the state of AI in music production',
  'how zero-knowledge proofs protect musicians',
  'building a beat from scratch in a browser',
  'the BoltEVM ecosystem and sovereign media',
  'GigaOrb visualizer and its impact on creative flow',
  'comparing desktop DAWs to browser DAWs honestly',
  'DePIN and the future of creative computing',
  'minting your first track as an NFT',
  'why self-hosted metaverse worlds matter',
  'spatial audio and virtual music collaboration',
]

const FEATURE_SPOTLIGHTS = [
  'Piano Roll with advanced quantization',
  'real-time collaboration via Yjs CRDT',
  'ACE-Step 1.5 AI composition',
  'ZK Audio Gating for stem privacy',
  'GigaOrb particle visualizer',
  'Tesla Engine synthesis modules',
  'Step Sequencer for drum programming',
  'built-in effects chain',
  'Performance View session grid',
  'DJ Turntable Decks',
  'NFT minting from the DAW',
  'Arweave decentralized storage',
  'LiveKit spatial voice chat in BoltEVM World',
  'WebXR VR support',
]

// ─── Campaign Scheduler ──────────────────────────────────────────────────────

export class CampaignScheduler {
  private campaigns = new Map<string, ICampaignJob>()
  private config: ICampaignConfig
  private running = false

  constructor(config: ICampaignConfig) {
    this.config = config
  }

  /** Start a specific campaign by name. */
  public startCampaign(name: string): boolean {
    const existing = this.campaigns.get(name)
    if (existing) {
      existing.task.start()
      console.log(`[CampaignScheduler] Resumed campaign: ${name}`)
      return true
    }

    switch (name) {
      case 'daily-grind':
        return this.setupDailyGrind()
      case 'reply-hunter':
        return this.setupReplyHunter()
      case 'feature-spotlight':
        return this.setupFeatureSpotlight()
      case 'community-pulse':
        return this.setupCommunityPulse()
      default:
        console.error(`[CampaignScheduler] Unknown campaign: ${name}`)
        return false
    }
  }

  /** Stop a specific campaign. */
  public stopCampaign(name: string): boolean {
    const campaign = this.campaigns.get(name)
    if (campaign) {
      campaign.task.stop()
      console.log(`[CampaignScheduler] Stopped campaign: ${name}`)
      return true
    }
    return false
  }

  /** Start all campaigns. */
  public startAll(): void {
    this.setupDailyGrind()
    this.setupReplyHunter()
    this.setupFeatureSpotlight()
    this.setupCommunityPulse()
    this.running = true
    console.log(`[CampaignScheduler] All campaigns started (${this.campaigns.size} active)`)
  }

  /** Stop all campaigns. */
  public stopAll(): void {
    for (const [name, campaign] of this.campaigns) {
      campaign.task.stop()
      console.log(`[CampaignScheduler] Stopped: ${name}`)
    }
    this.running = false
  }

  /** Get list of active campaigns. */
  public getActiveCampaigns(): { name: string; description: string; schedule: string }[] {
    return Array.from(this.campaigns.values()).map(c => ({
      name: c.name,
      description: c.description,
      schedule: c.schedule,
    }))
  }

  /** Get schedule overview. */
  public getSchedule(): Record<string, string> {
    const schedule: Record<string, string> = {}
    for (const [name, campaign] of this.campaigns) {
      schedule[name] = campaign.schedule
    }
    return schedule
  }

  /** Force-trigger a campaign action immediately. */
  public async triggerImmediate(campaignName: string): Promise<void> {
    console.log(`[CampaignScheduler] Force-triggering: ${campaignName}`)
    switch (campaignName) {
      case 'daily-grind':
        await this.executeDailyPost()
        break
      case 'reply-hunter':
        await this.executeReplyHunt()
        break
      case 'feature-spotlight':
        await this.executeFeatureSpotlight()
        break
      default:
        console.warn(`[CampaignScheduler] Cannot force-trigger: ${campaignName}`)
    }
  }

  /** Check if scheduler is running. */
  public isRunning(): boolean {
    return this.running
  }

  // ─── Campaign Setups ──────────────────────────────────────────────────────

  /**
   * "daily-grind" — Optimal daily posting schedule across all platforms.
   * Morning tweet, midday Reddit, afternoon Discord, evening Twitter replies,
   * night Telegram, late Reddit for international audiences.
   */
  private setupDailyGrind(): boolean {
    // Morning tweet — 9:00 UTC (with +/- 15 min jitter)
    const morningTweet = cron.schedule('0 9 * * *', () => this.withJitter(() => this.executeDailyPost('twitter'), 15))
    // Midday Reddit engagement — 12:00 UTC
    const middayReddit = cron.schedule('0 12 * * *', () => this.withJitter(() => this.executeDailyPost('reddit'), 15))
    // Afternoon Discord — 15:00 UTC
    const afternoonDiscord = cron.schedule('0 15 * * *', () => this.withJitter(() => this.executeDailyPost('discord'), 10))
    // Evening Twitter reply scan — 18:00 UTC
    const eveningReplies = cron.schedule('0 18 * * *', () => this.withJitter(() => this.executeReplyHunt('twitter'), 15))
    // Night Telegram — 21:00 UTC
    const nightTelegram = cron.schedule('0 21 * * *', () => this.withJitter(() => this.executeDailyPost('telegram'), 10))
    // Late Reddit — 00:00 UTC (international)
    const lateReddit = cron.schedule('0 0 * * *', () => this.withJitter(() => this.executeReplyHunt('reddit'), 15))

    // Wrap all tasks into one campaign entry
    const compositeTask = morningTweet // Store reference to first task for start/stop
    this.campaigns.set('daily-grind', {
      name: 'daily-grind',
      task: compositeTask,
      description: 'Optimal daily posting: tweet 9UTC, Reddit 12UTC, Discord 15UTC, Twitter replies 18UTC, Telegram 21UTC, late Reddit 0UTC',
      schedule: '9,12,15,18,21,0 UTC',
    })

    // Store sub-tasks for cleanup
    ;(compositeTask as any).__subTasks = [middayReddit, afternoonDiscord, eveningReplies, nightTelegram, lateReddit]

    console.log(`[CampaignScheduler] 📅 daily-grind campaign started`)
    return true
  }

  /**
   * "reply-hunter" — Focused reply growth hacking.
   * Scans Reddit and Twitter every 2 hours for relevant threads/tweets.
   */
  private setupReplyHunter(): boolean {
    const task = cron.schedule('0 */2 * * *', () => this.withJitter(() => this.executeReplyHunt(), 20))

    this.campaigns.set('reply-hunter', {
      name: 'reply-hunter',
      task,
      description: 'Scans Reddit & Twitter every 2 hours for relevant threads to reply to with value',
      schedule: 'Every 2 hours',
    })

    console.log(`[CampaignScheduler] 🎯 reply-hunter campaign started`)
    return true
  }

  /**
   * "feature-spotlight" — Weekly deep-dive on Tuesdays and Thursdays.
   */
  private setupFeatureSpotlight(): boolean {
    const task = cron.schedule('0 14 * * 2,4', () => this.withJitter(() => this.executeFeatureSpotlight(), 30))

    this.campaigns.set('feature-spotlight', {
      name: 'feature-spotlight',
      task,
      description: 'Cross-platform feature deep-dive every Tuesday and Thursday at 14:00 UTC',
      schedule: 'Tue/Thu 14:00 UTC',
    })

    console.log(`[CampaignScheduler] 🔦 feature-spotlight campaign started`)
    return true
  }

  /**
   * "community-pulse" — Continuous keyword monitoring across all platforms.
   * Sets up real-time listeners on Discord, Reddit, Twitter, and Telegram.
   */
  private setupCommunityPulse(): boolean {
    // Set up keyword monitors on each platform
    if (this.config.discord) {
      this.config.discord.monitorKeywords(ALL_KEYWORDS, async (message, matched) => {
        console.log(`[CampaignScheduler] 💬 Discord keyword match: ${matched.join(', ')}`)
        try {
          const reply = await this.config.contentEngine.generateReply(
            'discord',
            '',
            message.content,
            'both'
          )
          // Only reply if the relevance is high enough
          const assessment = await this.config.contentEngine.assessRelevance(message.content, 'discord')
          if (assessment.score > 50) {
            await this.config.discord!.replyToMessage(message, reply.content)
            await this.config.analytics.recordPost('discord', 'reply', reply.content.slice(0, 100))
          }
        } catch (err: any) {
          console.error(`[CampaignScheduler] Discord reply failed:`, err.message)
        }
      })
    }

    if (this.config.reddit) {
      this.config.reddit.monitorSubreddits(
        RedditAdapter.TARGET_SUBREDDITS,
        ALL_KEYWORDS,
        async (post: any, matched: string[], subreddit: string) => {
          console.log(`[CampaignScheduler] 📋 Reddit keyword match in r/${subreddit}: ${matched.join(', ')}`)
          try {
            const assessment = await this.config.contentEngine.assessRelevance(
              `${post.title} ${post.selftext || ''}`,
              'reddit'
            )
            if (assessment.score > 60 && assessment.shouldMentionProduct) {
              const reply = await this.config.contentEngine.generateReply(
                'reddit',
                `Subreddit: r/${subreddit}`,
                `${post.title}\n\n${post.selftext || ''}`,
                'both'
              )
              await this.config.reddit!.replyToThread(post.id, reply.content)
              await this.config.analytics.recordPost('reddit', 'reply', reply.content.slice(0, 100))
            }
          } catch (err: any) {
            console.error(`[CampaignScheduler] Reddit reply failed:`, err.message)
          }
        },
        300000 // 5 minute intervals
      )
    }

    if (this.config.twitter) {
      this.config.twitter.monitorKeywords(
        [...REPLY_KEYWORDS.music.slice(0, 5), ...REPLY_KEYWORDS.collab],
        async (tweet: any, matched: string[]) => {
          console.log(`[CampaignScheduler] 🐦 Twitter keyword match: ${matched.join(', ')}`)
          try {
            const assessment = await this.config.contentEngine.assessRelevance(tweet.text, 'twitter')
            if (assessment.score > 55 && assessment.shouldMentionProduct) {
              const reply = await this.config.contentEngine.generateReply('twitter', '', tweet.text, 'both')
              await this.config.twitter!.replyToTweet(tweet.id, reply.content)
              await this.config.analytics.recordPost('twitter', 'reply', reply.content.slice(0, 100))
            }
          } catch (err: any) {
            console.error(`[CampaignScheduler] Twitter reply failed:`, err.message)
          }
        },
        600000 // 10 minute intervals
      )
    }

    if (this.config.telegram) {
      this.config.telegram.monitorGroups(ALL_KEYWORDS, async (ctx: any, matched: string[]) => {
        console.log(`[CampaignScheduler] 📱 Telegram keyword match: ${matched.join(', ')}`)
        try {
          const msgText = ctx.message?.text || ''
          const assessment = await this.config.contentEngine.assessRelevance(msgText, 'telegram')
          if (assessment.score > 55) {
            const reply = await this.config.contentEngine.generateReply('telegram', '', msgText, 'both')
            await this.config.telegram!.replyInGroup(
              ctx.chat.id.toString(),
              ctx.message.message_id,
              reply.content
            )
            await this.config.analytics.recordPost('telegram', 'reply', reply.content.slice(0, 100))
          }
        } catch (err: any) {
          console.error(`[CampaignScheduler] Telegram reply failed:`, err.message)
        }
      })
    }

    // Store a dummy task for management (community-pulse is event-driven, not cron)
    const task = cron.schedule('0 */6 * * *', () => {
      console.log(`[CampaignScheduler] 💓 community-pulse heartbeat — all monitors active`)
    })

    this.campaigns.set('community-pulse', {
      name: 'community-pulse',
      task,
      description: 'Continuous keyword monitoring across all platforms with real-time replies',
      schedule: 'Always-on (event-driven)',
    })

    console.log(`[CampaignScheduler] 💓 community-pulse campaign started`)
    return true
  }

  // ─── Campaign Executors ───────────────────────────────────────────────────

  private async executeDailyPost(platform?: Platform): Promise<void> {
    const topic = DAILY_TOPICS[Math.floor(Math.random() * DAILY_TOPICS.length)]
    const targetPlatform = platform || this.randomPlatform()

    try {
      console.log(`[CampaignScheduler] Generating daily post for ${targetPlatform}: "${topic}"`)
      const content = await this.config.contentEngine.generatePost(targetPlatform, topic, 'both')

      switch (targetPlatform) {
        case 'twitter':
          if (this.config.twitter) {
            await this.config.twitter.postTweet(content.content)
          }
          break
        case 'reddit':
          if (this.config.reddit) {
            const sub = RedditAdapter.TARGET_SUBREDDITS[Math.floor(Math.random() * RedditAdapter.TARGET_SUBREDDITS.length)]
            // Parse title/body for Reddit
            const lines = content.content.split('\n').filter(l => l.trim())
            const title = lines[0]?.replace(/^TITLE:\s*/i, '') || topic
            const body = lines.slice(1).join('\n').replace(/^BODY:\s*/i, '') || content.content
            await this.config.reddit.postToSubreddit(sub, title, body)
          }
          break
        case 'discord':
          // Discord posting would need a target channel ID — emit event for handler
          this.config.discord && console.log(`[CampaignScheduler] Discord post ready: "${content.content.slice(0, 80)}..."`)
          break
        case 'telegram':
          // Telegram posting would need a target chat ID — emit event for handler
          this.config.telegram && console.log(`[CampaignScheduler] Telegram post ready: "${content.content.slice(0, 80)}..."`)
          break
      }

      await this.config.analytics.recordPost(targetPlatform, 'post', content.content.slice(0, 100))
    } catch (err: any) {
      console.error(`[CampaignScheduler] Daily post failed:`, err.message)
    }
  }

  private async executeReplyHunt(platform?: Platform): Promise<void> {
    console.log(`[CampaignScheduler] 🎯 Starting reply hunt...`)

    // Reddit reply hunt
    if ((!platform || platform === 'reddit') && this.config.reddit) {
      const searchQueries = ['browser DAW', 'web DAW', 'online music production', 'music collaboration tool', 'Web3 music']
      const query = searchQueries[Math.floor(Math.random() * searchQueries.length)]

      try {
        const threads = await this.config.reddit.searchThreads(query)
        let repliesPlaced = 0

        for (const thread of threads.slice(0, 5)) {
          if (repliesPlaced >= 3) break

          const assessment = await this.config.contentEngine.assessRelevance(
            `${thread.title} ${thread.selftext || ''}`,
            'reddit'
          )

          if (assessment.score > 60 && assessment.shouldMentionProduct) {
            const reply = await this.config.contentEngine.generateReply(
              'reddit',
              `r/${thread.subreddit?.display_name || 'unknown'}`,
              `${thread.title}\n\n${thread.selftext || ''}`,
              'both'
            )
            const result = await this.config.reddit.replyToThread(thread.id, reply.content)
            if (result.success) repliesPlaced++
          }
        }

        console.log(`[CampaignScheduler] Reddit reply hunt: ${repliesPlaced} replies placed`)
      } catch (err: any) {
        console.error(`[CampaignScheduler] Reddit reply hunt failed:`, err.message)
      }
    }

    // Twitter reply hunt
    if ((!platform || platform === 'twitter') && this.config.twitter) {
      const searchQueries = ['looking for a DAW', 'best DAW for', 'music production setup', 'browser music', 'collaborate on music']
      const query = searchQueries[Math.floor(Math.random() * searchQueries.length)]

      try {
        const tweets = await this.config.twitter.searchTweets(query, 10)
        let repliesPlaced = 0

        for (const tweet of tweets.slice(0, 8)) {
          if (repliesPlaced >= 5) break

          const assessment = await this.config.contentEngine.assessRelevance(tweet.text, 'twitter')
          if (assessment.score > 55 && assessment.shouldMentionProduct) {
            const reply = await this.config.contentEngine.generateReply('twitter', '', tweet.text, 'both')
            const result = await this.config.twitter.replyToTweet(tweet.id, reply.content)
            if (result.success) repliesPlaced++
          }
        }

        console.log(`[CampaignScheduler] Twitter reply hunt: ${repliesPlaced} replies placed`)
      } catch (err: any) {
        console.error(`[CampaignScheduler] Twitter reply hunt failed:`, err.message)
      }
    }
  }

  private async executeFeatureSpotlight(): Promise<void> {
    const feature = FEATURE_SPOTLIGHTS[Math.floor(Math.random() * FEATURE_SPOTLIGHTS.length)]
    console.log(`[CampaignScheduler] 🔦 Feature spotlight: "${feature}"`)

    try {
      // Cross-platform burst
      const platforms: Platform[] = ['twitter', 'reddit', 'discord', 'telegram']
      for (const platform of platforms) {
        const content = await this.config.contentEngine.generatePost(
          platform,
          `Deep dive into ${feature}`,
          'daw'
        )
        console.log(`[CampaignScheduler] Feature spotlight content for ${platform}: "${content.content.slice(0, 80)}..."`)
        await this.config.analytics.recordPost(platform, 'post', content.content.slice(0, 100))

        // Delay between platforms
        await new Promise(r => setTimeout(r, 5000 + Math.random() * 10000))
      }

      // Voice segment if voice is enabled
      if (this.config.voiceEngine) {
        await this.config.voiceEngine.featureSpotlight(feature)
        console.log(`[CampaignScheduler] Voice spotlight generated for: "${feature}"`)
      }
    } catch (err: any) {
      console.error(`[CampaignScheduler] Feature spotlight failed:`, err.message)
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** Add human-like jitter to scheduled tasks (+/- minutes). */
  private async withJitter(fn: () => Promise<void>, maxJitterMinutes: number): Promise<void> {
    const jitter = (Math.random() * 2 - 1) * maxJitterMinutes * 60 * 1000
    const delay = Math.max(0, jitter)
    if (delay > 0) {
      console.log(`[CampaignScheduler] Jitter delay: ${(delay / 1000 / 60).toFixed(1)} minutes`)
      await new Promise(r => setTimeout(r, delay))
    }
    await fn()
  }

  /** Pick a random available platform. */
  private randomPlatform(): Platform {
    const available: Platform[] = []
    if (this.config.discord) available.push('discord')
    if (this.config.reddit) available.push('reddit')
    if (this.config.twitter) available.push('twitter')
    if (this.config.telegram) available.push('telegram')
    return available[Math.floor(Math.random() * available.length)] || 'twitter'
  }
}
