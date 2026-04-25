/**
 * Scope Management (Sentry-compatible)
 *
 * Provides isolated context for error tracking, matching Sentry's scope API.
 *
 * @module scope
 * @packageDocumentation
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { LogLevel, UserInfo, LogMetadata, SentryEvent } from './types.js';

/**
 * Sentry-compatible severity level type
 */
export type SeverityLevel = 'fatal' | 'error' | 'warning' | 'log' | 'info' | 'debug';

/**
 * Hint passed to event processors (Sentry-compatible).
 */
export interface EventHint {
  event_id?: string;
  originalException?: unknown;
  syntheticException?: Error | null;
  data?: unknown;
  attachments?: Attachment[];
  [key: string]: unknown;
}

/**
 * Event processor function (Sentry-compatible).
 * Return null to drop the event, or a (possibly modified) event/Promise.
 */
export type EventProcessor = (
  event: SentryEvent,
  hint?: EventHint
) => SentryEvent | null | PromiseLike<SentryEvent | null>;

/**
 * Attachment data (Sentry-compatible).
 */
export interface Attachment {
  data: string | Uint8Array;
  filename: string;
  contentType?: string;
  attachmentType?: string;
}

/**
 * Breadcrumb data structure (Sentry-compatible)
 */
export interface Breadcrumb {
  /** Breadcrumb type (default, http, navigation, etc.) */
  type?: string;
  /** Category for grouping (ui.click, api, navigation, etc.) */
  category?: string;
  /** Human-readable message */
  message?: string;
  /** Severity level */
  level?: SeverityLevel;
  /** Timestamp (ISO 8601) */
  timestamp?: number;
  /** Additional data */
  data?: Record<string, unknown>;
}

/**
 * Trace propagation context (Sentry-compatible).
 */
export interface PropagationContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  sampled?: boolean;
  dsc?: Record<string, string>;
}

/**
 * Capture context for exceptions and messages (Sentry-compatible)
 */
export interface CaptureContext {
  /** Tags for filtering and searching */
  tags?: Record<string, string>;
  /** Extra data attached to the event */
  extra?: Record<string, unknown>;
  /** User context */
  user?: UserInfo;
  /** Severity level */
  level?: SeverityLevel;
  /** Custom fingerprint for grouping */
  fingerprint?: string[];
  /** Named contexts (e.g., 'browser', 'os', 'device') */
  contexts?: Record<string, Record<string, unknown>>;
}

/**
 * Scope class for managing event context (Sentry-compatible)
 *
 * @remarks
 * A scope holds context data that gets attached to events.
 * Use `withScope()` to create isolated scopes for specific operations.
 *
 * @example
 * ```typescript
 * import { withScope, captureException } from '@nodelogger/core';
 *
 * withScope((scope) => {
 *   scope.setTag('transaction', 'payment');
 *   scope.setExtra('orderId', '12345');
 *   scope.setFingerprint(['payment', 'error']);
 *
 *   captureException(error);
 * });
 * ```
 */
export class Scope {
  private _tags: Record<string, string> = {};
  private _extra: Record<string, unknown> = {};
  private _user: UserInfo | null = null;
  private _level: SeverityLevel | null = null;
  private _fingerprint: string[] | null = null;
  private _breadcrumbs: Breadcrumb[] = [];
  private _contexts: Record<string, Record<string, unknown>> = {};
  private _maxBreadcrumbs: number = 100;
  private _eventProcessors: EventProcessor[] = [];
  private _attachments: Attachment[] = [];
  private _propagationContext: PropagationContext | null = null;
  private _activeSpan: { traceId: string; spanId: string; parentSpanId?: string } | null = null;
  private _client: unknown = null;

  /**
   * Create a new scope, optionally cloning from another
   */
  constructor(scope?: Scope) {
    if (scope) {
      this._tags = { ...scope._tags };
      this._extra = { ...scope._extra };
      this._user = scope._user ? { ...scope._user } : null;
      this._level = scope._level;
      this._fingerprint = scope._fingerprint ? [...scope._fingerprint] : null;
      this._breadcrumbs = [...scope._breadcrumbs];
      this._contexts = JSON.parse(JSON.stringify(scope._contexts));
      this._eventProcessors = [...scope._eventProcessors];
      this._attachments = [...scope._attachments];
      this._propagationContext = scope._propagationContext
        ? { ...scope._propagationContext }
        : null;
      this._activeSpan = scope._activeSpan ? { ...scope._activeSpan } : null;
      this._client = scope._client;
    }
  }

