/**
 * BoltPromoter Marketing Analytics
 * Engagement tracking and performance reporting with SQLite storage.
 */

import Database from 'better-sqlite3'
import path from 'path'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IMarketingTelemetry {
  activePlatforms: string[]
  postsToday: number
  repliesToday: number
  engagementRate: number
  voiceMinutesToday: number
  activeCampaigns: string[]
  lastPostTimestamps: Record<string, number>
  topPlatform: string
}

export interface IPostRecord {
  id?: number
  platform: string
  type: string
  contentPreview: string
  likes: number
  comments: number
  shares: number
  createdAt: string
}

export interface IDailyReport {
  date: string
  totalPosts: number
  totalReplies: number
  totalVoiceMinutes: number
  platformBreakdown: Record<string, { posts: number; replies: number; engagement: number }>
}

// ─── Marketing Analytics ─────────────────────────────────────────────────────

export class MarketingAnalytics {
  private db!: Database.Database
  private dbPath: string
  private lastPostTimestamps: Record<string, number> = {}
  private activeCampaigns: string[] = []
  private activePlatforms: string[] = []

  constructor(dbPath: string = 'marketing_analytics.db') {
    this.dbPath = dbPath
  }

  /** Create database and tables if they don't exist. */
  public initialize(): void {
    this.db = new Database(this.dbPath)

    // Enable WAL mode for better concurrent performance
    this.db.pragma('journal_mode = WAL')

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        type TEXT NOT NULL,
        content_preview TEXT,
        likes INTEGER DEFAULT 0,
        comments INTEGER DEFAULT 0,
        shares INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        started_at TEXT DEFAULT (datetime('now')),
        stopped_at TEXT,
        total_posts INTEGER DEFAULT 0,
        total_engagement INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS voice_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        duration_minutes REAL NOT NULL,
        channel_id TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_posts_platform ON posts(platform);
      CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at);
      CREATE INDEX IF NOT EXISTS idx_posts_type ON posts(type);
    `)

    console.log(`[Analytics] Database initialized at ${this.dbPath}`)
  }

  /** Record a post or reply. */
  public async recordPost(platform: string, type: string, contentPreview: string, metadata?: any): Promise<number> {
    const stmt = this.db.prepare(
      'INSERT INTO posts (platform, type, content_preview) VALUES (?, ?, ?)'
    )
    const result = stmt.run(platform, type, contentPreview.slice(0, 200))
    this.lastPostTimestamps[platform] = Date.now()

    if (!this.activePlatforms.includes(platform)) {
      this.activePlatforms.push(platform)
    }

    console.log(`[Analytics] Recorded ${type} on ${platform}: "${contentPreview.slice(0, 50)}..."`)
    return result.lastInsertRowid as number
  }

  /** Update engagement metrics for a post. */
  public updateEngagement(postId: number, metrics: { likes?: number; comments?: number; shares?: number }): void {
    const updates: string[] = []
    const values: any[] = []

    if (metrics.likes !== undefined) { updates.push('likes = ?'); values.push(metrics.likes) }
    if (metrics.comments !== undefined) { updates.push('comments = ?'); values.push(metrics.comments) }
    if (metrics.shares !== undefined) { updates.push('shares = ?'); values.push(metrics.shares) }

    if (updates.length === 0) return

    values.push(postId)
    this.db.prepare(`UPDATE posts SET ${updates.join(', ')} WHERE id = ?`).run(...values)
  }

  /** Record a voice session. */
  public recordVoiceSession(durationMinutes: number, channelId: string): void {
    this.db.prepare(
      'INSERT INTO voice_sessions (duration_minutes, channel_id) VALUES (?, ?)'
    ).run(durationMinutes, channelId)
    console.log(`[Analytics] Recorded ${durationMinutes}min voice session in ${channelId}`)
  }

  /** Get today's quick summary. */
  public getTodayStats(): { posts: number; replies: number; voiceMinutes: number; platforms: Record<string, number> } {
    const today = new Date().toISOString().slice(0, 10)

    const posts = this.db.prepare(
      "SELECT COUNT(*) as count FROM posts WHERE type = 'post' AND date(created_at) = ?"
    ).get(today) as any

    const replies = this.db.prepare(
      "SELECT COUNT(*) as count FROM posts WHERE type = 'reply' AND date(created_at) = ?"
    ).get(today) as any

    const voice = this.db.prepare(
      "SELECT COALESCE(SUM(duration_minutes), 0) as total FROM voice_sessions WHERE date(created_at) = ?"
    ).get(today) as any

    const platforms = this.db.prepare(
      "SELECT platform, COUNT(*) as count FROM posts WHERE date(created_at) = ? GROUP BY platform"
    ).all(today) as any[]

    const platformMap: Record<string, number> = {}
    for (const p of platforms) {
      platformMap[p.platform] = p.count
    }

    return {
      posts: posts?.count || 0,
      replies: replies?.count || 0,
      voiceMinutes: voice?.total || 0,
      platforms: platformMap,
    }
  }

  /** Get daily report for a specific date. */
  public getDailyReport(date?: string): IDailyReport {
    const targetDate = date || new Date().toISOString().slice(0, 10)

    const allPosts = this.db.prepare(
      "SELECT platform, type, COUNT(*) as count, SUM(likes + comments + shares) as engagement FROM posts WHERE date(created_at) = ? GROUP BY platform, type"
    ).all(targetDate) as any[]

    const voiceTotal = this.db.prepare(
      "SELECT COALESCE(SUM(duration_minutes), 0) as total FROM voice_sessions WHERE date(created_at) = ?"
    ).get(targetDate) as any

    const breakdown: Record<string, { posts: number; replies: number; engagement: number }> = {}
    let totalPosts = 0
    let totalReplies = 0

    for (const row of allPosts) {
      if (!breakdown[row.platform]) {
        breakdown[row.platform] = { posts: 0, replies: 0, engagement: 0 }
      }
      if (row.type === 'post') {
        breakdown[row.platform].posts += row.count
        totalPosts += row.count
      } else if (row.type === 'reply') {
        breakdown[row.platform].replies += row.count
        totalReplies += row.count
      }
      breakdown[row.platform].engagement += row.engagement || 0
    }

    return {
      date: targetDate,
      totalPosts,
      totalReplies,
      totalVoiceMinutes: voiceTotal?.total || 0,
      platformBreakdown: breakdown,
    }
  }

  /** Get weekly aggregate metrics. */
  public getWeeklyReport(): IDailyReport[] {
    const reports: IDailyReport[] = []
    for (let i = 6; i >= 0; i--) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      reports.push(this.getDailyReport(date.toISOString().slice(0, 10)))
    }
    return reports
  }

  /** Get per-platform performance stats. */
  public getPlatformStats(platform: string, days: number = 7): { totalPosts: number; totalReplies: number; avgEngagement: number; topContent: string } {
    const since = new Date()
    since.setDate(since.getDate() - days)
    const sinceStr = since.toISOString().slice(0, 10)

    const stats = this.db.prepare(
      "SELECT type, COUNT(*) as count, AVG(likes + comments + shares) as avg_engagement FROM posts WHERE platform = ? AND date(created_at) >= ? GROUP BY type"
    ).all(platform, sinceStr) as any[]

    const topPost = this.db.prepare(
      "SELECT content_preview, (likes + comments + shares) as engagement FROM posts WHERE platform = ? AND date(created_at) >= ? ORDER BY engagement DESC LIMIT 1"
    ).get(platform, sinceStr) as any

    let totalPosts = 0, totalReplies = 0, avgEngagement = 0
    for (const row of stats) {
      if (row.type === 'post') totalPosts = row.count
      else if (row.type === 'reply') totalReplies = row.count
      avgEngagement = row.avg_engagement || 0
    }

    return {
      totalPosts,
      totalReplies,
      avgEngagement,
      topContent: topPost?.content_preview || 'No posts yet',
    }
  }

  /** Get top performing content. */
  public getTopPerformingContent(limit: number = 10): IPostRecord[] {
    return this.db.prepare(
      "SELECT * FROM posts ORDER BY (likes + comments + shares) DESC LIMIT ?"
    ).all(limit) as any[]
  }

  /** Set active campaigns (called by scheduler). */
  public setActiveCampaigns(campaigns: string[]): void {
    this.activeCampaigns = campaigns
  }

  /** Export IMarketingTelemetry for harness integration. */
  public exportTelemetry(): IMarketingTelemetry {
    const today = this.getTodayStats()
    const platforms = Object.keys(today.platforms)

    // Find top platform
    let topPlatform = 'none'
    let maxCount = 0
    for (const [p, count] of Object.entries(today.platforms)) {
      if (count > maxCount) {
        topPlatform = p
        maxCount = count
      }
    }

    const totalActivity = today.posts + today.replies
    const engagementRate = totalActivity > 0 ? (today.replies / Math.max(today.posts, 1)) * 100 : 0

    return {
      activePlatforms: this.activePlatforms,
      postsToday: today.posts,
      repliesToday: today.replies,
      engagementRate: Math.round(engagementRate * 100) / 100,
      voiceMinutesToday: today.voiceMinutes,
      activeCampaigns: this.activeCampaigns,
      lastPostTimestamps: { ...this.lastPostTimestamps },
      topPlatform,
    }
  }

  /** Close the database connection. */
  public close(): void {
    if (this.db) {
      this.db.close()
      console.log(`[Analytics] Database closed.`)
    }
  }
}
