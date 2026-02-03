/**
 * NodeLogger - Main Logger Class
 *
 * A lightweight, type-safe logger with pluggable storage backends.
 *
 * @module logger
 * @packageDocumentation
 */

// Browser-compatible utilities
function getHostname(): string {
  if (typeof globalThis !== 'undefined' && 'location' in globalThis) {
    return (globalThis as any).location?.hostname || 'browser';
  }
  try {
    const os = require('node:os');
    return os.hostname();
  } catch {
    return 'unknown';
  }
}

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
  LoggerConfig,
  LogLevel,
  LogEntry,
  LogMetadata,
  Session,
  ErrorInfo,
  StoreProvider,
  LogFilter,
  SessionFilter,
  StoreStats,
} from './types.js';

/**
 * Log level numeric values (lower = more severe)
 */
const LOG_LEVEL_VALUES: Record<LogLevel, number> = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

/**
 * NodeLogger - Backend logger with pluggable storage
 *
 * @remarks
 * Provides a simple, type-safe logging API with support for:
 * - Multiple log levels (fatal, error, warn, info, debug, trace)
 * - Session tracking
 * - Structured metadata (tags, user, request, error info)
 * - Pluggable storage backends (Console, Memory)
 *
 * @example
 * ```typescript
 * import { Logger } from '@johnboxcodes/boxlogger';
 * import { ConsoleStoreProvider } from '@johnboxcodes/boxlogger/console';
 *
 * const store = new ConsoleStoreProvider();
 * await store.init();
 *
 * const logger = new Logger({
 *   store,
 *   service: 'my-api',
 *   environment: 'production'
 * });
 *
 * logger.info('Server started', { tags: { port: '3000' } });
 * logger.error('Request failed', { error: err });
 * ```
 */
export class Logger {
  private store: StoreProvider;
  private config: {
    name: string;
    minLevel: LogLevel;
    service?: string;
    environment: string;
    enableSessions: boolean;
    release?: string;
    defaultMetadata?: LogMetadata;
    formatMessage?: (message: string, ...args: unknown[]) => string;
    store: StoreProvider;
  };
  private currentSession: Session | null = null;
  private hostname: string;
  private pid?: number;

  /**
   * Create a new logger instance
   * @param config - Logger configuration
   */
  constructor(config: LoggerConfig) {
    this.store = config.store;
    this.config = {
      ...config,
      name: config.name ?? 'default',
      minLevel: config.minLevel ?? 'info',
      service: config.service ?? undefined,
      environment: config.environment ?? (typeof process !== 'undefined' ? process.env.NODE_ENV : undefined) ?? 'development',
      enableSessions: config.enableSessions ?? false,
    };

    this.hostname = getHostname();
    this.pid = typeof process !== 'undefined' ? process.pid : undefined;
  }

  // =========================================================================
  // Log Methods
  // =========================================================================

  /**
   * Log a fatal error (system is unusable)
   * @param message - Log message
   * @param metadata - Additional metadata
   */
  fatal(message: string, metadata?: LogMetadata): void {
    this.log('fatal', message, metadata);
  }

  /**
   * Log an error (operation failed)
   * @param message - Log message
   * @param metadata - Additional metadata
   */
  error(message: string, metadata?: LogMetadata): void {
    this.log('error', message, metadata);
  }

  /**
   * Log a warning (something unexpected but not an error)
   * @param message - Log message
   * @param metadata - Additional metadata
   */
  warn(message: string, metadata?: LogMetadata): void {
    this.log('warn', message, metadata);
  }

  /**
   * Log informational message
   * @param message - Log message
   * @param metadata - Additional metadata
   */
  info(message: string, metadata?: LogMetadata): void {
    this.log('info', message, metadata);
  }

  /**
   * Log debug information
   * @param message - Log message
   * @param metadata - Additional metadata
   */
  debug(message: string, metadata?: LogMetadata): void {
    this.log('debug', message, metadata);
  }

  /**
   * Log trace/verbose information
   * @param message - Log message
   * @param metadata - Additional metadata
   */
  trace(message: string, metadata?: LogMetadata): void {
    this.log('trace', message, metadata);
  }

  /**
   * Log an exception/error object
   * @param error - Error object
   * @param message - Optional message (defaults to error.message)
   * @param metadata - Additional metadata
   */
  exception(error: Error, message?: string, metadata?: LogMetadata): void {
    const errorInfo = this.extractErrorInfo(error);
    const finalMessage = message ?? error.message;

    this.log('error', finalMessage, {
      ...metadata,
      error: errorInfo,
    });
  }

  /**
   * Generic log method
   * @param level - Log level
   * @param message - Log message
   * @param metadata - Additional metadata
   */
  log(level: LogLevel, message: string, metadata?: LogMetadata): void {
    // Check minimum level
    if (LOG_LEVEL_VALUES[level] > LOG_LEVEL_VALUES[this.config.minLevel]) {
      return;
    }

    const entry: LogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      level,
      message: this.config.formatMessage
        ? this.config.formatMessage(message)
        : message,
      logger: this.config.name,
      sessionId: this.currentSession?.id,
      service: this.config.service,
      environment: this.config.environment,
      release: this.config.release,
      hostname: this.hostname,
      pid: this.pid,
      metadata: this.mergeMetadata(metadata),
    };

    // Update session error count
    if (this.currentSession && (level === 'error' || level === 'fatal')) {
      this.currentSession.errorCount++;
    }

