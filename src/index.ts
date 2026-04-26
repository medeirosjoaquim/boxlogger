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
 * import * as Sentry from '@johnboxcodes/boxlogger';
 *
 * // Initialize with Console storage
 * await Sentry.init('console', { service: 'my-app' });
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
  withIsolationScope as withIsolationScopeInternal,
  withIsolationScopeAsync,
  addGlobalEventProcessor,
  getGlobalEventProcessors,
  resetScopes,
  type Breadcrumb as ScopeBreadcrumb,
  type CaptureContext as ScopeCaptureContext,
  type SeverityLevel,
  type EventProcessor,
  type EventHint,
  type Attachment,
  type PropagationContext,
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
let _denyUrls: (string | RegExp)[] = [];
let _allowUrls: (string | RegExp)[] = [];
let _sampleRate: number = 1.0;
let _messagesSampleRate: number = 1.0;
let _tracesSampleRate: number = 0;
let _activeTransaction: Transaction | null = null;
let _lastEventId: string = '';
let _dsn: string | undefined;
let _integrations: SentryIntegration[] = [];
let _initOptions: InitOptions = {};

/**
 * Provider type for quick initialization
 */
export type ProviderType = 'memory' | 'console';

/**
 * Sentry-style integration descriptor (boxlogger accepts these to keep
 * call signatures compatible — most are no-ops since we do not perform
 * any auto-instrumentation).
 */
export interface SentryIntegration {
  name: string;
  setupOnce?: () => void;
  setup?: (client?: unknown) => void;
  afterAllSetup?: (client?: unknown) => void;
  processEvent?: EventProcessor;
}

/**
 * Initialization options.
 *
 * @remarks
 * Accepts the full `@sentry/node` init shape so that existing Sentry code
 * compiles and runs against boxlogger. Options that don't make sense for a
 * local in-memory/console logger (DSN, transports, instrumentations, etc.)
 * are stored but otherwise ignored.
 */
export interface InitOptions {
  // -- boxlogger native --
  /** Storage provider for boxlogger's local store. */
  service?: string;
  environment?: string;
  release?: string;
  minLevel?: LogLevel;
  enableSessions?: boolean;
  defaultMetadata?: LogMetadata;
  debug?: boolean;
  ignoreErrors?: (string | RegExp)[];
  sampleRate?: number;
  messagesSampleRate?: number;
  beforeSend?: BeforeSendHook;
  beforeSendMessage?: BeforeSendMessageHook;

  // -- Sentry-compatible (accepted; mostly no-op locally) --
  /** Sentry DSN. Accepted for API compatibility; events are not transported. */
  dsn?: string;
  /** Tunnel URL. Accepted for compatibility. */
  tunnel?: string;
  /** Sentry-style integrations. Their setup/afterAllSetup hooks are invoked. */
  integrations?: SentryIntegration[] | ((defaults: SentryIntegration[]) => SentryIntegration[]);
  /** Sample rate for traces (0.0 to 1.0). */
  tracesSampleRate?: number;
  /** Custom traces sampler. Accepted for compatibility. */
  tracesSampler?: (ctx: unknown) => number | boolean;
  /** Sample rate for profiling (accepted for compatibility). */
  profilesSampleRate?: number;
  /** URL deny-list for events. */
  denyUrls?: (string | RegExp)[];
  /** URL allow-list for events. */
  allowUrls?: (string | RegExp)[];
  /** Maximum breadcrumb count. */
  maxBreadcrumbs?: number;
  /** Attach a stack trace to messages. Accepted for compatibility. */
  attachStacktrace?: boolean;
  /** Auto session tracking (Sentry release health). */
  autoSessionTracking?: boolean;
  /** Initial scope tags/extras/user. */
  initialScope?: ScopeCaptureContext | ((scope: Scope) => Scope);
  /** Enable structured logs (Sentry.logger.*). Defaults to true locally. */
  enableLogs?: boolean;
  /** Default integrations toggle (no-op locally). */
  defaultIntegrations?: false | SentryIntegration[];
  /** Send default PII flag (no-op locally). */
  sendDefaultPii?: boolean;
  /** Server name override. */
  serverName?: string;
  /** Shutdown timeout in milliseconds. */
  shutdownTimeout?: number;
  /** Maximum value length for normalized strings. */
  maxValueLength?: number;
  /** Normalize depth for objects. */
  normalizeDepth?: number;
  /** Normalize max breadth. */
  normalizeMaxBreadth?: number;
  /** Transport factory (no-op locally). */
  transport?: unknown;
  /** Transport options (no-op locally). */
  transportOptions?: unknown;
  /** beforeSendTransaction hook. */
  beforeSendTransaction?: (event: unknown, hint?: unknown) => unknown;
  /** beforeSendSpan hook. */
  beforeSendSpan?: (span: unknown) => unknown;
  /** beforeBreadcrumb hook. */
  beforeBreadcrumb?: (
    breadcrumb: ScopeBreadcrumb,
    hint?: Record<string, unknown>
  ) => ScopeBreadcrumb | null;

