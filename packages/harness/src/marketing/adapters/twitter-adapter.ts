/**
 * BoltPromoter Twitter/X Adapter
 * Tweet posting, reply growth hacking, thread creation, and keyword monitoring via twitter-api-v2.
 */

import { TwitterApi, type TweetV2, type TwitterApiReadWrite } from 'twitter-api-v2'
import { EventEmitter } from 'events'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ITwitterConfig {
  apiKey: string
  apiSecret: string
  accessToken: string
  accessSecret: string
}

export interface IEngagementResult {
  platform: 'twitter'
  action: string
  tweetId?: string
  success: boolean
  timestamp: number
}

// ─── Rate Limiter ────────────────────────────────────────────────────────────

class TwitterRateLimiter {
  private dailyTweets: { date: string; count: number } = { date: '', count: 0 }
  private actionTimestamps: number[] = []

  canTweet(maxPerDay: number = 12): boolean {
    const today = new Date().toISOString().slice(0, 10)
    if (this.dailyTweets.date !== today) {
      this.dailyTweets = { date: today, count: 0 }
    }
    return this.dailyTweets.count < maxPerDay
  }

  /** Rate limit for API calls (300/15min for most endpoints). */
  canAct(): boolean {
    const now = Date.now()
    this.actionTimestamps = this.actionTimestamps.filter(t => now - t < 900000)
    return this.actionTimestamps.length < 280
  }

  recordTweet(): void {
    const today = new Date().toISOString().slice(0, 10)
    if (this.dailyTweets.date !== today) {
      this.dailyTweets = { date: today, count: 1 }
    } else {
      this.dailyTweets.count++
    }
    this.actionTimestamps.push(Date.now())
  }

  recordAction(): void {
    this.actionTimestamps.push(Date.now())
  }
}

// ─── Twitter Adapter ─────────────────────────────────────────────────────────

export class TwitterAdapter extends EventEmitter {
  private client!: TwitterApiReadWrite
  private config: ITwitterConfig
  private rateLimiter = new TwitterRateLimiter()
  private monitorIntervals: NodeJS.Timeout[] = []
  private repliedTweets = new Set<string>()
  private initialized = false
  private metrics = { tweetsSent: 0, repliesMade: 0, likes: 0, retweets: 0, threadsPosted: 0 }

  constructor(config: ITwitterConfig) {
    super()
    this.config = config
  }

  /** Authenticate with Twitter API v2. */
  public async initialize(): Promise<void> {
    if (this.initialized) return

    const twitterClient = new TwitterApi({
      appKey: this.config.apiKey,
      appSecret: this.config.apiSecret,
      accessToken: this.config.accessToken,
      accessSecret: this.config.accessSecret,
    })

    this.client = twitterClient.readWrite
    this.initialized = true

    // Verify credentials
    try {
      const me = await this.client.v2.me()
      console.log(`[TwitterAdapter] Authenticated as @${me.data.username}`)
    } catch (err: any) {
      console.error(`[TwitterAdapter] Auth verification failed:`, err.message)
    }
  }

  /** Post a tweet (max 280 chars). */
  public async postTweet(content: string, replyToId?: string): Promise<IEngagementResult> {
    const result: IEngagementResult = { platform: 'twitter', action: 'tweet', success: false, timestamp: Date.now() }

    if (content.length > 280) {
      console.warn(`[TwitterAdapter] Tweet exceeds 280 chars (${content.length}), truncating.`)
      content = content.slice(0, 277) + '...'
    }

    if (!this.rateLimiter.canTweet() || !this.rateLimiter.canAct()) {
      console.warn(`[TwitterAdapter] Rate limited.`)
      return result
    }

    try {
      await this.humanDelay(2000, 8000)

      const params: any = { text: content }
      if (replyToId) {
        params.reply = { in_reply_to_tweet_id: replyToId }
      }

      const tweet = await this.client.v2.tweet(params)
      this.rateLimiter.recordTweet()
      this.metrics.tweetsSent++
      result.success = true
      result.tweetId = tweet.data.id
      console.log(`[TwitterAdapter] Posted tweet: "${content.slice(0, 60)}..."`)
    } catch (err: any) {
      console.error(`[TwitterAdapter] Failed to post tweet:`, err.message)
    }
    return result
  }

  /** Reply to a tweet — CORE GROWTH HACK. */
  public async replyToTweet(tweetId: string, content: string): Promise<IEngagementResult> {
    if (this.repliedTweets.has(tweetId)) {
      console.warn(`[TwitterAdapter] Already replied to tweet ${tweetId}, skipping.`)
      return { platform: 'twitter', action: 'reply', success: false, timestamp: Date.now() }
    }

    const result = await this.postTweet(content, tweetId)
    if (result.success) {
      this.repliedTweets.add(tweetId)
      this.metrics.repliesMade++
      result.action = 'reply'
    }
    return result
  }

