/**
 * SQLite Store Provider
 *
 * Persistent storage using better-sqlite3 - the most reliable SQLite library for Node.js.
 *
 * @module stores/sqlite
 * @packageDocumentation
 */

import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { BaseStoreProvider } from './base.js';
import type {
  StoreProviderConfig,
  LogEntry,
  Session,
  LogFilter,
  SessionFilter,
  StoreStats,
  LogLevel,
} from '../types.js';

/**
 * Configuration options for SQLite store
 */
export interface SQLiteStoreConfig extends StoreProviderConfig {
  /**
   * Path to SQLite database file
   * @default ':memory:' for in-memory database
   */
  filename?: string;

  /**
   * Enable WAL mode for better concurrent read performance
   * @default true
   */
  walMode?: boolean;

  /**
   * Cache size in KB (negative for number of pages)
   * @default -2000 (2000 pages)
   */
  cacheSize?: number;

  /**
   * Enable foreign keys
   * @default true
   */
  foreignKeys?: boolean;

  /**
   * Create indexes for common queries
   * @default true
   */
  createIndexes?: boolean;
}

/**
 * SQLite store provider using better-sqlite3
 *
 * @remarks
 * Uses synchronous better-sqlite3 for maximum performance and reliability.
 * Supports both file-based and in-memory databases.
 *
 * Features:
 * - WAL mode for concurrent reads
 * - Automatic schema creation and migration
 * - Full-text search on message field
 * - Efficient indexes for common query patterns
 * - Transaction support for bulk operations
 *
 * @example
 * ```typescript
 * import { SQLiteStoreProvider } from '@nodelogger/core/sqlite';
 *
 * // File-based persistent storage
 * const store = new SQLiteStoreProvider({
 *   filename: './logs.db',
 *   walMode: true
 * });
 * await store.init();
 *
 * // In-memory (fast, non-persistent)
 * const memStore = new SQLiteStoreProvider();
 * await memStore.init();
 * ```
 */
export class SQLiteStoreProvider extends BaseStoreProvider {
  readonly name = 'sqlite';

  private db: DatabaseType | null = null;
  private sqliteConfig: Required<SQLiteStoreConfig>;

  constructor(config?: SQLiteStoreConfig) {
    super(config);

    this.sqliteConfig = {
      maxLogs: config?.maxLogs ?? 100000,
      maxSessions: config?.maxSessions ?? 10000,
      cleanupInterval: config?.cleanupInterval ?? 0,
      retentionPeriod: config?.retentionPeriod ?? 30 * 24 * 60 * 60 * 1000,
      filename: config?.filename ?? ':memory:',
      walMode: config?.walMode ?? true,
      cacheSize: config?.cacheSize ?? -2000,
      foreignKeys: config?.foreignKeys ?? true,
      createIndexes: config?.createIndexes ?? true,
    };
  }

  /**
   * Initialize the SQLite database
   */
  async init(): Promise<void> {
    this.db = new Database(this.sqliteConfig.filename);

    // Configure database
    if (this.sqliteConfig.walMode && this.sqliteConfig.filename !== ':memory:') {
      this.db.pragma('journal_mode = WAL');
    }
    this.db.pragma(`cache_size = ${this.sqliteConfig.cacheSize}`);
    if (this.sqliteConfig.foreignKeys) {
      this.db.pragma('foreign_keys = ON');
    }

    // Create schema
    this.createSchema();

    this._ready = true;
    this.startCleanupTimer();
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    this.stopCleanupTimer();

    if (this.db) {
      this.db.close();
      this.db = null;
    }

    this._ready = false;
  }

