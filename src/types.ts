/**
 * Core type definitions for NodeLogger
 *
 * @module types
 * @packageDocumentation
 */

/**
 * Log severity levels ordered from most to least severe
 */
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

/**
 * Numeric values for log levels (lower = more severe)
 */
export const LogLevelValue: Record<LogLevel, number> = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

/**
 * Metadata attached to log entries
 */
export interface LogMetadata {
  /** Additional tags for filtering */
  tags?: Record<string, string>;
  /** Arbitrary extra data */
  extra?: Record<string, unknown>;
  /** User information */
  user?: UserInfo;
  /** Request context */
  request?: RequestInfo;
  /** Error/exception data */
  error?: ErrorInfo;
  /** Trace correlation ID */
  traceId?: string;
  /** Span ID for distributed tracing */
  spanId?: string;
  /** Parent span ID */
  parentSpanId?: string;
}

/**
 * Sentry-compatible severity level
 */
export type SeverityLevel = 'fatal' | 'error' | 'warning' | 'log' | 'info' | 'debug';

/**
 * User information for attribution (Sentry-compatible)
 */
export interface UserInfo {
  /** Unique user identifier */
  id?: string | number;
  /** User email */
  email?: string;
  /** Username or handle */
  username?: string;
  /** IP address - use '{{auto}}' for auto-detection */
  ip_address?: string;
  /** @deprecated Use ip_address instead */
  ipAddress?: string;
  /** User segment for analytics (e.g., 'free', 'pro', 'enterprise') */
  segment?: string;
  /** Additional user data */
  [key: string]: unknown;
}

/**
 * HTTP request information
 */
export interface RequestInfo {
  /** Request URL */
  url?: string;
  /** HTTP method */
  method?: string;
  /** Request headers */
  headers?: Record<string, string>;
  /** Query string or params */
  query?: string | Record<string, string>;
  /** Request body */
  body?: unknown;
  /** Response status code */
  statusCode?: number;
  /** Request duration in ms */
  duration?: number;
}

/**
 * Error/exception information
 */
export interface ErrorInfo {
  /** Error type/class name */
  type: string;
  /** Error message */
  message: string;
  /** Stack trace */
  stack?: string;
  /** Error code */
  code?: string | number;
  /** Whether the error was handled */
  handled?: boolean;
  /** Cause chain */
  cause?: ErrorInfo;
}

/**
 * A single log entry stored in the backend
 */
export interface LogEntry {
  /** Unique log entry ID */
  id: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Log severity level */
  level: LogLevel;
  /** Log message */
  message: string;
  /** Logger name/category */
  logger?: string;
  /** Session ID */
  sessionId?: string;
  /** Metadata */
  metadata?: LogMetadata;
  /** Application/service name */
  service?: string;
  /** Environment (production, staging, etc.) */
  environment?: string;
  /** Release/version */
  release?: string;
  /** Host/server name */
  hostname?: string;
  /** Process ID */
  pid?: number;
}

/**
 * Session tracking data
 */
export interface Session {
  /** Unique session ID */
  id: string;
  /** Session start time (ISO 8601) */
  startedAt: string;
  /** Session end time (ISO 8601) */
  endedAt?: string;
  /** Session status */
  status: 'active' | 'ended' | 'crashed';
  /** Error count during session */
  errorCount: number;
  /** Session duration in ms */
  duration?: number;
  /** User info */
  user?: UserInfo;
  /** Session attributes */
  attributes?: Record<string, unknown>;
}

/**
 * Filter options for querying logs
 */
export interface LogFilter {
  /** Filter by log level(s) */
  level?: LogLevel | LogLevel[];
  /** Filter by session ID */
  sessionId?: string;
  /** Filter by logger name */
  logger?: string;
  /** Filter from this time (inclusive) */
  startTime?: string | Date;
  /** Filter to this time (inclusive) */
  endTime?: string | Date;
  /** Full-text search in message */
  search?: string;
  /** Filter by tags */
  tags?: Record<string, string>;
  /** Filter by trace ID */
  traceId?: string;
  /** Filter by service name */
  service?: string;
  /** Filter by environment */
  environment?: string;
  /** Maximum results to return */
  limit?: number;
  /** Skip this many results */
  offset?: number;
  /** Sort field */
  orderBy?: 'timestamp' | 'level';
  /** Sort direction */
  orderDirection?: 'asc' | 'desc';
}

