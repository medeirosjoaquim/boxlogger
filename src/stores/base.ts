/**
 * Base Store Provider
 *
 * Abstract base class providing common utilities for store implementations.
 *
 * @module stores/base
 * @packageDocumentation
 */

// Browser-compatible UUID generation
function randomUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

import type {
  StoreProvider,
  StoreProviderConfig,
  LogEntry,
  Session,
  LogFilter,
  SessionFilter,
  StoreStats,
  LogLevel,
  LogLevelValue,
} from '../types.js';

/**
 * Default configuration values for store providers
 */
export const DEFAULT_STORE_CONFIG: Required<StoreProviderConfig> = {
  maxLogs: 100000,
  maxSessions: 10000,
  cleanupInterval: 0,
  retentionPeriod: 30 * 24 * 60 * 60 * 1000, // 30 days
};

/**
 * Log level numeric values for comparison
 */
const LEVEL_VALUES: Record<LogLevel, number> = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

/**
 * Abstract base class for store providers
 *
 * @remarks
 * Provides common functionality like ID generation, timestamp handling,
 * and filtering utilities. Extend this class to create new store providers.
 *
 * @example
 * ```typescript
 * class MyStoreProvider extends BaseStoreProvider {
 *   readonly name = 'mystore';
 *
 *   async init(): Promise<void> {
 *     // Initialize your store
 *     this._ready = true;
 *   }
 *   // ... implement other abstract methods
 * }
 * ```
 */
export abstract class BaseStoreProvider implements StoreProvider {
  abstract readonly name: string;

  protected _ready = false;
  protected config: Required<StoreProviderConfig>;
  protected cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(config?: StoreProviderConfig) {
    this.config = { ...DEFAULT_STORE_CONFIG, ...config };
  }

  /**
   * Check if the provider is ready for operations
   */
  isReady(): boolean {
    return this._ready;
  }

  /**
   * Start automatic cleanup if configured
   */
  protected startCleanupTimer(): void {
    if (this.config.cleanupInterval > 0) {
      this.cleanupTimer = setInterval(async () => {
        const cutoff = new Date(Date.now() - this.config.retentionPeriod);
        await this.cleanup(cutoff);
      }, this.config.cleanupInterval);

      // Don't keep the process alive just for cleanup
      if (this.cleanupTimer.unref) {
        this.cleanupTimer.unref();
      }
    }
  }

  /**
   * Stop automatic cleanup
   */
  protected stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  // Abstract methods that must be implemented
  abstract init(): Promise<void>;
  abstract close(): Promise<void>;
  abstract saveLog(entry: LogEntry): Promise<void>;
  abstract getLogs(filter?: LogFilter): Promise<LogEntry[]>;
  abstract deleteLogs(filter?: LogFilter): Promise<number>;
  abstract countLogs(filter?: LogFilter): Promise<number>;
  abstract createSession(session: Session): Promise<void>;
  abstract updateSession(sessionId: string, updates: Partial<Session>): Promise<void>;
  abstract getSession(sessionId: string): Promise<Session | null>;
  abstract getSessions(filter?: SessionFilter): Promise<Session[]>;
  abstract deleteSession(sessionId: string): Promise<void>;
  abstract cleanup(olderThan: Date): Promise<number>;
  abstract getStats(): Promise<StoreStats>;

  // =========================================================================
  // ID Generation Utilities
  // =========================================================================

  /**
   * Generate a UUID v4
   * @returns UUID string
   */
  protected generateId(): string {
    return randomUUID();
  }