  /**
   * Set a single tag
   * @param key - Tag key (max 32 chars recommended)
   * @param value - Tag value (max 200 chars recommended)
   */
  setTag(key: string, value: string): this {
    this._tags[key] = value;
    return this;
  }

  /**
   * Set multiple tags
   * @param tags - Tags object
   */
  setTags(tags: Record<string, string>): this {
    for (const [key, value] of Object.entries(tags)) {
      this._tags[key] = value;
    }
    return this;
  }

  /**
   * Get all tags
   */
  getTags(): Record<string, string> {
    return { ...this._tags };
  }

  /**
   * Set extra data
   * @param key - Extra key
   * @param value - Any value
   */
  setExtra(key: string, value: unknown): this {
    this._extra[key] = value;
    return this;
  }

  /**
   * Set multiple extras
   * @param extras - Extras object
   */
  setExtras(extras: Record<string, unknown>): this {
    for (const [key, value] of Object.entries(extras)) {
      this._extra[key] = value;
    }
    return this;
  }

  /**
   * Get all extras
   */
  getExtras(): Record<string, unknown> {
    return { ...this._extra };
  }

  /**
   * Set user context
   * @param user - User info or null to clear
   */
  setUser(user: UserInfo | null): this {
    this._user = user ? { ...user } : null;
    return this;
  }

  /**
   * Get user context
   */
  getUser(): UserInfo | null {
    return this._user ? { ...this._user } : null;
  }

  /**
   * Set severity level
   * @param level - Severity level
   */
  setLevel(level: SeverityLevel): this {
    this._level = level;
    return this;
  }

  /**
   * Get severity level
   */
  getLevel(): SeverityLevel | null {
    return this._level;
  }

  /**
   * Set custom fingerprint for error grouping
   * @param fingerprint - Array of strings for grouping
   */
  setFingerprint(fingerprint: string[]): this {
    this._fingerprint = [...fingerprint];
    return this;
  }

  /**
   * Get fingerprint
   */
  getFingerprint(): string[] | null {
    return this._fingerprint ? [...this._fingerprint] : null;
  }

  /**
   * Set a named context
   * @param name - Context name (e.g., 'browser', 'os', 'device', 'custom')
   * @param context - Context data or null to clear
   */
  setContext(name: string, context: Record<string, unknown> | null): this {
    if (context === null) {
      delete this._contexts[name];
    } else {
      this._contexts[name] = { ...context };
    }
    return this;
  }

  /**
   * Get a named context
   */
  getContext(name: string): Record<string, unknown> | undefined {
    return this._contexts[name] ? { ...this._contexts[name] } : undefined;
  }

  /**
   * Get all contexts
   */
  getContexts(): Record<string, Record<string, unknown>> {
    return JSON.parse(JSON.stringify(this._contexts));
  }

  /**
   * Add a breadcrumb
   * @param breadcrumb - Breadcrumb data
   */
  addBreadcrumb(breadcrumb: Breadcrumb): this {
    const crumb: Breadcrumb = {
      ...breadcrumb,
      timestamp: breadcrumb.timestamp ?? Date.now() / 1000, // Sentry uses seconds
    };

    this._breadcrumbs.push(crumb);

    // Enforce max breadcrumbs
    if (this._breadcrumbs.length > this._maxBreadcrumbs) {
      this._breadcrumbs.shift();
    }

    return this;
  }

  /**
   * Get all breadcrumbs
   */
  getBreadcrumbs(): Breadcrumb[] {
    return [...this._breadcrumbs];
  }

  /**
   * Clear all breadcrumbs
   */
  clearBreadcrumbs(): this {
    this._breadcrumbs = [];
    return this;
  }

  /**
   * Clear all scope data
   */
  clear(): this {
    this._tags = {};
    this._extra = {};
    this._user = null;
    this._level = null;
    this._fingerprint = null;
    this._breadcrumbs = [];
    this._contexts = {};
    this._eventProcessors = [];
    this._attachments = [];
    this._propagationContext = null;
    this._activeSpan = null;
    return this;
  }

