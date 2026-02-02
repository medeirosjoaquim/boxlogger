/**
 * Sentry API Compatibility Tests
 *
 * Validates that the API surface matches Sentry's official JavaScript SDK.
 * Tests are organized by feature category from Sentry documentation.
 *
 * @see https://docs.sentry.io/platforms/javascript/
 */

import * as Sentry from './index.js';

// =============================================================================
// Top 5 Sentry Functions - Complete Coverage
// =============================================================================

describe('Sentry API Compatibility', () => {
  beforeEach(async () => {
    await Sentry.init('memory');
  });

  afterEach(async () => {
    await Sentry.close();
  });

  // ---------------------------------------------------------------------------
  // 1. captureException() - Error Monitoring
  // ---------------------------------------------------------------------------
  describe('captureException()', () => {
    it('should match Sentry signature: captureException(error)', () => {
      const eventId = Sentry.captureException(new Error('Test'));
      expect(typeof eventId).toBe('string');
    });

    it('should match Sentry signature: captureException(error, context)', () => {
      const eventId = Sentry.captureException(new Error('Test'), {
        tags: { key: 'value' },
        extra: { data: 123 },
        level: 'error',
      });
      expect(typeof eventId).toBe('string');
    });

    it('should handle string errors like Sentry', () => {
      const eventId = Sentry.captureException('String error');
      expect(typeof eventId).toBe('string');
    });

    it('should support context.fingerprint for grouping', async () => {
      Sentry.captureException(new Error('Test'), {
        fingerprint: ['custom', 'fingerprint'],
      });

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].metadata?.extra?._fingerprint).toEqual(['custom', 'fingerprint']);
    });

    it('should support context.user override', async () => {
      Sentry.setUser({ id: 'global' });

      Sentry.captureException(new Error('Test'), {
        user: { id: 'override' },
      });

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].metadata?.user?.id).toBe('override');
    });

    it('should support context.contexts for named contexts', async () => {
      Sentry.captureException(new Error('Test'), {
        contexts: {
          browser: { name: 'Chrome', version: '120' },
          device: { family: 'Desktop' },
        },
      });

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      const contexts = logs[0].metadata?.extra?._contexts as any;
      expect(contexts?.browser?.name).toBe('Chrome');
      expect(contexts?.device?.family).toBe('Desktop');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. captureMessage() - Custom Alerts
  // ---------------------------------------------------------------------------
  describe('captureMessage()', () => {
    it('should match Sentry signature: captureMessage(message)', () => {
      const eventId = Sentry.captureMessage('Test message');
      expect(typeof eventId).toBe('string');
    });

    it('should match Sentry signature: captureMessage(message, level)', async () => {
      Sentry.captureMessage('Warning message', 'warning');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].level).toBe('warn');
    });

    it('should match Sentry signature: captureMessage(message, context)', async () => {
      Sentry.captureMessage('Info message', {
        level: 'info',
        tags: { source: 'manual' },
        extra: { count: 42 },
      });

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].level).toBe('info');
      expect(logs[0].metadata?.tags?.source).toBe('manual');
    });

    it('should support all Sentry severity levels', async () => {
      const levels: Array<[Sentry.SeverityLevel, Sentry.LogLevel]> = [
        ['fatal', 'fatal'],
        ['error', 'error'],
        ['warning', 'warn'],
        ['log', 'info'],
        ['info', 'info'],
        ['debug', 'debug'],
      ];

      // Test each level separately, capturing all in one session
      await Sentry.close();
      await Sentry.init('memory', { minLevel: 'debug' });

      for (const [sentryLevel, expectedLevel] of levels) {
        Sentry.captureMessage(`Test ${sentryLevel}`, sentryLevel);
        await new Promise((r) => setTimeout(r, 20));
        const logs = await Sentry.getLogs();
        const lastLog = logs[logs.length - 1];
        expect(lastLog.level).toBe(expectedLevel);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 3. setUser() - User Context
  // ---------------------------------------------------------------------------
  describe('setUser()', () => {
    it('should match Sentry signature: setUser(user)', async () => {
      Sentry.setUser({
        id: '123',
        email: 'test@example.com',
        username: 'testuser',
      });

      Sentry.captureMessage('Test');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].metadata?.user?.id).toBe('123');
      expect(logs[0].metadata?.user?.email).toBe('test@example.com');
    });

    it('should support ip_address: "{{auto}}" like Sentry', async () => {
      Sentry.setUser({
        id: '123',
        ip_address: '{{auto}}',
      });

      Sentry.captureMessage('Test');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].metadata?.user?.ip_address).toBe('{{auto}}');
    });

    it('should support segment field for analytics', async () => {
      Sentry.setUser({
        id: '123',
        segment: 'enterprise',
      });

      Sentry.captureMessage('Test');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].metadata?.user?.segment).toBe('enterprise');
    });

    it('should clear user with null like Sentry', async () => {
      Sentry.setUser({ id: '123' });
      Sentry.setUser(null);

      Sentry.captureMessage('Test');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].metadata?.user).toBeUndefined();
    });

    it('should support custom fields like Sentry', async () => {
      Sentry.setUser({
        id: '123',
        customField: 'customValue',
        plan: 'pro',
      } as any);

      Sentry.captureMessage('Test');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect((logs[0].metadata?.user as any)?.customField).toBe('customValue');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. addBreadcrumb() - Event Trail
  // ---------------------------------------------------------------------------
  describe('addBreadcrumb()', () => {
    it('should match Sentry signature: addBreadcrumb(breadcrumb)', async () => {
      Sentry.addBreadcrumb({
        category: 'navigation',
        message: 'Navigated to /checkout',
        level: 'info',
      });

      Sentry.captureMessage('Test');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      const breadcrumbs = logs[0].metadata?.extra?._breadcrumbs as any[];
      expect(breadcrumbs.length).toBeGreaterThan(0);
      expect(breadcrumbs[0].category).toBe('navigation');
    });

    it('should auto-add timestamp like Sentry', async () => {
      Sentry.addBreadcrumb({
        category: 'test',
        message: 'Test',
      });

      Sentry.captureMessage('Test');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      const breadcrumbs = logs[0].metadata?.extra?._breadcrumbs as any[];
      expect(typeof breadcrumbs[0].timestamp).toBe('number');
      // Sentry uses seconds, not milliseconds
      expect(breadcrumbs[0].timestamp).toBeLessThan(Date.now());
    });

    it('should support type field like Sentry', async () => {
      Sentry.addBreadcrumb({
        type: 'http',
        category: 'xhr',
        message: 'GET /api/users',
        data: { method: 'GET', url: '/api/users', status_code: 200 },
      });

      Sentry.captureMessage('Test');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      const breadcrumbs = logs[0].metadata?.extra?._breadcrumbs as any[];
      expect(breadcrumbs[0].type).toBe('http');
      expect(breadcrumbs[0].data?.status_code).toBe(200);
    });

    it('should support all Sentry breadcrumb categories', async () => {
      const categories = ['http', 'navigation', 'ui.click', 'console', 'debug', 'query'];

      for (const category of categories) {
        Sentry.addBreadcrumb({ category, message: `Test ${category}` });
      }

      Sentry.captureMessage('Test');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      const breadcrumbs = logs[0].metadata?.extra?._breadcrumbs as any[];
      expect(breadcrumbs.length).toBe(categories.length);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. withScope() - Isolated Context
  // ---------------------------------------------------------------------------
  describe('withScope()', () => {
    it('should match Sentry signature: withScope(callback)', () => {
      const result = Sentry.withScope((scope) => {
        scope.setTag('test', 'value');
        return 'result';
      });

      expect(result).toBe('result');
    });

    it('should provide scope with setTag method', async () => {
      Sentry.withScope((scope) => {
        scope.setTag('isolated', 'yes');
        Sentry.captureMessage('In scope');
      });

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].metadata?.tags?.isolated).toBe('yes');
    });

    it('should provide scope with setExtra method', async () => {
      Sentry.withScope((scope) => {
        scope.setExtra('orderId', '12345');
        Sentry.captureMessage('In scope');
      });

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].metadata?.extra?.orderId).toBe('12345');
    });

    it('should provide scope with setUser method', async () => {
      Sentry.withScope((scope) => {
        scope.setUser({ id: 'scoped-user' });
        Sentry.captureMessage('In scope');
      });

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].metadata?.user?.id).toBe('scoped-user');
    });

    it('should provide scope with setFingerprint method', async () => {
      Sentry.withScope((scope) => {
        scope.setFingerprint(['custom', 'group']);
        Sentry.captureMessage('In scope');
      });

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].metadata?.extra?._fingerprint).toEqual(['custom', 'group']);
    });

    it('should provide scope with setLevel method', () => {
      Sentry.withScope((scope) => {
        scope.setLevel('warning');
        // Level is applied via scope
        expect(scope.getLevel()).toBe('warning');
      });
    });

    it('should provide scope with setContext method', async () => {
      Sentry.withScope((scope) => {
        scope.setContext('payment', { processor: 'stripe' });
        Sentry.captureMessage('In scope');
      });

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      const contexts = logs[0].metadata?.extra?._contexts as any;
      expect(contexts?.payment?.processor).toBe('stripe');
    });

    it('should isolate scope changes like Sentry', async () => {
      Sentry.setTag('global', 'yes');

      Sentry.withScope((scope) => {
        scope.setTag('scoped', 'yes');
        Sentry.captureMessage('In scope');
      });

      Sentry.captureMessage('Outside scope');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();

      // Sort by timestamp
      logs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      expect(logs[0].metadata?.tags?.scoped).toBe('yes');
      expect(logs[1].metadata?.tags?.scoped).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // configureScope() - Global Scope Configuration
  // ---------------------------------------------------------------------------
  describe('configureScope()', () => {
    it('should match Sentry signature: configureScope(callback)', async () => {
      Sentry.configureScope((scope) => {
        scope.setTag('app_version', '1.0.0');
      });

      Sentry.captureMessage('Test');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].metadata?.tags?.app_version).toBe('1.0.0');
    });

    it('should affect all subsequent events like Sentry', async () => {
      Sentry.configureScope((scope) => {
        scope.setTag('environment', 'production');
      });

      Sentry.captureMessage('First');
      Sentry.captureMessage('Second');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();

      expect(logs.every((l) => l.metadata?.tags?.environment === 'production')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // setTag() / setTags() - Tag Management
  // ---------------------------------------------------------------------------
  describe('setTag() / setTags()', () => {
    it('should match Sentry signature: setTag(key, value)', async () => {
      Sentry.setTag('release', '1.0.0');

      Sentry.captureMessage('Test');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].metadata?.tags?.release).toBe('1.0.0');
    });

    it('should match Sentry signature: setTags(tags)', async () => {
      Sentry.setTags({
        environment: 'staging',
        server: 'api-1',
      });

      Sentry.captureMessage('Test');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].metadata?.tags?.environment).toBe('staging');
      expect(logs[0].metadata?.tags?.server).toBe('api-1');
    });
  });

  // ---------------------------------------------------------------------------
  // setExtra() / setExtras() - Extra Data
  // ---------------------------------------------------------------------------
  describe('setExtra() / setExtras()', () => {
    it('should match Sentry signature: setExtra(key, value)', async () => {
      Sentry.setExtra('requestId', 'req_123');

      Sentry.captureMessage('Test');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].metadata?.extra?.requestId).toBe('req_123');
    });

    it('should match Sentry signature: setExtras(extras)', async () => {
      Sentry.setExtras({
        requestId: 'req_123',
        duration: 150,
      });

      Sentry.captureMessage('Test');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].metadata?.extra?.requestId).toBe('req_123');
      expect(logs[0].metadata?.extra?.duration).toBe(150);
    });
  });

  // ---------------------------------------------------------------------------
  // setContext() - Named Contexts
  // ---------------------------------------------------------------------------
  describe('setContext()', () => {
    it('should match Sentry signature: setContext(name, context)', async () => {
      Sentry.setContext('browser', {
        name: 'Chrome',
        version: '120.0.0',
      });

      Sentry.captureMessage('Test');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      const contexts = logs[0].metadata?.extra?._contexts as any;
      expect(contexts?.browser?.name).toBe('Chrome');
    });

    it('should clear context with null like Sentry', async () => {
      Sentry.setContext('browser', { name: 'Chrome' });
      Sentry.setContext('browser', null);

      Sentry.captureMessage('Test');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      const contexts = logs[0].metadata?.extra?._contexts as any;
      expect(contexts?.browser).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // captureEvent() - Raw Event Capture
  // ---------------------------------------------------------------------------
  describe('captureEvent()', () => {
    it('should match Sentry signature: captureEvent(event)', () => {
      const eventId = Sentry.captureEvent({
        message: 'Manual event',
        level: 'info',
      });

      expect(typeof eventId).toBe('string');
    });

    it('should support all SentryEvent fields', async () => {
      Sentry.captureEvent({
        event_id: 'custom-id',
        message: 'Full event',
        level: 'warning',
        tags: { source: 'manual' },
        extra: { count: 1 },
        user: { id: 'user_1' },
        contexts: { custom: { key: 'value' } },
        fingerprint: ['custom-group'],
      });

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].message).toBe('Full event');
      expect(logs[0].level).toBe('warn');
    });

    it('should support exception events like Sentry', async () => {
      Sentry.captureEvent({
        exception: {
          values: [
            {
              type: 'TypeError',
              value: 'Cannot read property x of undefined',
            },
          ],
        },
      });

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].metadata?.error?.type).toBe('TypeError');
    });
  });

  // ---------------------------------------------------------------------------
  // startTransaction() - Performance Monitoring
  // ---------------------------------------------------------------------------
  describe('startTransaction()', () => {
    it('should match Sentry signature: startTransaction(context)', () => {
      const transaction = Sentry.startTransaction({
        name: 'GET /api/users',
        op: 'http.server',
      });

      expect(transaction.name).toBe('GET /api/users');
      expect(transaction.op).toBe('http.server');
      expect(typeof transaction.traceId).toBe('string');
      expect(typeof transaction.spanId).toBe('string');

      transaction.finish();
    });

    it('should provide setTag method', () => {
      const transaction = Sentry.startTransaction({ name: 'test' });
      transaction.setTag('http.method', 'GET');
      expect(transaction.tags?.['http.method']).toBe('GET');
      transaction.finish();
    });

    it('should provide setData method', () => {
      const transaction = Sentry.startTransaction({ name: 'test' });
      transaction.setData('response.status', 200);
      expect(transaction.data?.['response.status']).toBe(200);
      transaction.finish();
    });

    it('should provide setMeasurement method like Sentry', () => {
      const transaction = Sentry.startTransaction({ name: 'test' });
      transaction.setMeasurement('ttfb', 250, 'millisecond');
      expect(transaction.measurements?.ttfb).toEqual({ value: 250, unit: 'millisecond' });
      transaction.finish();
    });

    it('should provide setStatus method', () => {
      const transaction = Sentry.startTransaction({ name: 'test' });
      transaction.setStatus('ok');
      expect(transaction.status).toBe('ok');
      transaction.finish();
    });

    it('should provide finish method that sets endTimestamp', () => {
      const transaction = Sentry.startTransaction({ name: 'test' });
      expect(transaction.endTimestamp).toBeUndefined();
      transaction.finish();
      expect(transaction.endTimestamp).toBeDefined();
    });

    it('should attach traceId to events during transaction', async () => {
      const transaction = Sentry.startTransaction({ name: 'test' });
      Sentry.captureMessage('During transaction');
      transaction.finish();

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].metadata?.traceId).toBe(transaction.traceId);
      expect(logs[0].metadata?.spanId).toBe(transaction.spanId);
    });
  });

  // ---------------------------------------------------------------------------
  // Init Options - Configuration
  // ---------------------------------------------------------------------------
  describe('Init Options', () => {
    afterEach(async () => {
      await Sentry.close();
    });

    it('should support dsn-less mode like our memory provider', async () => {
      await Sentry.close();
      await Sentry.init('memory');
      expect(Sentry.isInitialized()).toBe(true);
    });

    it('should support environment option', async () => {
      await Sentry.close();
      await Sentry.init('memory', { environment: 'production' });

      Sentry.captureMessage('Test');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].environment).toBe('production');
    });

    it('should support release option', async () => {
      await Sentry.close();
      await Sentry.init('memory', { release: '1.0.0' });

      Sentry.captureMessage('Test');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].release).toBe('1.0.0');
    });

    it('should support sampleRate option', async () => {
      await Sentry.close();
      await Sentry.init('memory', { sampleRate: 0 });

      const eventId = Sentry.captureException(new Error('Test'));
      expect(eventId).toBe('');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs.length).toBe(0);
    });

    it('should support ignoreErrors option', async () => {
      await Sentry.close();
      await Sentry.init('memory', {
        ignoreErrors: ['Ignored error', /ResizeObserver/i],
      });

      Sentry.captureException(new Error('Ignored error'));
      Sentry.captureException(new Error('ResizeObserver loop'));
      Sentry.captureException(new Error('Real error'));

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs.length).toBe(1);
      expect(logs[0].metadata?.error?.message).toBe('Real error');
    });

    it('should support beforeSend option', async () => {
      await Sentry.close();
      await Sentry.init('memory', {
        beforeSend(event) {
          event.metadata = { ...event.metadata, custom: 'added' };
          return event;
        },
      });

      Sentry.captureException(new Error('Test'));

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect((logs[0].metadata as any)?.custom).toBe('added');
    });

    it('should support beforeSend returning null to drop event', async () => {
      await Sentry.close();
      await Sentry.init('memory', {
        beforeSend() {
          return null;
        },
      });

      Sentry.captureException(new Error('Test'));

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Scope Utilities - getCurrentScope, getGlobalScope, etc.
  // ---------------------------------------------------------------------------
  describe('Scope Utilities', () => {
    it('should export getCurrentScope like Sentry', () => {
      const scope = Sentry.getCurrentScope();
      expect(scope).toBeDefined();
      expect(typeof scope.setTag).toBe('function');
    });

    it('should export getGlobalScope like Sentry', () => {
      const scope = Sentry.getGlobalScope();
      expect(scope).toBeDefined();
      expect(typeof scope.setTag).toBe('function');
    });

    it('should export getIsolationScope like Sentry', () => {
      const scope = Sentry.getIsolationScope();
      expect(scope).toBeDefined();
      expect(typeof scope.setTag).toBe('function');
    });
  });

  // ---------------------------------------------------------------------------
  // Session Management
  // ---------------------------------------------------------------------------
  describe('Session Management', () => {
    beforeEach(async () => {
      await Sentry.close();
      await Sentry.init('memory', { enableSessions: true });
    });

    it('should support startSession', async () => {
      const sessionId = await Sentry.startSession();
      expect(typeof sessionId).toBe('string');
    });

    it('should support endSession', async () => {
      await Sentry.startSession();
      await Sentry.endSession();
      expect(Sentry.getCurrentSession()).toBeNull();
    });

    it('should support getCurrentSession', async () => {
      await Sentry.startSession();
      const session = Sentry.getCurrentSession();
      expect(session).not.toBeNull();
      expect(session?.status).toBe('active');
    });
  });

  // ---------------------------------------------------------------------------
  // Classic Logging API
  // ---------------------------------------------------------------------------
  describe('Classic Logging API', () => {
    it('should export fatal()', async () => {
      Sentry.fatal('Fatal error');
      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs({ level: 'fatal' });
      expect(logs.length).toBe(1);
    });

    it('should export error()', async () => {
      Sentry.error('Error message');
      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs({ level: 'error' });
      expect(logs.length).toBe(1);
    });

    it('should export warn()', async () => {
      Sentry.warn('Warning message');
      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs({ level: 'warn' });
      expect(logs.length).toBe(1);
    });

    it('should export info()', async () => {
      Sentry.info('Info message');
      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs({ level: 'info' });
      expect(logs.length).toBe(1);
    });

    it('should export debug()', async () => {
      await Sentry.close();
      await Sentry.init('memory', { minLevel: 'debug' });

      Sentry.debug('Debug message');
      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs({ level: 'debug' });
      expect(logs.length).toBe(1);
    });

    it('should export trace()', async () => {
      await Sentry.close();
      await Sentry.init('memory', { minLevel: 'trace' });

      Sentry.trace('Trace message');
      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs({ level: 'trace' });
      expect(logs.length).toBe(1);
    });

    it('should export exception()', async () => {
      Sentry.exception(new Error('Exception error'));
      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs({ level: 'error' });
      expect(logs[0].metadata?.error?.message).toBe('Exception error');
    });
  });
});