  /**
   * Create database schema
   */
  private createSchema(): void {
    if (!this.db) return;

    // Logs table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS logs (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        logger TEXT,
        session_id TEXT,
        service TEXT,
        environment TEXT,
        release TEXT,
        hostname TEXT,
        pid INTEGER,
        metadata TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Sessions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        error_count INTEGER DEFAULT 0,
        duration INTEGER,
        user_data TEXT,
        attributes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for common query patterns
    if (this.sqliteConfig.createIndexes) {
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
        CREATE INDEX IF NOT EXISTS idx_logs_session_id ON logs(session_id);
        CREATE INDEX IF NOT EXISTS idx_logs_service ON logs(service);
        CREATE INDEX IF NOT EXISTS idx_logs_environment ON logs(environment);
        CREATE INDEX IF NOT EXISTS idx_logs_level_timestamp ON logs(level, timestamp DESC);

        CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
        CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC);
      `);
    }
  }

  // =========================================================================
  // Log Operations
  // =========================================================================

  /**
   * Save a log entry
   * @param entry - Log entry to save
   */
  async saveLog(entry: LogEntry): Promise<void> {
    this.ensureReady();

    const stmt = this.db!.prepare(`
      INSERT INTO logs (id, timestamp, level, message, logger, session_id,
                       service, environment, release, hostname, pid, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      entry.id || this.generateId(),
      entry.timestamp || this.now(),
      entry.level,
      entry.message,
      entry.logger ?? null,
      entry.sessionId ?? null,
      entry.service ?? null,
      entry.environment ?? null,
      entry.release ?? null,
      entry.hostname ?? null,
      entry.pid ?? null,
      entry.metadata ? JSON.stringify(entry.metadata) : null
    );

    // Enforce max logs limit
    await this.enforceLogLimit();
  }

  /**
   * Save multiple log entries in a transaction
   * @param entries - Log entries to save
   */
  async saveLogs(entries: LogEntry[]): Promise<void> {
    this.ensureReady();

    const stmt = this.db!.prepare(`
      INSERT INTO logs (id, timestamp, level, message, logger, session_id,
                       service, environment, release, hostname, pid, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db!.transaction((logs: LogEntry[]) => {
      for (const entry of logs) {
        stmt.run(
          entry.id || this.generateId(),
          entry.timestamp || this.now(),
          entry.level,
          entry.message,
          entry.logger ?? null,
          entry.sessionId ?? null,
          entry.service ?? null,
          entry.environment ?? null,
          entry.release ?? null,
          entry.hostname ?? null,
          entry.pid ?? null,
          entry.metadata ? JSON.stringify(entry.metadata) : null
        );
      }
    });

    insertMany(entries);
    await this.enforceLogLimit();
  }

  /**
   * Get log entries matching filter
   * @param filter - Query filter
   * @returns Matching log entries
   */
  async getLogs(filter?: LogFilter): Promise<LogEntry[]> {
    this.ensureReady();

    const { sql, params } = this.buildLogQuery(filter);
    const stmt = this.db!.prepare(sql);
    const rows = stmt.all(...params) as SQLiteLogRow[];

    return rows.map((row) => this.rowToLogEntry(row));
  }

  /**
   * Delete log entries matching filter
   * @param filter - Query filter
   * @returns Number of deleted entries
   */
  async deleteLogs(filter?: LogFilter): Promise<number> {
    this.ensureReady();

    if (!filter) {
      const result = this.db!.prepare('DELETE FROM logs').run();
      return result.changes;
    }

    const { whereClauses, params } = this.buildWhereClause(filter);
    const sql = `DELETE FROM logs${whereClauses ? ` WHERE ${whereClauses}` : ''}`;
    const result = this.db!.prepare(sql).run(...params);
    return result.changes;
  }

  /**
   * Count log entries matching filter
   * @param filter - Query filter
   * @returns Count of matching entries
   */
  async countLogs(filter?: LogFilter): Promise<number> {
    this.ensureReady();

    const { whereClauses, params } = this.buildWhereClause(filter);
    const sql = `SELECT COUNT(*) as count FROM logs${whereClauses ? ` WHERE ${whereClauses}` : ''}`;
    const row = this.db!.prepare(sql).get(...params) as { count: number };
    return row.count;
  }

  /**
   * Enforce maximum log limit by deleting oldest entries
   */
  private async enforceLogLimit(): Promise<void> {
    const count = await this.countLogs();
    if (count > this.sqliteConfig.maxLogs) {
      const excess = count - this.sqliteConfig.maxLogs;
      this.db!.prepare(`
        DELETE FROM logs WHERE id IN (
          SELECT id FROM logs ORDER BY timestamp ASC LIMIT ?
        )
      `).run(excess);
    }
  }

  // =========================================================================
  // Session Operations
  // =========================================================================

  /**
   * Create a new session
   * @param session - Session to create
   */
  async createSession(session: Session): Promise<void> {
    this.ensureReady();

    const stmt = this.db!.prepare(`
      INSERT INTO sessions (id, started_at, ended_at, status, error_count,
                           duration, user_data, attributes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      session.id || this.generateId(),
      session.startedAt || this.now(),
      session.endedAt ?? null,
      session.status || 'active',
      session.errorCount || 0,
      session.duration ?? null,
      session.user ? JSON.stringify(session.user) : null,
      session.attributes ? JSON.stringify(session.attributes) : null
    );

    // Enforce max sessions limit
    await this.enforceSessionLimit();
  }

  /**
   * Update an existing session
   * @param sessionId - Session ID
   * @param updates - Partial session data
   */
  async updateSession(sessionId: string, updates: Partial<Session>): Promise<void> {
    this.ensureReady();

    const setClauses: string[] = [];
    const params: unknown[] = [];

    if (updates.endedAt !== undefined) {
      setClauses.push('ended_at = ?');
      params.push(updates.endedAt);
    }
    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      params.push(updates.status);
    }
    if (updates.errorCount !== undefined) {
      setClauses.push('error_count = ?');
      params.push(updates.errorCount);
    }
    if (updates.duration !== undefined) {
      setClauses.push('duration = ?');
      params.push(updates.duration);
    }
    if (updates.user !== undefined) {
      setClauses.push('user_data = ?');
      params.push(updates.user ? JSON.stringify(updates.user) : null);
    }
    if (updates.attributes !== undefined) {
      setClauses.push('attributes = ?');
      params.push(updates.attributes ? JSON.stringify(updates.attributes) : null);
    }

    if (setClauses.length === 0) return;

    params.push(sessionId);
    const sql = `UPDATE sessions SET ${setClauses.join(', ')} WHERE id = ?`;
    const result = this.db!.prepare(sql).run(...params);

    if (result.changes === 0) {
      throw new Error(`Session not found: ${sessionId}`);
    }
  }