  /** Post a multi-tweet thread. */
  public async postThread(tweets: string[]): Promise<IEngagementResult> {
    const result: IEngagementResult = { platform: 'twitter', action: 'thread', success: false, timestamp: Date.now() }

    if (tweets.length === 0) return result

    try {
      let previousId: string | undefined

      for (let i = 0; i < tweets.length; i++) {
        let content = tweets[i]
        if (content.length > 280) content = content.slice(0, 277) + '...'

        if (!this.rateLimiter.canTweet() || !this.rateLimiter.canAct()) {
          console.warn(`[TwitterAdapter] Rate limited mid-thread at part ${i + 1}/${tweets.length}`)
          break
        }

        await this.humanDelay(3000, 7000)

        const params: any = { text: content }
        if (previousId) {
          params.reply = { in_reply_to_tweet_id: previousId }
        }

        const tweet = await this.client.v2.tweet(params)
        this.rateLimiter.recordTweet()
        previousId = tweet.data.id

        if (i === 0) result.tweetId = tweet.data.id
      }

      this.metrics.threadsPosted++
      result.success = true
      console.log(`[TwitterAdapter] Posted ${tweets.length}-part thread`)
    } catch (err: any) {
      console.error(`[TwitterAdapter] Thread posting failed:`, err.message)
    }
    return result
  }

  /** Search for recent tweets matching a query. */
  public async searchTweets(query: string, maxResults: number = 20): Promise<TweetV2[]> {
    try {
      if (!this.rateLimiter.canAct()) return []

      const result = await this.client.v2.search(query, {
        max_results: Math.min(maxResults, 100),
        'tweet.fields': ['created_at', 'public_metrics', 'author_id', 'conversation_id'],
        sort_order: 'relevancy',
      })

      this.rateLimiter.recordAction()
      return result.data?.data || []
    } catch (err: any) {
      console.error(`[TwitterAdapter] Search failed for "${query}":`, err.message)
      return []
    }
  }

  /** Like a tweet. */
  public async likeTweet(tweetId: string): Promise<boolean> {
    try {
      if (!this.rateLimiter.canAct()) return false
      const me = await this.client.v2.me()
      await this.client.v2.like(me.data.id, tweetId)
      this.rateLimiter.recordAction()
      this.metrics.likes++
      return true
    } catch (err: any) {
      console.error(`[TwitterAdapter] Failed to like tweet ${tweetId}:`, err.message)
      return false
    }
  }

  /** Retweet a tweet. */
  public async retweet(tweetId: string): Promise<boolean> {
    try {
      if (!this.rateLimiter.canAct()) return false
      const me = await this.client.v2.me()
      await this.client.v2.retweet(me.data.id, tweetId)
      this.rateLimiter.recordAction()
      this.metrics.retweets++
      return true
    } catch (err: any) {
      console.error(`[TwitterAdapter] Failed to retweet ${tweetId}:`, err.message)
      return false
    }
  }

  /**
   * Monitor for tweets matching keywords via polling.
   * Checks every intervalMs (default 10 minutes).
   */
  public monitorKeywords(
    keywords: string[],
    callback: (tweet: TweetV2, matchedKeywords: string[]) => void,
    intervalMs: number = 600000
  ): void {
    const query = keywords.map(kw => `"${kw}"`).join(' OR ') + ' -is:retweet lang:en'

    const check = async () => {
      try {
        const tweets = await this.searchTweets(query, 15)
        for (const tweet of tweets) {
          if (this.repliedTweets.has(tweet.id)) continue
          const content = tweet.text.toLowerCase()
          const matched = keywords.filter(kw => content.includes(kw.toLowerCase()))
          if (matched.length > 0) {
            callback(tweet, matched)
          }
        }
      } catch (err: any) {
        console.error(`[TwitterAdapter] Keyword monitor error:`, err.message)
      }
    }

    check()
    const interval = setInterval(check, intervalMs)
    this.monitorIntervals.push(interval)

    console.log(`[TwitterAdapter] Monitoring keywords: ${keywords.join(', ')}`)
  }

  /** Get engagement metrics. */
  public getMetrics() {
    return { ...this.metrics, repliedTweets: this.repliedTweets.size }
  }

  /** Graceful shutdown. */
  public async shutdown(): Promise<void> {
    for (const interval of this.monitorIntervals) {
      clearInterval(interval)
    }
    this.monitorIntervals = []
    this.initialized = false
    console.log(`[TwitterAdapter] Shut down.`)
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  private humanDelay(minMs: number, maxMs: number): Promise<void> {
    const delay = minMs + Math.random() * (maxMs - minMs)
    return new Promise(resolve => setTimeout(resolve, delay))
  }
}
