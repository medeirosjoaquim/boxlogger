/**
 * Comprehensive tests for index.ts (main API)
 *
 * Tests for 100% coverage of all exported functions and edge cases.
 */

import * as Sentry from './index.js';

describe('Index Module - Full Coverage', () => {
  afterEach(async () => {
    await Sentry.close();
  });

  // ---------------------------------------------------------------------------
  // init() function
  // ---------------------------------------------------------------------------
  describe('init()', () => {
    it('should initialize with memory provider by default', async () => {
      await Sentry.init();
      expect(Sentry.isInitialized()).toBe(true);
    });

    it('should close existing instance when reinitializing', async () => {
      await Sentry.init('memory');
      expect(Sentry.isInitialized()).toBe(true);

      // Reinitialize - should close first
      await Sentry.init('memory');
      expect(Sentry.isInitialized()).toBe(true);
    });

    it('should initialize with console provider', async () => {
      await Sentry.init('console');
      expect(Sentry.isInitialized()).toBe(true);
    });

    it('should log debug message when debug option is true', async () => {
      // Store original console.log
      const originalLog = console.log;
      const logCalls: any[][] = [];
      console.log = (...args: any[]) => logCalls.push(args);

      await Sentry.init('memory', { debug: true });

      // Restore console.log
      console.log = originalLog;

      // Verify debug message was logged
      expect(logCalls.some(call =>
        call[0] === '[NodeLogger] Initialized with provider:' && call[1] === 'memory'
      )).toBe(true);
    });

    it('should initialize with all options', async () => {
      await Sentry.init('memory', {
        service: 'test-service',
        environment: 'test',
        release: '1.0.0',
        minLevel: 'debug',
        enableSessions: true,
        defaultMetadata: { tags: { app: 'test' } },
        sampleRate: 0.5,
        messagesSampleRate: 0.5,
        ignoreErrors: ['ignore-me'],
        beforeSend: (event) => event,
        beforeSendMessage: (event) => event,
      });

      expect(Sentry.isInitialized()).toBe(true);
    });

    it('should use process.env.NODE_ENV when environment not provided', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'staging';

      await Sentry.init('memory', {});
      // Can't directly check environment, but should not throw
      expect(Sentry.isInitialized()).toBe(true);

      process.env.NODE_ENV = originalEnv;
    });

    it('should use default environment when neither option nor env var provided', async () => {
      const originalEnv = process.env.NODE_ENV;
      delete process.env.NODE_ENV;

      await Sentry.init('memory', {});
      expect(Sentry.isInitialized()).toBe(true);

      process.env.NODE_ENV = originalEnv;
    });
  });

  // ---------------------------------------------------------------------------
  // create() function
  // ---------------------------------------------------------------------------
  describe('create()', () => {
    it('should create a new isolated logger with memory provider', async () => {
      const logger = await Sentry.create('memory');
      expect(logger).toBeDefined();
      await logger.close();
    });

    it('should create with memory provider by default', async () => {
      const logger = await Sentry.create();
      expect(logger).toBeDefined();
      await logger.close();
    });

    it('should create with console provider', async () => {
      const logger = await Sentry.create('console');
      expect(logger).toBeDefined();
      await logger.close();
    });

    it('should use development environment when process.env is unavailable', async () => {
      const originalProcess = global.process;
      (global as any).process = undefined;

      const logger = await Sentry.create('memory');
      expect(logger).toBeDefined();
      await logger.close();

      global.process = originalProcess;
    });

    it('should create with all options', async () => {
      const logger = await Sentry.create('memory', {
        service: 'test',
        environment: 'production',
        release: '2.0.0',
        minLevel: 'warn',
        enableSessions: true,
        defaultMetadata: { tags: { source: 'create' } },
      });

      expect(logger).toBeDefined();
      await logger.close();
    });
  });

  // ---------------------------------------------------------------------------
  // close() function
  // ---------------------------------------------------------------------------
  describe('close()', () => {
    it('should handle close when not initialized', async () => {
      // Should not throw
      await expect(Sentry.close()).resolves.not.toThrow();
    });

    it('should close and clear state', async () => {
      await Sentry.init('memory');
      expect(Sentry.isInitialized()).toBe(true);

      await Sentry.close();
      expect(Sentry.isInitialized()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // isInitialized() function
  // ---------------------------------------------------------------------------
  describe('isInitialized()', () => {
    it('should return false when not initialized', () => {
      expect(Sentry.isInitialized()).toBe(false);
    });

    it('should return true when initialized', async () => {
      await Sentry.init('memory');
      expect(Sentry.isInitialized()).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // ensureInitialized() - via functions that use it
  // ---------------------------------------------------------------------------
  describe('ensureInitialized (error path)', () => {
    it('should throw when calling log() without init', () => {
      expect(() => Sentry.log('info', 'test')).toThrow('NodeLogger not initialized');
    });

    it('should throw when calling getSessions() without init', async () => {
      await expect(Sentry.getSessions()).rejects.toThrow('NodeLogger not initialized');
    });

    it('should throw when calling getStats() without init', async () => {
      await expect(Sentry.getStats()).rejects.toThrow('NodeLogger not initialized');
    });

    it('should throw when calling setMinLevel() without init', () => {
      expect(() => Sentry.setMinLevel('debug')).toThrow('NodeLogger not initialized');
    });

    it('should throw when calling getMinLevel() without init', () => {
      expect(() => Sentry.getMinLevel()).toThrow('NodeLogger not initialized');
    });

    it('should throw when calling child() without init', () => {
      expect(() => Sentry.child('test')).toThrow('NodeLogger not initialized');
    });
  });

  // ---------------------------------------------------------------------------
  // log() function
  // ---------------------------------------------------------------------------
  describe('log()', () => {
    beforeEach(async () => {
      await Sentry.init('memory');
    });

    it('should log with level and message', async () => {
      Sentry.log('info', 'Test log message');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs.length).toBe(1);
      expect(logs[0].message).toBe('Test log message');
      expect(logs[0].level).toBe('info');
    });

    it('should log with metadata', async () => {
      Sentry.log('warn', 'Warning message', { tags: { source: 'test' } });

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].metadata?.tags?.source).toBe('test');
    });
  });

  // ---------------------------------------------------------------------------
  // getSessions() function
  // ---------------------------------------------------------------------------
  describe('getSessions()', () => {
    beforeEach(async () => {
      await Sentry.init('memory', { enableSessions: true });
    });

    it('should return sessions', async () => {
      await Sentry.startSession();
      const sessions = await Sentry.getSessions();
      expect(sessions.length).toBe(1);
    });

    it('should filter sessions', async () => {
      await Sentry.startSession();
      await Sentry.endSession();

      const activeSessions = await Sentry.getSessions({ status: 'active' });
      expect(activeSessions.length).toBe(0);

      const endedSessions = await Sentry.getSessions({ status: 'ended' });
      expect(endedSessions.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // getStats() function
  // ---------------------------------------------------------------------------
  describe('getStats()', () => {
    beforeEach(async () => {
      await Sentry.init('memory');
    });

    it('should return stats', async () => {
      Sentry.captureMessage('Test');
      await new Promise((r) => setTimeout(r, 50));

      const stats = await Sentry.getStats();
      expect(stats.totalLogs).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // setMinLevel() / getMinLevel()
  // ---------------------------------------------------------------------------
  describe('setMinLevel() / getMinLevel()', () => {
    beforeEach(async () => {
      await Sentry.init('memory');
    });

    it('should get and set min level', () => {
      expect(Sentry.getMinLevel()).toBe('info');

      Sentry.setMinLevel('debug');
      expect(Sentry.getMinLevel()).toBe('debug');
    });
  });

  // ---------------------------------------------------------------------------
  // isLevelEnabled() function
  // ---------------------------------------------------------------------------
  describe('isLevelEnabled()', () => {
    it('should return false when not initialized', () => {
      expect(Sentry.isLevelEnabled('info')).toBe(false);
    });

    it('should check if level is enabled', async () => {
      await Sentry.init('memory', { minLevel: 'warn' });

      expect(Sentry.isLevelEnabled('error')).toBe(true);
      expect(Sentry.isLevelEnabled('warn')).toBe(true);
      expect(Sentry.isLevelEnabled('info')).toBe(false);
      expect(Sentry.isLevelEnabled('debug')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // child() function
  // ---------------------------------------------------------------------------
  describe('child()', () => {
    beforeEach(async () => {
      await Sentry.init('memory');
    });

    it('should create child logger', () => {
      const child = Sentry.child('child-name');
      expect(child).toBeDefined();
    });

    it('should create child logger with metadata', () => {
      const child = Sentry.child('child', { tags: { module: 'auth' } });
      expect(child).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // mapSeverityToLogLevel - default case
  // ---------------------------------------------------------------------------
  describe('mapSeverityToLogLevel (via captureMessage)', () => {
    beforeEach(async () => {
      await Sentry.init('memory');
    });

    it('should handle unknown severity level with default', async () => {
      // Pass an unknown level (will hit default case)
      Sentry.captureMessage('Test', 'unknown-level' as any);

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      // Default is 'info'
      expect(logs[0].level).toBe('info');
    });
  });

  // ---------------------------------------------------------------------------
  // Transaction - edge cases for if (!this.tags/data/measurements) branches
  // ---------------------------------------------------------------------------
  describe('Transaction edge cases', () => {
    beforeEach(async () => {
      await Sentry.init('memory');
    });

    it('should handle setTag when tags is undefined', () => {
      const transaction = Sentry.startTransaction({ name: 'test' });
      // Manually set tags to undefined to test the branch
      (transaction as any).tags = undefined;

      transaction.setTag('key', 'value');
      expect(transaction.tags?.key).toBe('value');

      transaction.finish();
    });

    it('should handle setData when data is undefined', () => {
      const transaction = Sentry.startTransaction({ name: 'test' });
      // Manually set data to undefined to test the branch
      (transaction as any).data = undefined;

      transaction.setData('key', 'value');
      expect(transaction.data?.key).toBe('value');

      transaction.finish();
    });

    it('should handle setMeasurement when measurements is undefined', () => {
      const transaction = Sentry.startTransaction({ name: 'test' });
      // Manually set measurements to undefined to test the branch
      (transaction as any).measurements = undefined;

      transaction.setMeasurement('ttfb', 100);
      expect(transaction.measurements?.ttfb?.value).toBe(100);

      transaction.finish();
    });
  });

  // ---------------------------------------------------------------------------
  // mergeWithScopeMetadata - traceId/spanId from active transaction
  // ---------------------------------------------------------------------------
  describe('mergeWithScopeMetadata with active transaction', () => {
    beforeEach(async () => {
      await Sentry.init('memory');
    });

    it('should attach traceId and spanId from active transaction to log()', async () => {
      const transaction = Sentry.startTransaction({ name: 'test-op' });

      Sentry.log('info', 'During transaction');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();

      expect(logs[0].metadata?.traceId).toBe(transaction.traceId);
      expect(logs[0].metadata?.spanId).toBe(transaction.spanId);

      transaction.finish();
    });
  });

  // ---------------------------------------------------------------------------
  // getCurrentSession() when not initialized
  // ---------------------------------------------------------------------------
  describe('getCurrentSession()', () => {
    it('should return null when not initialized', () => {
      expect(Sentry.getCurrentSession()).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // getActiveTransaction()
  // ---------------------------------------------------------------------------
  describe('getActiveTransaction()', () => {
    beforeEach(async () => {
      await Sentry.init('memory');
    });

    it('should return null when no active transaction', () => {
      expect(Sentry.getActiveTransaction()).toBeNull();
    });

    it('should return active transaction', () => {
      const transaction = Sentry.startTransaction({ name: 'test' });
      expect(Sentry.getActiveTransaction()).toBe(transaction);
      transaction.finish();
    });

    it('should return null after transaction finishes', () => {
      const transaction = Sentry.startTransaction({ name: 'test' });
      transaction.finish();
      expect(Sentry.getActiveTransaction()).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Default export
  // ---------------------------------------------------------------------------
  describe('default export', () => {
    it('should have all expected methods', async () => {
      const defaultExport = await import('./index.js').then(m => m.default);

      expect(typeof defaultExport.init).toBe('function');
      expect(typeof defaultExport.create).toBe('function');
      expect(typeof defaultExport.close).toBe('function');
      expect(typeof defaultExport.isInitialized).toBe('function');
      expect(typeof defaultExport.captureException).toBe('function');
      expect(typeof defaultExport.captureMessage).toBe('function');
      expect(typeof defaultExport.setUser).toBe('function');
      expect(typeof defaultExport.addBreadcrumb).toBe('function');
      expect(typeof defaultExport.withScope).toBe('function');
      expect(typeof defaultExport.configureScope).toBe('function');
      expect(typeof defaultExport.setTag).toBe('function');
      expect(typeof defaultExport.setTags).toBe('function');
      expect(typeof defaultExport.setExtra).toBe('function');
      expect(typeof defaultExport.setExtras).toBe('function');
      expect(typeof defaultExport.setContext).toBe('function');
      expect(typeof defaultExport.fatal).toBe('function');
      expect(typeof defaultExport.error).toBe('function');
      expect(typeof defaultExport.warn).toBe('function');
      expect(typeof defaultExport.info).toBe('function');
      expect(typeof defaultExport.debug).toBe('function');
      expect(typeof defaultExport.trace).toBe('function');
      expect(typeof defaultExport.exception).toBe('function');
      expect(typeof defaultExport.log).toBe('function');
      expect(typeof defaultExport.startSession).toBe('function');
      expect(typeof defaultExport.endSession).toBe('function');
      expect(typeof defaultExport.getCurrentSession).toBe('function');
      expect(typeof defaultExport.getLogs).toBe('function');
      expect(typeof defaultExport.getSessions).toBe('function');
      expect(typeof defaultExport.getStats).toBe('function');
      expect(typeof defaultExport.setMinLevel).toBe('function');
      expect(typeof defaultExport.getMinLevel).toBe('function');
      expect(typeof defaultExport.isLevelEnabled).toBe('function');
      expect(typeof defaultExport.child).toBe('function');
      expect(typeof defaultExport.getCurrentScope).toBe('function');
      expect(typeof defaultExport.getGlobalScope).toBe('function');
      expect(typeof defaultExport.getIsolationScope).toBe('function');
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases for 100% branch coverage
  // ---------------------------------------------------------------------------
  describe('Edge cases for branch coverage', () => {
    beforeEach(async () => {
      await Sentry.init('memory');
    });

    it('captureException with object that has no message', async () => {
      // Pass an object without a message property to test the String(error) fallback
      const weirdError = { code: 123, reason: 'weird' };
      Sentry.captureException(weirdError);

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs.length).toBe(1);
    });

    it('captureMessage with context without level', async () => {
      // Context with tags but no level - should use default 'info'
      Sentry.captureMessage('Test', {
        tags: { source: 'test' },
        // No level specified
      });

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].level).toBe('info');
    });

    it('captureEvent with exception missing value', async () => {
      // Exception with only type, no value
      Sentry.captureEvent({
        exception: {
          values: [{ type: 'CustomError' }],
        },
      });

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].metadata?.error?.type).toBe('CustomError');
    });

    it('captureEvent with exception stacktrace with partial frames', async () => {
      // Stacktrace with frames missing some properties
      Sentry.captureEvent({
        exception: {
          values: [
            {
              type: 'Error',
              value: 'test',
              stacktrace: {
                frames: [
                  { filename: 'test.js' }, // missing function, lineno, colno
                  { function: 'myFunc' }, // missing filename, lineno, colno
                  {}, // completely empty frame
                ],
              },
            },
          ],
        },
      });

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].metadata?.error?.stack).toContain('<anonymous>');
      expect(logs[0].metadata?.error?.stack).toContain('unknown');
    });

    it('captureEvent with exception but message already set', async () => {
      // Message is provided along with exception
      Sentry.captureEvent({
        message: 'Custom message',
        exception: {
          values: [{ type: 'Error', value: 'Exception message' }],
        },
      });

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].message).toBe('Custom message');
    });

    it('captureEvent with no message and no exception', async () => {
      // Should fall back to default message
      Sentry.captureEvent({
        level: 'info',
        tags: { source: 'test' },
      });

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].message).toBe('Event captured');
    });

    it('captureEvent with exception having only type (no value)', async () => {
      // Test fallback to type when value is missing
      Sentry.captureEvent({
        exception: {
          values: [{ type: 'TypeError' }], // no value field
        },
      });

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].message).toContain('TypeError');
    });

    it('captureEvent with exception having neither type nor value', async () => {
      // Test fallback to 'Unknown error'
      Sentry.captureEvent({
        exception: {
          values: [{}], // completely empty exception
        },
      });

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].message).toContain('Unknown error');
    });
  });

  // ---------------------------------------------------------------------------
  // shouldIgnoreError edge cases
  // ---------------------------------------------------------------------------
  describe('shouldIgnoreError edge cases', () => {
    it('should handle non-string non-regexp pattern gracefully', async () => {
      // This tests the else branch when pattern is neither string nor RegExp
      await Sentry.init('memory', {
        ignoreErrors: [
          'valid string',
          /valid-regex/,
          123 as any, // Invalid pattern type - should be ignored
          null as any, // Another invalid type
        ],
      });

      // This error should not match any valid patterns
      Sentry.captureException(new Error('unrelated error'));

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // create() environment fallback tests
  // ---------------------------------------------------------------------------
  describe('create() environment fallback', () => {
    it('should use process.env.NODE_ENV when environment not provided', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'testing';

      const logger = await Sentry.create('memory', {});
      expect(logger).toBeDefined();
      await logger.close();

      process.env.NODE_ENV = originalEnv;
    });

    it('should use default when neither option nor env var provided', async () => {
      const originalEnv = process.env.NODE_ENV;
      delete process.env.NODE_ENV;

      const logger = await Sentry.create('memory', {});
      expect(logger).toBeDefined();
      await logger.close();

      process.env.NODE_ENV = originalEnv;
    });
  });

  // ---------------------------------------------------------------------------
  // Type exports
  // ---------------------------------------------------------------------------
  describe('Type exports', () => {
    it('should export Transaction class', () => {
      expect(Sentry.Transaction).toBeDefined();
    });

    it('should export Scope class', () => {
      expect(Sentry.Scope).toBeDefined();
    });

    it('should export Logger class', () => {
      expect(Sentry.Logger).toBeDefined();
    });

    it('should export store providers', () => {
      expect(Sentry.MemoryStoreProvider).toBeDefined();
      expect(Sentry.BaseStoreProvider).toBeDefined();
    });

    it('should export LogLevelValue', () => {
      expect(Sentry.LogLevelValue).toBeDefined();
      expect(Sentry.LogLevelValue.error).toBe(1);
    });
  });
});
