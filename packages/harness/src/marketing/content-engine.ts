/**
 * BoltPromoter Content Engine
 * LLM-powered content generation using OpenAI GPT-4o.
 * Encodes the chill, grounded, down-to-earth producer persona.
 */

import OpenAI from 'openai'
import { KnowledgeBase } from './knowledge-base'

// ─── Types ───────────────────────────────────────────────────────────────────

export type Platform = 'discord' | 'reddit' | 'twitter' | 'telegram'
export type Product = 'daw' | 'world' | 'both'

export interface IGeneratedContent {
  content: string
  platform: Platform
  product: Product
  type: 'post' | 'reply' | 'thread' | 'voice_script' | 'campaign'
  metadata?: Record<string, any>
}

export interface IThreadContent {
  posts: string[]
  platform: Platform
  topic: string
}

// ─── System Prompts ──────────────────────────────────────────────────────────

const BASE_PERSONA = `You are a chill, grounded, down-to-earth music producer and tech enthusiast. You genuinely use Bolt DAW for your own productions and hang out in the BoltEVM World. You're NOT a marketer, NOT a corporate shill, NOT a hype beast. You're a real creator who loves these tools.

Your communication style:
- Talk like you're chatting with a friend in the studio
- Use casual language but stay knowledgeable and articulate
- Be genuinely helpful — if someone asks a question, answer it properly
- Only mention Bolt DAW or BoltEVM World when it's actually relevant to the conversation
- Never force a product mention — if it doesn't fit, just be helpful without promoting
- Use appropriate slang and music production jargon naturally
- Be confident but humble — you know your stuff but you're not showing off
- Occasionally use emojis but don't overdo it
- Never use corporate marketing language, buzzwords, or empty hype
- If you don't know something, say so honestly`

const PLATFORM_PROMPTS: Record<Platform, string> = {
  discord: `${BASE_PERSONA}

Platform: Discord
- Keep messages concise and casual
- Use emojis naturally (🔥 🎹 💯 etc.)
- Reference community culture and inside jokes
- If posting in a server you don't own, be extra chill and respectful
- When sharing embeds, keep them clean and informative
- In voice channels, speak conversationally like you're in a studio session`,

  reddit: `${BASE_PERSONA}

Platform: Reddit
- Lead with GENUINE VALUE — your answer should be helpful even if the reader never clicks any link
- Write in a natural Reddit voice — not too formal, not too casual
- Use proper formatting (headers, bullet points, code blocks if relevant)
- NEVER sound promotional — Redditors will call you out instantly
- When mentioning Bolt DAW, frame it as "I've been using X and here's my honest experience"
- Acknowledge limitations and other options — honesty builds credibility
- Include disclaimers like "disclaimer: I'm part of the community" when directly promoting
- Match the subreddit's culture — r/edmproduction is different from r/cryptocurrency
- If suggesting Bolt, also mention 1-2 alternatives to seem balanced`,

  twitter: `${BASE_PERSONA}

Platform: Twitter/X
- Stay under 280 characters for single tweets
- Be punchy and quotable — make people want to RT
- Use 2-4 relevant hashtags per tweet
- Hot takes and strong opinions get engagement — don't be boring
- Reply to popular tweets with genuine insights, not just "check out our product"
- Thread format for longer breakdowns — hook in the first tweet
- Engage with the music production and Web3 Twitter communities authentically`,

  telegram: `${BASE_PERSONA}

Platform: Telegram
- Be concise and direct — Telegram users scroll fast
- Use crypto/Web3 terminology naturally
- Include links when referencing products
- For group chats, be conversational and responsive
- For channel posts, lead with the most important info
- Use formatting (bold, italic) for emphasis
- Emoji usage is fine but keep it professional`,
}