  /**
   * Get a session by ID
   * @param sessionId - Session ID
   * @returns Session or null
   */
  async getSession(sessionId: string): Promise<Session | null> {
    this.ensureReady();

    const row = this.db!.prepare('SELECT * FROM sessions WHERE id = ?').get(
      sessionId
    ) as SQLiteSessionRow | undefined;

    return row ? this.rowToSession(row) : null;
  }

  /**
   * Get sessions matching filter
   * @param filter - Query filter
   * @returns Matching sessions
   */
  async getSessions(filter?: SessionFilter): Promise<Session[]> {
    this.ensureReady();

    let sql = 'SELECT * FROM sessions';
    const params: unknown[] = [];
    const whereClauses: string[] = [];

    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      whereClauses.push(`status IN (${statuses.map(() => '?').join(',')})`);
      params.push(...statuses);
    }

    if (filter?.userId !== undefined) {
      whereClauses.push('json_extract(user_data, "$.id") = ?');
      params.push(String(filter.userId));
    }

    if (filter?.startTime) {
      whereClauses.push('started_at >= ?');
      params.push(
        filter.startTime instanceof Date
          ? filter.startTime.toISOString()
          : filter.startTime
      );
    }

    if (filter?.endTime) {
      whereClauses.push('started_at <= ?');
      params.push(
        filter.endTime instanceof Date ? filter.endTime.toISOString() : filter.endTime
      );
    }

