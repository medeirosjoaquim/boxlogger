/**
 * Memory Store Provider
 *
 * In-memory storage implementation for development, testing, or ephemeral logging.
 *
 * @module stores/memory
 * @packageDocumentation
 */

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
 * Configuration options for the memory store
 */
export interface MemoryStoreConfig extends StoreProviderConfig {
  /** Maximum log entries to retain (default: 10000) */
  maxLogs?: number;
  /** Maximum sessions to retain (default: 1000) */
  maxSessions?: number;
}

/**
 * In-memory store provider
 *
 * @remarks
 * Fast read/write operations with no persistence.
 * Data is lost when the process exits.
 * Ideal for testing, development, or caching scenarios.
 *
 * @example
 * ```typescript
 * import { MemoryStoreProvider } from '@nodelogger/core/memory';
 *
 * const store = new MemoryStoreProvider({ maxLogs: 5000 });
 * await store.init();
 *
 * await store.saveLog({
 *   id: '1',
 *   timestamp: new Date().toISOString(),
 *   level: 'info',
 *   message: 'Hello world'
 * });
 * ```
 */
export class MemoryStoreProvider extends BaseStoreProvider {
  readonly name = 'memory';

  private logs: LogEntry[] = [];
  private sessions: Map<string, Session> = new Map();

  constructor(config?: MemoryStoreConfig) {
    super({
      ...config,
      maxLogs: config?.maxLogs ?? 10000,
      maxSessions: config?.maxSessions ?? 1000,
    });
  }

  /**
   * Initialize the memory store
   */
  async init(): Promise<void> {
    this._ready = true;
    this.startCleanupTimer();
  }

  /**
   * Close the memory store and clear all data
   */
  async close(): Promise<void> {
    this.stopCleanupTimer();
    this.logs = [];
    this.sessions.clear();
    this._ready = false;
  }

  // =========================================================================
  // Log Operations
  // =========================================================================

  /**
   * Save a log entry to memory
   * @param entry - Log entry to save
   */
  async saveLog(entry: LogEntry): Promise<void> {
    this.ensureReady();

    const logEntry: LogEntry = {
      ...entry,
      id: entry.id || this.generateId(),
      timestamp: entry.timestamp || this.now(),
    };

    this.logs.push(logEntry);

    // Enforce max logs limit (FIFO eviction)
    if (this.logs.length > this.config.maxLogs) {
      this.logs = this.logs.slice(-this.config.maxLogs);
    }
  }

  /**
   * Get log entries matching filter
   * @param filter - Query filter
   * @returns Matching log entries
   */
  async getLogs(filter?: LogFilter): Promise<LogEntry[]> {
    this.ensureReady();

    if (!filter) {
      return this.logs.map((log) => this.clone(log));
    }

    return this.filterLogs(this.logs, filter).map((log) => this.clone(log));
  }

  /**
   * Delete log entries matching filter
   * @param filter - Query filter
   * @returns Number of deleted entries
   */
  async deleteLogs(filter?: LogFilter): Promise<number> {
    this.ensureReady();

    if (!filter) {
      const count = this.logs.length;
      this.logs = [];
      return count;
    }

    const toDelete = new Set(this.filterLogs(this.logs, filter).map((l) => l.id));
    const before = this.logs.length;
    this.logs = this.logs.filter((log) => !toDelete.has(log.id));
    return before - this.logs.length;
  }

  /**
   * Count log entries matching filter
   * @param filter - Query filter
   * @returns Count of matching entries
   */
  async countLogs(filter?: LogFilter): Promise<number> {
    this.ensureReady();

    if (!filter) {
      return this.logs.length;
    }

    return this.filterLogs(this.logs, filter).length;
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

    const sessionEntry: Session = {
      ...session,
      id: session.id || this.generateId(),
      startedAt: session.startedAt || this.now(),
      status: session.status || 'active',
      errorCount: session.errorCount || 0,
    };

    this.sessions.set(sessionEntry.id, sessionEntry);

    // Enforce max sessions limit
    if (this.sessions.size > this.config.maxSessions) {
      const sorted = Array.from(this.sessions.values()).sort(
        (a, b) =>
          this.parseTimestamp(a.startedAt).getTime() -
          this.parseTimestamp(b.startedAt).getTime()
      );

      const toRemove = sorted.slice(0, this.sessions.size - this.config.maxSessions);
      for (const s of toRemove) {
        this.sessions.delete(s.id);
      }
    }
  }

