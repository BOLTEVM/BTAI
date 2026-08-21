/**
 * BoltPromoter Discord Adapter
 * Full Discord integration: text channels, voice chat with TTS, slash commands, embeds.
 */

import {
  Client,
  GatewayIntentBits,
  Partials,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  ChannelType,
  ActivityType,
  type TextChannel,
  type VoiceChannel,
  type Message,
  type Interaction,
} from 'discord.js'
import {
  joinVoiceChannel as djsJoinVoice,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  type VoiceConnection,
  type AudioPlayer,
} from '@discordjs/voice'
import { EventEmitter } from 'events'
import { Readable } from 'stream'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IDiscordConfig {
  botToken: string
  guildIds: string[]
  voiceEnabled?: boolean
}

export interface IDiscordEmbedData {
  title: string
  description: string
  url?: string
  color?: number
  fields?: { name: string; value: string; inline?: boolean }[]
  thumbnail?: string
  footer?: string
}

export interface IEngagementResult {
  platform: 'discord'
  action: string
  channelId: string
  messageId?: string
  success: boolean
  timestamp: number
}

// ─── Rate Limiter ────────────────────────────────────────────────────────────

class RateLimiter {
  private timestamps: Map<string, number[]> = new Map()

  canSend(channelId: string, maxPerMinute: number = 5): boolean {
    const now = Date.now()
    const key = channelId
    const times = (this.timestamps.get(key) || []).filter(t => now - t < 60000)
    this.timestamps.set(key, times)
    return times.length < maxPerMinute
  }

  record(channelId: string): void {
    const times = this.timestamps.get(channelId) || []
    times.push(Date.now())
    this.timestamps.set(channelId, times)
  }
}

// ─── Discord Adapter ─────────────────────────────────────────────────────────

export class DiscordAdapter extends EventEmitter {
  private client: Client
  private config: IDiscordConfig
  private rateLimiter = new RateLimiter()
  private voiceConnections = new Map<string, VoiceConnection>()
  private audioPlayers = new Map<string, AudioPlayer>()
  private audioQueues = new Map<string, Buffer[]>()
  private initialized = false
  private metrics = { messagesSent: 0, repliesMade: 0, voiceMinutes: 0, embedsSent: 0 }

