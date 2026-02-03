/**
 * NodeLogger - Backend Logger with Pluggable Storage
 *
 * A lightweight, Sentry-compatible logger with multiple storage backends.
 * Implements the top 5 Sentry functions for Next.js production apps.
 *
 * @packageDocumentation
 *
 * @example Quick Start
 * ```typescript
 * import * as Sentry from '@nodelogger/core';
 *
 * // Initialize with SQLite storage
 * await Sentry.init('sqlite', { filename: './logs.db' });
 *
 * // 1. captureException - The Error Workhorse
 * try {
 *   await riskyOperation();
 * } catch (error) {
 *   Sentry.captureException(error, {
 *     tags: { section: 'payment', userId: '123' },
 *     extra: { endpoint: '/api/charge', amount: 99.99 },
 *     level: 'error',
 *   });
 * }
 *
 * // 2. captureMessage - Custom Alerts
 * Sentry.captureMessage('User reached payment limit', 'warning');
 * Sentry.captureMessage('High-value transaction', {
 *   level: 'info',
 *   tags: { transactionType: 'purchase' },
 *   extra: { amount: 5000 },
 * });
 *
 * // 3. setUser - User Context
 * Sentry.setUser({
 *   id: user.id,
 *   email: user.email,
 *   segment: user.subscriptionTier,
 *   ip_address: '{{auto}}',
 * });
 *
 * // 4. addBreadcrumb - Event Trail
 * Sentry.addBreadcrumb({
 *   category: 'navigation',
 *   message: 'Navigated to checkout',
 *   level: 'info',
 *   data: { from: '/cart', to: '/checkout' },
 * });
 *
 * // 5. withScope - Isolated Context
 * Sentry.withScope((scope) => {
 *   scope.setTag('transaction', 'payment');
 *   scope.setExtra('orderId', orderId);
 *   scope.setFingerprint(['payment', orderId]);
 *   Sentry.captureException(error);
 * });
 * ```
 */