  /**
   * Update an existing session
   * @param sessionId - Session ID
   * @param updates - Partial session data
   */
  async updateSession(sessionId: string, updates: Partial<Session>): Promise<void> {
    this.ensureReady();

    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    this.sessions.set(sessionId, {
      ...session,
      ...updates,
      id: session.id, // Don't allow ID change
    });
  }

  /**
   * Get a session by ID
   * @param sessionId - Session ID
   * @returns Session or null
   */
  async getSession(sessionId: string): Promise<Session | null> {
    this.ensureReady();

    const session = this.sessions.get(sessionId);
    return session ? this.clone(session) : null;
  }

  /**
   * Get sessions matching filter
   * @param filter - Query filter
   * @returns Matching sessions
   */
  async getSessions(filter?: SessionFilter): Promise<Session[]> {
    this.ensureReady();

    const sessions = Array.from(this.sessions.values());

    if (!filter) {
      return sessions
        .sort(
          (a, b) =>
            this.parseTimestamp(b.startedAt).getTime() -
            this.parseTimestamp(a.startedAt).getTime()
        )
        .map((s) => this.clone(s));
    }

    return this.filterSessions(sessions, filter).map((s) => this.clone(s));
  }

  /**
   * Delete a session and its associated logs
   * @param sessionId - Session ID
   */
  async deleteSession(sessionId: string): Promise<void> {
    this.ensureReady();

    this.sessions.delete(sessionId);
    this.logs = this.logs.filter((log) => log.sessionId !== sessionId);
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

    const cutoff = olderThan.getTime();
    let deleted = 0;

    // Clean logs
    const logsBefore = this.logs.length;
    this.logs = this.logs.filter(
      (log) => this.parseTimestamp(log.timestamp).getTime() > cutoff
    );
    deleted += logsBefore - this.logs.length;

    // Clean ended sessions
    for (const [id, session] of this.sessions) {
      if (
        session.status !== 'active' &&
        session.endedAt &&
        this.parseTimestamp(session.endedAt).getTime() <= cutoff
      ) {
        this.sessions.delete(id);
        deleted++;
      }
    }

    return deleted;
  }

  /**
   * Get storage statistics
   * @returns Storage stats
   */
  async getStats(): Promise<StoreStats> {
    this.ensureReady();

    const logsByLevel: Record<LogLevel, number> = {
      fatal: 0,
      error: 0,
      warn: 0,
      info: 0,
      debug: 0,
      trace: 0,
    };

    let oldest: string | undefined;
    let newest: string | undefined;

    for (const log of this.logs) {
      logsByLevel[log.level]++;

      if (!oldest || log.timestamp < oldest) {
        oldest = log.timestamp;
      }
      if (!newest || log.timestamp > newest) {
        newest = log.timestamp;
      }
    }

    const activeSessions = Array.from(this.sessions.values()).filter(
      (s) => s.status === 'active'
    ).length;

    return {
      totalLogs: this.logs.length,
      totalSessions: this.sessions.size,
      activeSessions,
      logsByLevel,
      oldestLog: oldest,
      newestLog: newest,
    };
  }

  // =========================================================================
  // Additional Memory Store Methods
  // =========================================================================

  /**
   * Clear all data from the store
   */
  async clear(): Promise<void> {
    this.ensureReady();
    this.logs = [];
    this.sessions.clear();
  }

  /**
   * Get raw storage arrays (for debugging)
   * @returns Internal storage references
   */
  getRawData(): { logs: LogEntry[]; sessions: Map<string, Session> } {
    return {
      logs: this.logs,
      sessions: this.sessions,
    };
  }
}
