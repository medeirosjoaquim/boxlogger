/**
 * Tests for Scope Management
 */

import {
  Scope,
  getGlobalScope,
  getCurrentScope,
  getIsolationScope,
  configureScope,
  withScope,
  withScopeAsync,
  resetScopes,
  type Breadcrumb,
  type CaptureContext,
  type SeverityLevel,
} from './scope.js';

describe('Scope', () => {
  beforeEach(() => {
    resetScopes();
  });

  describe('constructor', () => {
    it('should create an empty scope', () => {
      const scope = new Scope();
      expect(scope.getTags()).toEqual({});
      expect(scope.getExtras()).toEqual({});
      expect(scope.getUser()).toBeNull();
      expect(scope.getLevel()).toBeNull();
      expect(scope.getFingerprint()).toBeNull();
      expect(scope.getBreadcrumbs()).toEqual([]);
      expect(scope.getContexts()).toEqual({});
    });

    it('should clone from another scope', () => {
      const original = new Scope();
      original.setTag('key', 'value');
      original.setExtra('extraKey', 'extraValue');
      original.setUser({ id: '123', email: 'test@example.com' });
      original.setLevel('error');
      original.setFingerprint(['fingerprint1', 'fingerprint2']);
      original.addBreadcrumb({ message: 'test breadcrumb', category: 'test' });
      original.setContext('browser', { name: 'Chrome', version: '100' });

      const cloned = new Scope(original);

      expect(cloned.getTags()).toEqual({ key: 'value' });
      expect(cloned.getExtras()).toEqual({ extraKey: 'extraValue' });
      expect(cloned.getUser()).toEqual({ id: '123', email: 'test@example.com' });
      expect(cloned.getLevel()).toBe('error');
      expect(cloned.getFingerprint()).toEqual(['fingerprint1', 'fingerprint2']);
      expect(cloned.getBreadcrumbs()).toHaveLength(1);
      expect(cloned.getBreadcrumbs()[0].message).toBe('test breadcrumb');
      expect(cloned.getContext('browser')).toEqual({ name: 'Chrome', version: '100' });
    });

    it('should deep clone and not share references with original', () => {
      const original = new Scope();
      original.setTag('key', 'value');
      original.setExtra('extraKey', { nested: 'data' });
      original.setContext('custom', { deep: { nested: 'value' } });

      const cloned = new Scope(original);

      // Modify cloned scope
      cloned.setTag('key', 'modified');
      cloned.setExtra('extraKey', { nested: 'modified' });
      cloned.setContext('custom', { deep: { nested: 'modified' } });

      // Original should remain unchanged
      expect(original.getTags()).toEqual({ key: 'value' });
      expect(original.getExtras()).toEqual({ extraKey: { nested: 'data' } });
      expect(original.getContext('custom')).toEqual({ deep: { nested: 'value' } });
    });

    it('should clone scope with null user', () => {
      const original = new Scope();
      original.setUser(null);

      const cloned = new Scope(original);
      expect(cloned.getUser()).toBeNull();
    });

    it('should clone scope with null fingerprint', () => {
      const original = new Scope();
      // fingerprint is null by default

      const cloned = new Scope(original);
      expect(cloned.getFingerprint()).toBeNull();
    });
  });

  describe('tags', () => {
    it('should set and get a single tag', () => {
      const scope = new Scope();
      scope.setTag('environment', 'production');

      expect(scope.getTags()).toEqual({ environment: 'production' });
    });

    it('should set multiple tags', () => {
      const scope = new Scope();
      scope.setTags({ env: 'prod', version: '1.0.0', region: 'us-east' });

      expect(scope.getTags()).toEqual({
        env: 'prod',
        version: '1.0.0',
        region: 'us-east',
      });
    });

    it('should return a copy of tags (not a reference)', () => {
      const scope = new Scope();
      scope.setTag('key', 'value');

      const tags = scope.getTags();
      tags.key = 'modified';

      expect(scope.getTags()).toEqual({ key: 'value' });
    });

    it('should support method chaining', () => {
      const scope = new Scope();
      const result = scope.setTag('a', '1').setTag('b', '2').setTags({ c: '3' });

      expect(result).toBe(scope);
      expect(scope.getTags()).toEqual({ a: '1', b: '2', c: '3' });
    });
  });

  describe('extras', () => {
    it('should set and get a single extra', () => {
      const scope = new Scope();
      scope.setExtra('orderId', '12345');

      expect(scope.getExtras()).toEqual({ orderId: '12345' });
    });

    it('should set multiple extras', () => {
      const scope = new Scope();
      scope.setExtras({
        orderId: '12345',
        amount: 99.99,
        items: ['item1', 'item2'],
      });

      expect(scope.getExtras()).toEqual({
        orderId: '12345',
        amount: 99.99,
        items: ['item1', 'item2'],
      });
    });

    it('should return a copy of extras (not a reference)', () => {
      const scope = new Scope();
      scope.setExtra('data', { nested: 'value' });

      const extras = scope.getExtras();
      extras.data = 'modified';

      expect(scope.getExtras()).toEqual({ data: { nested: 'value' } });
    });

    it('should support method chaining', () => {
      const scope = new Scope();
      const result = scope.setExtra('a', 1).setExtra('b', 2).setExtras({ c: 3 });

      expect(result).toBe(scope);
      expect(scope.getExtras()).toEqual({ a: 1, b: 2, c: 3 });
    });
  });

  describe('user', () => {
    it('should set and get user', () => {
      const scope = new Scope();
      scope.setUser({ id: '123', email: 'user@example.com', username: 'testuser' });

      expect(scope.getUser()).toEqual({
        id: '123',
        email: 'user@example.com',
        username: 'testuser',
      });
    });

    it('should clear user when set to null', () => {
      const scope = new Scope();
      scope.setUser({ id: '123' });
      scope.setUser(null);

      expect(scope.getUser()).toBeNull();
    });

    it('should return a copy of user (not a reference)', () => {
      const scope = new Scope();
      scope.setUser({ id: '123', email: 'test@example.com' });

      const user = scope.getUser();
      if (user) {
        user.email = 'modified@example.com';
      }

      expect(scope.getUser()?.email).toBe('test@example.com');
    });

    it('should support method chaining', () => {
      const scope = new Scope();
      const result = scope.setUser({ id: '123' });

      expect(result).toBe(scope);
    });
  });

  describe('level', () => {
    it('should set and get level', () => {
      const scope = new Scope();
      scope.setLevel('error');

      expect(scope.getLevel()).toBe('error');
    });

    it('should support all severity levels', () => {
      const levels: SeverityLevel[] = ['fatal', 'error', 'warning', 'log', 'info', 'debug'];
      const scope = new Scope();

      for (const level of levels) {
        scope.setLevel(level);
        expect(scope.getLevel()).toBe(level);
      }
    });

    it('should support method chaining', () => {
      const scope = new Scope();
      const result = scope.setLevel('warning');

      expect(result).toBe(scope);
    });
  });

  describe('fingerprint', () => {
    it('should set and get fingerprint', () => {
      const scope = new Scope();
      scope.setFingerprint(['payment', 'checkout', 'error']);

      expect(scope.getFingerprint()).toEqual(['payment', 'checkout', 'error']);
    });

    it('should return null when fingerprint is not set', () => {
      const scope = new Scope();
      expect(scope.getFingerprint()).toBeNull();
    });

    it('should return a copy of fingerprint (not a reference)', () => {
      const scope = new Scope();
      scope.setFingerprint(['original']);

      const fingerprint = scope.getFingerprint();
      if (fingerprint) {
        fingerprint.push('modified');
      }

      expect(scope.getFingerprint()).toEqual(['original']);
    });

    it('should support method chaining', () => {
      const scope = new Scope();
      const result = scope.setFingerprint(['test']);

      expect(result).toBe(scope);
    });
  });

  describe('contexts', () => {
    it('should set and get a named context', () => {
      const scope = new Scope();
      scope.setContext('browser', { name: 'Chrome', version: '100' });

      expect(scope.getContext('browser')).toEqual({ name: 'Chrome', version: '100' });
    });

    it('should return undefined for non-existent context', () => {
      const scope = new Scope();
      expect(scope.getContext('nonexistent')).toBeUndefined();
    });

    it('should clear context when set to null', () => {
      const scope = new Scope();
      scope.setContext('browser', { name: 'Chrome' });
      scope.setContext('browser', null);

      expect(scope.getContext('browser')).toBeUndefined();
    });

    it('should get all contexts', () => {
      const scope = new Scope();
      scope.setContext('browser', { name: 'Chrome' });
      scope.setContext('os', { name: 'macOS' });
      scope.setContext('device', { family: 'Desktop' });

      expect(scope.getContexts()).toEqual({
        browser: { name: 'Chrome' },
        os: { name: 'macOS' },
        device: { family: 'Desktop' },
      });
    });

    it('should return a deep copy of contexts', () => {
      const scope = new Scope();
      scope.setContext('custom', { deep: { nested: 'value' } });

      const contexts = scope.getContexts();
      contexts.custom.deep = { nested: 'modified' };

      expect(scope.getContext('custom')).toEqual({ deep: { nested: 'value' } });
    });

    it('should return a copy of individual context', () => {
      const scope = new Scope();
      scope.setContext('browser', { name: 'Chrome' });

      const context = scope.getContext('browser');
      if (context) {
        context.name = 'Firefox';
      }

      expect(scope.getContext('browser')).toEqual({ name: 'Chrome' });
    });

    it('should support method chaining', () => {
      const scope = new Scope();
      const result = scope.setContext('test', { key: 'value' });

      expect(result).toBe(scope);
    });
  });

  describe('breadcrumbs', () => {
    it('should add and get breadcrumbs', () => {
      const scope = new Scope();
      scope.addBreadcrumb({ message: 'First action', category: 'ui' });
      scope.addBreadcrumb({ message: 'Second action', category: 'navigation' });

      const breadcrumbs = scope.getBreadcrumbs();
      expect(breadcrumbs).toHaveLength(2);
      expect(breadcrumbs[0].message).toBe('First action');
      expect(breadcrumbs[1].message).toBe('Second action');
    });

    it('should add timestamp if not provided', () => {
      const scope = new Scope();
      const beforeTime = Date.now() / 1000;
      scope.addBreadcrumb({ message: 'Test' });
      const afterTime = Date.now() / 1000;

      const breadcrumbs = scope.getBreadcrumbs();
      expect(breadcrumbs[0].timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(breadcrumbs[0].timestamp).toBeLessThanOrEqual(afterTime);
    });

    it('should preserve provided timestamp', () => {
      const scope = new Scope();
      const customTimestamp = 1234567890;
      scope.addBreadcrumb({ message: 'Test', timestamp: customTimestamp });

      expect(scope.getBreadcrumbs()[0].timestamp).toBe(customTimestamp);
    });

    it('should return a copy of breadcrumbs (not a reference)', () => {
      const scope = new Scope();
      scope.addBreadcrumb({ message: 'Original' });

      const breadcrumbs = scope.getBreadcrumbs();
      breadcrumbs.push({ message: 'Added' });

      expect(scope.getBreadcrumbs()).toHaveLength(1);
    });

    it('should enforce max breadcrumbs limit', () => {
      const scope = new Scope();
      // Default max is 100, add 105 breadcrumbs
      for (let i = 0; i < 105; i++) {
        scope.addBreadcrumb({ message: `Breadcrumb ${i}` });
      }

      const breadcrumbs = scope.getBreadcrumbs();
      expect(breadcrumbs).toHaveLength(100);
      // First 5 should have been removed
      expect(breadcrumbs[0].message).toBe('Breadcrumb 5');
      expect(breadcrumbs[99].message).toBe('Breadcrumb 104');
    });

    it('should clear all breadcrumbs', () => {
      const scope = new Scope();
      scope.addBreadcrumb({ message: 'First' });
      scope.addBreadcrumb({ message: 'Second' });

      scope.clearBreadcrumbs();

      expect(scope.getBreadcrumbs()).toEqual([]);
    });

    it('should support method chaining for addBreadcrumb', () => {
      const scope = new Scope();
      const result = scope.addBreadcrumb({ message: 'Test' });

      expect(result).toBe(scope);
    });

    it('should support method chaining for clearBreadcrumbs', () => {
      const scope = new Scope();
      scope.addBreadcrumb({ message: 'Test' });
      const result = scope.clearBreadcrumbs();

      expect(result).toBe(scope);
    });

    it('should handle breadcrumb with all properties', () => {
      const scope = new Scope();
      const breadcrumb: Breadcrumb = {
        type: 'http',
        category: 'api',
        message: 'API call',
        level: 'info',
        timestamp: 1234567890,
        data: { url: '/api/users', status: 200 },
      };

      scope.addBreadcrumb(breadcrumb);

      const stored = scope.getBreadcrumbs()[0];
      expect(stored.type).toBe('http');
      expect(stored.category).toBe('api');
      expect(stored.message).toBe('API call');
      expect(stored.level).toBe('info');
      expect(stored.timestamp).toBe(1234567890);
      expect(stored.data).toEqual({ url: '/api/users', status: 200 });
    });
  });

  describe('clear', () => {
    it('should clear all scope data', () => {
      const scope = new Scope();
      scope.setTag('key', 'value');
      scope.setExtra('extra', 'data');
      scope.setUser({ id: '123' });
      scope.setLevel('error');
      scope.setFingerprint(['test']);
      scope.addBreadcrumb({ message: 'Test' });
      scope.setContext('browser', { name: 'Chrome' });

      scope.clear();

      expect(scope.getTags()).toEqual({});
      expect(scope.getExtras()).toEqual({});
      expect(scope.getUser()).toBeNull();
      expect(scope.getLevel()).toBeNull();
      expect(scope.getFingerprint()).toBeNull();
      expect(scope.getBreadcrumbs()).toEqual([]);
      expect(scope.getContexts()).toEqual({});
    });

    it('should support method chaining', () => {
      const scope = new Scope();
      scope.setTag('key', 'value');
      const result = scope.clear();

      expect(result).toBe(scope);
    });
  });

  describe('clone', () => {
    it('should create an independent clone', () => {
      const original = new Scope();
      original.setTag('env', 'production');
      original.setExtra('data', { value: 1 });
      original.setUser({ id: 'user1' });
      original.setLevel('warning');
      original.setFingerprint(['clone-test']);
      original.addBreadcrumb({ message: 'Original breadcrumb' });
      original.setContext('app', { name: 'Test App' });

      const cloned = original.clone();

      // Verify cloned data matches
      expect(cloned.getTags()).toEqual({ env: 'production' });
      expect(cloned.getExtras()).toEqual({ data: { value: 1 } });
      expect(cloned.getUser()).toEqual({ id: 'user1' });
      expect(cloned.getLevel()).toBe('warning');
      expect(cloned.getFingerprint()).toEqual(['clone-test']);
      expect(cloned.getBreadcrumbs()).toHaveLength(1);
      expect(cloned.getContext('app')).toEqual({ name: 'Test App' });

      // Modify cloned scope
      cloned.setTag('env', 'staging');
      cloned.setExtra('data', { value: 2 });
      cloned.setUser({ id: 'user2' });

      // Original should be unchanged
      expect(original.getTags()).toEqual({ env: 'production' });
      expect(original.getExtras()).toEqual({ data: { value: 1 } });
      expect(original.getUser()).toEqual({ id: 'user1' });
    });
  });

  describe('applyContext', () => {
    it('should apply all context properties', () => {
      const scope = new Scope();
      const context: CaptureContext = {
        tags: { env: 'production' },
        extra: { orderId: '123' },
        user: { id: 'user1', email: 'test@example.com' },
        level: 'error',
        fingerprint: ['payment', 'error'],
        contexts: {
          browser: { name: 'Chrome' },
          os: { name: 'macOS' },
        },
      };

      scope.applyContext(context);

      expect(scope.getTags()).toEqual({ env: 'production' });
      expect(scope.getExtras()).toEqual({ orderId: '123' });
      expect(scope.getUser()).toEqual({ id: 'user1', email: 'test@example.com' });
      expect(scope.getLevel()).toBe('error');
      expect(scope.getFingerprint()).toEqual(['payment', 'error']);
      expect(scope.getContext('browser')).toEqual({ name: 'Chrome' });
      expect(scope.getContext('os')).toEqual({ name: 'macOS' });
    });

    it('should handle partial context', () => {
      const scope = new Scope();
      scope.applyContext({ tags: { only: 'tags' } });

      expect(scope.getTags()).toEqual({ only: 'tags' });
      expect(scope.getExtras()).toEqual({});
      expect(scope.getUser()).toBeNull();
      expect(scope.getLevel()).toBeNull();
    });

    it('should handle empty context object', () => {
      const scope = new Scope();
      scope.setTag('existing', 'value');
      scope.setExtra('existing', 'data');

      scope.applyContext({});

      // Existing data should remain unchanged
      expect(scope.getTags()).toEqual({ existing: 'value' });
      expect(scope.getExtras()).toEqual({ existing: 'data' });
      expect(scope.getUser()).toBeNull();
      expect(scope.getLevel()).toBeNull();
      expect(scope.getFingerprint()).toBeNull();
    });

    it('should merge with existing data', () => {
      const scope = new Scope();
      scope.setTag('existing', 'tag');
      scope.setExtra('existing', 'extra');

      scope.applyContext({
        tags: { new: 'tag' },
        extra: { new: 'extra' },
      });

      expect(scope.getTags()).toEqual({ existing: 'tag', new: 'tag' });
      expect(scope.getExtras()).toEqual({ existing: 'extra', new: 'extra' });
    });

    it('should support method chaining', () => {
      const scope = new Scope();
      const result = scope.applyContext({ tags: { key: 'value' } });

      expect(result).toBe(scope);
    });
  });

  describe('toMetadata', () => {
    it('should convert scope to LogMetadata with all data', () => {
      const scope = new Scope();
      scope.setTag('env', 'production');
      scope.setExtra('orderId', '12345');
      scope.setUser({ id: 'user1', email: 'test@example.com' });
      scope.setFingerprint(['error-group']);
      scope.addBreadcrumb({ message: 'User action', category: 'ui' });
      scope.setContext('device', { family: 'Desktop' });

      const metadata = scope.toMetadata();

      expect(metadata.tags).toEqual({ env: 'production' });
      expect(metadata.extra).toMatchObject({ orderId: '12345' });
      expect(metadata.extra?._fingerprint).toEqual(['error-group']);
      expect(metadata.extra?._breadcrumbs).toHaveLength(1);
      expect(metadata.extra?._contexts).toEqual({ device: { family: 'Desktop' } });
      expect(metadata.user).toEqual({ id: 'user1', email: 'test@example.com' });
    });

    it('should return empty metadata for empty scope', () => {
      const scope = new Scope();
      const metadata = scope.toMetadata();

      expect(metadata).toEqual({});
    });

    it('should not include empty collections', () => {
      const scope = new Scope();
      scope.setUser({ id: '123' });

      const metadata = scope.toMetadata();

      expect(metadata.tags).toBeUndefined();
      expect(metadata.extra).toBeUndefined();
      expect(metadata.user).toEqual({ id: '123' });
    });
  });
});

describe('Global Scope Management', () => {
  beforeEach(() => {
    resetScopes();
  });

  describe('getGlobalScope', () => {
    it('should return the global scope', () => {
      const globalScope = getGlobalScope();
      expect(globalScope).toBeInstanceOf(Scope);
    });

    it('should return the same instance on multiple calls', () => {
      const scope1 = getGlobalScope();
      const scope2 = getGlobalScope();
      expect(scope1).toBe(scope2);
    });
  });

  describe('getCurrentScope', () => {
    it('should return the current scope', () => {
      const currentScope = getCurrentScope();
      expect(currentScope).toBeInstanceOf(Scope);
    });

    it('should return the same instance on multiple calls', () => {
      const scope1 = getCurrentScope();
      const scope2 = getCurrentScope();
      expect(scope1).toBe(scope2);
    });
  });

  describe('getIsolationScope', () => {
    it('should return the isolation scope (same as current)', () => {
      const isolationScope = getIsolationScope();
      const currentScope = getCurrentScope();
      expect(isolationScope).toBe(currentScope);
    });
  });

  describe('configureScope', () => {
    it('should configure the global scope', () => {
      configureScope((scope) => {
        scope.setTag('environment', 'production');
        scope.setTag('release', '1.0.0');
      });

      expect(getGlobalScope().getTags()).toEqual({
        environment: 'production',
        release: '1.0.0',
      });
    });

    it('should update current scope after configuration', () => {
      configureScope((scope) => {
        scope.setTag('global', 'value');
      });

      expect(getCurrentScope().getTags()).toEqual({ global: 'value' });
    });
  });

  describe('withScope', () => {
    it('should run callback with isolated scope', () => {
      getCurrentScope().setTag('outer', 'value');

      withScope((scope) => {
        scope.setTag('inner', 'value');
        expect(scope.getTags()).toEqual({ outer: 'value', inner: 'value' });
      });

      expect(getCurrentScope().getTags()).toEqual({ outer: 'value' });
    });

    it('should return callback result', () => {
      const result = withScope(() => {
        return 42;
      });

      expect(result).toBe(42);
    });

    it('should restore scope after callback', () => {
      const beforeScope = getCurrentScope();
      beforeScope.setTag('original', 'value');

      withScope((scope) => {
        scope.setTag('temporary', 'value');
      });

      expect(getCurrentScope().getTags()).toEqual({ original: 'value' });
    });

    it('should handle nested withScope calls', () => {
      getCurrentScope().setTag('level', '0');

      withScope((scope1) => {
        scope1.setTag('level', '1');
        expect(scope1.getTags()).toEqual({ level: '1' });

        withScope((scope2) => {
          scope2.setTag('level', '2');
          expect(scope2.getTags()).toEqual({ level: '2' });

          withScope((scope3) => {
            scope3.setTag('level', '3');
            expect(scope3.getTags()).toEqual({ level: '3' });
          });

          expect(getCurrentScope().getTags()).toEqual({ level: '2' });
        });

        expect(getCurrentScope().getTags()).toEqual({ level: '1' });
      });

      expect(getCurrentScope().getTags()).toEqual({ level: '0' });
    });

    it('should restore scope after exception', () => {
      getCurrentScope().setTag('before', 'exception');

      try {
        withScope((scope) => {
          scope.setTag('error', 'scope');
          throw new Error('Test error');
        });
      } catch (e) {
        // Expected
      }

      expect(getCurrentScope().getTags()).toEqual({ before: 'exception' });
    });

    it('should provide current scope to callback', () => {
      let capturedScope: Scope | null = null;

      withScope((scope) => {
        capturedScope = scope;
      });

      expect(capturedScope).toBeInstanceOf(Scope);
    });
  });

  describe('withScopeAsync', () => {
    it('should run async callback with isolated scope', async () => {
      getCurrentScope().setTag('outer', 'value');

      await withScopeAsync(async (scope) => {
        scope.setTag('inner', 'value');
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(scope.getTags()).toEqual({ outer: 'value', inner: 'value' });
      });

      expect(getCurrentScope().getTags()).toEqual({ outer: 'value' });
    });

    it('should return async callback result', async () => {
      const result = await withScopeAsync(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'async result';
      });

      expect(result).toBe('async result');
    });

    it('should restore scope after async callback completes', async () => {
      const beforeTags = { original: 'value' };
      getCurrentScope().setTags(beforeTags);

      await withScopeAsync(async (scope) => {
        scope.setTag('temporary', 'async-value');
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      expect(getCurrentScope().getTags()).toEqual(beforeTags);
    });

    it('should handle nested async withScope calls', async () => {
      getCurrentScope().setTag('level', '0');

      await withScopeAsync(async (scope1) => {
        scope1.setTag('level', '1');
        await new Promise((resolve) => setTimeout(resolve, 5));

        await withScopeAsync(async (scope2) => {
          scope2.setTag('level', '2');
          await new Promise((resolve) => setTimeout(resolve, 5));
          expect(scope2.getTags()).toEqual({ level: '2' });
        });

        expect(getCurrentScope().getTags()).toEqual({ level: '1' });
      });

      expect(getCurrentScope().getTags()).toEqual({ level: '0' });
    });

    it('should restore scope after async exception', async () => {
      getCurrentScope().setTag('before', 'async-exception');

      try {
        await withScopeAsync(async (scope) => {
          scope.setTag('error', 'async-scope');
          await new Promise((resolve) => setTimeout(resolve, 10));
          throw new Error('Async test error');
        });
      } catch (e) {
        // Expected
      }

      expect(getCurrentScope().getTags()).toEqual({ before: 'async-exception' });
    });

    it('should work with Promise-returning callback', async () => {
      const result = await withScopeAsync((scope) => {
        scope.setTag('key', 'value');
        return Promise.resolve({ success: true });
      });

      expect(result).toEqual({ success: true });
    });

    it('should handle empty scope stack gracefully (fallback to global scope)', async () => {
      // Configure global scope before the async operation
      configureScope((scope) => {
        scope.setTag('global', 'fallback');
      });

      await withScopeAsync(async (scope) => {
        scope.setTag('async', 'value');
        // Clear the stack while inside async scope - this triggers the fallback
        resetScopes();
        // Re-configure global for the fallback
        configureScope((s) => {
          s.setTag('recovered', 'true');
        });
      });

      // After the async scope ends, it should fall back to a scope based on global
      // Since we reset and reconfigured, the current scope should have 'recovered'
      expect(getCurrentScope().getTags()).toEqual({ recovered: 'true' });
    });
  });

  describe('resetScopes', () => {
    it('should reset all scopes to empty state', () => {
      configureScope((scope) => {
        scope.setTag('global', 'value');
      });
      getCurrentScope().setTag('current', 'value');

      resetScopes();

      expect(getGlobalScope().getTags()).toEqual({});
      expect(getCurrentScope().getTags()).toEqual({});
    });

    it('should clear the scope stack', () => {
      withScope((scope) => {
        scope.setTag('nested', 'value');
        resetScopes();
      });

      // After reset, getCurrentScope should be a fresh scope
      expect(getCurrentScope().getTags()).toEqual({});
    });
  });
});