    // Save asynchronously (fire and forget for performance)
    this.store.saveLog(entry).catch((err) => {
      console.error('[NodeLogger] Failed to save log:', err);
    });
  }

  // =========================================================================
  // Session Management
  // =========================================================================

  /**
   * Start a new logging session
   * @param attributes - Optional session attributes
   * @returns Session ID
   */
  async startSession(attributes?: Record<string, unknown>): Promise<string> {
    if (!this.config.enableSessions) {
      throw new Error('Sessions are not enabled. Set enableSessions: true in config.');
    }

    // End current session if active
    if (this.currentSession) {
      await this.endSession();
    }

    const session: Session = {
      id: randomUUID(),
      startedAt: new Date().toISOString(),
      status: 'active',
      errorCount: 0,
      attributes,
    };

    await this.store.createSession(session);
    this.currentSession = session;

    return session.id;
  }

  /**
   * End the current session
   * @param status - Final session status
   */
  async endSession(status: 'ended' | 'crashed' = 'ended'): Promise<void> {
    if (!this.currentSession) return;

    const endedAt = new Date().toISOString();
    const duration =
      new Date(endedAt).getTime() -
      new Date(this.currentSession.startedAt).getTime();

    // Determine final status
    const finalStatus =
      status === 'crashed' || this.currentSession.errorCount > 0
        ? 'crashed'
        : 'ended';

    await this.store.updateSession(this.currentSession.id, {
      endedAt,
      duration,
      status: finalStatus,
      errorCount: this.currentSession.errorCount,
    });

    this.currentSession = null;
  }

  /**
   * Get the current session
   * @returns Current session or null
   */
  getCurrentSession(): Session | null {
    return this.currentSession;
  }

  /**
   * Set user info on the current session
   * @param user - User information
   */
  async setSessionUser(user: Session['user']): Promise<void> {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    this.currentSession.user = user;
    await this.store.updateSession(this.currentSession.id, { user });
  }

  // =========================================================================
  // Query Methods
  // =========================================================================

  /**
   * Get log entries matching filter
   * @param filter - Query filter
   * @returns Matching log entries
   */
  async getLogs(filter?: LogFilter): Promise<LogEntry[]> {
    return this.store.getLogs(filter);
  }

  /**
   * Get sessions matching filter
   * @param filter - Query filter
   * @returns Matching sessions
   */
  async getSessions(filter?: SessionFilter): Promise<Session[]> {
    return this.store.getSessions(filter);
  }

  /**
   * Get storage statistics
   * @returns Store stats
   */
  async getStats(): Promise<StoreStats> {
    return this.store.getStats();
  }

  // =========================================================================
  // Child Logger
  // =========================================================================

  /**
   * Create a child logger with additional default metadata
   * @param name - Child logger name
   * @param defaultMetadata - Default metadata for all logs from this child
   * @returns Child logger instance
   */
  child(name: string, defaultMetadata?: LogMetadata): Logger {
    const childConfig: LoggerConfig = {
      ...this.config,
      name: `${this.config.name}:${name}`,
      defaultMetadata: {
        ...this.config.defaultMetadata,
        ...defaultMetadata,
        tags: {
          ...this.config.defaultMetadata?.tags,
          ...defaultMetadata?.tags,
        },
        extra: {
          ...this.config.defaultMetadata?.extra,
          ...defaultMetadata?.extra,
        },
      },
    };

    const childLogger = new Logger(childConfig);

    // Share the session with parent
    if (this.currentSession) {
      childLogger.currentSession = this.currentSession;
    }

    return childLogger;
  }

  // =========================================================================
  // Utility Methods
  // =========================================================================

  /**
   * Set minimum log level
   * @param level - New minimum level
   */
  setMinLevel(level: LogLevel): void {
    this.config.minLevel = level;
  }

  /**
   * Get current minimum log level
   * @returns Current minimum level
   */
  getMinLevel(): LogLevel {
    return this.config.minLevel;
  }

  /**
   * Check if a level would be logged
   * @param level - Level to check
   * @returns true if would be logged
   */
  isLevelEnabled(level: LogLevel): boolean {
    return LOG_LEVEL_VALUES[level] <= LOG_LEVEL_VALUES[this.config.minLevel];
  }

  /**
   * Close the logger and its store
   */
  async close(): Promise<void> {
    if (this.currentSession) {
      await this.endSession();
    }
    await this.store.close();
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  /**
   * Merge metadata with defaults
   */
  private mergeMetadata(metadata?: LogMetadata): LogMetadata | undefined {
    if (!this.config.defaultMetadata && !metadata) {
      return undefined;
    }

    return {
      ...this.config.defaultMetadata,
      ...metadata,
      tags: {
        ...this.config.defaultMetadata?.tags,
        ...metadata?.tags,
      },
      extra: {
        ...this.config.defaultMetadata?.extra,
        ...metadata?.extra,
      },
    };
  }

  /**
   * Extract error info from an Error object
   */
  private extractErrorInfo(error: Error): ErrorInfo {
    const info: ErrorInfo = {
      type: error.name || error.constructor.name,
      message: error.message,
      stack: error.stack,
    };

    // Extract code if present
    if ('code' in error && error.code !== undefined) {
      info.code = error.code as string | number;
    }

    // Extract cause chain
    if (error.cause instanceof Error) {
      info.cause = this.extractErrorInfo(error.cause);
    }

    return info;
  }
}

/**
 * Create a logger with default configuration
 * @param store - Store provider
 * @param options - Additional options
 * @returns Configured logger
 */
export function createLogger(
  store: StoreProvider,
  options?: Partial<Omit<LoggerConfig, 'store'>>
): Logger {
  return new Logger({
    store,
    ...options,
  });
}