  /** Allow forward-compat unknown options without TS errors. */
  [key: string]: unknown;
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
  _denyUrls = options.denyUrls ?? [];
  _allowUrls = options.allowUrls ?? [];

  // Store sample rates
  _sampleRate = options.sampleRate ?? 1.0;
  _messagesSampleRate = options.messagesSampleRate ?? 1.0;
  _tracesSampleRate = options.tracesSampleRate ?? 0;

  // Store beforeSend hooks
  _beforeSend = options.beforeSend ?? null;
  _beforeSendMessage = options.beforeSendMessage ?? null;

  // Sentry-compatible options
  _dsn = options.dsn;
  _initOptions = options;
  _lastEventId = '';

  // Apply initialScope before integrations run
  if (options.initialScope) {
    if (typeof options.initialScope === 'function') {
      options.initialScope(getGlobalScope());
    } else {
      getGlobalScope().applyContext(options.initialScope as ScopeCaptureContext);
    }
  }

  // Resolve integrations: default integrations + user integrations, deduped by name.
  const defaults = options.defaultIntegrations === false
    ? []
    : Array.isArray(options.defaultIntegrations)
    ? options.defaultIntegrations
    : getDefaultIntegrations(options);
  const userIntegrations = typeof options.integrations === 'function'
    ? options.integrations(defaults)
    : [...defaults, ...(options.integrations ?? [])];
  _integrations = dedupeIntegrations(userIntegrations);

  // Run integration lifecycle (best-effort, never throws)
  for (const integration of _integrations) {
    try {
      integration.setupOnce?.();
    } catch (e) {
      if (options.debug) console.warn('[boxlogger] integration setupOnce failed:', e);
    }
  }
  for (const integration of _integrations) {
    try {
      integration.setup?.(getClient());
    } catch (e) {
      if (options.debug) console.warn('[boxlogger] integration setup failed:', e);
    }
  }
  for (const integration of _integrations) {
    try {
      integration.afterAllSetup?.(getClient());
    } catch (e) {
      if (options.debug) console.warn('[boxlogger] integration afterAllSetup failed:', e);
    }
    if (integration.processEvent) {
      addGlobalEventProcessor(integration.processEvent);
    }
  }

  if (options.debug) {
    console.log('[NodeLogger] Initialized with provider:', provider);
    if (_dsn) console.log('[NodeLogger] DSN accepted (events are stored locally only):', _dsn);
  }
}

function dedupeIntegrations(integrations: SentryIntegration[]): SentryIntegration[] {
  const seen = new Set<string>();
  const result: SentryIntegration[] = [];
  for (const integration of integrations) {
    if (!seen.has(integration.name)) {
      seen.add(integration.name);
      result.push(integration);
    }
  }
  return result;
}

/**
 * Default integrations installed at init() time on Node.
 *
 * @remarks
 * Mirrors the integrations Sentry's Node SDK installs automatically so that
 * `Sentry.init()` "just works" for crash reporting in a server process. Pass
 * `defaultIntegrations: false` (or your own `integrations` factory) to opt out.
 */
export function getDefaultIntegrations(_options: InitOptions = {}): SentryIntegration[] {
  if (typeof process === 'undefined' || !process?.versions?.node) return [];
  return [onUncaughtExceptionIntegration(), onUnhandledRejectionIntegration()];
}

let _uncaughtExceptionListener: ((err: Error) => void) | null = null;
let _unhandledRejectionListener: ((reason: unknown) => void) | null = null;