// Browser-compatible UUID generation
function randomUUID(): string {
  // Use native crypto.randomUUID if available (Node.js 16+ or modern browsers)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  
  // Fallback for older environments
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

import { Logger, createLogger } from './logger.js';
import { MemoryStoreProvider } from './stores/memory.js';
import { ConsoleStoreProvider } from './stores/console.js';
import {
  Scope,
  getCurrentScope,
  getGlobalScope,
  getIsolationScope,
  configureScope,
  withScope as withScopeInternal,
  withScopeAsync,
  resetScopes,
  type Breadcrumb as ScopeBreadcrumb,
  type CaptureContext as ScopeCaptureContext,
  type SeverityLevel,
} from './scope.js';
import type {
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
  BeforeSendHint,
  BeforeSendMessageHint,
  SentryEvent,
  Transaction as TransactionInterface,
  TransactionContext,
  TransactionStatus,
  Measurement,
} from './types.js';

// ============================================================================
// Global Singleton Logger
// ============================================================================

let _instance: Logger | null = null;
let _store: StoreProvider | null = null;
let _beforeSend: BeforeSendHook | null = null;
let _beforeSendMessage: BeforeSendMessageHook | null = null;
let _ignoreErrors: (string | RegExp)[] = [];
let _sampleRate: number = 1.0;
let _messagesSampleRate: number = 1.0;
let _activeTransaction: Transaction | null = null;

/**
 * Provider type for quick initialization
 */
export type ProviderType = 'memory' | 'console';

/**
 * Initialization options
 */
export interface InitOptions {
  /** Service/application name */
  service?: string;
  /** Environment (production, staging, development) */
  environment?: string;
  /** Release/version string */
  release?: string;
  /** Minimum log level */
  minLevel?: LogLevel;
  /** Enable session tracking */
  enableSessions?: boolean;
  /** Default metadata for all logs */
  defaultMetadata?: LogMetadata;
  /** Debug mode - logs SDK internals */
  debug?: boolean;
  /** Patterns to match error messages that should be ignored. Strings or RegExp. */
  ignoreErrors?: (string | RegExp)[];
  /** Sample rate for error events (0.0 to 1.0). Default 1.0 (100%). */
  sampleRate?: number;
  /** Sample rate for message events (0.0 to 1.0). Default 1.0 (100%). */
  messagesSampleRate?: number;
  /** Called before sending exception event. Return null to drop the event. */
  beforeSend?: BeforeSendHook;
  /** Called before sending message event. Return null to drop the event. */
  beforeSendMessage?: BeforeSendMessageHook;
}

/**
 * Initialize the global logger singleton
 *
 * @param provider - Storage provider type ('memory', 'console')
 * @param options - Configuration options
 *
 * @example
 * ```typescript
 * // Memory (development/testing)
 * await init('memory');
 *
 * // Console (colorful output)
 * await init('console');
 * ```
 */
export async function init(
  provider: ProviderType = 'memory',
  options: InitOptions = {}
): Promise<void> {
  // Close existing instance if any
  if (_instance) {
    await close();
  }

  // Reset scopes
  resetScopes();

  // Create store based on provider type
  switch (provider) {
    case 'console':
      _store = new ConsoleStoreProvider();
      break;

    case 'memory':
    default:
      _store = new MemoryStoreProvider();
      break;
  }

  await _store.init();

  // Create logger instance
  _instance = new Logger({
    store: _store,
    service: options.service,
    environment: options.environment ?? (typeof process !== 'undefined' ? process.env.NODE_ENV : undefined) ?? 'development',
    release: options.release,
    minLevel: options.minLevel ?? 'info',
    enableSessions: options.enableSessions ?? false,
    defaultMetadata: options.defaultMetadata,
  });

  // Store ignoreErrors patterns
  _ignoreErrors = options.ignoreErrors ?? [];

  // Store sample rates
  _sampleRate = options.sampleRate ?? 1.0;
  _messagesSampleRate = options.messagesSampleRate ?? 1.0;

  // Store beforeSend hooks
  _beforeSend = options.beforeSend ?? null;
  _beforeSendMessage = options.beforeSendMessage ?? null;

  if (options.debug) {
    console.log('[NodeLogger] Initialized with provider:', provider);
  }
}

/**
 * Create a new logger instance with its own store
 *
 * Factory function for creating isolated logger instances.
 *
 * @param provider - Storage provider type
 * @param options - Configuration options
 * @returns Logger instance
 */
export async function create(
  provider: ProviderType = 'memory',
  options: InitOptions = {}
): Promise<Logger> {
  let store: StoreProvider;

  switch (provider) {
    case 'console':
      store = new ConsoleStoreProvider();
      break;

    case 'memory':
    default:
      store = new MemoryStoreProvider();
      break;
  }

  await store.init();

  return new Logger({
    store,
    service: options.service,
    environment: options.environment ?? (typeof process !== 'undefined' ? process.env.NODE_ENV : undefined) ?? 'development',
    release: options.release,
    minLevel: options.minLevel ?? 'info',
    enableSessions: options.enableSessions ?? false,
    defaultMetadata: options.defaultMetadata,
  });
}

/**
 * Close the global logger and release resources
 */
export async function close(): Promise<void> {
  if (_instance) {
    await _instance.close();
    _instance = null;
  }
  if (_store) {
    _store = null;
  }
  _ignoreErrors = [];
  _sampleRate = 1.0;
  _messagesSampleRate = 1.0;
  _beforeSend = null;
  _beforeSendMessage = null;
  _activeTransaction = null;
  resetScopes();
}

/**
 * Check if the global logger is initialized
 */
export function isInitialized(): boolean {
  return _instance !== null && _store !== null && _store.isReady();
}

// ============================================================================
// TOP 5 SENTRY FUNCTIONS FOR PRODUCTION APPS
// ============================================================================

// ----------------------------------------------------------------------------
// 1. captureException() - The Error Workhorse
// ----------------------------------------------------------------------------

/**
 * Capture an exception (Sentry-compatible)
 *
 * This is the most used Sentry function. It captures errors with full stack
 * traces and context information.
 *
 * @param error - Error object or error message string
 * @param captureContext - Additional context (tags, extra, level, fingerprint)
 * @returns Event ID (UUID)
 *
 * @example Basic usage
 * ```typescript
 * try {
 *   await riskyOperation();
 * } catch (error) {
 *   Sentry.captureException(error);
 * }
 * ```
 *
 * @example With full context (production pattern)
 * ```typescript
 * try {
 *   await fetchUserProfile(userId);
 * } catch (error) {
 *   Sentry.captureException(error, {
 *     tags: {
 *       section: 'user-profile',
 *       userId,
 *     },
 *     extra: {
 *       endpoint: '/api/users/profile',
 *       timestamp: Date.now(),
 *     },
 *     level: 'error',
 *   });
 * }
 * ```
 */
export function captureException(
  error: Error | string | unknown,
  captureContext?: CaptureContext
): string {
  ensureInitialized();

  // Handle null/undefined gracefully like Sentry
  if (error == null) {
    return '';
  }

  // Apply sampling - return empty string if event is dropped
  if (Math.random() >= _sampleRate) {
    return '';
  }

  const eventId = randomUUID();

  // Convert error to Error object if string
  const err = typeof error === 'string' ? new Error(error) : (error as Error);

  // Check if this error should be ignored based on ignoreErrors patterns
  const errorMessage = err?.message ?? String(error);
  if (shouldIgnoreError(errorMessage)) {
    return eventId;
  }

  const scope = getCurrentScope();

  // Apply capture context to a temporary scope
  const tempScope = new Scope(scope);
  if (captureContext) {
    tempScope.applyContext(captureContext as ScopeCaptureContext);
  }

  // Determine level
  const level = mapSeverityToLogLevel(captureContext?.level ?? 'error');

  // Build metadata from scope
  const metadata = tempScope.toMetadata();

  // Attach traceId and spanId from active transaction if present
  if (_activeTransaction) {
    metadata.traceId = _activeTransaction.traceId;
    metadata.spanId = _activeTransaction.spanId;
  }

  // Build event for beforeSend hook
  let event: LogEntry = {
    id: eventId,
    timestamp: new Date().toISOString(),
    level,
    message: err.message,
    metadata: {
      ...metadata,
      error: {
        type: err.name,
        message: err.message,
        stack: err.stack,
      },
    },
  };

  // Call beforeSend hook if set
  if (_beforeSend) {
    const result = _beforeSend(event, { originalException: err });
    if (result === null) {
      // Event was dropped
      return '';
    }
    event = result;
  }

  // Log the exception using the (possibly modified) event data
  _instance!.exception(err, undefined, event.metadata);

  return eventId;
}

// ----------------------------------------------------------------------------
// 2. captureMessage() - Custom Alerts
// ----------------------------------------------------------------------------

/**
 * Capture a message (Sentry-compatible)
 *
 * Used for logging important events that aren't errors but need visibility,
 * such as security events or business logic anomalies.
 *
 * @param message - Message to capture
 * @param captureContextOrLevel - Severity level string OR full context object
 * @returns Event ID (UUID)
 *
 * @example Simple message
 * ```typescript
 * Sentry.captureMessage('User reached payment limit');
 * ```
 *
 * @example With severity level
 * ```typescript
 * Sentry.captureMessage('Suspicious login attempt detected', 'warning');
 * ```
 *
 * @example With full context
 * ```typescript
 * Sentry.captureMessage('High-value transaction completed', {
 *   level: 'info',
 *   tags: {
 *     transactionType: 'purchase',
 *     amount: 'high',
 *   },
 *   extra: {
 *     orderId,
 *     amount: 5000,
 *     userTier: 'premium',
 *   },
 * });
 * ```
 */
export function captureMessage(
  message: string,
  captureContextOrLevel?: CaptureContext | SeverityLevel
): string {
  ensureInitialized();

  // Apply sampling - return empty string if event is dropped
  if (Math.random() >= _messagesSampleRate) {
    return '';
  }

  const eventId = randomUUID();
  const scope = getCurrentScope();

  let level: LogLevel = 'info';
  let captureContext: CaptureContext | undefined;

  // Handle overloaded parameter
  if (typeof captureContextOrLevel === 'string') {
    // It's a severity level
    level = mapSeverityToLogLevel(captureContextOrLevel);
  } else if (captureContextOrLevel) {
    // It's a full context object
    captureContext = captureContextOrLevel;
    if (captureContext.level) {
      level = mapSeverityToLogLevel(captureContext.level);
    }
  }

  // Apply capture context to a temporary scope
  const tempScope = new Scope(scope);
  if (captureContext) {
    tempScope.applyContext(captureContext as ScopeCaptureContext);
  }

  // Build metadata from scope
  const metadata = tempScope.toMetadata();

  // Attach traceId and spanId from active transaction if present
  if (_activeTransaction) {
    metadata.traceId = _activeTransaction.traceId;
    metadata.spanId = _activeTransaction.spanId;
  }

  // Build event for beforeSendMessage hook
  let event: LogEntry = {
    id: eventId,
    timestamp: new Date().toISOString(),
    level,
    message,
    metadata,
  };

  // Call beforeSendMessage hook if set
  if (_beforeSendMessage) {
    const result = _beforeSendMessage(event, { originalMessage: message });
    if (result === null) {
      // Event was dropped
      return '';
    }
    event = result;
  }

  // Log the message using the (possibly modified) event data
  _instance!.log(event.level, event.message, event.metadata);

  return eventId;
}

// ----------------------------------------------------------------------------
// 3. setUser() - User Context
// ----------------------------------------------------------------------------

/**
 * Set user context (Sentry-compatible)
 *
 * Essential for tracking which users are affected by errors.
 * Critical for production debugging.
 *
 * @param user - User info or null to clear
 *
 * @example After user authentication
 * ```typescript
 * function setSentryUser(user: User) {
 *   Sentry.setUser({
 *     id: user.id,
 *     email: user.email,
 *     username: user.username,
 *     ip_address: '{{auto}}', // Auto-detect IP
 *   });
 * }
 * ```
 *
 * @example On logout
 * ```typescript
 * function clearSentryUser() {
 *   Sentry.setUser(null);
 * }
 * ```
 *
 * @example With segment data
 * ```typescript
 * Sentry.setUser({
 *   id: user.id,
 *   email: user.email,
 *   segment: user.subscriptionTier, // 'free' | 'pro' | 'enterprise'
 *   plan: user.planType,
 * });
 * ```
 */
export function setUser(user: UserInfo | null): void {
  ensureInitialized();

  // Handle {{auto}} IP address
  if (user && user.ip_address === '{{auto}}') {
    // In a real backend scenario, you'd get this from the request
    // For now, we just leave it as a marker
    user = { ...user, ip_address: '{{auto}}' };
  }

  // Set on global scope
  getGlobalScope().setUser(user);
  getCurrentScope().setUser(user);

  // Also update logger default metadata
  if (!_instance!['config'].defaultMetadata) {
    _instance!['config'].defaultMetadata = {};
  }

  if (user === null) {
    delete _instance!['config'].defaultMetadata.user;
  } else {
    _instance!['config'].defaultMetadata.user = user;
  }
}

// ----------------------------------------------------------------------------
// 4. addBreadcrumb() - Event Trail
// ----------------------------------------------------------------------------

/**
 * Add a breadcrumb (Sentry-compatible)
 *
 * Creates a trail of events leading up to an error.
 * Invaluable for understanding what happened before a crash.
 *
 * @param breadcrumb - Breadcrumb data
 *
 * @example Navigation breadcrumb
 * ```typescript
 * function trackNavigation(url: string) {
 *   Sentry.addBreadcrumb({
 *     category: 'navigation',
 *     message: `Navigated to ${url}`,
 *     level: 'info',
 *     data: {
 *       from: window.location.pathname,
 *       to: url,
 *     },
 *   });
 * }
 * ```
 *
 * @example API call breadcrumb
 * ```typescript
 * Sentry.addBreadcrumb({
 *   category: 'api',
 *   message: 'API request started',
 *   level: 'info',
 *   data: { endpoint, method: 'GET' },
 * });
 * ```
 *
 * @example User action breadcrumb
 * ```typescript
 * Sentry.addBreadcrumb({
 *   category: 'ui.click',
 *   message: 'User clicked checkout button',
 *   level: 'info',
 *   data: {
 *     cartItems: 5,
 *     totalAmount: 129.99,
 *   },
 * });
 * ```
 */
export function addBreadcrumb(breadcrumb: Breadcrumb): void {
  ensureInitialized();

  // Add timestamp if not provided (Sentry uses seconds since epoch)
  const crumb: ScopeBreadcrumb = {
    ...breadcrumb,
    timestamp: breadcrumb.timestamp ?? Date.now() / 1000,
  };

  // Add to both global and current scope
  getGlobalScope().addBreadcrumb(crumb);
  getCurrentScope().addBreadcrumb(crumb);
}

// ----------------------------------------------------------------------------
// 5. withScope() - Isolated Context
// ----------------------------------------------------------------------------

/**
 * Run code with an isolated scope (Sentry-compatible)
 *
 * Creates a temporary scope that doesn't pollute the global scope.
 * This is the preferred way to add context to specific errors.
 *
 * @param callback - Function to run with isolated scope
 * @returns Result of the callback
 *
 * @example Basic usage
 * ```typescript
 * function processPayment(orderId: string, amount: number) {
 *   return Sentry.withScope((scope) => {
 *     scope.setTag('transaction', 'payment');
 *     scope.setExtra('orderId', orderId);
 *     scope.setExtra('amount', amount);
 *     scope.setFingerprint(['payment', orderId]);
 *
 *     try {
 *       return executePayment(orderId, amount);
 *     } catch (error) {
 *       Sentry.captureException(error);
 *       throw error;
 *     }
 *   });
 * }
 * ```
 *
 * @example Async operations
 * ```typescript
 * async function handleUserAction(userId: string, action: string) {
 *   return Sentry.withScope(async (scope) => {
 *     scope.setUser({ id: userId });
 *     scope.setTag('action', action);
 *
 *     const result = await performAction(userId, action);
 *     return result;
 *   });
 * }
 * ```
 */
export function withScope<T>(callback: (scope: Scope) => T): T {
  return withScopeInternal(callback);
}

// ============================================================================
// Additional Sentry-Compatible Functions
// ============================================================================

/**
 * Configure the global scope (Sentry-compatible)
 *
 * Modifies the global scope that affects all future events.
 * Use sparingly - prefer withScope for isolated context.
 *
 * @param callback - Function to configure the scope
 *
 * @example
 * ```typescript
 * Sentry.configureScope((scope) => {
 *   scope.setTag('environment', 'production');
 *   scope.setTag('release', process.env.APP_VERSION);
 * });
 * ```
 */
export { configureScope };

// ----------------------------------------------------------------------------
// captureEvent() - Low-level Event Capture
// ----------------------------------------------------------------------------

/**
 * Capture a raw event (Sentry-compatible)
 *
 * This is a low-level function that captures a raw event object.
 * Use this for maximum control over event data, such as manually constructed
 * exception events or custom event formats.
 *
 * @param event - The raw Sentry event object
 * @returns Event ID (UUID)
 *
 * @example Basic message event
 * ```typescript
 * Sentry.captureEvent({
 *   message: 'Manual event',
 *   level: 'info',
 *   tags: { source: 'manual' },
 * });
 * ```
 *
 * @example Exception event
 * ```typescript
 * Sentry.captureEvent({
 *   message: 'Something went wrong',
 *   level: 'error',
 *   exception: {
 *     values: [{
 *       type: 'Error',
 *       value: 'Connection failed',
 *       stacktrace: { frames: [] },
 *     }],
 *   },
 * });
 * ```
 *
 * @example With full context
 * ```typescript
 * Sentry.captureEvent({
 *   message: 'Custom event',
 *   level: 'warning',
 *   tags: { module: 'payments' },
 *   extra: { orderId: '123', amount: 99.99 },
 *   user: { id: 'user-123', email: 'user@example.com' },
 *   contexts: {
 *     payment: { processor: 'stripe', status: 'failed' },
 *   },
 *   fingerprint: ['payment', 'stripe', 'failed'],
 * });
 * ```
 */
export function captureEvent(event: SentryEvent): string {
  ensureInitialized();

  // Generate event_id if not provided
  const eventId = event.event_id ?? randomUUID();

  // Get current scope
  const scope = getCurrentScope();

  // Create a temporary scope starting from current scope
  const tempScope = new Scope(scope);

  // Apply event data to scope (event data takes precedence over scope)
  if (event.tags) {
    tempScope.setTags(event.tags);
  }
  if (event.extra) {
    tempScope.setExtras(event.extra);
  }
  if (event.user) {
    tempScope.setUser(event.user);
  }
  if (event.level) {
    tempScope.setLevel(event.level);
  }
  if (event.fingerprint) {
    tempScope.setFingerprint(event.fingerprint);
  }
  if (event.contexts) {
    for (const [name, ctx] of Object.entries(event.contexts)) {
      tempScope.setContext(name, ctx);
    }
  }
  if (event.breadcrumbs) {
    for (const crumb of event.breadcrumbs) {
      tempScope.addBreadcrumb(crumb);
    }
  }

  // Build metadata from scope
  const metadata = tempScope.toMetadata();

  // Determine log level
  const level = mapSeverityToLogLevel(event.level ?? 'info');

  // Determine message
  let message = event.message ?? '';

  // If there's an exception, handle it
  if (event.exception?.values?.length) {
    const exc = event.exception.values[0];
    const excMessage = exc.value || exc.type || 'Unknown error';

    // Store exception info in metadata
    metadata.error = {
      type: exc.type,
      message: exc.value,
      stack: exc.stacktrace?.frames
        ? exc.stacktrace.frames
            .map(
              (f) =>
                `    at ${f.function || '<anonymous>'} (${f.filename || 'unknown'}:${f.lineno || 0}:${f.colno || 0})`
            )
            .join('\n')
        : undefined,
    };

    // If no message provided, use exception message
    if (!message) {
      message = `${exc.type}: ${excMessage}`;
    }
  }

  // Ensure we have some message
  if (!message) {
    message = 'Event captured';
  }

  // Log the event
  _instance!.log(level, message, metadata);

  return eventId;
}

/**
 * Set a single tag on the global scope
 */
export function setTag(key: string, value: string): void {
  ensureInitialized();
  getGlobalScope().setTag(key, value);
  getCurrentScope().setTag(key, value);

  // Also update logger default metadata
  if (!_instance!['config'].defaultMetadata) {
    _instance!['config'].defaultMetadata = {};
  }
  if (!_instance!['config'].defaultMetadata.tags) {
    _instance!['config'].defaultMetadata.tags = {};
  }
  _instance!['config'].defaultMetadata.tags[key] = value;
}

/**
 * Set multiple tags
 */
export function setTags(tags: Record<string, string>): void {
  for (const [key, value] of Object.entries(tags)) {
    setTag(key, value);
  }
}

/**
 * Set extra data on the global scope
 */
export function setExtra(key: string, value: unknown): void {
  ensureInitialized();
  getGlobalScope().setExtra(key, value);
  getCurrentScope().setExtra(key, value);

  // Also update logger default metadata
  if (!_instance!['config'].defaultMetadata) {
    _instance!['config'].defaultMetadata = {};
  }
  if (!_instance!['config'].defaultMetadata.extra) {
    _instance!['config'].defaultMetadata.extra = {};
  }
  _instance!['config'].defaultMetadata.extra[key] = value;
}

/**
 * Set multiple extras
 */
export function setExtras(extras: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(extras)) {
    setExtra(key, value);
  }
}

