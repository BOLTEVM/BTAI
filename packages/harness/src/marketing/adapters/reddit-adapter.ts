/**
 * BoltPromoter Reddit Adapter
 * Subreddit monitoring, reply engagement, and post creation via snoowrap.
 */

import Snoowrap from 'snoowrap'
import { EventEmitter } from 'events'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IRedditConfig {
  clientId: string
  clientSecret: string
  refreshToken: string
  username: string
}

export interface IEngagementResult {
  platform: 'reddit'
  action: string
  subreddit?: string
  threadId?: string
  success: boolean
  timestamp: number
}

// ─── Rate Limiter ────────────────────────────────────────────────────────────

class RedditRateLimiter {
  private actionTimestamps: number[] = []
  private subredditCounts: Map<string, { date: string; count: number }> = new Map()

  /** Check if we can perform an action (global: 60/min). */
  canAct(): boolean {
    const now = Date.now()
    this.actionTimestamps = this.actionTimestamps.filter(t => now - t < 60000)
    return this.actionTimestamps.length < 55 // leave headroom
  }

  /** Check per-subreddit daily limit (default 5/day). */
  canPostInSubreddit(subreddit: string, maxPerDay: number = 5): boolean {
    const today = new Date().toISOString().slice(0, 10)
    const entry = this.subredditCounts.get(subreddit)
    if (!entry || entry.date !== today) return true
    return entry.count < maxPerDay
  }

  record(): void {
    this.actionTimestamps.push(Date.now())
  }

  recordSubreddit(subreddit: string): void {
    const today = new Date().toISOString().slice(0, 10)
    const entry = this.subredditCounts.get(subreddit)
    if (!entry || entry.date !== today) {
      this.subredditCounts.set(subreddit, { date: today, count: 1 })
    } else {
      entry.count++
    }
  }
}

// ─── Reddit Adapter ──────────────────────────────────────────────────────────

export class RedditAdapter extends EventEmitter {
  private reddit!: Snoowrap
  private config: IRedditConfig
  private rateLimiter = new RedditRateLimiter()
  private engagedThreads = new Set<string>()
  private monitorIntervals: NodeJS.Timeout[] = []
  private initialized = false
  private metrics = { postsCreated: 0, repliesMade: 0, threadsMonitored: 0 }

  /** Target subreddits for engagement. */
  public static readonly TARGET_SUBREDDITS = [
    'WeAreTheMusicMakers',
    'edmproduction',
    'MusicBattlestations',
    'synthesizers',
    'Web3',
    'cryptocurrency',
    'gamedev',
    'VRchat',
  ]

  constructor(config: IRedditConfig) {
    super()
    this.config = config
  }

  /** Authenticate with the Reddit API. */
  public async initialize(): Promise<void> {
    if (this.initialized) return

    this.reddit = new Snoowrap({
      userAgent: `BoltPromoter:v1.0.0 (by /u/${this.config.username})`,
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      refreshToken: this.config.refreshToken,
    })

    // Configure snoowrap
    this.reddit.config({
      requestDelay: 1100, // >1s between requests
      continueAfterRatelimitError: true,
      retryErrorCodes: [502, 503, 504, 522],
      maxRetryAttempts: 3,
    })

    this.initialized = true
    console.log(`[RedditAdapter] Initialized as /u/${this.config.username}`)
  }

  /**
   * Monitor subreddits for posts matching keywords.
   * Checks every intervalMs (default 5 minutes) for new relevant posts.
   */
  public monitorSubreddits(
    subreddits: string[],
    keywords: string[],
    callback: (post: any, matchedKeywords: string[], subreddit: string) => void,
    intervalMs: number = 300000
  ): void {
    const check = async () => {
      for (const sub of subreddits) {
        try {
          if (!this.rateLimiter.canAct()) {
            console.warn(`[RedditAdapter] Global rate limit reached, pausing.`)
            break
          }

          const posts = await this.reddit.getSubreddit(sub).getNew({ limit: 15 })
          this.rateLimiter.record()

          for (const post of posts) {
            if (this.engagedThreads.has(post.id)) continue

            const content = `${post.title} ${(post as any).selftext || ''}`.toLowerCase()
            const matched = keywords.filter(kw => content.includes(kw.toLowerCase()))

            if (matched.length > 0) {
              callback(post, matched, sub)
            }
          }

          this.metrics.threadsMonitored++
        } catch (err: any) {
          console.error(`[RedditAdapter] Error monitoring r/${sub}:`, err.message)
        }

        // Human-like delay between subreddit checks
        await this.humanDelay(2000, 5000)
      }
    }

    // Initial check
    check()
    // Recurring checks
    const interval = setInterval(check, intervalMs)
    this.monitorIntervals.push(interval)

    console.log(`[RedditAdapter] Monitoring ${subreddits.length} subreddit(s) for: ${keywords.join(', ')}`)
  }