/**
 * Filter options for querying sessions
 */
export interface SessionFilter {
  /** Filter by status */
  status?: Session['status'] | Session['status'][];
  /** Filter by user ID */
  userId?: string | number;
  /** Filter from this time */
  startTime?: string | Date;
  /** Filter to this time */
  endTime?: string | Date;
  /** Maximum results */
  limit?: number;
  /** Skip this many results */
  offset?: number;
}

/**
 * Configuration for store providers
 */
export interface StoreProviderConfig {
  /** Maximum log entries to retain */
  maxLogs?: number;
  /** Maximum sessions to retain */
  maxSessions?: number;
  /** Auto-cleanup interval in ms (0 to disable) */
  cleanupInterval?: number;
  /** Retention period in ms */
  retentionPeriod?: number;
}

/**
 * Store provider interface that all implementations must follow
 *
 * @remarks
 * Implement this interface to create custom storage backends.
 * All methods are async to support both sync and async stores.
 */
export interface StoreProvider {
  /** Provider name (e.g., 'sqlite', 'mongodb', 'memory') */
  readonly name: string;

  /**
   * Check if the store is ready for operations
   * @returns true if initialized and ready
   */
  isReady(): boolean;

  /**
   * Initialize the store provider
   * @throws Error if initialization fails
   */
  init(): Promise<void>;

  /**
   * Close the store and release resources
   */
  close(): Promise<void>;

  // Log operations

  /**
   * Save a log entry
   * @param entry - Log entry to save
   */
  saveLog(entry: LogEntry): Promise<void>;

  /**
   * Retrieve log entries matching filter
   * @param filter - Query filter
   * @returns Matching log entries
   */
  getLogs(filter?: LogFilter): Promise<LogEntry[]>;

  /**
   * Delete log entries matching filter
   * @param filter - Query filter (deletes all if not provided)
   */
  deleteLogs(filter?: LogFilter): Promise<number>;

  /**
   * Count log entries matching filter
   * @param filter - Query filter
   * @returns Number of matching entries
   */
  countLogs(filter?: LogFilter): Promise<number>;

  // Session operations

  /**
   * Create a new session
   * @param session - Session to create
   */
  createSession(session: Session): Promise<void>;

  /**
   * Update an existing session
   * @param sessionId - Session ID
   * @param updates - Partial session data to merge
   */
  updateSession(sessionId: string, updates: Partial<Session>): Promise<void>;

  /**
   * Get a session by ID
   * @param sessionId - Session ID
   * @returns Session or null if not found
   */
  getSession(sessionId: string): Promise<Session | null>;

  /**
   * Get sessions matching filter
   * @param filter - Query filter
   * @returns Matching sessions
   */
  getSessions(filter?: SessionFilter): Promise<Session[]>;

  /**
   * Delete a session and its logs
   * @param sessionId - Session ID to delete
   */
  deleteSession(sessionId: string): Promise<void>;

  // Maintenance operations

  /**
   * Run cleanup to remove old data
   * @param olderThan - Delete entries older than this date
   * @returns Number of deleted entries
   */
  cleanup(olderThan: Date): Promise<number>;

  /**
   * Get storage statistics
   * @returns Storage stats
   */
  getStats(): Promise<StoreStats>;
}

/**
 * Storage statistics
 */
export interface StoreStats {
  /** Total log entries */
  totalLogs: number;
  /** Total sessions */
  totalSessions: number;
  /** Active sessions */
  activeSessions: number;
  /** Logs by level */
  logsByLevel: Record<LogLevel, number>;
  /** Storage size in bytes (if available) */
  sizeBytes?: number;
  /** Oldest log timestamp */
  oldestLog?: string;
  /** Newest log timestamp */
  newestLog?: string;
}

/**
 * Logger configuration options
 */
export interface LoggerConfig {
  /** Store provider instance */
  store: StoreProvider;
  /** Default logger name */
  name?: string;
  /** Minimum log level to record */
  minLevel?: LogLevel;
  /** Service/application name */
  service?: string;
  /** Environment name */
  environment?: string;
  /** Release/version string */
  release?: string;
  /** Enable session tracking */
  enableSessions?: boolean;
  /** Default metadata for all logs */
  defaultMetadata?: Partial<LogMetadata>;
  /** Format log message before storing */
  formatMessage?: (message: string, ...args: unknown[]) => string;
}