  /**
   * Register an event processor that mutates or drops events on this scope (Sentry-compatible).
   */
  addEventProcessor(processor: EventProcessor): this {
    this._eventProcessors.push(processor);
    return this;
  }

  /**
   * Get all event processors registered on this scope.
   */
  getEventProcessors(): EventProcessor[] {
    return [...this._eventProcessors];
  }

  /**
   * Add an attachment that will be sent with the next event (Sentry-compatible).
   */
  addAttachment(attachment: Attachment): this {
    this._attachments.push(attachment);
    return this;
  }

  /**
   * Get all attachments on this scope.
   */
  getAttachments(): Attachment[] {
    return [...this._attachments];
  }

  /**
   * Remove all attachments from this scope (Sentry-compatible).
   */
  clearAttachments(): this {
    this._attachments = [];
    return this;
  }

  /**
   * Set the trace propagation context for distributed tracing (Sentry-compatible).
   */
  setPropagationContext(context: PropagationContext): this {
    this._propagationContext = { ...context };
    return this;
  }

  /**
   * Get the trace propagation context.
   */
  getPropagationContext(): PropagationContext | null {
    return this._propagationContext ? { ...this._propagationContext } : null;
  }

  /**
   * Track the active span on this scope (used by tracing helpers).
   */
  setActiveSpan(span: { traceId: string; spanId: string; parentSpanId?: string } | null): this {
    this._activeSpan = span ? { ...span } : null;
    return this;
  }

  /**
   * Get the active span on this scope (Sentry-compatible).
   */
  getActiveSpan(): { traceId: string; spanId: string; parentSpanId?: string } | null {
    return this._activeSpan ? { ...this._activeSpan } : null;
  }

  /**
   * Associate a client with this scope (Sentry-compatible).
   */
  setClient(client: unknown): this {
    this._client = client;
    return this;
  }

  /**
   * Get the client associated with this scope.
   */
  getClient<T = unknown>(): T | null {
    return (this._client as T) ?? null;
  }

  /**
   * Run all registered event processors on the given event.
   * Returns the (possibly modified) event, or null if any processor drops it.
   */
  async applyToEvent(event: SentryEvent, hint?: EventHint): Promise<SentryEvent | null> {
    let current: SentryEvent | null = event;
    for (const processor of this._eventProcessors) {
      if (current === null) return null;
      current = await Promise.resolve(processor(current, hint));
    }
    return current;
  }

  /**
   * Apply capture context to scope
   * @param captureContext - Context to apply
   */
  applyContext(captureContext: CaptureContext): this {
    if (captureContext.tags) {
      this.setTags(captureContext.tags);
    }
    if (captureContext.extra) {
      this.setExtras(captureContext.extra);
    }
    if (captureContext.user) {
      this.setUser(captureContext.user);
    }
    if (captureContext.level) {
      this.setLevel(captureContext.level);
    }
    if (captureContext.fingerprint) {
      this.setFingerprint(captureContext.fingerprint);
    }
    if (captureContext.contexts) {
      for (const [name, ctx] of Object.entries(captureContext.contexts)) {
        this.setContext(name, ctx);
      }
    }
    return this;
  }

  /**
   * Convert scope to LogMetadata for storage
   */
  toMetadata(): LogMetadata {
    const metadata: LogMetadata = {};

    if (Object.keys(this._tags).length > 0) {
      metadata.tags = { ...this._tags };
    }

    const extra: Record<string, unknown> = { ...this._extra };
    if (this._breadcrumbs.length > 0) {
      extra._breadcrumbs = [...this._breadcrumbs];
    }
    if (this._fingerprint) {
      extra._fingerprint = [...this._fingerprint];
    }
    if (this._contexts && Object.keys(this._contexts).length > 0) {
      extra._contexts = JSON.parse(JSON.stringify(this._contexts));
    }
    if (Object.keys(extra).length > 0) {
      metadata.extra = extra;
    }

    if (this._user) {
      metadata.user = { ...this._user };
    }

    return metadata;
  }

  /**
   * Clone this scope
   */
  clone(): Scope {
    return new Scope(this);
  }
}

// ============================================================================
// Global Scope Management
// ============================================================================

let _globalScope = new Scope();
let _currentScopeFallback = new Scope();
let _isolationScopeFallback = new Scope();
const _globalEventProcessors: EventProcessor[] = [];

