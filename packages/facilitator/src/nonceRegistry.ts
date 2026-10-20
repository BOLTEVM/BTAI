import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

/**
 * node:sqlite (Node 22.5+) is loaded lazily through createRequire so bundlers
 * and test runners whose builtin list predates it never try to resolve it
 * statically.
 */
interface SqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}
interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}
type DatabaseSyncCtor = new (path: string) => SqliteDatabase;

function loadDatabaseSync(): DatabaseSyncCtor {
  const nodeRequire = createRequire(__filename);
  return nodeRequire("node:sqlite").DatabaseSync as DatabaseSyncCtor;
}

export type SettlementStatus = "pending" | "settled" | "failed";

export interface SettlementRecord {
  idempotencyKey: string;
  client: string;
  nonce: string;
  status: SettlementStatus;
  txHash?: string;
  agreementId?: string;
  error?: string;
  createdAt: number;
}

/**
 * Durable nonce/idempotency registry backed by SQLite (node:sqlite — zero
 * native deps). The PRIMARY KEY on idempotency_key and the UNIQUE constraint
 * on (client, nonce) are the replay-protection backbone: a duplicate settle
 * request can never slip through a race, a retry, or a restart.
 *
 * Production note: swap the connection string for Postgres when the
 * facilitator shares infrastructure with the backend — the interface stays.
 */
export class NonceRegistry {
  private db: SqliteDatabase;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    }
    const DatabaseSync = loadDatabaseSync();
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settlements (
        idempotency_key TEXT PRIMARY KEY,
        client TEXT NOT NULL,
        nonce TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','settled','failed')),
        tx_hash TEXT,
        agreement_id TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(client, nonce)
      );
    `);
  }

  /** True if this (client, nonce) has any record — the authorization is spent. */
  isNonceUsed(client: string, nonce: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM settlements WHERE client = ? AND nonce = ? LIMIT 1")
      .get(client.toLowerCase(), nonce.toLowerCase());
    return row !== undefined;
  }

  /** Returns the existing record for an idempotency key, if any. */
  getByIdempotencyKey(key: string): SettlementRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM settlements WHERE idempotency_key = ?")
      .get(key);
    return row ? this.toRecord(row) : undefined;
  }

  /**
   * Inserts a pending record. Returns false when the key or the (client,
   * nonce) pair already exists — the caller must then serve the recorded
   * outcome instead of settling twice.
   */
  beginSettlement(idempotencyKey: string, client: string, nonce: string): boolean {
    try {
      this.db
        .prepare(
          "INSERT INTO settlements (idempotency_key, client, nonce, status, created_at) VALUES (?, ?, ?, 'pending', ?)"
        )
        .run(idempotencyKey, client.toLowerCase(), nonce.toLowerCase(), Date.now());
      return true;
    } catch {
      return false;
    }
  }

  markSettled(idempotencyKey: string, txHash: string, agreementId?: string): void {
    this.db
      .prepare("UPDATE settlements SET status = 'settled', tx_hash = ?, agreement_id = ? WHERE idempotency_key = ?")
      .run(txHash, agreementId ?? null, idempotencyKey);
  }

  markFailed(idempotencyKey: string, error: string): void {
    this.db
      .prepare("UPDATE settlements SET status = 'failed', error = ? WHERE idempotency_key = ?")
      .run(error.slice(0, 500), idempotencyKey);
  }

  stats(): { pending: number; settled: number; failed: number } {
    const rows = this.db
      .prepare("SELECT status, COUNT(*) AS n FROM settlements GROUP BY status")
      .all() as unknown as { status: SettlementStatus; n: number }[];
    const out = { pending: 0, settled: 0, failed: 0 };
    for (const row of rows) out[row.status] = Number(row.n);
    return out;
  }

  close(): void {
    this.db.close();
  }

  private toRecord(row: Record<string, unknown>): SettlementRecord {
    return {
      idempotencyKey: row.idempotency_key as string,
      client: row.client as string,
      nonce: row.nonce as string,
      status: row.status as SettlementStatus,
      txHash: (row.tx_hash as string) ?? undefined,
      agreementId: (row.agreement_id as string) ?? undefined,
      error: (row.error as string) ?? undefined,
      createdAt: row.created_at as number,
    };
  }
}
