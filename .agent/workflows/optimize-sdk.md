# Workflow: Optimizing and Improving the Agent SDK

This workflow outlines optimization procedures for client-side agent execution and communication within the `@bolt/agent-sdk` package.

---

## 1. Structured Telemetry Subscriptions

Reduce telemetry payload parsing overhead by allowing agents to register for specific telemetry slices (e.g., only `mining` or only `bustabolt`) instead of receiving the entire unified state on every update.

### Steps:
1. Locate `packages/agent-sdk/src/index.ts`.
2. Update `HarnessClient` and `AgentBase` to send subscription options during connection:
   ```typescript
   export interface SubscriptionOptions {
     subsystems?: Array<'mining' | 'media' | 'daw' | 'bustabolt' | 'b3js' | 'chainvas'>
   }
   ```
3. Filter incoming telemetry messages on the client before invoking lifecycle events:
   ```typescript
   ws.on('message', (data) => {
     const msg = JSON.parse(data.toString())
     if (msg.type === 'TELEMETRY_UPDATE') {
       // Filter properties based on local subscription filters
       this.onTelemetryUpdate(msg.state)
     }
   })
   ```

---

## 2. Robust RPC Fail-safes

Malformed incoming websocket payloads should not trigger uncaught syntax errors that crash the agent process.

### Steps:
1. Locate `HarnessClient` in `packages/agent-sdk/src/index.ts`.
2. Wrap WebSocket data parsing in structured try-catch loops:
   ```typescript
   ws.on('message', (data) => {
     try {
       const msg = JSON.parse(data.toString())
       if (!msg || typeof msg !== 'object') return
       
       // Handle response correlations
       const pending = this.pendingCalls.get(msg.id)
       if (pending) {
         if (msg.error) {
           pending.reject(new Error(msg.error.message || 'RPC Error'))
         } else {
           pending.resolve(msg.result)
         }
         this.pendingCalls.delete(msg.id)
       }
     } catch (err: any) {
       console.error('[HarnessClient] Failed to parse message frame:', err.message)
     }
   })
   ```