/**
 * Capture errors thrown synchronously and never caught (Sentry-compatible).
 */
export function onUncaughtExceptionIntegration(options: {
  onFatalError?: (err: Error) => void;
  exitEvenIfOtherHandlersAreRegistered?: boolean;
} = {}): SentryIntegration {
  return {
    name: 'OnUncaughtException',
    setupOnce() {
      if (_uncaughtExceptionListener) return;
      _uncaughtExceptionListener = (err: Error) => {
        try {
          captureException(err, {
            level: 'fatal',
            tags: { mechanism: 'onuncaughtexception' },
          });
        } catch { /* never let our handler throw */ }
        if (options.onFatalError) {
          options.onFatalError(err);
        } else if (options.exitEvenIfOtherHandlersAreRegistered !== false) {
          // Match Sentry's default: re-emit so Node prints the trace and exits.
          if (process.listenerCount('uncaughtException') <= 1) {
            // We're the only listener — preserve default crash behavior.
            console.error(err);
            process.exit(1);
          }
        }
      };
      process.on('uncaughtException', _uncaughtExceptionListener);
    },
  };
}

/**
 * Capture promise rejections that never get a `.catch` (Sentry-compatible).
 */
export function onUnhandledRejectionIntegration(options: {
  mode?: 'none' | 'warn' | 'strict';
} = {}): SentryIntegration {
  return {
    name: 'OnUnhandledRejection',
    setupOnce() {
      if (_unhandledRejectionListener) return;
      const mode = options.mode ?? 'warn';
      _unhandledRejectionListener = (reason: unknown) => {
        try {
          captureException(reason, {
            level: 'error',
            tags: { mechanism: 'onunhandledrejection' },
          });
        } catch { /* never let our handler throw */ }
        if (mode === 'warn') {
          console.warn('boxlogger captured unhandled rejection:', reason);
        } else if (mode === 'strict') {
          process.exit(1);
        }
      };
      process.on('unhandledRejection', _unhandledRejectionListener);
    },
  };
}

/**
 * Detach process-level listeners installed by the default integrations.
 * Called automatically from close().
 */