  /** Create a new post in a subreddit. */
  public async postToSubreddit(
    subreddit: string,
    title: string,
    body: string,
    flair?: string
  ): Promise<IEngagementResult> {
    const result: IEngagementResult = { platform: 'reddit', action: 'post', subreddit, success: false, timestamp: Date.now() }

    if (!this.rateLimiter.canAct() || !this.rateLimiter.canPostInSubreddit(subreddit)) {
      console.warn(`[RedditAdapter] Rate limited for r/${subreddit}`)
      return result
    }

    try {
      await this.humanDelay(3000, 10000)

      const submission = await this.reddit.getSubreddit(subreddit).submitSelfpost({
        title,
        text: body,
        ...(flair ? { flairId: flair } : {}),
      })

      this.rateLimiter.record()
      this.rateLimiter.recordSubreddit(subreddit)
      this.metrics.postsCreated++
      result.success = true
      result.threadId = (submission as any).name || (submission as any).id
      console.log(`[RedditAdapter] Posted to r/${subreddit}: "${title.slice(0, 60)}..."`)
    } catch (err: any) {
      console.error(`[RedditAdapter] Failed to post to r/${subreddit}:`, err.message)
    }
    return result
  }

  /** Reply to a thread (submission). Core growth hack — reply with value. */
  public async replyToThread(threadId: string, body: string): Promise<IEngagementResult> {
    const result: IEngagementResult = { platform: 'reddit', action: 'replyToThread', threadId, success: false, timestamp: Date.now() }

    if (this.engagedThreads.has(threadId)) {
      console.warn(`[RedditAdapter] Already engaged in thread ${threadId}, skipping.`)
      return result
    }

    if (!this.rateLimiter.canAct()) {
      console.warn(`[RedditAdapter] Global rate limit reached.`)
      return result
    }

    try {
      await this.humanDelay(5000, 15000)

      const submission = this.reddit.getSubmission(threadId)
      await submission.reply(body)

      this.engagedThreads.add(threadId)
      this.rateLimiter.record()
      this.metrics.repliesMade++
      result.success = true
      console.log(`[RedditAdapter] Replied to thread ${threadId}: "${body.slice(0, 80)}..."`)
    } catch (err: any) {
      console.error(`[RedditAdapter] Failed to reply to thread ${threadId}:`, err.message)
    }
    return result
  }

  /** Reply to a specific comment. */
  public async replyToComment(commentId: string, body: string): Promise<IEngagementResult> {
    const result: IEngagementResult = { platform: 'reddit', action: 'replyToComment', threadId: commentId, success: false, timestamp: Date.now() }

    if (!this.rateLimiter.canAct()) return result

    try {
      await this.humanDelay(5000, 15000)

      const comment = this.reddit.getComment(commentId)
      await comment.reply(body)

      this.rateLimiter.record()
      this.metrics.repliesMade++
      result.success = true
      console.log(`[RedditAdapter] Replied to comment ${commentId}`)
    } catch (err: any) {
      console.error(`[RedditAdapter] Failed to reply to comment ${commentId}:`, err.message)
    }
    return result
  }

  /** Get hot/trending threads from a subreddit. */
  public async getHotThreads(subreddit: string, limit: number = 10): Promise<any[]> {
    try {
      if (!this.rateLimiter.canAct()) return []
      const posts = await this.reddit.getSubreddit(subreddit).getHot({ limit })
      this.rateLimiter.record()
      return posts as any[]
    } catch (err: any) {
      console.error(`[RedditAdapter] Failed to get hot threads from r/${subreddit}:`, err.message)
      return []
    }
  }

  /** Search for relevant threads across Reddit or a specific subreddit. */
  public async searchThreads(query: string, subreddit?: string): Promise<any[]> {
    try {
      if (!this.rateLimiter.canAct()) return []

      const searchOpts: any = { query, sort: 'relevance', time: 'week', limit: 15 }
      let results

      if (subreddit) {
        results = await this.reddit.getSubreddit(subreddit).search(searchOpts)
      } else {
        results = await this.reddit.search(searchOpts)
      }

      this.rateLimiter.record()
      return results as any[]
    } catch (err: any) {
      console.error(`[RedditAdapter] Search failed for "${query}":`, err.message)
      return []
    }
  }

  /** Get engagement metrics. */
  public getMetrics() {
    return { ...this.metrics, engagedThreads: this.engagedThreads.size }
  }

  /** Graceful shutdown. */
  public async shutdown(): Promise<void> {
    for (const interval of this.monitorIntervals) {
      clearInterval(interval)
    }
    this.monitorIntervals = []
    this.initialized = false
    console.log(`[RedditAdapter] Shut down. Engaged in ${this.engagedThreads.size} threads total.`)
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  /** Add a human-like random delay. */
  private humanDelay(minMs: number, maxMs: number): Promise<void> {
    const delay = minMs + Math.random() * (maxMs - minMs)
    return new Promise(resolve => setTimeout(resolve, delay))
  }
}