/**
 * AsyncLocalStorage-backed per-async-context scope storage.
 *
 * @remarks
 * Every `withScope` / `withIsolationScope` call runs the callback inside a
 * fresh ALS frame whose store is the forked scope — so any async work spawned
 * inside the callback (timers, promises, awaits) sees its own scope without
 * bleeding into sibling async work.
 */
const _currentScopeStorage = new AsyncLocalStorage<Scope>();
const _isolationScopeStorage = new AsyncLocalStorage<Scope>();

/**
 * Get the global scope (Sentry-compatible).
 */
export function getGlobalScope(): Scope {
  return _globalScope;
}

/**
 * Get the current scope (Sentry-compatible).
 *
 * @remarks
 * Reads from AsyncLocalStorage on Node so the scope follows async work spawned
 * inside a `withScope` callback. Falls back to a module-level scope when ALS
 * isn't available (browser).
 */
export function getCurrentScope(): Scope {
  return _currentScopeStorage?.getStore() ?? _currentScopeFallback;
}

/**
 * Get the isolation scope (Sentry-compatible).
 *
 * @remarks
 * In Sentry, the isolation scope is per-async-context (e.g. per-request),
 * separate from the current scope which is per-frame within that context.
 * On Node it is backed by AsyncLocalStorage so that HTTP servers can run each
 * incoming request inside a `withIsolationScope` and have all spawned async
 * work share that same isolation scope without leaking into other requests.
 */
export function getIsolationScope(): Scope {
  return _isolationScopeStorage?.getStore() ?? _isolationScopeFallback;
}

/**
 * Register a global event processor (Sentry-compatible).
 *
 * Processors run on every event captured through captureException/Message/Event.
 */
export function addGlobalEventProcessor(processor: EventProcessor): void {
  _globalEventProcessors.push(processor);
}

/**
 * Get all global event processors.
 */
export function getGlobalEventProcessors(): EventProcessor[] {
  return [..._globalEventProcessors];
}

/**
 * Configure the global scope (Sentry-compatible).
 *
 * @example
 * ```typescript
 * configureScope((scope) => {
 *   scope.setTag('environment', 'production');
 *   scope.setTag('release', '1.0.0');
 * });
 * ```
 */
export function configureScope(callback: (scope: Scope) => void): void {
  callback(_globalScope);
  // Apply global scope to the fallback current scope so synchronous reads
  // outside an ALS frame still see configured values.
  _currentScopeFallback = new Scope(_globalScope);
}

/**
 * Run code with an isolated current scope (Sentry-compatible).
 *
 * The forked scope is stored in AsyncLocalStorage so any async work spawned
 * inside the callback inherits the same scope without bleeding into siblings.
 */
export function withScope<T>(callback: (scope: Scope) => T): T {
  const forked = new Scope(getCurrentScope());
  return _currentScopeStorage.run(forked, () => callback(forked));
}

/**
 * Async variant of withScope (Sentry-compatible).
 */
export async function withScopeAsync<T>(
  callback: (scope: Scope) => Promise<T>
): Promise<T> {
  const forked = new Scope(getCurrentScope());
  return _currentScopeStorage.run(forked, () => callback(forked));
}

/**
 * Run a callback with a forked isolation scope (Sentry-compatible).
 *
 * @remarks
 * The canonical way to isolate per-request context in HTTP servers: every
 * request handler should run inside a `withIsolationScope` so its tags,
 * breadcrumbs, and user context don't leak across concurrent requests.
 */
export function withIsolationScope<T>(callback: (scope: Scope) => T): T {
  const forked = new Scope(getIsolationScope());
  return _isolationScopeStorage.run(forked, () => callback(forked));
}

/**
 * Async variant of withIsolationScope (Sentry-compatible).
 */
export async function withIsolationScopeAsync<T>(
  callback: (scope: Scope) => Promise<T>
): Promise<T> {
  const forked = new Scope(getIsolationScope());
  return _isolationScopeStorage.run(forked, () => callback(forked));
}

/**
 * Reset all scopes (for testing).
 */
export function resetScopes(): void {
  _globalScope = new Scope();
  _currentScopeFallback = new Scope();
  _isolationScopeFallback = new Scope();
  _globalEventProcessors.length = 0;
}