/**
 * Set a named context (Sentry-compatible)
 *
 * @param name - Context name (e.g., 'browser', 'os', 'device', 'custom')
 * @param context - Context data or null to clear
 *
 * @example
 * ```typescript
 * Sentry.setContext('payment', {
 *   processor: 'stripe',
 *   orderId: '12345',
 *   amount: 99.99,
 * });
 * ```
 */
export function setContext(
  name: string,
  context: Record<string, unknown> | null
): void {
  ensureInitialized();
  getGlobalScope().setContext(name, context);
  getCurrentScope().setContext(name, context);
}

// ============================================================================
// Classic Logging API
// ============================================================================

/**
 * Log a fatal error
 */
export function fatal(message: string, metadata?: LogMetadata): void {
  ensureInitialized();
  _instance!.fatal(message, mergeWithScopeMetadata(metadata));
}

/**
 * Log an error
 */
export function error(message: string, metadata?: LogMetadata): void {
  ensureInitialized();
  _instance!.error(message, mergeWithScopeMetadata(metadata));
}

/**
 * Log a warning
 */
export function warn(message: string, metadata?: LogMetadata): void {
  ensureInitialized();
  _instance!.warn(message, mergeWithScopeMetadata(metadata));
}

/**
 * Log an info message
 */
export function info(message: string, metadata?: LogMetadata): void {
  ensureInitialized();
  _instance!.info(message, mergeWithScopeMetadata(metadata));
}