// ============================================================================
// Sentry-Compatible Types
// ============================================================================

/**
 * Breadcrumb data structure (Sentry-compatible)
 */
export interface Breadcrumb {
  /** Breadcrumb type (default, http, navigation, ui, etc.) */
  type?: string;
  /** Category for grouping (ui.click, api, navigation, console, etc.) */
  category?: string;
  /** Human-readable message */
  message?: string;
  /** Severity level */
  level?: SeverityLevel;
  /** Unix timestamp in seconds (Sentry format) */
  timestamp?: number;
  /** Additional structured data */
  data?: Record<string, unknown>;
}

/**
 * Capture context for exceptions and messages (Sentry-compatible)
 *
 * @remarks
 * This matches Sentry's `CaptureContext` type for maximum compatibility.
 * Use with `captureException()` and `captureMessage()`.
 *
 * @example
 * ```typescript
 * captureException(error, {
 *   tags: { section: 'checkout', userId: '123' },
 *   extra: { orderId: 'abc', amount: 99.99 },
 *   level: 'error',
 *   fingerprint: ['checkout', 'payment-failed'],
 * });
 * ```
 */
export interface CaptureContext {
  /** Tags for filtering and searching in Sentry */
  tags?: Record<string, string>;
  /** Extra data attached to the event */
  extra?: Record<string, unknown>;
  /** User context */
  user?: UserInfo;
  /** Severity level (overrides default) */
  level?: SeverityLevel;
  /** Custom fingerprint for error grouping */
  fingerprint?: string[];
  /** Named contexts (e.g., 'browser', 'os', 'device') */
  contexts?: Record<string, Record<string, unknown>>;
}

/**
 * Exception value for SentryEvent (Sentry-compatible)
 */
export interface ExceptionValue {
  /** Exception type/class name */
  type: string;
  /** Exception message */
  value: string;
  /** Stack trace frames */
  stacktrace?: {
    frames: Array<{
      filename?: string;
      function?: string;
      lineno?: number;
      colno?: number;
      in_app?: boolean;
    }>;
  };
}

/**
 * Raw Sentry event structure (Sentry-compatible)
 *
 * @remarks
 * This is the low-level event format used by Sentry's captureEvent API.
 * Use this for maximum control over event data.
 *
 * @example
 * ```typescript
 * captureEvent({
 *   message: 'Manual event',
 *   level: 'info',
 *   tags: { source: 'manual' },
 *   extra: { customData: 'value' },
 * });
 * ```
 */
export interface SentryEvent {
  /** Unique event identifier (auto-generated if not provided) */
  event_id?: string;
  /** Event message */
  message?: string;
  /** Severity level */
  level?: SeverityLevel;
  /** Unix timestamp in seconds */
  timestamp?: number;
  /** Platform identifier (e.g., 'node', 'javascript') */
  platform?: string;
  /** Logger name/category */
  logger?: string;
  /** Server/host name */
  server_name?: string;
  /** Release/version string */
  release?: string;
  /** Environment name (production, staging, etc.) */
  environment?: string;
  /** Tags for filtering and searching */
  tags?: Record<string, string>;
  /** Extra data attached to the event */
  extra?: Record<string, unknown>;
  /** User context */
  user?: UserInfo;
  /** Named contexts (e.g., 'browser', 'os', 'device') */
  contexts?: Record<string, Record<string, unknown>>;
  /** Breadcrumb trail */
  breadcrumbs?: Breadcrumb[];
  /** Exception data */
  exception?: {
    values: ExceptionValue[];
  };
  /** Custom fingerprint for error grouping */
  fingerprint?: string[];
}

// ============================================================================
// Performance Monitoring Types (Sentry-compatible)
// ============================================================================

/**
 * Transaction status values (Sentry-compatible)
 */
export type TransactionStatus =
  | 'ok'
  | 'cancelled'
  | 'unknown'
  | 'invalid_argument'
  | 'deadline_exceeded'
  | 'not_found'
  | 'permission_denied'
  | 'internal_error';

/**
 * Measurement data for performance metrics
 */
