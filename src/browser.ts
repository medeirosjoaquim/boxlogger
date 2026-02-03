/**
 * Browser-safe entry point
 * Only exports console and memory providers (no SQLite)
 */

export * from './index.js';

// Re-export everything except SQLite-related types
export type { 
  LogLevel,
  LogMetadata,
  LogEntry,
  Session,
  StoreProvider,
  StoreStats,
  LogFilter,
  SessionFilter,
  LoggerConfig,
  UserInfo,
  RequestInfo,
  ErrorInfo,
  Breadcrumb,
  CaptureContext,
  BeforeSendHook,
  BeforeSendMessageHook,
  SentryEvent,
  Transaction,
  TransactionContext,
  TransactionStatus,
  Measurement,
  SeverityLevel,
} from './types.js';

export type { MemoryStoreConfig } from './stores/memory.js';
export type { ConsoleStoreConfig } from './stores/console.js';

// Note: SQLiteStoreConfig is not exported to avoid importing sqlite module
