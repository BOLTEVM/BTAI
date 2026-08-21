# Workflow: Optimizing and Improving the Harness Subsystem

This workflow provides a step-by-step guide to optimize the performance, resource utilization, and storage throughput of the AI Agent Harness Daemon (`packages/harness`).

---

## 1. Audit Log Throughput Refactoring (JSONL)

To prevent disk IO and memory overhead scaling $O(N)$ with task history, refactor the audit logger in `src/orchestrator.ts` to use append-only JSON lines (JSONL).

### Steps:
1. Locate `packages/harness/src/orchestrator.ts`.
2. Replace `logAudit` and `initAuditLog` implementations:
   ```typescript
   private initAuditLog() {
     // Ensure directories exist
     const dir = path.dirname(this.auditLogPath)
     if (!fs.existsSync(dir)) {
       fs.mkdirSync(dir, { recursive: true })
     }
   }

   private logAudit(
     taskId: string,
     fromState: TaskState,
     toState: TaskState,
     actor: { role: string; id: string },
     guardsEvaluated: Array<{ code: string; name: string; passed: boolean; reason?: string }>,
     success: boolean,
     errorMsg?: string
   ) {
     const entry = {
       timestamp: Date.now(),
       taskId,
       fromState,
       toState,
       actor,
       guardsEvaluated,
       success,
       error: errorMsg
     }
     // Append as a single line to the stream
     fs.appendFileSync(this.auditLogPath, JSON.stringify(entry) + '\n', 'utf8')
   }
   ```
3. Update `getAuditTrail()` to parse the JSONL structure:
   ```typescript
   public getAuditTrail(): IAuditTrailEntry[] {
     if (!fs.existsSync(this.auditLogPath)) return []
     const fileContent = fs.readFileSync(this.auditLogPath, 'utf8')
     return fileContent
       .split('\n')
       .filter(line => line.trim().length > 0)
       .map(line => JSON.parse(line))
   }
   ```

---

## 2. Telemetry Broadcast Throttling

Throttle mining state telemetry broadcasts to reduce network congestion and CPU cycles during periods of high share submission.

### Steps:
1. Locate `packages/harness/src/telemetry.ts`.
2. Implement a rate-limited telemetry broker in `TelemetryAggregator`:
   - Introduce a `lastBroadcastTime` stamp.
   - Buffer telemetry updates and trigger broadcasts at a maximum rate of 2Hz (every 500ms).
   ```typescript
   private throttleTimeout: NodeJS.Timeout | null = null

   private triggerUpdate() {
     this.state.timestamp = Date.now()
     if (this.throttleTimeout) return

     this.throttleTimeout = setTimeout(() => {
       this.listeners.forEach(fn => fn(this.state))
       this.throttleTimeout = null
     }, 500)
   }
   ```

---

## 3. Graceful Socket Cleanup

Prevent memory leaks and dangling socket connections when simulated subsystems disconnect or experience timeouts.

### Steps:
1. Locate the WebSocket connection handler in `packages/harness/src/index.ts`.
2. Register cleanups on close/error:
   - Clear pending RPC timeouts (`pendingSubsystemCalls`).
   - Remove references from `subsystemSockets`.