    if (whereClauses.length > 0) {
      sql += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    sql += ' ORDER BY started_at DESC';

    if (filter?.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    if (filter?.offset) {
      sql += ' OFFSET ?';
      params.push(filter.offset);
    }

    const rows = this.db!.prepare(sql).all(...params) as SQLiteSessionRow[];
    return rows.map((row) => this.rowToSession(row));
  }

  /**
   * Delete a session and its logs
   * @param sessionId - Session ID
   */
  async deleteSession(sessionId: string): Promise<void> {
    this.ensureReady();

    const deleteAll = this.db!.transaction(() => {
      this.db!.prepare('DELETE FROM logs WHERE session_id = ?').run(sessionId);
      this.db!.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    });

    deleteAll();
  }

  /**
   * Enforce maximum session limit
   */
  private async enforceSessionLimit(): Promise<void> {
    const row = this.db!.prepare('SELECT COUNT(*) as count FROM sessions').get() as {
      count: number;
    };

    if (row.count > this.sqliteConfig.maxSessions) {
      const excess = row.count - this.sqliteConfig.maxSessions;
      this.db!.prepare(`
        DELETE FROM sessions WHERE id IN (
          SELECT id FROM sessions
          WHERE status != 'active'
          ORDER BY started_at ASC LIMIT ?
        )
      `).run(excess);
    }
  }

  // =========================================================================
  // Maintenance Operations
  // =========================================================================

  /**
   * Clean up old data
   * @param olderThan - Delete entries older than this date
   * @returns Number of deleted entries
   */
  async cleanup(olderThan: Date): Promise<number> {
    this.ensureReady();

    const cutoff = olderThan.toISOString();
    let deleted = 0;

    const cleanupTx = this.db!.transaction(() => {
      // Delete old logs
      const logsResult = this.db!.prepare(
        'DELETE FROM logs WHERE timestamp < ?'
      ).run(cutoff);
      deleted += logsResult.changes;

      // Delete old ended sessions
      const sessionsResult = this.db!.prepare(
        "DELETE FROM sessions WHERE status != 'active' AND ended_at < ?"
      ).run(cutoff);
      deleted += sessionsResult.changes;
    });

    cleanupTx();
    return deleted;
  }

  /**
   * Get storage statistics
   * @returns Storage stats
   */
  async getStats(): Promise<StoreStats> {
    this.ensureReady();

    const totalLogs =
      (this.db!.prepare('SELECT COUNT(*) as count FROM logs').get() as { count: number })
        .count;

    const totalSessions =
      (
        this.db!.prepare('SELECT COUNT(*) as count FROM sessions').get() as {
          count: number;
        }
      ).count;

    const activeSessions =
      (
        this.db!.prepare(
          "SELECT COUNT(*) as count FROM sessions WHERE status = 'active'"
        ).get() as { count: number }
      ).count;

    // Get logs by level
    const levelRows = this.db!.prepare(
      'SELECT level, COUNT(*) as count FROM logs GROUP BY level'
    ).all() as { level: LogLevel; count: number }[];

    const logsByLevel: Record<LogLevel, number> = {
      fatal: 0,
      error: 0,
      warn: 0,
      info: 0,
      debug: 0,
      trace: 0,
    };

    for (const row of levelRows) {
      logsByLevel[row.level] = row.count;
    }

    // Get oldest and newest logs
    const oldest = this.db!.prepare(
      'SELECT timestamp FROM logs ORDER BY timestamp ASC LIMIT 1'
    ).get() as { timestamp: string } | undefined;

    const newest = this.db!.prepare(
      'SELECT timestamp FROM logs ORDER BY timestamp DESC LIMIT 1'
    ).get() as { timestamp: string } | undefined;

    // Get database size (for file-based databases)
    let sizeBytes: number | undefined;
    if (this.sqliteConfig.filename !== ':memory:') {
      try {
        const pageCount = (
          this.db!.pragma('page_count') as { page_count: number }[]
        )[0]?.page_count;
        const pageSize = (this.db!.pragma('page_size') as { page_size: number }[])[0]
          ?.page_size;
        if (pageCount && pageSize) {
          sizeBytes = pageCount * pageSize;
        }
      } catch {
        // Ignore if pragma fails
      }
    }

    return {
      totalLogs,
      totalSessions,
      activeSessions,
      logsByLevel,
      sizeBytes,
      oldestLog: oldest?.timestamp,
      newestLog: newest?.timestamp,
    };
  }

  // =========================================================================
  // Query Building Helpers
  // =========================================================================

  /**
   * Build WHERE clause from filter
   */
  private buildWhereClause(filter?: LogFilter): {
    whereClauses: string;
    params: unknown[];
  } {
    if (!filter) return { whereClauses: '', params: [] };

    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filter.level) {
      const levels = Array.isArray(filter.level) ? filter.level : [filter.level];
      clauses.push(`level IN (${levels.map(() => '?').join(',')})`);
      params.push(...levels);
    }

    if (filter.sessionId) {
      clauses.push('session_id = ?');
      params.push(filter.sessionId);
    }

    if (filter.logger) {
      clauses.push('logger = ?');
      params.push(filter.logger);
    }

    if (filter.startTime) {
      clauses.push('timestamp >= ?');
      params.push(
        filter.startTime instanceof Date
          ? filter.startTime.toISOString()
          : filter.startTime
      );
    }

    if (filter.endTime) {
      clauses.push('timestamp <= ?');
      params.push(
        filter.endTime instanceof Date ? filter.endTime.toISOString() : filter.endTime
      );
    }

    if (filter.search) {
      clauses.push('message LIKE ?');
      params.push(`%${filter.search}%`);
    }

    if (filter.service) {
      clauses.push('service = ?');
      params.push(filter.service);
    }

    if (filter.environment) {
      clauses.push('environment = ?');
      params.push(filter.environment);
    }

    if (filter.traceId) {
      clauses.push('json_extract(metadata, "$.traceId") = ?');
      params.push(filter.traceId);
    }

    if (filter.tags && Object.keys(filter.tags).length > 0) {
      for (const [key, value] of Object.entries(filter.tags)) {
        clauses.push(`json_extract(metadata, "$.tags.${key}") = ?`);
        params.push(value);
      }
    }

    return {
      whereClauses: clauses.join(' AND '),
      params,
    };
  }

