import { WebSocketServer, WebSocket } from 'ws';
import { TelemetryAggregator } from './telemetry';
import { JsonRpcHandler } from './rpc';
import { AgentSandbox } from './sandbox';
import { HandoffOrchestrator } from './orchestrator'

const PORT = 3700;

class HarnessDaemon {
  private wss: WebSocketServer;
  private telemetry = new TelemetryAggregator();
  private orchestrator = new HandoffOrchestrator()
  private rpcHandler: JsonRpcHandler;
  private sandbox = new AgentSandbox(`ws://localhost:${PORT}`);
  private clients = new Set<WebSocket>();
  private subsystemSockets = new Map<string, WebSocket>();
  private connectionIdentities = new Map<WebSocket, string>();
  private pendingSubsystemCalls = new Map<string, { resolve: (val: any) => void, reject: (err: any) => void, timeout: NodeJS.Timeout }>();

  constructor() {
    this.wss = new WebSocketServer({ port: PORT });
    this.rpcHandler = new JsonRpcHandler(this.telemetry, this.orchestrator, async (subsystem, payload) => {
      return this.sendToSubsystem(subsystem, payload);
    });
  }

  public start() {
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      console.log(`[Harness] New client connected. Total clients: ${this.clients.size}`);

      // Immediately send current state
      ws.send(JSON.stringify({
        type: 'TELEMETRY_UPDATE',
        state: this.telemetry.getState()
      }));

      ws.on('message', async (data) => {
        try {
          const payload = JSON.parse(data.toString());
          
          // Handle telemetry updates from substrates
          if (payload.type === 'TELEMETRY_SUBMIT') {
            this.handleSubsystemTelemetry(payload.subsystem, payload.data);
            return;
          }

          // Handle subsystem responses
          if (payload.type === 'SUBSYSTEM_RESPONSE') {
            const pending = this.pendingSubsystemCalls.get(payload.correlationId);
            if (pending) {
              clearTimeout(pending.timeout);
              if (payload.error) {
                pending.reject(new Error(payload.error.message || payload.error));
              } else {
                pending.resolve(payload.result);
              }
              this.pendingSubsystemCalls.delete(payload.correlationId);
            }
            return;
          }

          // Handle custom events (betting, mining) to broadcast
          if (payload.type === 'EVENT_SUBMIT') {
            this.broadcast(payload);
            return;
          }

          // Handle JSON-RPC requests
          if (payload.jsonrpc === '2.0') {
            // Register subsystem socket if it identifies itself
            if (payload.method === 'harness.registerSubsystem') {
              const { name } = payload.params;
              this.subsystemSockets.set(name, ws);
              this.connectionIdentities.set(ws, name);
              console.log(`[Harness] Subsystem registered: ${name}`);
              ws.send(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: { registered: true } }));
              return;
            }

            if (payload.method === 'harness.registerIdentity') {
              const { actorId } = payload.params;
              this.connectionIdentities.set(ws, actorId);
              console.log(`[Harness] Identity registered: ${actorId}`);
              ws.send(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: { registered: true, actorId } }));
              return;
            }

            const response = await this.rpcHandler.handleRequest(payload, this.connectionIdentities.get(ws));
            ws.send(JSON.stringify(response));
          }
        } catch (e) {
          console.error('[Harness] Error handling message', e);
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        this.connectionIdentities.delete(ws);
        // Remove from subsystem sockets
        for (const [name, socket] of this.subsystemSockets.entries()) {
          if (socket === ws) {
            this.subsystemSockets.delete(name);
            console.log(`[Harness] Subsystem disconnected: ${name}`);
          }
        }
        console.log(`[Harness] Client disconnected. Total clients: ${this.clients.size}`);
      });
    });

    // Start telemetry broadcast loop
    this.telemetry.addListener((state) => {
      this.broadcast({
        type: 'TELEMETRY_UPDATE',
        state
      });
    });

    console.log(`[Harness] AI Agent Harness Daemon listening on port ${PORT}`);

    // Launch simulations for offline testing
    this.startSimulations();

    // Launch agent scripts in the sandbox
    this.sandbox.launchAgent('profit');
    this.sandbox.launchAgent('dj');
    this.sandbox.launchAgent('marketing');
  }

  private handleSubsystemTelemetry(subsystem: string, data: any) {
    switch (subsystem) {
      case 'fractal':
      case 'quai':
      case 'qrl':
        this.telemetry.updateMining(subsystem, data);
        break;
      case 'media':
        this.telemetry.updateMedia(data);
        break;
      case 'daw':
        this.telemetry.updateDaw(data);
        break;
      case 'bustabolt':
        this.telemetry.updateBustaBolt(data);
        break;
      case 'b3js':
        this.telemetry.updateB3js(data);
        break;
      case 'chainvas':
        this.telemetry.updateChainvas(data);
        break;
      case 'marketing':
        this.telemetry.updateMarketing(data);
        break;
    }
  }

  private async sendToSubsystem(subsystem: string, payload: any): Promise<any> {
    const socket = this.subsystemSockets.get(subsystem);
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.warn(`[Harness] Warning: Subsystem ${subsystem} is offline. Simulating action locally.`);
      return { simulated: true, subsystem, status: 'EXECUTED_FALLBACK', txHash: '0xmockhash' };
    }

    const correlationId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pending = this.pendingSubsystemCalls.get(correlationId);
        if (pending) {
          pending.reject(new Error(`Subsystem call to ${subsystem} timed out after 4000ms`));
          this.pendingSubsystemCalls.delete(correlationId);
        }
      }, 4000);

      this.pendingSubsystemCalls.set(correlationId, { resolve, reject, timeout });

      socket.send(JSON.stringify({
        type: 'SUBSYSTEM_COMMAND',
        correlationId,
        payload
      }));
    });
  }

  private broadcast(payload: any) {
    const dataStr = JSON.stringify(payload);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(dataStr);
      }
    }
  }

  private startSimulations() {
    // 1. Simulate mining hashrates & shares when local substrates are not running
    setInterval(() => {
      const state = this.telemetry.getState();
      if (!this.subsystemSockets.has('fractal')) {
        const active = Math.random() > 0.3;
        this.telemetry.updateMining('fractal', {
          running: active,
          hashrate: active ? 1200 + Math.random() * 200 : 0,
          shares_accepted: state.mining.fractal.shares_accepted + (active && Math.random() > 0.8 ? 1 : 0),
          uptime: state.mining.fractal.uptime + 3,
          difficulty: 50000
        });
      }
      if (!this.subsystemSockets.has('qrl')) {
        const active = Math.random() > 0.5;
        this.telemetry.updateMining('qrl', {
          running: active,
          hashrate: active ? 800 + Math.random() * 100 : 0,
          shares_accepted: state.mining.qrl.shares_accepted + (active && Math.random() > 0.9 ? 1 : 0),
          uptime: state.mining.qrl.uptime + 3,
          difficulty: 12000
        });
      }
    }, 3000);

    // 2. Simulate BustaBolt betting crash loop when Fastify server is offline
    let multiplier = 1.0;
    let status: 'BETTING' | 'ACTIVE' | 'CRASHED' = 'BETTING';
    let betCooldown = 3;

    setInterval(() => {
      if (this.subsystemSockets.has('bustabolt')) return; // use real server if online

      if (status === 'BETTING') {
        betCooldown--;
        if (betCooldown <= 0) {
          status = 'ACTIVE';
          multiplier = 1.0;
          this.broadcast({
            type: 'BETTING_EVENT',
            event: { type: 'GAME_STARTING' }
          });
        }
      } else if (status === 'ACTIVE') {
        multiplier += 0.05 + (multiplier * 0.02);
        if (multiplier > 1.2 && Math.random() > 0.9) {
          status = 'CRASHED';
          betCooldown = 4;
          this.broadcast({
            type: 'BETTING_EVENT',
            event: { type: 'GAME_CRASHED', multiplier: parseFloat(multiplier.toFixed(2)) }
          });
        }
      } else if (status === 'CRASHED') {
        betCooldown--;
        if (betCooldown <= 0) {
          status = 'BETTING';
          multiplier = 1.0;
        }
      }

      this.telemetry.updateBustaBolt({
        multiplier: parseFloat(multiplier.toFixed(2)),
        status,
        poolEth: '45.12',
        poolSats: '1280054'
      });
    }, 1000);

    // 3. Simulate Chainvas collaborative editor session when offline
    setInterval(() => {
      if (this.subsystemSockets.has('chainvas')) return;
      const docTypes: ('PHOTO' | 'VIDEO' | 'INDESIGN')[] = ['PHOTO', 'VIDEO', 'INDESIGN'];
      const currentDoc = docTypes[Math.floor(Math.random() * docTypes.length)];
      this.telemetry.updateChainvas({
        documentType: currentDoc,
        activeUsers: 2 + Math.floor(Math.random() * 4),
        layerCount: 5 + Math.floor(Math.random() * 8),
        isMinting: Math.random() > 0.9
      });
    }, 4000);
  }
}

const daemon = new HarnessDaemon();
daemon.start();
