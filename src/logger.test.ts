import { jest } from '@jest/globals';
import { Logger, createLogger } from './logger.js';
import { MemoryStoreProvider } from './stores/memory.js';
import type { StoreProvider, LogEntry, Session, LogFilter, SessionFilter, StoreStats } from './types.js';

describe('Logger', () => {
  let store: MemoryStoreProvider;
  let logger: Logger;

  beforeEach(async () => {
    store = new MemoryStoreProvider();
    await store.init();

    logger = new Logger({
      store,
      service: 'test-service',
      environment: 'test',
      minLevel: 'debug',
    });
  });

  afterEach(async () => {
    await logger.close();
  });

  describe('log levels', () => {
    it('should log at different levels', async () => {
      logger.fatal('Fatal message');
      logger.error('Error message');
      logger.warn('Warning message');
      logger.info('Info message');
      logger.debug('Debug message');

      // Wait for async saves
      await new Promise((resolve) => setTimeout(resolve, 50));

      const logs = await store.getLogs();
      expect(logs).toHaveLength(5);
    });

    it('should respect minimum log level', async () => {
      logger.setMinLevel('warn');

      logger.error('Should log');
      logger.warn('Should log');
      logger.info('Should NOT log');
      logger.debug('Should NOT log');

      await new Promise((resolve) => setTimeout(resolve, 50));

      const logs = await store.getLogs();
      expect(logs).toHaveLength(2);
    });

    it('should check if level is enabled', () => {
      logger.setMinLevel('warn');

      expect(logger.isLevelEnabled('error')).toBe(true);
      expect(logger.isLevelEnabled('warn')).toBe(true);
      expect(logger.isLevelEnabled('info')).toBe(false);
      expect(logger.isLevelEnabled('debug')).toBe(false);
    });
  });

  describe('metadata', () => {
    it('should include metadata in logs', async () => {
      logger.info('Test message', {
        tags: { userId: '123' },
        extra: { custom: 'data' },
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      const logs = await store.getLogs();
      expect(logs[0].metadata?.tags?.userId).toBe('123');
      expect(logs[0].metadata?.extra?.custom).toBe('data');
    });

    it('should include service and environment', async () => {
      logger.info('Test message');

      await new Promise((resolve) => setTimeout(resolve, 50));

      const logs = await store.getLogs();
      expect(logs[0].service).toBe('test-service');
      expect(logs[0].environment).toBe('test');
    });
  });

  describe('exception logging', () => {
    it('should log exceptions with stack trace', async () => {
      const error = new Error('Test error');
      logger.exception(error);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const logs = await store.getLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].metadata?.error?.type).toBe('Error');
      expect(logs[0].metadata?.error?.message).toBe('Test error');
      expect(logs[0].metadata?.error?.stack).toBeDefined();
    });

    it('should handle custom error types', async () => {
      class CustomError extends Error {
        code = 'CUSTOM_CODE';
        constructor(message: string) {
          super(message);
          this.name = 'CustomError';
        }
      }

      const error = new CustomError('Custom error message');
      logger.exception(error);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const logs = await store.getLogs();
      expect(logs[0].metadata?.error?.type).toBe('CustomError');
      expect(logs[0].metadata?.error?.code).toBe('CUSTOM_CODE');
    });
  });

  describe('sessions', () => {
    let sessionLogger: Logger;

    beforeEach(async () => {
      const sessionStore = new MemoryStoreProvider();
      await sessionStore.init();

      sessionLogger = new Logger({
        store: sessionStore,
        enableSessions: true,
      });
    });

    afterEach(async () => {
      await sessionLogger.close();
    });

    it('should start and end sessions', async () => {
      const sessionId = await sessionLogger.startSession({ userId: '123' });
      expect(sessionId).toBeDefined();
      expect(sessionLogger.getCurrentSession()).not.toBeNull();

      await sessionLogger.endSession();
      expect(sessionLogger.getCurrentSession()).toBeNull();
    });

    it('should track session errors', async () => {
      await sessionLogger.startSession();

      sessionLogger.error('First error');
      sessionLogger.error('Second error');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sessionLogger.getCurrentSession()?.errorCount).toBe(2);
    });

    it('should throw if sessions not enabled', async () => {
      await expect(logger.startSession()).rejects.toThrow('Sessions are not enabled');
    });
  });

  describe('child loggers', () => {
    it('should create child logger with prefixed name', () => {
      const child = logger.child('worker');
      expect(child['config'].name).toBe('default:worker');
    });

    it('should inherit parent metadata', async () => {
      const parent = new Logger({
        store,
        defaultMetadata: {
          tags: { version: '1.0.0' },
        },
      });

      const child = parent.child('sub', {
        tags: { module: 'auth' },
      });

      child.info('Test');

      await new Promise((resolve) => setTimeout(resolve, 50));

      const logs = await store.getLogs();
      expect(logs[0].metadata?.tags?.version).toBe('1.0.0');
      expect(logs[0].metadata?.tags?.module).toBe('auth');
    });

    it('should share session with parent', async () => {
      const sessionStore = new MemoryStoreProvider();
      await sessionStore.init();

      const parent = new Logger({
        store: sessionStore,
        enableSessions: true,
      });

      await parent.startSession({ userId: '123' });
      const parentSession = parent.getCurrentSession();
      expect(parentSession).not.toBeNull();

      const child = parent.child('sub');
      const childSession = child.getCurrentSession();

      expect(childSession).not.toBeNull();
      expect(childSession?.id).toBe(parentSession?.id);

      await parent.close();
    });
  });

  describe('formatMessage config option', () => {
    it('should apply formatMessage function to log messages', async () => {
      const formatStore = new MemoryStoreProvider();
      await formatStore.init();

      const formattedLogger = new Logger({
        store: formatStore,
        formatMessage: (message: string) => `[FORMATTED] ${message}`,
      });

      formattedLogger.info('Test message');

      await new Promise((resolve) => setTimeout(resolve, 50));

      const logs = await formatStore.getLogs();
      expect(logs[0].message).toBe('[FORMATTED] Test message');

      await formattedLogger.close();
    });

    it('should not modify message when formatMessage is not provided', async () => {
      logger.info('Plain message');

      await new Promise((resolve) => setTimeout(resolve, 50));

      const logs = await store.getLogs();
      expect(logs[0].message).toBe('Plain message');
    });
  });

  describe('setSessionUser method', () => {
    let sessionLogger: Logger;
    let sessionStore: MemoryStoreProvider;

    beforeEach(async () => {
      sessionStore = new MemoryStoreProvider();
      await sessionStore.init();

      sessionLogger = new Logger({
        store: sessionStore,
        enableSessions: true,
      });
    });

    afterEach(async () => {
      await sessionLogger.close();
    });

    it('should set user info on active session', async () => {
      await sessionLogger.startSession();

      await sessionLogger.setSessionUser({
        id: 'user-123',
        email: 'test@example.com',
        username: 'testuser',
      });

      const session = sessionLogger.getCurrentSession();
      expect(session?.user?.id).toBe('user-123');
      expect(session?.user?.email).toBe('test@example.com');
      expect(session?.user?.username).toBe('testuser');

      // Verify it's persisted in the store
      const storedSession = await sessionStore.getSession(session!.id);
      expect(storedSession?.user?.id).toBe('user-123');
    });

    it('should throw error when no active session', async () => {
      await expect(
        sessionLogger.setSessionUser({ id: 'user-123' })
      ).rejects.toThrow('No active session');
    });
  });

  describe('getLogs and getSessions query methods', () => {
    let queryLogger: Logger;
    let queryStore: MemoryStoreProvider;

    beforeEach(async () => {
      queryStore = new MemoryStoreProvider();
      await queryStore.init();

      queryLogger = new Logger({
        store: queryStore,
        enableSessions: true,
        minLevel: 'debug',
      });
    });

    afterEach(async () => {
      await queryLogger.close();
    });

    it('should retrieve logs via getLogs', async () => {
      queryLogger.info('First log');
      queryLogger.error('Second log');

      await new Promise((resolve) => setTimeout(resolve, 50));

      const logs = await queryLogger.getLogs();
      expect(logs).toHaveLength(2);
    });

    it('should filter logs via getLogs', async () => {
      queryLogger.info('Info log');
      queryLogger.error('Error log');

      await new Promise((resolve) => setTimeout(resolve, 50));

      const errorLogs = await queryLogger.getLogs({ level: 'error' });
      expect(errorLogs).toHaveLength(1);
      expect(errorLogs[0].level).toBe('error');
    });

    it('should retrieve sessions via getSessions', async () => {
      await queryLogger.startSession({ name: 'session1' });
      await queryLogger.endSession();

      await queryLogger.startSession({ name: 'session2' });
      await queryLogger.endSession();

      const sessions = await queryLogger.getSessions();
      expect(sessions).toHaveLength(2);
    });

    it('should filter sessions via getSessions', async () => {
      await queryLogger.startSession({ name: 'session1' });
      await queryLogger.endSession();

      await queryLogger.startSession({ name: 'session2' });
      // Leave this session active

      const endedSessions = await queryLogger.getSessions({ status: 'ended' });
      expect(endedSessions).toHaveLength(1);
    });

    it('should retrieve stats via getStats', async () => {
      queryLogger.info('Info log');
      queryLogger.error('Error log');
      queryLogger.warn('Warn log');

      await new Promise((resolve) => setTimeout(resolve, 50));

      await queryLogger.startSession();

      const stats = await queryLogger.getStats();
      expect(stats.totalLogs).toBe(3);
      expect(stats.logsByLevel.info).toBe(1);
      expect(stats.logsByLevel.error).toBe(1);
      expect(stats.logsByLevel.warn).toBe(1);
      expect(stats.activeSessions).toBe(1);
    });
  });

  describe('error handling when store fails', () => {
    it('should log error to console when store.saveLog fails', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      // Create a failing store
      const failingStore: StoreProvider = {
        name: 'failing',
        isReady: () => true,
        init: async () => {},
        close: async () => {},
        saveLog: async () => {
          throw new Error('Store save failed');
        },
        getLogs: async () => [],
        deleteLogs: async () => 0,
        countLogs: async () => 0,
        createSession: async () => {},
        updateSession: async () => {},
        getSession: async () => null,
        getSessions: async () => [],
        deleteSession: async () => {},
        cleanup: async () => 0,
        getStats: async () => ({
          totalLogs: 0,
          totalSessions: 0,
          activeSessions: 0,
          logsByLevel: { fatal: 0, error: 0, warn: 0, info: 0, debug: 0, trace: 0 },
        }),
      };

      const failingLogger = new Logger({
        store: failingStore,
      });

      failingLogger.info('This will fail');

      // Wait for the async save to fail
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(consoleSpy).toHaveBeenCalledWith(
        '[NodeLogger] Failed to save log:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  describe('extractErrorInfo edge cases', () => {
    it('should extract error cause chain', async () => {
      const rootCause = new Error('Root cause');
      const middleError = new Error('Middle error', { cause: rootCause });
      const topError = new Error('Top error', { cause: middleError });

      logger.exception(topError);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const logs = await store.getLogs();
      const errorInfo = logs[0].metadata?.error;

      expect(errorInfo?.message).toBe('Top error');
      expect(errorInfo?.cause?.message).toBe('Middle error');
      expect(errorInfo?.cause?.cause?.message).toBe('Root cause');
    });

    it('should extract numeric error code', async () => {
      class NumericCodeError extends Error {
        code = 500;
        constructor(message: string) {
          super(message);
          this.name = 'NumericCodeError';
        }
      }

      const error = new NumericCodeError('Server error');
      logger.exception(error);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const logs = await store.getLogs();
      expect(logs[0].metadata?.error?.code).toBe(500);
    });

    it('should extract string error code', async () => {
      class StringCodeError extends Error {
        code = 'ENOENT';
        constructor(message: string) {
          super(message);
          this.name = 'StringCodeError';
        }
      }

      const error = new StringCodeError('File not found');
      logger.exception(error);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const logs = await store.getLogs();
      expect(logs[0].metadata?.error?.code).toBe('ENOENT');
    });
  });

  describe('log method branches', () => {
    it('should track fatal level as error for session errorCount', async () => {
      const sessionStore = new MemoryStoreProvider();
      await sessionStore.init();

      const sessionLogger = new Logger({
        store: sessionStore,
        enableSessions: true,
      });

      await sessionLogger.startSession();

      sessionLogger.fatal('Fatal error');
      sessionLogger.error('Regular error');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sessionLogger.getCurrentSession()?.errorCount).toBe(2);

      await sessionLogger.close();
    });

    it('should filter trace level when minLevel is debug', async () => {
      logger.setMinLevel('debug');
      logger.trace('Should not log');

      await new Promise((resolve) => setTimeout(resolve, 50));

      const logs = await store.getLogs();
      expect(logs.filter(l => l.message === 'Should not log')).toHaveLength(0);
    });

    it('should include session ID in log entry when session is active', async () => {
      const sessionStore = new MemoryStoreProvider();
      await sessionStore.init();

      const sessionLogger = new Logger({
        store: sessionStore,
        enableSessions: true,
      });

      const sessionId = await sessionLogger.startSession();
      sessionLogger.info('Log with session');

      await new Promise((resolve) => setTimeout(resolve, 50));

      const logs = await sessionStore.getLogs();
      expect(logs[0].sessionId).toBe(sessionId);

      await sessionLogger.close();
    });
  });

  describe('session management edge cases', () => {
    it('should end existing session when starting a new one', async () => {
      const sessionStore = new MemoryStoreProvider();
      await sessionStore.init();

      const sessionLogger = new Logger({
        store: sessionStore,
        enableSessions: true,
      });

      const firstSessionId = await sessionLogger.startSession({ name: 'first' });
      const secondSessionId = await sessionLogger.startSession({ name: 'second' });

      expect(firstSessionId).not.toBe(secondSessionId);

      // First session should be ended
      const firstSession = await sessionStore.getSession(firstSessionId);
      expect(firstSession?.status).toBe('ended');

      // Second session should be active
      expect(sessionLogger.getCurrentSession()?.id).toBe(secondSessionId);

      await sessionLogger.close();
    });

    it('should mark session as crashed when ending with crashed status', async () => {
      const sessionStore = new MemoryStoreProvider();
      await sessionStore.init();

      const sessionLogger = new Logger({
        store: sessionStore,
        enableSessions: true,
      });

      const sessionId = await sessionLogger.startSession();
      await sessionLogger.endSession('crashed');

      const session = await sessionStore.getSession(sessionId);
      expect(session?.status).toBe('crashed');
    });

    it('should mark session as crashed if there were errors', async () => {
      const sessionStore = new MemoryStoreProvider();
      await sessionStore.init();

      const sessionLogger = new Logger({
        store: sessionStore,
        enableSessions: true,
      });

      const sessionId = await sessionLogger.startSession();
      sessionLogger.error('An error occurred');

      await new Promise((resolve) => setTimeout(resolve, 50));

      await sessionLogger.endSession();

      const session = await sessionStore.getSession(sessionId);
      expect(session?.status).toBe('crashed');
    });
  });

  describe('getMinLevel method', () => {
    it('should return current minimum log level', () => {
      expect(logger.getMinLevel()).toBe('debug');

      logger.setMinLevel('error');
      expect(logger.getMinLevel()).toBe('error');

      logger.setMinLevel('trace');
      expect(logger.getMinLevel()).toBe('trace');
    });
  });

  describe('createLogger helper function', () => {
    it('should create logger with store and default options', async () => {
      const helperStore = new MemoryStoreProvider();
      await helperStore.init();

      const helperLogger = createLogger(helperStore);

      helperLogger.info('Test message');

      await new Promise((resolve) => setTimeout(resolve, 50));

      const logs = await helperStore.getLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('Test message');

      await helperLogger.close();
    });

    it('should create logger with store and custom options', async () => {
      const helperStore = new MemoryStoreProvider();
      await helperStore.init();

      const helperLogger = createLogger(helperStore, {
        service: 'my-service',
        environment: 'production',
        minLevel: 'warn',
      });

      helperLogger.warn('Warning message');
      helperLogger.info('Info message'); // Should not be logged

      await new Promise((resolve) => setTimeout(resolve, 50));

      const logs = await helperStore.getLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].service).toBe('my-service');
      expect(logs[0].environment).toBe('production');

      await helperLogger.close();
    });
  });

  describe('default config values and edge cases', () => {
    it('should use NODE_ENV as environment when not specified', async () => {
      const envStore = new MemoryStoreProvider();
      await envStore.init();

      // NODE_ENV is already set in test environment
      const envLogger = new Logger({
        store: envStore,
      });

      envLogger.info('Test');
      await new Promise((resolve) => setTimeout(resolve, 50));

      const logs = await envStore.getLogs();
      expect(logs[0].environment).toBe('test');

      await envLogger.close();
    });

    it('should use development as environment when NODE_ENV is not set', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      delete process.env.NODE_ENV;

      const envStore = new MemoryStoreProvider();
      await envStore.init();

      const envLogger = new Logger({
        store: envStore,
      });

      envLogger.info('Test');
      await new Promise((resolve) => setTimeout(resolve, 50));

      const logs = await envStore.getLogs();
      expect(logs[0].environment).toBe('development');

      await envLogger.close();

      process.env.NODE_ENV = originalNodeEnv;
    });

    it('should do nothing when endSession is called without active session', async () => {
      const sessionStore = new MemoryStoreProvider();
      await sessionStore.init();

      const sessionLogger = new Logger({
        store: sessionStore,
        enableSessions: true,
      });

      // Call endSession without starting a session - should not throw
      await sessionLogger.endSession();

      // Verify no sessions were created
      const sessions = await sessionStore.getSessions();
      expect(sessions).toHaveLength(0);

      await sessionLogger.close();
    });

    it('should use constructor name when error.name is empty', async () => {
      // Create an error with an empty name
      const error = new Error('Test error');
      error.name = '';

      logger.exception(error);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const logs = await store.getLogs();
      // Should fall back to constructor.name which is 'Error'
      expect(logs[0].metadata?.error?.type).toBe('Error');
    });
  });
});