  /**
   * Build complete SELECT query from filter
   */
  private buildLogQuery(filter?: LogFilter): { sql: string; params: unknown[] } {
    const { whereClauses, params } = this.buildWhereClause(filter);

    let sql = 'SELECT * FROM logs';

    if (whereClauses) {
      sql += ` WHERE ${whereClauses}`;
    }

    // Ordering
    const orderBy = filter?.orderBy || 'timestamp';
    const direction = filter?.orderDirection || 'desc';
    sql += ` ORDER BY ${orderBy} ${direction.toUpperCase()}`;

    // Pagination
    if (filter?.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    if (filter?.offset) {
      sql += ' OFFSET ?';
      params.push(filter.offset);
    }

    return { sql, params };
  }

  // =========================================================================
  // Row Conversion Helpers
  // =========================================================================

  /**
   * Convert SQLite row to LogEntry
   */
  private rowToLogEntry(row: SQLiteLogRow): LogEntry {
    return {
      id: row.id,
      timestamp: row.timestamp,
      level: row.level as LogLevel,
      message: row.message,
      logger: row.logger ?? undefined,
      sessionId: row.session_id ?? undefined,
      service: row.service ?? undefined,
      environment: row.environment ?? undefined,
      release: row.release ?? undefined,
      hostname: row.hostname ?? undefined,
      pid: row.pid ?? undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  /**
   * Convert SQLite row to Session
   */
  private rowToSession(row: SQLiteSessionRow): Session {
    return {
      id: row.id,
      startedAt: row.started_at,
      endedAt: row.ended_at ?? undefined,
      status: row.status as Session['status'],
      errorCount: row.error_count,
      duration: row.duration ?? undefined,
      user: row.user_data ? JSON.parse(row.user_data) : undefined,
      attributes: row.attributes ? JSON.parse(row.attributes) : undefined,
    };
  }

  // =========================================================================
  // Additional SQLite-Specific Methods
  // =========================================================================

  /**
   * Execute raw SQL query
   * @param sql - SQL query
   * @param params - Query parameters
   * @returns Query results
   */
  query<T>(sql: string, ...params: unknown[]): T[] {
    this.ensureReady();
    return this.db!.prepare(sql).all(...params) as T[];
  }

  /**
   * Execute raw SQL statement
   * @param sql - SQL statement
   * @param params - Statement parameters
   * @returns Run result
   */
  execute(sql: string, ...params: unknown[]): Database.RunResult {
    this.ensureReady();
    return this.db!.prepare(sql).run(...params);
  }

  /**
   * Run VACUUM to optimize database
   */
  vacuum(): void {
    this.ensureReady();
    this.db!.exec('VACUUM');
  }

  /**
   * Get the underlying better-sqlite3 database instance
   * @returns Database instance or null
   */
  getDatabase(): DatabaseType | null {
    return this.db;
  }
}

// =========================================================================
// Internal Types
// =========================================================================

interface SQLiteLogRow {
  id: string;
  timestamp: string;
  level: string;
  message: string;
  logger: string | null;
  session_id: string | null;
  service: string | null;
  environment: string | null;
  release: string | null;
  hostname: string | null;
  pid: number | null;
  metadata: string | null;
  created_at: string;
}

interface SQLiteSessionRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  error_count: number;
  duration: number | null;
  user_data: string | null;
  attributes: string | null;
  created_at: string;
}
