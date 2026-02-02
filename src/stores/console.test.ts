import { ConsoleStoreProvider } from './console.js';
import type { LogEntry, Session } from '../types.js';

// Mock console.log to suppress output during tests
const originalLog = console.log;
beforeAll(() => {
  console.log = () => {};
});
afterAll(() => {
  console.log = originalLog;
});

describe('ConsoleStoreProvider', () => {
  let store: ConsoleStoreProvider;

  beforeEach(async () => {
    store = new ConsoleStoreProvider();
    await store.init();
  });

  afterEach(async () => {
    await store.close();
  });

  describe('init and close', () => {
    it('should initialize successfully', async () => {
      const newStore = new ConsoleStoreProvider();
      await newStore.init();
      expect(newStore.isReady()).toBe(true);
      await newStore.close();
    });
  });

  describe('saveLog', () => {
    it('should log entry to console', async () => {
      const entry: LogEntry = {
        id: '1',
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Test message',
      };

      await expect(store.saveLog(entry)).resolves.toBeUndefined();
    });

    it('should log error with metadata', async () => {
      const entry: LogEntry = {
        id: '1',
        timestamp: new Date().toISOString(),
        level: 'error',
        message: 'Error occurred',
        metadata: {
          tags: { section: 'payment' },
          extra: { orderId: '123' },
          error: {
            type: 'Error',
            message: 'Something failed',
            stack: 'Error: Something failed\n  at test.ts:1:1',
          },
        },
      };

      await expect(store.saveLog(entry)).resolves.toBeUndefined();
    });
  });

  describe('getLogs', () => {
    it('should return empty array', async () => {
      const logs = await store.getLogs();
      expect(logs).toEqual([]);
    });
  });

  describe('session operations', () => {
    it('should log session start', async () => {
      const session: Session = {
        id: 'session-1',
        startedAt: new Date().toISOString(),
        status: 'active',
        errorCount: 0,
      };

      await expect(store.createSession(session)).resolves.toBeUndefined();
    });

    it('should log session end', async () => {
      await expect(store.updateSession('session-1', { status: 'ended' })).resolves.toBeUndefined();
    });

    it('should log session crash', async () => {
      await expect(store.updateSession('session-1', { status: 'crashed', errorCount: 5 })).resolves.toBeUndefined();
    });

    it('should return null for getSession', async () => {
      const session = await store.getSession('session-1');
      expect(session).toBeNull();
    });

    it('should return empty array for getSessions', async () => {
      const sessions = await store.getSessions();
      expect(sessions).toEqual([]);
    });
  });

  describe('maintenance operations', () => {
    it('should return 0 for cleanup', async () => {
      const deleted = await store.cleanup(new Date());
      expect(deleted).toBe(0);
    });

    it('should return empty stats', async () => {
      const stats = await store.getStats();
      expect(stats.totalLogs).toBe(0);
      expect(stats.totalSessions).toBe(0);
    });

    it('should return 0 for countLogs', async () => {
      const count = await store.countLogs();
      expect(count).toBe(0);
    });

    it('should return 0 for deleteLogs', async () => {
      const deleted = await store.deleteLogs();
      expect(deleted).toBe(0);
    });
  });
});
