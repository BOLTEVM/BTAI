export interface IMiningTelemetry {
  hashrate: number;
  shares_accepted: number;
  shares_rejected: number;
  uptime: number;
  difficulty: number;
  running: boolean;
  temp_c?: number;
}

export interface IMediaTelemetry {
  currentScene: string;
  scenes: string[];
  broadcasting: boolean;
  recording: boolean;
  fps: number;
  audioPeakL: number;
  audioPeakR: number;
}

export interface IDawTelemetry {
  playing: boolean;
  bpm: number;
  position: string;
  masterVolume: number;
}

export interface IBustaBoltTelemetry {
  multiplier: number;
  status: 'BETTING' | 'ACTIVE' | 'CRASHED';
  poolEth: string;
  poolSats: string;
}

export interface IB3jsTelemetry {
  fps: number;
  physicsLoad: number;
  entityCount: number;
}

export interface IChainvasTelemetry {
  documentType: 'PHOTO' | 'VIDEO' | 'INDESIGN';
  activeUsers: number;
  layerCount: number;
  isMinting: boolean;
}

export interface IMarketingTelemetry {
  activePlatforms: string[];
  postsToday: number;
  repliesToday: number;
  engagementRate: number;
  voiceMinutesToday: number;
  activeCampaigns: string[];
  lastPostTimestamps: Record<string, number>;
  topPlatform: string;
}

export interface IUnifiedState {
  mining: {
    fractal: IMiningTelemetry;
    quai: IMiningTelemetry;
    qrl: IMiningTelemetry;
  };
  media: IMediaTelemetry;
  daw: IDawTelemetry;
  bustabolt: IBustaBoltTelemetry;
  b3js: IB3jsTelemetry;
  chainvas: IChainvasTelemetry;
  marketing: IMarketingTelemetry;
  timestamp: number;
}

export class TelemetryAggregator {
  private state: IUnifiedState = {
    mining: {
      fractal: { hashrate: 0, shares_accepted: 0, shares_rejected: 0, uptime: 0, difficulty: 0, running: false },
      quai: { hashrate: 0, shares_accepted: 0, shares_rejected: 0, uptime: 0, difficulty: 0, running: false },
      qrl: { hashrate: 0, shares_accepted: 0, shares_rejected: 0, uptime: 0, difficulty: 0, running: false }
    },
    media: { currentScene: 'Default', scenes: ['Default'], broadcasting: false, recording: false, fps: 0, audioPeakL: -60, audioPeakR: -60 },
    daw: { playing: false, bpm: 120, position: '0:0:0', masterVolume: 0 },
    bustabolt: { multiplier: 1.0, status: 'CRASHED', poolEth: '0', poolSats: '0' },
    b3js: { fps: 60, physicsLoad: 0.1, entityCount: 0 },
    chainvas: { documentType: 'PHOTO', activeUsers: 1, layerCount: 3, isMinting: false },
    marketing: { activePlatforms: [], postsToday: 0, repliesToday: 0, engagementRate: 0, voiceMinutesToday: 0, activeCampaigns: [], lastPostTimestamps: {}, topPlatform: 'none' },
    timestamp: Date.now()
  };

  private listeners: ((state: IUnifiedState) => void)[] = [];

  public getState(): IUnifiedState {
    return { ...this.state };
  }

  public updateMining(substrate: 'fractal' | 'quai' | 'qrl', telemetry: Partial<IMiningTelemetry>) {
    this.state.mining[substrate] = {
      ...this.state.mining[substrate],
      ...telemetry
    };
    this.triggerUpdate();
  }

  public updateMedia(telemetry: Partial<IMediaTelemetry>) {
    this.state.media = {
      ...this.state.media,
      ...telemetry
    };
    this.triggerUpdate();
  }

  public updateDaw(telemetry: Partial<IDawTelemetry>) {
    this.state.daw = {
      ...this.state.daw,
      ...telemetry
    };
    this.triggerUpdate();
  }

  public updateBustaBolt(telemetry: Partial<IBustaBoltTelemetry>) {
    this.state.bustabolt = {
      ...this.state.bustabolt,
      ...telemetry
    };
    this.triggerUpdate();
  }

  public updateB3js(telemetry: Partial<IB3jsTelemetry>) {
    this.state.b3js = {
      ...this.state.b3js,
      ...telemetry
    };
    this.triggerUpdate();
  }

  public updateChainvas(telemetry: Partial<IChainvasTelemetry>) {
    this.state.chainvas = {
      ...this.state.chainvas,
      ...telemetry
    };
    this.triggerUpdate();
  }

  public updateMarketing(telemetry: Partial<IMarketingTelemetry>) {
    this.state.marketing = {
      ...this.state.marketing,
      ...telemetry
    };
    this.triggerUpdate();
  }

  public addListener(fn: (state: IUnifiedState) => void) {
    this.listeners.push(fn);
    fn(this.state);
  }

  private triggerUpdate() {
    this.state.timestamp = Date.now();
    this.listeners.forEach(fn => fn(this.state));
  }
}