export interface Measurement {
  /** The measurement value */
  value: number;
  /** Optional unit (e.g., 'millisecond', 'byte', 'percent') */
  unit?: string;
}

/**
 * Transaction interface for performance monitoring (Sentry-compatible)
 *
 * @remarks
 * Transactions represent a unit of work, such as an HTTP request or a task.
 * They can contain measurements and contextual data.
 *
 * @example
 * ```typescript
 * const transaction = startTransaction({ name: 'checkout', op: 'http.server' });
 * transaction.setMeasurement('ttfb', 250, 'millisecond');
 * // ... do work ...
 * transaction.finish();
 * ```
 */
export interface Transaction {
  /** Transaction name (e.g., 'checkout', '/api/users') */
  name: string;
  /** Operation type (e.g., 'http.server', 'db.query', 'task') */
  op?: string;
  /** Human-readable description */
  description?: string;
  /** Trace ID for distributed tracing (32 hex characters) */
  traceId: string;
  /** Span ID (16 hex characters) */
  spanId: string;
  /** Start timestamp in milliseconds since epoch */
  startTimestamp: number;
  /** End timestamp in milliseconds since epoch (set on finish) */
  endTimestamp?: number;
  /** Transaction status */
  status?: TransactionStatus;
  /** Tags for filtering */
  tags?: Record<string, string>;
  /** Arbitrary data */
  data?: Record<string, unknown>;
  /** Performance measurements */
  measurements?: Record<string, Measurement>;

  /**
   * Set a tag on the transaction
   * @param key - Tag key
   * @param value - Tag value
   */
  setTag(key: string, value: string): void;

  /**
   * Set arbitrary data on the transaction
   * @param key - Data key
   * @param value - Data value
   */
  setData(key: string, value: unknown): void;

  /**
   * Set a performance measurement
   * @param name - Measurement name (e.g., 'ttfb', 'fcp', 'memory')
   * @param value - Measurement value
   * @param unit - Optional unit (e.g., 'millisecond', 'byte')
   */
  setMeasurement(name: string, value: number, unit?: string): void;

  /**
   * Set the transaction status
   * @param status - Status value
   */
  setStatus(status: TransactionStatus): void;

  /**
   * Finish the transaction and calculate duration
   */
  finish(): void;
}

/**
 * Context for starting a transaction
 */
export interface TransactionContext {
  /** Transaction name */
  name: string;
  /** Operation type */
  op?: string;
  /** Description */
  description?: string;
  /** Initial tags */
  tags?: Record<string, string>;
}

// ============================================================================
// beforeSend Hooks (Sentry-compatible)
// ============================================================================

/**
 * Hint object passed to beforeSend for exception events
 */
export interface BeforeSendHint {
  /** The original exception that was captured */
  originalException?: Error;
}

/**
 * Hint object passed to beforeSendMessage for message events
 */
export interface BeforeSendMessageHint {
  /** The original message that was captured */
  originalMessage?: string;
}

/**
 * Hook called before sending an exception event (Sentry-compatible)
 *
 * @param event - The log entry about to be stored
 * @param hint - Additional context about the event
 * @returns The modified event, or null to drop the event
 *
 * @example
 * ```typescript
 * await Sentry.init('memory', {
 *   beforeSend(event, hint) {
 *     // Filter out certain errors
 *     if (hint?.originalException?.message?.includes('ignore')) {
 *       return null;
 *     }
 *     // Modify event data
 *     event.metadata = { ...event.metadata, processed: true };
 *     return event;
 *   },
 * });
 * ```
 */
export type BeforeSendHook = (
  event: LogEntry,
  hint?: BeforeSendHint
) => LogEntry | null;

/**
 * Hook called before sending a message event (Sentry-compatible)
 *
 * @param event - The log entry about to be stored
 * @param hint - Additional context about the event
 * @returns The modified event, or null to drop the event
 *
 * @example
 * ```typescript
 * await Sentry.init('memory', {
 *   beforeSendMessage(event, hint) {
 *     // Filter out sensitive messages
 *     if (event.message?.includes('password')) {
 *       return null;
 *     }
 *     return event;
 *   },
 * });
 * ```
 */
export type BeforeSendMessageHook = (
  event: LogEntry,
  hint?: BeforeSendMessageHint
) => LogEntry | null;