const REPLY_GROWTH_HACK_PROMPT = `
CRITICAL INSTRUCTION FOR REPLIES:
Your #1 goal is to provide a genuinely helpful, insightful response to the original post or comment. 
Your #2 goal (secondary) is to naturally weave in a mention of Bolt DAW or BoltEVM World ONLY when truly relevant.

The reply growth hack strategy:
1. READ the original post/comment carefully — understand what they're actually asking or saying
2. ANSWER their question or add value to the conversation FIRST
3. If (and ONLY if) Bolt DAW or BoltEVM World is relevant to their situation, mention it naturally
4. Frame it as personal experience: "I've been using X for this" or "worth checking out X for that specific thing"
5. NEVER be the person who just drops a link and bounces
6. If the topic has nothing to do with DAWs, Web3, or metaverse — just be helpful without any product mention

Examples of GOOD replies:
- "For real-time collab I've been using Bolt DAW — just share a link and you're producing together. No setup needed."
- "That's a solid workflow. Have you tried running it through a browser-based DAW? Some of them have gotten seriously good lately."

Examples of BAD replies (NEVER do these):
- "Check out Bolt DAW at daw.boltevm.com! It has amazing features!"
- "You should try BoltEVM World, it's the best metaverse platform!"
- *Any response that feels copy-pasted or template-y*`

// ─── Content Engine Class ────────────────────────────────────────────────────

export class ContentEngine {
  private openai: OpenAI
  private kb: KnowledgeBase

  constructor(openaiApiKey: string, knowledgeBase: KnowledgeBase) {
    this.openai = new OpenAI({ apiKey: openaiApiKey })
    this.kb = knowledgeBase
  }

  /**
   * Generate an original post optimized for a specific platform.
   */
  public async generatePost(
    platform: Platform,
    topic: string,
    product: Product = 'both'
  ): Promise<IGeneratedContent> {
    const context = this.kb.buildContextForLLM(product)
    const hook = this.kb.getRandomHook(platform)
    const hashtags = platform === 'twitter' ? `\nRelevant hashtags to consider: ${this.kb.getHashtags(product).join(' ')}` : ''

    const response = await this.callGPT(
      PLATFORM_PROMPTS[platform],
      `Create an original ${platform} post about: ${topic}

Product knowledge for reference (use naturally, don't dump features):
${context}

Here's a hook style for inspiration (don't copy directly, create something fresh):
"${hook}"
${hashtags}

${platform === 'twitter' ? 'Keep it under 280 characters. Be punchy.' : ''}
${platform === 'reddit' ? 'Write a title and body. Format: TITLE: <title>\\n\\nBODY: <body>' : ''}

Remember: Be genuine, be helpful, be the cool producer friend. Not a marketing bot.`
    )

    return {
      content: response,
      platform,
      product,
      type: 'post',
    }
  }

  /**
   * Generate a contextual reply — the CORE growth hack.
   * Provides a genuinely helpful response that naturally mentions the product when relevant.
   */
  public async generateReply(
    platform: Platform,
    threadContext: string,
    originalPost: string,
    product: Product = 'both'
  ): Promise<IGeneratedContent> {
    const context = this.kb.buildContextForLLM(product)

    const response = await this.callGPT(
      `${PLATFORM_PROMPTS[platform]}\n\n${REPLY_GROWTH_HACK_PROMPT}`,
      `You're replying to this ${platform} post/comment:

---
${originalPost}
---

Thread context (if available):
${threadContext || 'No additional context.'}

Product knowledge (only reference if GENUINELY relevant):
${context}

Write a helpful, natural reply. If the product isn't relevant to what they're discussing, just be helpful without mentioning it.

${platform === 'twitter' ? 'Keep it under 280 characters.' : ''}
${platform === 'reddit' ? 'Use natural Reddit formatting. Be thorough but not preachy.' : ''}`
    )

    return {
      content: response,
      platform,
      product,
      type: 'reply',
    }
  }

  /**
   * Generate a voice script for TTS in Discord voice channels.
   * Casual, conversational tone — like a producer chatting in the studio.
   */
  public async generateVoiceScript(
    topic: string,
    durationSeconds: number = 30
  ): Promise<IGeneratedContent> {
    const wordCount = Math.round(durationSeconds * 2.5) // ~150 words per minute speaking rate
    const context = this.kb.buildContextForLLM('both')

    const response = await this.callGPT(
      `${BASE_PERSONA}

You're speaking out loud in a Discord voice channel. Write a script that sounds NATURAL when spoken — not like reading a document. Use conversational fillers occasionally ("like", "you know", "honestly", "ngl"). The tone is a chill producer dropping knowledge in a voice chat.`,
      `Write a spoken script about: ${topic}

Target length: approximately ${wordCount} words (~${durationSeconds} seconds when spoken)

Product knowledge for reference:
${context}

Rules:
- Write it as SPEECH, not text — it needs to sound natural when spoken aloud
- No markdown formatting, no bullet points, no headers
- Include natural pauses (use "..." for breath pauses)
- Be conversational — like you're actually talking to people in a voice channel
- Don't read off a list of features — weave them into a natural conversation
- Start with a casual opener, don't dive straight into the pitch`
    )

    return {
      content: response,
      platform: 'discord',
      product: 'both',
      type: 'voice_script',
    }
  }

