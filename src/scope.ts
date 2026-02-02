/**
 * Scope Management (Sentry-compatible)
 *
 * Provides isolated context for error tracking, matching Sentry's scope API.
 *
 * @module scope
 * @packageDocumentation
 */

import type { LogLevel, UserInfo, LogMetadata } from './types.js';

/**
 * Sentry-compatible severity level type
 */
export type SeverityLevel = 'fatal' | 'error' | 'warning' | 'log' | 'info' | 'debug';

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
    return this;
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
let _currentScope = new Scope();
const _scopeStack: Scope[] = [];

/**
 * Get the global scope
 */
export function getGlobalScope(): Scope {
  return _globalScope;
}

/**
 * Get the current scope
 */
export function getCurrentScope(): Scope {
  return _currentScope;
}

/**
 * Get the isolation scope (same as current for now)
 */
export function getIsolationScope(): Scope {
  return _currentScope;
}

/**
 * Configure the global scope (Sentry-compatible)
 *
 * @param callback - Function to configure the scope
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
  // Apply global scope to current scope
  _currentScope = new Scope(_globalScope);
}

/**
 * Run code with an isolated scope (Sentry-compatible)
 *
 * @param callback - Function to run with isolated scope
 * @returns Result of the callback
 *
 * @example
 * ```typescript
 * withScope((scope) => {
 *   scope.setTag('transaction', 'payment');
 *   scope.setExtra('orderId', orderId);
 *   scope.setFingerprint(['payment', orderId]);
 *
 *   try {
 *     await processPayment(orderId);
 *   } catch (error) {
 *     captureException(error);
 *   }
 * });
 * ```
 */
export function withScope<T>(callback: (scope: Scope) => T): T {
  // Create isolated scope by cloning current
  const previousScope = _currentScope;
  _currentScope = new Scope(_currentScope);
  _scopeStack.push(previousScope);

  try {
    return callback(_currentScope);
  } finally {
    // Restore previous scope
    _currentScope = _scopeStack.pop() || new Scope(_globalScope);
  }
}

/**
 * Run async code with an isolated scope
 *
 * @param callback - Async function to run
 * @returns Promise with callback result
 */
export async function withScopeAsync<T>(
  callback: (scope: Scope) => Promise<T>
): Promise<T> {
  const previousScope = _currentScope;
  _currentScope = new Scope(_currentScope);
  _scopeStack.push(previousScope);

  try {
    return await callback(_currentScope);
  } finally {
    _currentScope = _scopeStack.pop() || new Scope(_globalScope);
  }
}

/**
 * Reset all scopes (for testing)
 */
export function resetScopes(): void {
  _globalScope = new Scope();
  _currentScope = new Scope();
  _scopeStack.length = 0;
}