/**
 * Log a debug message
 */
export function debug(message: string, metadata?: LogMetadata): void {
  ensureInitialized();
  _instance!.debug(message, mergeWithScopeMetadata(metadata));
}

/**
 * Log a trace message
 */
export function trace(message: string, metadata?: LogMetadata): void {
  ensureInitialized();
  _instance!.trace(message, mergeWithScopeMetadata(metadata));
}

/**
 * Log an exception
 */
export function exception(
  err: Error,
  message?: string,
  metadata?: LogMetadata
): void {
  ensureInitialized();
  _instance!.exception(err, message, mergeWithScopeMetadata(metadata));
}

/**
 * Generic log method
 */
export function log(level: LogLevel, message: string, metadata?: LogMetadata): void {
  ensureInitialized();
  _instance!.log(level, message, mergeWithScopeMetadata(metadata));
}

// ============================================================================
// Session Management
// ============================================================================

export async function startSession(
  attributes?: Record<string, unknown>
): Promise<string> {
  ensureInitialized();
  return _instance!.startSession(attributes);
}

export async function endSession(status?: 'ended' | 'crashed'): Promise<void> {
  ensureInitialized();
  await _instance!.endSession(status);
}

export function getCurrentSession(): Session | null {
  if (!_instance) return null;
  return _instance.getCurrentSession();
}