function teardownDefaultIntegrations(): void {
  if (typeof process === 'undefined' || !process?.versions?.node) return;
  if (_uncaughtExceptionListener) {
    process.off('uncaughtException', _uncaughtExceptionListener);
    _uncaughtExceptionListener = null;
  }
  if (_unhandledRejectionListener) {
    process.off('unhandledRejection', _unhandledRejectionListener);
    _unhandledRejectionListener = null;
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
  teardownDefaultIntegrations();
  if (_instance) {
    await _instance.close();
    _instance = null;
  }
  if (_store) {
    _store = null;
  }
  _ignoreErrors = [];
  _denyUrls = [];
  _allowUrls = [];
  _sampleRate = 1.0;
  _messagesSampleRate = 1.0;
  _tracesSampleRate = 0;
  _beforeSend = null;
  _beforeSendMessage = null;
  _activeTransaction = null;
  _lastEventId = '';
  _dsn = undefined;
  _integrations = [];
  _initOptions = {};
  _activeSpan = null;
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

  // Merge global → isolation → current scopes (Sentry-compatible).
  const tempScope = new Scope();
  tempScope.merge(getGlobalScope());
  tempScope.merge(getIsolationScope());
  tempScope.merge(getCurrentScope());
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

  // Run global event processors (Sentry-compatible)
  const sentryEvent = logEntryToSentryEvent(event);
  let processed: SentryEvent | null = sentryEvent;
  for (const processor of getGlobalEventProcessors()) {
    if (processed === null) return '';
    const next = processor(processed, { originalException: err });
    processed = next instanceof Promise ? sentryEvent : (next as SentryEvent | null);
  }
  if (processed === null) return '';

  // Log the exception using the (possibly modified) event data
  _instance!.exception(err, undefined, event.metadata);
  _lastEventId = eventId;

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

  // Merge global → isolation → current scopes (Sentry-compatible).
  const tempScope = new Scope();
  tempScope.merge(getGlobalScope());
  tempScope.merge(getIsolationScope());
  tempScope.merge(getCurrentScope());
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

  // Run global event processors (Sentry-compatible)
  const sentryEvent = logEntryToSentryEvent(event);
  let processed: SentryEvent | null = sentryEvent;
  for (const processor of getGlobalEventProcessors()) {
    if (processed === null) return '';
    const next = processor(processed, { originalException: undefined, data: { message } });
    processed = next instanceof Promise ? sentryEvent : (next as SentryEvent | null);
  }
  if (processed === null) return '';

  // Log the message using the (possibly modified) event data
  _instance!.log(event.level, event.message, event.metadata);
  _lastEventId = eventId;

  return eventId;
}

/**
 * Best-effort conversion of a stored LogEntry to a Sentry event shape so
 * Sentry-style event processors can inspect/mutate the basics.
 */
function logEntryToSentryEvent(entry: LogEntry): SentryEvent {
  return {
    event_id: entry.id,
    message: entry.message,
    level: entry.level === 'warn' ? 'warning' : (entry.level as SeverityLevel),
    timestamp: new Date(entry.timestamp).getTime() / 1000,
    tags: entry.metadata?.tags,
    extra: entry.metadata?.extra,
    user: entry.metadata?.user,
  };
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
export function addBreadcrumb(
  breadcrumb: Breadcrumb,
  hint?: Record<string, unknown>
): void {
  ensureInitialized();

  // Add timestamp if not provided (Sentry uses seconds since epoch)
  let crumb: ScopeBreadcrumb | null = {
    ...breadcrumb,
    timestamp: breadcrumb.timestamp ?? Date.now() / 1000,
  };

  // Run beforeBreadcrumb hook (Sentry-compatible)
  if (_initOptions.beforeBreadcrumb) {
    crumb = _initOptions.beforeBreadcrumb(crumb, hint);
    if (crumb === null) return;
  }

  // Sentry v8+ writes breadcrumbs to the isolation scope — that scope is
  // per-async-context (ALS-backed) so per-request handlers naturally get
  // their own breadcrumb trail without leaking across requests. The capture
  // pipeline merges global → isolation → current so the breadcrumb still
  // appears on every captured event.
  getIsolationScope().addBreadcrumb(crumb);
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

  // Merge global → isolation → current scopes (Sentry-compatible).
  const tempScope = new Scope();
  tempScope.merge(getGlobalScope());
  tempScope.merge(getIsolationScope());
  tempScope.merge(getCurrentScope());

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

export async function endSession(
  status?: 'ok' | 'exited' | 'crashed' | 'abnormal' | 'ended',
  abnormalMechanism?: string
): Promise<void> {
  ensureInitialized();
  await _instance!.endSession(status, abnormalMechanism);
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
  // Merge global → isolation → current to mirror Sentry's scope merge order.
  const merged = new Scope();
  merged.merge(getGlobalScope());
  merged.merge(getIsolationScope());
  merged.merge(getCurrentScope());
  const scopeMetadata = merged.toMetadata();

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
// Sentry Drop-in Shims
// ============================================================================
// The following functions exist purely to make code written against
// `@sentry/node` keep working when the import is swapped to boxlogger.
// Anything that requires a real Sentry transport, instrumentation, or
// envelope is a no-op locally — but the call signature matches.

let _activeSpan: SpanShim | null = null;
const _DEFAULT_SHUTDOWN_MS = 2000;

/**
 * Minimal Sentry-compatible client shim.
 *
 * @remarks
 * Exposes the methods most commonly used by integrations and SDK code so
 * they can run unchanged. There is no real transport — `flush`/`close`
 * resolve immediately and event capture goes through the same local
 * pipeline as the rest of boxlogger.
 */
export interface SentryClientShim {
  getDsn(): { publicKey: string; host: string } | undefined;
  getOptions(): InitOptions;
  getTransport(): undefined;
  getIntegrationByName<T extends SentryIntegration = SentryIntegration>(name: string): T | undefined;
  addIntegration(integration: SentryIntegration): void;
  captureException(error: unknown, hint?: BeforeSendHint): string;
  captureMessage(message: string, level?: SeverityLevel): string;
  captureEvent(event: SentryEvent): string;
  flush(timeout?: number): Promise<boolean>;
  close(timeout?: number): Promise<boolean>;
  on(event: string, listener: (...args: unknown[]) => void): void;
  emit(event: string, ...args: unknown[]): void;
}

const _clientListeners = new Map<string, Array<(...args: unknown[]) => void>>();

function makeClient(): SentryClientShim {
  return {
    getDsn() {
      if (!_dsn) return undefined;
      const match = /^https?:\/\/([^@]+)@([^/]+)\//.exec(_dsn);
      if (!match) return undefined;
      return { publicKey: match[1], host: match[2] };
    },
    getOptions() {
      return _initOptions;
    },
    getTransport() {
      return undefined;
    },
    getIntegrationByName(name) {
      return _integrations.find((i) => i.name === name) as never;
    },
    addIntegration(integration) {
      if (_integrations.some((i) => i.name === integration.name)) return;
      _integrations.push(integration);
      try { integration.setupOnce?.(); } catch { /* swallow */ }
      try { integration.setup?.(this); } catch { /* swallow */ }
      try { integration.afterAllSetup?.(this); } catch { /* swallow */ }
      if (integration.processEvent) addGlobalEventProcessor(integration.processEvent);
    },
    captureException(error, hint) {
      return captureException(error, hint as CaptureContext | undefined);
    },
    captureMessage(message, level) {
      return captureMessage(message, level);
    },
    captureEvent(event) {
      return captureEvent(event);
    },
    async flush(_timeout) {
      return true;
    },
    async close(_timeout) {
      await close();
      return true;
    },
    on(event, listener) {
      const list = _clientListeners.get(event) ?? [];
      list.push(listener);
      _clientListeners.set(event, list);
    },
    emit(event, ...args) {
      const list = _clientListeners.get(event);
      if (!list) return;
      for (const listener of list) {
        try { listener(...args); } catch { /* swallow */ }
      }
    },
  };
}

let _client: SentryClientShim | null = null;

/**
 * Get the current Sentry client (Sentry-compatible).
 *
 * @remarks
 * Returns a minimal client shim that exposes the methods most often called
 * by integrations and SDK utilities. Returns undefined before init().
 */
export function getClient<T extends SentryClientShim = SentryClientShim>(): T | undefined {
  if (!_instance) return undefined;
  if (!_client) _client = makeClient();
  return _client as T;
}

/**
 * Flush pending events (Sentry-compatible).
 *
 * @remarks
 * boxlogger has no network transport, so this resolves immediately with `true`.
 */
export async function flush(_timeout?: number): Promise<boolean> {
  return true;
}

/**
 * The event ID of the most recently captured event (Sentry-compatible).
 */
export function lastEventId(): string {
  return _lastEventId;
}

/**
 * Register an event processor that runs on every captured event (Sentry-compatible).
 */
export function addEventProcessor(processor: EventProcessor): void {
  addGlobalEventProcessor(processor);
}

/**
 * Add an integration after init (Sentry-compatible).
 *
 * @remarks
 * boxlogger does not run real auto-instrumentation. The integration's
 * lifecycle hooks are invoked and any `processEvent` becomes a global event processor.
 */
export function addIntegration(integration: SentryIntegration): void {
  getClient()?.addIntegration(integration);
}

/**
 * Get a registered integration by name (Sentry-compatible).
 */
export function getIntegrationByName<T extends SentryIntegration = SentryIntegration>(
  name: string
): T | undefined {
  return _integrations.find((i) => i.name === name) as T | undefined;
}

// ----------------------------------------------------------------------------
// Isolation scope (Sentry-compatible)
// ----------------------------------------------------------------------------

export {
  withIsolationScopeInternal as withIsolationScope,
  withIsolationScopeAsync,
  addGlobalEventProcessor,
  getGlobalEventProcessors,
};

export type { EventProcessor, EventHint, Attachment, PropagationContext };

/**
 * Set the trace propagation context on the current scope (Sentry-compatible).
 */
export function setPropagationContext(context: PropagationContext): void {
  getCurrentScope().setPropagationContext(context);
  getIsolationScope().setPropagationContext(context);
}

/**
 * Get the active trace propagation context (Sentry-compatible).
 */
export function getPropagationContext(): PropagationContext | null {
  return getCurrentScope().getPropagationContext()
    ?? getIsolationScope().getPropagationContext();
}

/**
 * Continue a trace from incoming headers (Sentry-compatible).
 *
 * Accepts `sentry-trace` and `baggage` header values and runs the callback
 * with the propagation context applied.
 */
export function continueTrace<T>(
  options: { sentryTrace?: string; baggage?: string },
  callback: () => T
): T {
  const trace = parseSentryTrace(options.sentryTrace);
  const dsc = parseBaggage(options.baggage);
  return withScope(() => {
    if (trace) {
      setPropagationContext({ ...trace, dsc });
    }
    return callback();
  });
}

function parseSentryTrace(header?: string): { traceId: string; spanId: string; sampled?: boolean } | null {
  if (!header) return null;
  const match = /^([0-9a-f]{32})-([0-9a-f]{16})(?:-([01]))?$/i.exec(header.trim());
  if (!match) return null;
  return {
    traceId: match[1],
    spanId: match[2],
    sampled: match[3] === '1' ? true : match[3] === '0' ? false : undefined,
  };
}

function parseBaggage(header?: string): Record<string, string> | undefined {
  if (!header) return undefined;
  const out: Record<string, string> = {};
  for (const part of header.split(',')) {
    const [k, v] = part.split('=').map((s) => s?.trim());
    if (k && v && k.startsWith('sentry-')) out[k.slice('sentry-'.length)] = decodeURIComponent(v);
  }
  return Object.keys(out).length ? out : undefined;
}

// ----------------------------------------------------------------------------
// Span API shims (Sentry-compatible call signatures)
// ----------------------------------------------------------------------------

/**
 * Sentry-compatible span shape.
 *
 * @remarks
 * boxlogger does not produce a real span envelope; spans here are
 * lightweight timing records that integrate with the transaction trace ID.
 */
export interface SpanShim {
  spanContext(): { traceId: string; spanId: string; traceFlags: number };
  setAttribute(key: string, value: unknown): SpanShim;
  setAttributes(attrs: Record<string, unknown>): SpanShim;
  setStatus(status: { code: number; message?: string } | string): SpanShim;
  updateName(name: string): SpanShim;
  end(endTimestamp?: number): void;
  isRecording(): boolean;
  addEvent(name: string, attrs?: Record<string, unknown>): SpanShim;
}

interface SpanShimContext {
  name: string;
  op?: string;
  description?: string;
  attributes?: Record<string, unknown>;
  startTime?: number;
  parentSpan?: SpanShim | null;
  forceTransaction?: boolean;
}

function makeSpan(ctx: SpanShimContext): SpanShim {
  const traceId = (_activeSpan?.spanContext().traceId
    ?? _activeTransaction?.traceId
    ?? generateHexId(32));
  const spanId = generateHexId(16);
  const startTime = ctx.startTime ?? Date.now();
  let endTime: number | undefined;
  let name = ctx.name;
  const attributes: Record<string, unknown> = { ...ctx.attributes };
  if (ctx.op) attributes['sentry.op'] = ctx.op;
  if (ctx.description) attributes['sentry.description'] = ctx.description;
  let status: { code: number; message?: string } | undefined;

  const span: SpanShim = {
    spanContext: () => ({ traceId, spanId, traceFlags: 1 }),
    setAttribute(key, value) {
      attributes[key] = value;
      return span;
    },
    setAttributes(attrs) {
      Object.assign(attributes, attrs);
      return span;
    },
    setStatus(s) {
      if (typeof s === 'string') status = { code: s === 'ok' ? 1 : 2, message: s };
      else status = s;
      return span;
    },
    updateName(n) {
      name = n;
      return span;
    },
    end(endTimestamp) {
      if (endTime !== undefined) return;
      endTime = endTimestamp ?? Date.now();
      // Best-effort: log span as a debug breadcrumb-like log
      if (_instance) {
        _instance.debug(`span.end ${name}`, {
          traceId,
          spanId,
          extra: {
            durationMs: endTime - startTime,
            attributes,
            status,
          },
        });
      }
    },
    isRecording: () => endTime === undefined,
    addEvent(eventName, attrs) {
      attributes[`event.${eventName}`] = attrs ?? true;
      return span;
    },
  };
  return span;
}

/**
 * Start a span and run a callback (Sentry-compatible).
 *
 * The span is automatically finished when the callback returns or throws.
 * Returns the callback's result.
 */
export function startSpan<T>(
  context: SpanShimContext,
  callback: (span: SpanShim) => T
): T {
  const span = makeSpan(context);
  const previous = _activeSpan;
  _activeSpan = span;
  getCurrentScope().setActiveSpan(span.spanContext());
  try {
    const result = callback(span);
    if (result instanceof Promise) {
      return result.then(
        (v) => { span.end(); _activeSpan = previous; return v; },
        (err) => {
          span.setStatus({ code: 2, message: 'internal_error' });
          span.end();
          _activeSpan = previous;
          throw err;
        }
      ) as T;
    }
    span.end();
    _activeSpan = previous;
    return result;
  } catch (err) {
    span.setStatus({ code: 2, message: 'internal_error' });
    span.end();
    _activeSpan = previous;
    throw err;
  }
}

/**
 * Start a span without making it active (Sentry-compatible).
 */
export function startInactiveSpan(context: SpanShimContext): SpanShim {
  return makeSpan(context);
}

/**
 * Start a span and run a callback, but require the caller to call `span.end()` (Sentry-compatible).
 */
export function startSpanManual<T>(
  context: SpanShimContext,
  callback: (span: SpanShim, finish: () => void) => T
): T {
  const span = makeSpan(context);
  const previous = _activeSpan;
  _activeSpan = span;
  const finish = () => {
    span.end();
    _activeSpan = previous;
  };
  try {
    return callback(span, finish);
  } catch (err) {
    span.setStatus({ code: 2, message: 'internal_error' });
    finish();
    throw err;
  }
}

/**
 * Run a callback with the given span as active (Sentry-compatible).
 */
export function withActiveSpan<T>(span: SpanShim | null, callback: () => T): T {
  const previous = _activeSpan;
  _activeSpan = span;
  try {
    return callback();
  } finally {
    _activeSpan = previous;
  }
}

/**
 * Get the currently active span (Sentry-compatible).
 */
export function getActiveSpan(): SpanShim | null {
  return _activeSpan;
}

/**
 * Get the root span of the current trace (Sentry-compatible).
 *
 * boxlogger does not maintain a span tree, so this returns the active span.
 */
export function getRootSpan(span?: SpanShim | null): SpanShim | null {
  return span ?? _activeSpan;
}

/**
 * Get trace data suitable for HTTP propagation (Sentry-compatible).
 */
export function getTraceData(): { 'sentry-trace'?: string; baggage?: string } {
  const ctx = getPropagationContext()
    ?? (_activeSpan
        ? { traceId: _activeSpan.spanContext().traceId, spanId: _activeSpan.spanContext().spanId }
        : _activeTransaction
        ? { traceId: _activeTransaction.traceId, spanId: _activeTransaction.spanId }
        : null);
  if (!ctx) return {};
  const sampled = (ctx as PropagationContext).sampled;
  const sampledFlag = sampled === true ? '-1' : sampled === false ? '-0' : '';
  return {
    'sentry-trace': `${ctx.traceId}-${ctx.spanId}${sampledFlag}`,
  };
}

// ----------------------------------------------------------------------------
// Cron / monitoring (Sentry-compatible no-ops)
// ----------------------------------------------------------------------------

export interface CheckIn {
  monitorSlug: string;
  status: 'in_progress' | 'ok' | 'error';
  checkInId?: string;
  duration?: number;
}

/**
 * Capture a cron check-in (Sentry-compatible).
 *
 * @remarks
 * Stored locally as a debug log; not sent anywhere.
 */
export function captureCheckIn(
  checkIn: CheckIn,
  monitorConfig?: Record<string, unknown>
): string {
  const id = checkIn.checkInId ?? randomUUID();
  if (_instance) {
    _instance.debug(`checkin ${checkIn.monitorSlug} ${checkIn.status}`, {
      tags: { 'monitor.slug': checkIn.monitorSlug, 'monitor.status': checkIn.status },
      extra: { checkInId: id, monitorConfig, duration: checkIn.duration },
    });
  }
  return id;
}

/**
 * Wrap a callback with automatic check-in reporting (Sentry-compatible).
 */
export function withMonitor<T>(
  monitorSlug: string,
  callback: () => T,
  monitorConfig?: Record<string, unknown>
): T {
  const checkInId = captureCheckIn(
    { monitorSlug, status: 'in_progress' },
    monitorConfig
  );
  const start = Date.now();
  const finish = (status: 'ok' | 'error') => {
    captureCheckIn(
      { monitorSlug, status, checkInId, duration: (Date.now() - start) / 1000 },
      monitorConfig
    );
  };
  try {
    const result = callback();
    if (result instanceof Promise) {
      return result.then(
        (v) => { finish('ok'); return v; },
        (err) => { finish('error'); throw err; }
      ) as T;
    }
    finish('ok');
    return result;
  } catch (err) {
    finish('error');
    throw err;
  }
}

// ----------------------------------------------------------------------------
// User feedback (Sentry-compatible no-op)
// ----------------------------------------------------------------------------

export interface UserFeedback {
  event_id?: string;
  name?: string;
  email?: string;
  message: string;
  associatedEventId?: string;
}

/**
 * Capture user feedback (Sentry-compatible).
 *
 * @remarks
 * Stored locally as an info log; not sent anywhere.
 */
export function captureFeedback(feedback: UserFeedback): string {
  const id = feedback.event_id ?? randomUUID();
  if (_instance) {
    _instance.info(`feedback ${feedback.message}`, {
      tags: { type: 'feedback' },
      user: feedback.email || feedback.name
        ? { email: feedback.email, username: feedback.name }
        : undefined,
      extra: {
        feedbackId: id,
        associatedEventId: feedback.associatedEventId,
      },
    });
  }
  return id;
}

// ----------------------------------------------------------------------------
// Sentry.logger / Sentry.metrics namespaces (Sentry-compatible call shims)
// ----------------------------------------------------------------------------

/** Sentry.logger.* namespace — proxies to boxlogger's log methods. */
export const logger = {
  trace: (msg: string, attrs?: Record<string, unknown>) =>
    _instance?.trace(msg, { extra: attrs }),
  debug: (msg: string, attrs?: Record<string, unknown>) =>
    _instance?.debug(msg, { extra: attrs }),
  info: (msg: string, attrs?: Record<string, unknown>) =>
    _instance?.info(msg, { extra: attrs }),
  warn: (msg: string, attrs?: Record<string, unknown>) =>
    _instance?.warn(msg, { extra: attrs }),
  error: (msg: string, attrs?: Record<string, unknown>) =>
    _instance?.error(msg, { extra: attrs }),
  fatal: (msg: string, attrs?: Record<string, unknown>) =>
    _instance?.fatal(msg, { extra: attrs }),
  fmt: (template: TemplateStringsArray, ...values: unknown[]) => {
    let out = '';
    template.forEach((t, i) => { out += t + (i < values.length ? String(values[i]) : ''); });
    return out;
  },
};

/** Sentry.metrics.* namespace — stored locally as debug logs. */
export const metrics = {
  increment: (name: string, value = 1, data?: Record<string, unknown>) => {
    _instance?.debug(`metric.increment ${name}`, {
      extra: { metric: name, value, type: 'counter', ...data },
    });
  },
  distribution: (name: string, value: number, data?: Record<string, unknown>) => {
    _instance?.debug(`metric.distribution ${name}`, {
      extra: { metric: name, value, type: 'distribution', ...data },
    });
  },
  gauge: (name: string, value: number, data?: Record<string, unknown>) => {
    _instance?.debug(`metric.gauge ${name}`, {
      extra: { metric: name, value, type: 'gauge', ...data },
    });
  },
  set: (name: string, value: number | string, data?: Record<string, unknown>) => {
    _instance?.debug(`metric.set ${name}`, {
      extra: { metric: name, value, type: 'set', ...data },
    });
  },
  timing: (name: string, value: number, unit = 'second', data?: Record<string, unknown>) => {
    _instance?.debug(`metric.timing ${name}`, {
      extra: { metric: name, value, unit, type: 'timing', ...data },
    });
  },
};

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

  // Client / lifecycle
  getClient,
  flush,
  lastEventId,
  addEventProcessor,
  addIntegration,
  getIntegrationByName,

  // Trace propagation
  setPropagationContext,
  getPropagationContext,
  continueTrace,
  getTraceData,

  // Spans
  startSpan,
  startInactiveSpan,
  startSpanManual,
  withActiveSpan,
  getActiveSpan,
  getRootSpan,

  // Cron / monitor / feedback
  captureCheckIn,
  withMonitor,
  captureFeedback,

  // Sub-namespaces
  logger,
  metrics,

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