// =============================================================================
// Type Compatibility Tests
// =============================================================================

describe('Type Compatibility', () => {
  it('should export all expected types', () => {
    // Core types
    const logLevel: Sentry.LogLevel = 'error';
    const severityLevel: Sentry.SeverityLevel = 'warning';

    // User info
    const user: Sentry.UserInfo = {
      id: '123',
      email: 'test@example.com',
      username: 'test',
      ip_address: '{{auto}}',
      segment: 'pro',
    };

    // Breadcrumb
    const breadcrumb: Sentry.Breadcrumb = {
      type: 'http',
      category: 'xhr',
      message: 'GET /api',
      level: 'info',
      timestamp: Date.now() / 1000,
      data: { status: 200 },
    };

    // Capture context
    const context: Sentry.CaptureContext = {
      tags: { key: 'value' },
      extra: { data: 123 },
      user: { id: '123' },
      level: 'error',
      fingerprint: ['custom'],
      contexts: { custom: { key: 'value' } },
    };

    expect(logLevel).toBeDefined();
    expect(severityLevel).toBeDefined();
    expect(user).toBeDefined();
    expect(breadcrumb).toBeDefined();
    expect(context).toBeDefined();
  });

  it('should export Scope class', () => {
    const scope = new Sentry.Scope();
    expect(scope.setTag).toBeDefined();
    expect(scope.setExtra).toBeDefined();
    expect(scope.setUser).toBeDefined();
    expect(scope.setLevel).toBeDefined();
    expect(scope.setFingerprint).toBeDefined();
    expect(scope.setContext).toBeDefined();
    expect(scope.addBreadcrumb).toBeDefined();
    expect(scope.clear).toBeDefined();
  });
});