// ============================================================================
// Query Methods
// ============================================================================

export async function getLogs(filter?: LogFilter): Promise<LogEntry[]> {
  ensureInitialized();
  return _instance!.getLogs(filter);
}

export async function getSessions(filter?: SessionFilter): Promise<Session[]> {
  ensureInitialized();
  return _instance!.getSessions(filter);
}

export async function getStats(): Promise<StoreStats> {
  ensureInitialized();
  return _instance!.getStats();
}

// ============================================================================
// Configuration
// ============================================================================

export function setMinLevel(level: LogLevel): void {
  ensureInitialized();
  _instance!.setMinLevel(level);
}

export function getMinLevel(): LogLevel {
  ensureInitialized();
  return _instance!.getMinLevel();
}

export function isLevelEnabled(level: LogLevel): boolean {
  if (!_instance) return false;
  return _instance.isLevelEnabled(level);
}

export function child(name: string, defaultMetadata?: LogMetadata): Logger {
  ensureInitialized();
  return _instance!.child(name, defaultMetadata);
}

// ============================================================================
// Helpers
// ============================================================================

function ensureInitialized(): void {
  if (!_instance || !_store) {
    throw new Error(
      'NodeLogger not initialized. Call init() first.'
    );
  }
}

/**
 * Check if an error message matches any ignoreErrors pattern
 */