  constructor(config: IDiscordConfig) {
    super()
    this.config = config
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
      ],
      partials: [Partials.Channel, Partials.Message],
    })
  }

  /** Connect the bot, register slash commands, and set up event listeners. */
  public async initialize(): Promise<void> {
    if (this.initialized) return

    await this.client.login(this.config.botToken)
    console.log(`[DiscordAdapter] Bot logged in as ${this.client.user?.tag}`)

    // Register slash commands
    await this.registerSlashCommands()

    // Set rich presence
    this.client.user?.setActivity('🎹 Making beats on Bolt DAW', { type: ActivityType.Custom })

    // Handle slash command interactions
    this.client.on('interactionCreate', async (interaction: Interaction) => {
      if (!interaction.isChatInputCommand()) return
      await this.handleSlashCommand(interaction)
    })

    this.initialized = true
    console.log(`[DiscordAdapter] Initialized with ${this.config.guildIds.length} guild(s), voice=${this.config.voiceEnabled}`)
  }

  /** Send a text message to a channel. */
  public async sendMessage(channelId: string, content: string): Promise<IEngagementResult> {
    const result: IEngagementResult = { platform: 'discord', action: 'sendMessage', channelId, success: false, timestamp: Date.now() }

    if (!this.rateLimiter.canSend(channelId)) {
      console.warn(`[DiscordAdapter] Rate limited on channel ${channelId}`)
      return result
    }

    try {
      const channel = await this.client.channels.fetch(channelId)
      if (!channel || !channel.isTextBased()) {
        console.error(`[DiscordAdapter] Channel ${channelId} not found or not text-based`)
        return result
      }

      const msg = await (channel as TextChannel).send(content)
      this.rateLimiter.record(channelId)
      this.metrics.messagesSent++
      result.success = true
      result.messageId = msg.id
      console.log(`[DiscordAdapter] Sent message to ${channelId}: "${content.slice(0, 80)}..."`)
    } catch (err: any) {
      console.error(`[DiscordAdapter] Failed to send message:`, err.message)
    }
    return result
  }

  /** Send a rich embed to a channel. */
  public async sendEmbed(channelId: string, data: IDiscordEmbedData): Promise<IEngagementResult> {
    const result: IEngagementResult = { platform: 'discord', action: 'sendEmbed', channelId, success: false, timestamp: Date.now() }

    if (!this.rateLimiter.canSend(channelId)) {
      console.warn(`[DiscordAdapter] Rate limited on channel ${channelId}`)
      return result
    }

    try {
      const channel = await this.client.channels.fetch(channelId)
      if (!channel || !channel.isTextBased()) return result

      const embed = new EmbedBuilder()
        .setTitle(data.title)
        .setDescription(data.description)
        .setColor(data.color || 0xEA580C) // Bolt orange

      if (data.url) embed.setURL(data.url)
      if (data.thumbnail) embed.setThumbnail(data.thumbnail)
      if (data.footer) embed.setFooter({ text: data.footer })
      if (data.fields) {
        for (const field of data.fields) {
          embed.addFields({ name: field.name, value: field.value, inline: field.inline ?? false })
        }
      }

      const msg = await (channel as TextChannel).send({ embeds: [embed] })
      this.rateLimiter.record(channelId)
      this.metrics.embedsSent++
      result.success = true
      result.messageId = msg.id
      console.log(`[DiscordAdapter] Sent embed to ${channelId}: "${data.title}"`)
    } catch (err: any) {
      console.error(`[DiscordAdapter] Failed to send embed:`, err.message)
    }
    return result
  }

  /**
   * Monitor messages for keywords and trigger a callback when matched.
   * Callback receives the message object and matched keywords.
   */
  public monitorKeywords(keywords: string[], callback: (message: Message, matched: string[]) => void): void {
    this.client.on('messageCreate', (message: Message) => {
      if (message.author.bot) return
      const content = message.content.toLowerCase()
      const matched = keywords.filter(kw => content.includes(kw.toLowerCase()))
      if (matched.length > 0) {
        callback(message, matched)
      }
    })
    console.log(`[DiscordAdapter] Monitoring for keywords: ${keywords.join(', ')}`)
  }

  /** Reply to a specific message. */
  public async replyToMessage(message: Message, content: string): Promise<IEngagementResult> {
    const result: IEngagementResult = { platform: 'discord', action: 'reply', channelId: message.channelId, success: false, timestamp: Date.now() }

    if (!this.rateLimiter.canSend(message.channelId)) return result

    try {
      const reply = await message.reply(content)
      this.rateLimiter.record(message.channelId)
      this.metrics.repliesMade++
      result.success = true
      result.messageId = reply.id
      console.log(`[DiscordAdapter] Replied to ${message.author.tag}: "${content.slice(0, 80)}..."`)
    } catch (err: any) {
      console.error(`[DiscordAdapter] Failed to reply:`, err.message)
    }
    return result
  }

  // ─── Voice Channel Features ────────────────────────────────────────────────

  /** Join a voice channel. */
  public async joinVoiceChannel(guildId: string, channelId: string): Promise<boolean> {
    if (!this.config.voiceEnabled) {
      console.warn(`[DiscordAdapter] Voice is disabled in config`)
      return false
    }

    try {
      const guild = await this.client.guilds.fetch(guildId)
      const channel = await guild.channels.fetch(channelId) as VoiceChannel
      if (!channel || channel.type !== ChannelType.GuildVoice) {
        console.error(`[DiscordAdapter] Channel ${channelId} is not a voice channel`)
        return false
      }

      const connection = djsJoinVoice({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator as any,
      })

      await entersState(connection, VoiceConnectionStatus.Ready, 15_000)

      const player = createAudioPlayer()
      connection.subscribe(player)

      this.voiceConnections.set(guildId, connection)
      this.audioPlayers.set(guildId, player)
      this.audioQueues.set(guildId, [])

      console.log(`[DiscordAdapter] Joined voice channel ${channel.name} in ${guild.name}`)
      return true
    } catch (err: any) {
      console.error(`[DiscordAdapter] Failed to join voice channel:`, err.message)
      return false
    }
  }

  /** Leave a voice channel. */
  public leaveVoiceChannel(guildId: string): void {
    const connection = this.voiceConnections.get(guildId)
    if (connection) {
      connection.destroy()
      this.voiceConnections.delete(guildId)
      this.audioPlayers.delete(guildId)
      this.audioQueues.delete(guildId)
      console.log(`[DiscordAdapter] Left voice channel in guild ${guildId}`)
    }
  }

  /** Play an audio buffer in the voice channel. Queues if already playing. */
  public async speakInChannel(guildId: string, audioBuffer: Buffer): Promise<boolean> {
    const player = this.audioPlayers.get(guildId)
    if (!player) {
      console.error(`[DiscordAdapter] No audio player for guild ${guildId}. Join a voice channel first.`)
      return false
    }

    // Queue if already playing
    if (player.state.status === AudioPlayerStatus.Playing) {
      const queue = this.audioQueues.get(guildId) || []
      queue.push(audioBuffer)
      this.audioQueues.set(guildId, queue)
      console.log(`[DiscordAdapter] Queued audio for guild ${guildId} (queue size: ${queue.length})`)
      return true
    }

    return this.playAudio(guildId, player, audioBuffer)
  }

  /** Get all active voice connections. */
  public getVoiceConnections(): string[] {
    return Array.from(this.voiceConnections.keys())
  }

  // ─── Slash Commands ────────────────────────────────────────────────────────

  private async registerSlashCommands(): Promise<void> {
    const commands = [
      new SlashCommandBuilder()
        .setName('bolt-daw')
        .setDescription('Learn about Bolt DAW — the professional web-based Digital Audio Workstation'),
      new SlashCommandBuilder()
        .setName('bolt-world')
        .setDescription('Explore BoltEVM World — the Dynamic 3D Hyperfy Metaverse'),
      new SlashCommandBuilder()
        .setName('bolt-features')
        .setDescription('See a breakdown of Bolt DAW features')
        .addStringOption(option =>
          option.setName('category')
            .setDescription('Feature category')
            .addChoices(
              { name: 'Audio Engine', value: 'Core Audio' },
              { name: 'UI & Editing', value: 'UI & Editing' },
              { name: 'AI Composition', value: 'AI Composition' },
              { name: 'Collaboration', value: 'Collaboration' },
              { name: 'Web3', value: 'Web3' },
              { name: 'Privacy', value: 'Privacy' },
            )),
    ]

    try {
      const rest = new REST({ version: '10' }).setToken(this.config.botToken)
      for (const guildId of this.config.guildIds) {
        await rest.put(
          Routes.applicationGuildCommands(this.client.user!.id, guildId),
          { body: commands.map(c => c.toJSON()) }
        )
      }
      console.log(`[DiscordAdapter] Slash commands registered for ${this.config.guildIds.length} guild(s)`)
    } catch (err: any) {
      console.error(`[DiscordAdapter] Failed to register slash commands:`, err.message)
    }
  }

  private async handleSlashCommand(interaction: any): Promise<void> {
    try {
      switch (interaction.commandName) {
        case 'bolt-daw': {
          const embed = new EmbedBuilder()
            .setTitle('🎹 Bolt DAW')
            .setDescription('Professional Digital Audio Workstation — runs in your browser.\nComposition, Arrangement, Mixing & Mastering with Web3 integration.')
            .setURL('https://daw.boltevm.com')
            .setColor(0xEA580C)
            .addFields(
              { name: '🔊 Audio Engine', value: 'Tone.js 15 · Sub-10ms latency · Unlimited tracks', inline: true },
              { name: '🤝 Real-Time Collab', value: 'Yjs CRDT · WebRTC · Share a link and produce together', inline: true },
              { name: '🔗 Web3 Native', value: 'NFT minting · Arweave storage · Multi-chain', inline: true },
              { name: '🤖 AI Composition', value: 'ACE-Step 1.5 · Generate melodies and beats', inline: true },
              { name: '🔒 ZK Privacy', value: 'Semaphore Protocol · Anonymous collab proofs', inline: true },
              { name: '💻 Cross-Platform', value: 'Browser · Desktop · PWA · Offline mode', inline: true },
            )
            .setFooter({ text: 'Built for the future of music. | BOLTEVM Labs' })
          await interaction.reply({ embeds: [embed] })
          break
        }
        case 'bolt-world': {
          const embed = new EmbedBuilder()
            .setTitle('🌐 BoltEVM World')
            .setDescription('Dynamic 3D metaverse built on Hyperfy.\nExplore, create, and connect in persistent virtual worlds.')
            .setURL('https://boltevm.com')
            .setColor(0x00FFCC)
            .addFields(
              { name: '🎮 Multiplayer', value: 'Persistent worlds · Real-time building · JavaScript apps', inline: true },
              { name: '🎧 Spatial Audio', value: 'LiveKit voice chat · Positional audio', inline: true },
              { name: '🥽 VR Ready', value: 'WebXR support · Desktop & mobile', inline: true },
              { name: '🔗 Web3', value: 'Wallet connect · ENS · On-chain assets', inline: true },
              { name: '🤖 AI Agents', value: 'OpenAI · Claude · Grok · In-world NPCs', inline: true },
              { name: '🏠 Self-Hosted', value: 'Run your own world on your own domain', inline: true },
            )
            .setFooter({ text: 'Sovereign Media Meets Local Compute. | BOLTEVM Labs' })
          await interaction.reply({ embeds: [embed] })
          break
        }
        case 'bolt-features': {
          const category = interaction.options.getString('category') || 'Core Audio'
          const featureMap: Record<string, string[]> = {
            'Core Audio': ['Tone.js 15 engine · sub-10ms latency', 'PolySynth, Sampler, full drum kit synthesis', 'Unlimited tracks · channel strips · sidechain compression', 'ASIO/WDM hardware audio routing', 'Master bus + limiter + waveform/FFT analysers'],
            'UI & Editing': ['Performance View (Ableton-style session grid)', 'Piano Roll with advanced quantization', 'Step Sequencer · DJ Turntable Decks', 'GigaOrb visualizer · Tesla Engine synths', '9 built-in effects (EQ8, Distortion, Chorus, etc.)'],
            'AI Composition': ['ACE-Step 1.5 for melody and beat generation', 'GPU acceleration: CUDA, ROCm, MPS, MLX', 'Graceful degradation without AI backend'],
            Collaboration: ['Real-time editing via Yjs CRDT', 'WebRTC peer-to-peer connections', 'Video Portals for face-to-face collab', 'SpacetimeDB for low-latency sync'],
            Web3: ['Lens Protocol social layer', 'Arweave decentralized storage', 'NFT minting via smart contracts', 'Multi-chain: ETH, Polygon, Base, PulseChain, Soneium, Monad'],
            Privacy: ['Semaphore Protocol 4.x ZK proofs', 'AnonCollab anonymous collaboration receipts', 'ZK Audio Gating for stem access', 'Soulbound DAO Credentials'],
          }
          const features = featureMap[category] || featureMap['Core Audio']
          const embed = new EmbedBuilder()
            .setTitle(`⚡ Bolt DAW — ${category}`)
            .setDescription(features.map(f => `• ${f}`).join('\n'))
            .setColor(0xEA580C)
            .setFooter({ text: 'daw.boltevm.com' })
          await interaction.reply({ embeds: [embed] })
          break
        }
      }
    } catch (err: any) {
      console.error(`[DiscordAdapter] Slash command error:`, err.message)
      if (!interaction.replied) {
        await interaction.reply({ content: 'Something went wrong, try again!', ephemeral: true })
      }
    }
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  private playAudio(guildId: string, player: AudioPlayer, audioBuffer: Buffer): boolean {
    try {
      const stream = new Readable()
      stream.push(audioBuffer)
      stream.push(null)

      const resource = createAudioResource(stream)
      player.play(resource)

      // Process queue when done
      player.once(AudioPlayerStatus.Idle, () => {
        const queue = this.audioQueues.get(guildId) || []
        const next = queue.shift()
        if (next) {
          this.playAudio(guildId, player, next)
        }
      })

      return true
    } catch (err: any) {
      console.error(`[DiscordAdapter] Failed to play audio:`, err.message)
      return false
    }
  }

  /** Get engagement metrics. */
  public getMetrics() {
    return { ...this.metrics }
  }

  /** Graceful shutdown. */
  public async shutdown(): Promise<void> {
    for (const guildId of this.voiceConnections.keys()) {
      this.leaveVoiceChannel(guildId)
    }
    this.client.destroy()
    this.initialized = false
    console.log(`[DiscordAdapter] Shut down.`)
  }
}