  /**
   * Generate a short hex ID
   * @param length - ID length (default 16)
   * @returns Hex string ID
   */
  protected generateShortId(length = 16): string {
    const bytes = new Uint8Array(Math.ceil(length / 2));
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, length);
  }

  // =========================================================================
  // Timestamp Utilities
  // =========================================================================

  /**
   * Get current ISO 8601 timestamp
   * @returns ISO timestamp string
   */
  protected now(): string {
    return new Date().toISOString();
  }

  /**
   * Parse a timestamp to Date
   * @param timestamp - ISO string or Date
   * @returns Date object
   */
  protected parseTimestamp(timestamp: string | Date): Date {
    return timestamp instanceof Date ? timestamp : new Date(timestamp);
  }

  /**
   * Calculate duration between timestamps in milliseconds
   * @param start - Start timestamp
   * @param end - End timestamp
   * @returns Duration in ms
   */
  protected calculateDuration(start: string | Date, end: string | Date): number {
    return this.parseTimestamp(end).getTime() - this.parseTimestamp(start).getTime();
  }

  // =========================================================================
  // Filtering Utilities (for in-memory filtering)
  // =========================================================================

  /**
   * Filter log entries in memory
   * @param logs - Log entries to filter
   * @param filter - Filter criteria
   * @returns Filtered entries
   */
  protected filterLogs(logs: LogEntry[], filter: LogFilter): LogEntry[] {
    let result = [...logs];

    // Filter by level
    if (filter.level) {
      const levels = Array.isArray(filter.level) ? filter.level : [filter.level];
      result = result.filter((log) => levels.includes(log.level));
    }

    // Filter by session
    if (filter.sessionId) {
      result = result.filter((log) => log.sessionId === filter.sessionId);
    }

    // Filter by logger name
    if (filter.logger) {
      result = result.filter((log) => log.logger === filter.logger);
    }

    // Filter by time range
    if (filter.startTime) {
      const start = this.parseTimestamp(filter.startTime);
      result = result.filter((log) => this.parseTimestamp(log.timestamp) >= start);
    }

    if (filter.endTime) {
      const end = this.parseTimestamp(filter.endTime);
      result = result.filter((log) => this.parseTimestamp(log.timestamp) <= end);
    }

    // Filter by search text
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      result = result.filter(
        (log) =>
          log.message.toLowerCase().includes(searchLower) ||
          log.metadata?.error?.message?.toLowerCase().includes(searchLower)
      );
    }

    // Filter by tags
    if (filter.tags && Object.keys(filter.tags).length > 0) {
      result = result.filter((log) => {
        if (!log.metadata?.tags) return false;
        return Object.entries(filter.tags!).every(
          ([key, value]) => log.metadata?.tags?.[key] === value
        );
      });
    }

    // Filter by trace ID
    if (filter.traceId) {
      result = result.filter((log) => log.metadata?.traceId === filter.traceId);
    }

    // Filter by service
    if (filter.service) {
      result = result.filter((log) => log.service === filter.service);
    }

    // Filter by environment
    if (filter.environment) {
      result = result.filter((log) => log.environment === filter.environment);
    }

    // Sort
    const orderBy = filter.orderBy || 'timestamp';
    const direction = filter.orderDirection || 'desc';
    result = this.sortLogs(result, orderBy, direction);

    // Pagination
    if (filter.offset) {
      result = result.slice(filter.offset);
    }
    if (filter.limit) {
      result = result.slice(0, filter.limit);
    }

    return result;
  }

  /**
   * Sort log entries
   * @param logs - Logs to sort
   * @param orderBy - Sort field
   * @param direction - Sort direction
   * @returns Sorted logs
   */
  private sortLogs(
    logs: LogEntry[],
    orderBy: 'timestamp' | 'level',
    direction: 'asc' | 'desc'
  ): LogEntry[] {
    return logs.sort((a, b) => {
      let comparison: number;

      if (orderBy === 'level') {
        comparison = LEVEL_VALUES[a.level] - LEVEL_VALUES[b.level];
      } else {
        comparison =
          this.parseTimestamp(a.timestamp).getTime() -
          this.parseTimestamp(b.timestamp).getTime();
      }

      return direction === 'desc' ? -comparison : comparison;
    });
  }

  /**
   * Filter sessions in memory
   * @param sessions - Sessions to filter
   * @param filter - Filter criteria
   * @returns Filtered sessions
   */
  protected filterSessions(sessions: Session[], filter: SessionFilter): Session[] {
    let result = [...sessions];

    // Filter by status
    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      result = result.filter((s) => statuses.includes(s.status));
    }

    // Filter by user ID
    if (filter.userId !== undefined) {
      result = result.filter((s) => s.user?.id === filter.userId);
    }

    // Filter by time range
    if (filter.startTime) {
      const start = this.parseTimestamp(filter.startTime);
      result = result.filter((s) => this.parseTimestamp(s.startedAt) >= start);
    }

    if (filter.endTime) {
      const end = this.parseTimestamp(filter.endTime);
      result = result.filter((s) => this.parseTimestamp(s.startedAt) <= end);
    }

    // Sort by startedAt descending
    result.sort(
      (a, b) =>
        this.parseTimestamp(b.startedAt).getTime() -
        this.parseTimestamp(a.startedAt).getTime()
    );

    // Pagination
    if (filter.offset) {
      result = result.slice(filter.offset);
    }
    if (filter.limit) {
      result = result.slice(0, filter.limit);
    }

    return result;
  }

  // =========================================================================
  // Utility Methods
  // =========================================================================

  /**
   * Deep clone an object
   * @param obj - Object to clone
   * @returns Cloned object
   */
  protected clone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Ensure the store is ready, throw if not
   */
  protected ensureReady(): void {
    if (!this._ready) {
      throw new Error(`${this.name} store is not initialized. Call init() first.`);
    }
  }
}