function shouldIgnoreError(message: string): boolean {
  for (const pattern of _ignoreErrors) {
    if (typeof pattern === 'string') {
      // Substring match for strings
      if (message.includes(pattern)) {
        return true;
      }
    } else if (pattern instanceof RegExp) {
      // RegExp match
      if (pattern.test(message)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Map Sentry severity level to LogLevel
 */
function mapSeverityToLogLevel(severity: SeverityLevel): LogLevel {
  switch (severity) {
    case 'fatal':
      return 'fatal';
    case 'error':
      return 'error';
    case 'warning':
      return 'warn';
    case 'log':
    case 'info':
      return 'info';
    case 'debug':
      return 'debug';
    default:
      return 'info';
  }
}

/**
 * Generate a random hex ID of specified length
 */
function generateHexId(length: number): string {
  const bytes = new Uint8Array(length / 2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ============================================================================
// Performance Monitoring - Transaction Class
// ============================================================================

/**
 * Transaction implementation for performance monitoring (Sentry-compatible)
 *
 * @remarks
 * Transactions represent a unit of work and can contain measurements
 * and contextual data. Logs captured during an active transaction
 * automatically get traceId and spanId attached.
 *
 * @example
 * ```typescript
 * const transaction = Sentry.startTransaction({ name: 'checkout', op: 'http.server' });
 * transaction.setMeasurement('ttfb', 250, 'millisecond');
 * // ... do work ...
 * transaction.finish();
 * ```
 */
export class Transaction implements TransactionInterface {
  name: string;
  op?: string;
  description?: string;
  traceId: string;
  spanId: string;
  startTimestamp: number;
  endTimestamp?: number;
  status?: TransactionStatus;
  tags?: Record<string, string>;
  data?: Record<string, unknown>;
  measurements?: Record<string, Measurement>;

  constructor(context: TransactionContext) {
    this.name = context.name;
    this.op = context.op;
    this.description = context.description;
    this.tags = context.tags ? { ...context.tags } : {};
    this.data = {};
    this.measurements = {};
    this.traceId = generateHexId(32);
    this.spanId = generateHexId(16);
    this.startTimestamp = Date.now();
  }

  /**
   * Set a tag on the transaction
   */
  setTag(key: string, value: string): void {
    if (!this.tags) {
      this.tags = {};
    }
    this.tags[key] = value;
  }

  /**
   * Set arbitrary data on the transaction
   */
  setData(key: string, value: unknown): void {
    if (!this.data) {
      this.data = {};
    }
    this.data[key] = value;
  }

  /**
   * Set a performance measurement
   */
  setMeasurement(name: string, value: number, unit?: string): void {
    if (!this.measurements) {
      this.measurements = {};
    }
    this.measurements[name] = { value, unit };
  }

  /**
   * Set the transaction status
   */
  setStatus(status: TransactionStatus): void {
    this.status = status;
  }

  /**
   * Finish the transaction and calculate duration
   */
  finish(): void {
    this.endTimestamp = Date.now();

    // Clear the active transaction if this is it
    if (_activeTransaction === this) {
      _activeTransaction = null;
    }

    // Set status to 'ok' if not already set
    if (!this.status) {
      this.status = 'ok';
    }
  }
}

/**
 * Start a new transaction for performance monitoring (Sentry-compatible)
 *
 * @param context - Transaction context with name and optional operation type
 * @returns Transaction object with methods to add measurements and finish
 *
 * @example
 * ```typescript
 * const transaction = Sentry.startTransaction({
 *   name: 'checkout',
 *   op: 'http.server',
 * });
 * transaction.setMeasurement('ttfb', 250, 'millisecond');
 * // ... do work ...
 * transaction.finish();
 * ```
 */
export function startTransaction(context: TransactionContext): Transaction {
  const transaction = new Transaction(context);
  _activeTransaction = transaction;
  return transaction;
}

/**
 * Get the currently active transaction (if any)
 *
 * @returns The active transaction or null
 */
export function getActiveTransaction(): Transaction | null {
  return _activeTransaction;
}

/**
 * Merge provided metadata with scope metadata and active transaction context
 */
function mergeWithScopeMetadata(metadata?: LogMetadata): LogMetadata {
  const scopeMetadata = getCurrentScope().toMetadata();

  // Start with scope metadata
  const result: LogMetadata = {
    ...scopeMetadata,
    ...metadata,
    tags: {
      ...scopeMetadata.tags,
      ...metadata?.tags,
    },
    extra: {
      ...scopeMetadata.extra,
      ...metadata?.extra,
    },
  };

  // Attach traceId and spanId from active transaction if present
  if (_activeTransaction) {
    result.traceId = _activeTransaction.traceId;
    result.spanId = _activeTransaction.spanId;
  }

  return result;
}

// ============================================================================
// Re-exports
// ============================================================================

// Core classes
export { Logger, createLogger } from './logger.js';
export { Scope } from './scope.js';

// Store providers
export { MemoryStoreProvider, type MemoryStoreConfig } from './stores/memory.js';
export { ConsoleStoreProvider, type ConsoleStoreConfig } from './stores/console.js';
export { BaseStoreProvider } from './stores/base.js';

// Scope utilities
export {
  getCurrentScope,
  getGlobalScope,
  getIsolationScope,
  withScopeAsync,
} from './scope.js';

// Types
export type {
  LogLevel,
  LogEntry,
  LogMetadata,
  Session,
  StoreProvider,
  StoreProviderConfig,
  StoreStats,
  LogFilter,
  SessionFilter,
  LoggerConfig,
  UserInfo,
  RequestInfo,
  ErrorInfo,
  Breadcrumb,
  CaptureContext,
  SeverityLevel,
  SentryEvent,
  ExceptionValue,
  TransactionContext,
  TransactionStatus,
  Measurement,
  BeforeSendHook,
  BeforeSendMessageHook,
  BeforeSendHint,
  BeforeSendMessageHint,
} from './types.js';

export { LogLevelValue } from './types.js';
export type { Transaction as TransactionInterface } from './types.js';

// Default export for convenience (Sentry-style)
export default {
  // Initialization
  init,
  create,
  close,
  isInitialized,

  // Top 5 Sentry Functions
  captureException,
  captureMessage,
  setUser,
  addBreadcrumb,
  withScope,

  // Additional Sentry Functions
  configureScope,
  captureEvent,
  setTag,
  setTags,
  setExtra,
  setExtras,
  setContext,

  // Classic Logging API
  fatal,
  error,
  warn,
  info,
  debug,
  trace,
  exception,
  log,

  // Sessions
  startSession,
  endSession,
  getCurrentSession,

  // Queries
  getLogs,
  getSessions,
  getStats,

  // Config
  setMinLevel,
  getMinLevel,
  isLevelEnabled,
  child,

  // Scope Access
  getCurrentScope,
  getGlobalScope,
  getIsolationScope,

  // Performance Monitoring
  startTransaction,
  getActiveTransaction,
  Transaction,
};