  /**
   * Generate a coordinated multi-platform campaign burst.
   */
  public async generateCampaignBurst(
    theme: string,
    platforms: Platform[]
  ): Promise<IGeneratedContent[]> {
    const results: IGeneratedContent[] = []
    for (const platform of platforms) {
      const content = await this.generatePost(platform, theme, 'both')
      results.push(content)
    }
    return results
  }

  /**
   * Generate a multi-part thread (Twitter thread or Reddit series).
   */
  public async generateThread(
    platform: Platform,
    topic: string,
    partCount: number = 5
  ): Promise<IThreadContent> {
    const context = this.kb.buildContextForLLM('both')

    const response = await this.callGPT(
      PLATFORM_PROMPTS[platform],
      `Create a ${partCount}-part ${platform === 'twitter' ? 'tweet thread' : 'post series'} about: ${topic}

Product knowledge for reference:
${context}

Format each part as:
PART 1: <content>
PART 2: <content>
...

${platform === 'twitter' ? 'Each part must be under 280 characters. Part 1 should hook — make people want to read the thread.' : ''}
${platform === 'reddit' ? 'Each part should be a substantial paragraph. The first part should hook readers in.' : ''}

Thread strategy:
- Part 1: Hook — grab attention with a bold statement or question
- Parts 2-${partCount - 1}: Value — deliver insights, tips, or story
- Part ${partCount}: CTA — natural call to action (check it out, try it, etc.)

Be genuine and engaging throughout.`
    )

    const posts = response
      .split(/PART \d+:\s*/i)
      .filter(p => p.trim())
      .map(p => p.trim())

    return { posts, platform, topic }
  }

  /**
   * Rephrase content to avoid duplicate/similar posts.
   */
  public async varyContent(
    originalContent: string,
    platform: Platform
  ): Promise<string> {
    const response = await this.callGPT(
      PLATFORM_PROMPTS[platform],
      `Rephrase this ${platform} post to say the same thing but in a completely different way. Change the structure, wording, and angle. Keep the same general message but make it feel like a different person wrote it.

Original:
${originalContent}

Write only the rephrased version, nothing else.`
    )
    return response
  }

  /**
   * Check if a thread/post is relevant enough to reply to.
   * Returns a relevance score and whether a product mention would be natural.
   */
  public async assessRelevance(
    postContent: string,
    platform: Platform
  ): Promise<{ score: number; shouldMentionProduct: boolean; suggestedAngle: string }> {
    const response = await this.callGPT(
      'You are an engagement analyst. Respond ONLY in JSON format.',
      `Assess this ${platform} post for relevance to Bolt DAW (web-based music production) or BoltEVM World (3D metaverse). 

Post content:
"${postContent}"

Respond in this exact JSON format:
{"score": <0-100>, "shouldMentionProduct": <true/false>, "suggestedAngle": "<brief angle for reply>"}

Score guide:
- 90-100: Directly asking about web DAWs, browser music production, or 3D metaverse
- 70-89: Discussing DAWs, music production tools, Web3 music, or virtual worlds in general
- 50-69: Tangentially related (music production tips, creator economy, etc.)
- 0-49: Not relevant enough to engage with a product mention

shouldMentionProduct should be true ONLY if score > 60 and the product mention would feel natural.`
    )

    try {
      return JSON.parse(response)
    } catch {
      return { score: 0, shouldMentionProduct: false, suggestedAngle: '' }
    }
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  private async callGPT(systemPrompt: string, userMessage: string, retries = 3): Promise<string> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const completion = await this.openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.85,
          max_tokens: 1500,
        })
        return completion.choices[0]?.message?.content?.trim() || ''
      } catch (err: any) {
        console.error(`[ContentEngine] GPT-4o call failed (attempt ${attempt}/${retries}):`, err.message)
        if (attempt < retries) {
          const backoff = Math.pow(2, attempt) * 1000 + Math.random() * 1000
          await new Promise(r => setTimeout(r, backoff))
        } else {
          throw err
        }
      }
    }
    return ''
  }
}
