import { jest } from '@jest/globals';
import { BaseStoreProvider, DEFAULT_STORE_CONFIG } from './base.js';
import type {
  LogEntry,
  Session,
  LogFilter,
  SessionFilter,
  StoreStats,
  StoreProviderConfig,
} from '../types.js';

/**
 * Concrete implementation of BaseStoreProvider for testing
 */
class TestStoreProvider extends BaseStoreProvider {
  readonly name = 'test';
  private logs: LogEntry[] = [];
  private sessions: Map<string, Session> = new Map();
  public cleanupCalled = false;
  public cleanupOlderThan: Date | null = null;

  async init(): Promise<void> {
    this._ready = true;
    this.startCleanupTimer();
  }

  async close(): Promise<void> {
    this.stopCleanupTimer();
    this._ready = false;
  }

  async saveLog(entry: LogEntry): Promise<void> {
    this.ensureReady();
    this.logs.push(this.clone(entry));
  }

  async getLogs(filter?: LogFilter): Promise<LogEntry[]> {
    this.ensureReady();
    if (!filter) return this.clone(this.logs);
    return this.filterLogs(this.logs, filter);
  }

  async deleteLogs(filter?: LogFilter): Promise<number> {
    this.ensureReady();
    const toDelete = filter ? this.filterLogs(this.logs, filter) : this.logs;
    const count = toDelete.length;
    const idsToDelete = new Set(toDelete.map((l) => l.id));
    this.logs = this.logs.filter((l) => !idsToDelete.has(l.id));
    return count;
  }

  async countLogs(filter?: LogFilter): Promise<number> {
    this.ensureReady();
    return (await this.getLogs(filter)).length;
  }

  async createSession(session: Session): Promise<void> {
    this.ensureReady();
    this.sessions.set(session.id, this.clone(session));
  }

  async updateSession(sessionId: string, updates: Partial<Session>): Promise<void> {
    this.ensureReady();
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.set(sessionId, { ...session, ...updates });
    }
  }

  async getSession(sessionId: string): Promise<Session | null> {
    this.ensureReady();
    const session = this.sessions.get(sessionId);
    return session ? this.clone(session) : null;
  }

  async getSessions(filter?: SessionFilter): Promise<Session[]> {
    this.ensureReady();
    const sessions = Array.from(this.sessions.values());
    if (!filter) return this.clone(sessions);
    return this.filterSessions(sessions, filter);
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.ensureReady();
    this.sessions.delete(sessionId);
    this.logs = this.logs.filter((l) => l.sessionId !== sessionId);
  }

  async cleanup(olderThan: Date): Promise<number> {
    this.cleanupCalled = true;
    this.cleanupOlderThan = olderThan;
    return 0;
  }

  async getStats(): Promise<StoreStats> {
    this.ensureReady();
    const logsByLevel = {
      fatal: 0,
      error: 0,
      warn: 0,
      info: 0,
      debug: 0,
      trace: 0,
    };
    for (const log of this.logs) {
      logsByLevel[log.level]++;
    }
    return {
      totalLogs: this.logs.length,
      totalSessions: this.sessions.size,
      activeSessions: Array.from(this.sessions.values()).filter((s) => s.status === 'active')
        .length,
      logsByLevel,
    };
  }

  // Expose protected methods for testing
  public testGenerateId(): string {
    return this.generateId();
  }

  public testGenerateShortId(length?: number): string {
    return this.generateShortId(length);
  }

  public testNow(): string {
    return this.now();
  }

  public testParseTimestamp(timestamp: string | Date): Date {
    return this.parseTimestamp(timestamp);
  }

  public testCalculateDuration(start: string | Date, end: string | Date): number {
    return this.calculateDuration(start, end);
  }

  public testFilterLogs(logs: LogEntry[], filter: LogFilter): LogEntry[] {
    return this.filterLogs(logs, filter);
  }

  public testFilterSessions(sessions: Session[], filter: SessionFilter): Session[] {
    return this.filterSessions(sessions, filter);
  }

  public testClone<T>(obj: T): T {
    return this.clone(obj);
  }

  public testEnsureReady(): void {
    this.ensureReady();
  }

  public getConfig(): Required<StoreProviderConfig> {
    return this.config;
  }

  public hasCleanupTimer(): boolean {
    return this.cleanupTimer !== undefined;
  }

  // Helper to manually trigger cleanup via the timer mechanism
  public startTimerForTesting(): void {
    this.startCleanupTimer();
  }

  public stopTimerForTesting(): void {
    this.stopCleanupTimer();
  }
}

describe('BaseStoreProvider', () => {
  describe('DEFAULT_STORE_CONFIG', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_STORE_CONFIG.maxLogs).toBe(100000);
      expect(DEFAULT_STORE_CONFIG.maxSessions).toBe(10000);
      expect(DEFAULT_STORE_CONFIG.cleanupInterval).toBe(0);
      expect(DEFAULT_STORE_CONFIG.retentionPeriod).toBe(30 * 24 * 60 * 60 * 1000);
    });
  });

  describe('constructor and configuration', () => {
    it('should use default config when no config provided', () => {
      const store = new TestStoreProvider();
      const config = store.getConfig();
      expect(config.maxLogs).toBe(DEFAULT_STORE_CONFIG.maxLogs);
      expect(config.maxSessions).toBe(DEFAULT_STORE_CONFIG.maxSessions);
      expect(config.cleanupInterval).toBe(DEFAULT_STORE_CONFIG.cleanupInterval);
      expect(config.retentionPeriod).toBe(DEFAULT_STORE_CONFIG.retentionPeriod);
    });

    it('should merge provided config with defaults', () => {
      const store = new TestStoreProvider({ maxLogs: 500, cleanupInterval: 1000 });
      const config = store.getConfig();
      expect(config.maxLogs).toBe(500);
      expect(config.maxSessions).toBe(DEFAULT_STORE_CONFIG.maxSessions);
      expect(config.cleanupInterval).toBe(1000);
      expect(config.retentionPeriod).toBe(DEFAULT_STORE_CONFIG.retentionPeriod);
    });
  });

  describe('isReady', () => {
    it('should return false before init', () => {
      const store = new TestStoreProvider();
      expect(store.isReady()).toBe(false);
    });

    it('should return true after init', async () => {
      const store = new TestStoreProvider();
      await store.init();
      expect(store.isReady()).toBe(true);
      await store.close();
    });

    it('should return false after close', async () => {
      const store = new TestStoreProvider();
      await store.init();
      await store.close();
      expect(store.isReady()).toBe(false);
    });
  });

  describe('generateId', () => {
    it('should generate a valid UUID', async () => {
      const store = new TestStoreProvider();
      await store.init();
      const id = store.testGenerateId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      await store.close();
    });

    it('should generate unique IDs', async () => {
      const store = new TestStoreProvider();
      await store.init();
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(store.testGenerateId());
      }
      expect(ids.size).toBe(100);
      await store.close();
    });
  });

  describe('generateShortId', () => {
    it('should generate a 16-character hex string by default', async () => {
      const store = new TestStoreProvider();
      await store.init();
      const id = store.testGenerateShortId();
      expect(id).toHaveLength(16);
      expect(id).toMatch(/^[0-9a-f]+$/);
      await store.close();
    });

    it('should generate a custom length hex string', async () => {
      const store = new TestStoreProvider();
      await store.init();
      const id = store.testGenerateShortId(8);
      expect(id).toHaveLength(8);
      expect(id).toMatch(/^[0-9a-f]+$/);
      await store.close();
    });

    it('should generate unique IDs', async () => {
      const store = new TestStoreProvider();
      await store.init();
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(store.testGenerateShortId());
      }
      expect(ids.size).toBe(100);
      await store.close();
    });

    it('should handle odd length correctly', async () => {
      const store = new TestStoreProvider();
      await store.init();
      const id = store.testGenerateShortId(5);
      expect(id).toHaveLength(5);
      await store.close();
    });
  });

  describe('now', () => {
    it('should return an ISO 8601 timestamp', async () => {
      const store = new TestStoreProvider();
      await store.init();
      const timestamp = store.testNow();
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      await store.close();
    });

    it('should return the current time', async () => {
      const store = new TestStoreProvider();
      await store.init();
      const before = Date.now();
      const timestamp = store.testNow();
      const after = Date.now();
      const parsed = new Date(timestamp).getTime();
      expect(parsed).toBeGreaterThanOrEqual(before);
      expect(parsed).toBeLessThanOrEqual(after);
      await store.close();
    });
  });

  describe('parseTimestamp', () => {
    it('should return the same Date object if given a Date', async () => {
      const store = new TestStoreProvider();
      await store.init();
      const date = new Date('2024-01-01T12:00:00.000Z');
      const result = store.testParseTimestamp(date);
      expect(result).toBe(date);
      await store.close();
    });

    it('should parse an ISO string to a Date', async () => {
      const store = new TestStoreProvider();
      await store.init();
      const result = store.testParseTimestamp('2024-01-01T12:00:00.000Z');
      expect(result).toBeInstanceOf(Date);
      expect(result.toISOString()).toBe('2024-01-01T12:00:00.000Z');
      await store.close();
    });
  });

  describe('calculateDuration', () => {
    it('should calculate duration between two timestamps', async () => {
      const store = new TestStoreProvider();
      await store.init();
      const start = '2024-01-01T12:00:00.000Z';
      const end = '2024-01-01T12:00:05.000Z';
      const duration = store.testCalculateDuration(start, end);
      expect(duration).toBe(5000);
      await store.close();
    });

    it('should work with Date objects', async () => {
      const store = new TestStoreProvider();
      await store.init();
      const start = new Date('2024-01-01T12:00:00.000Z');
      const end = new Date('2024-01-01T12:01:00.000Z');
      const duration = store.testCalculateDuration(start, end);
      expect(duration).toBe(60000);
      await store.close();
    });

    it('should work with mixed Date and string', async () => {
      const store = new TestStoreProvider();
      await store.init();
      const start = new Date('2024-01-01T12:00:00.000Z');
      const end = '2024-01-01T12:00:30.000Z';
      const duration = store.testCalculateDuration(start, end);
      expect(duration).toBe(30000);
      await store.close();
    });

    it('should return negative duration if end is before start', async () => {
      const store = new TestStoreProvider();
      await store.init();
      const start = '2024-01-01T12:00:10.000Z';
      const end = '2024-01-01T12:00:00.000Z';
      const duration = store.testCalculateDuration(start, end);
      expect(duration).toBe(-10000);
      await store.close();
    });
  });

  describe('filterLogs', () => {
    let store: TestStoreProvider;
    let logs: LogEntry[];

    beforeEach(async () => {
      store = new TestStoreProvider();
      await store.init();
      logs = [
        {
          id: '1',
          timestamp: '2024-01-01T10:00:00.000Z',
          level: 'error',
          message: 'Error message',
          logger: 'app',
          sessionId: 'session-1',
          service: 'api',
          environment: 'production',
          metadata: {
            tags: { category: 'auth', priority: 'high' },
            traceId: 'trace-123',
            error: { type: 'AuthError', message: 'Authentication failed' },
          },
        },
        {
          id: '2',
          timestamp: '2024-01-01T11:00:00.000Z',
          level: 'info',
          message: 'Info message',
          logger: 'app',
          sessionId: 'session-2',
          service: 'api',
          environment: 'staging',
          metadata: {
            tags: { category: 'general' },
            traceId: 'trace-456',
          },
        },
        {
          id: '3',
          timestamp: '2024-01-01T12:00:00.000Z',
          level: 'debug',
          message: 'Debug message',
          logger: 'worker',
          sessionId: 'session-1',
          service: 'worker',
          environment: 'production',
        },
        {
          id: '4',
          timestamp: '2024-01-01T13:00:00.000Z',
          level: 'warn',
          message: 'Warning message',
          logger: 'app',
          sessionId: 'session-3',
          service: 'api',
          environment: 'production',
          metadata: {
            tags: { category: 'auth', priority: 'low' },
          },
        },
      ];
    });

    afterEach(async () => {
      await store.close();
    });

    it('should return all logs if no filter criteria', () => {
      const result = store.testFilterLogs(logs, {});
      expect(result).toHaveLength(4);
    });

    it('should filter by single level', () => {
      const result = store.testFilterLogs(logs, { level: 'error' });
      expect(result).toHaveLength(1);
      expect(result[0].level).toBe('error');
    });

    it('should filter by multiple levels', () => {
      const result = store.testFilterLogs(logs, { level: ['error', 'warn'] });
      expect(result).toHaveLength(2);
      expect(result.every((l) => l.level === 'error' || l.level === 'warn')).toBe(true);
    });

    it('should filter by sessionId', () => {
      const result = store.testFilterLogs(logs, { sessionId: 'session-1' });
      expect(result).toHaveLength(2);
      expect(result.every((l) => l.sessionId === 'session-1')).toBe(true);
    });

    it('should filter by logger name', () => {
      const result = store.testFilterLogs(logs, { logger: 'worker' });
      expect(result).toHaveLength(1);
      expect(result[0].logger).toBe('worker');
    });

    it('should filter by startTime', () => {
      const result = store.testFilterLogs(logs, { startTime: '2024-01-01T11:30:00.000Z' });
      expect(result).toHaveLength(2);
      expect(result.every((l) => new Date(l.timestamp) >= new Date('2024-01-01T11:30:00.000Z'))).toBe(true);
    });

    it('should filter by endTime', () => {
      const result = store.testFilterLogs(logs, { endTime: '2024-01-01T11:30:00.000Z' });
      expect(result).toHaveLength(2);
      expect(result.every((l) => new Date(l.timestamp) <= new Date('2024-01-01T11:30:00.000Z'))).toBe(true);
    });

    it('should filter by time range', () => {
      const result = store.testFilterLogs(logs, {
        startTime: '2024-01-01T10:30:00.000Z',
        endTime: '2024-01-01T12:30:00.000Z',
      });
      expect(result).toHaveLength(2);
    });

    it('should filter by search text in message', () => {
      const result = store.testFilterLogs(logs, { search: 'error' });
      expect(result).toHaveLength(1);
      expect(result[0].message.toLowerCase()).toContain('error');
    });

    it('should filter by search text case-insensitively', () => {
      const result = store.testFilterLogs(logs, { search: 'ERROR' });
      expect(result).toHaveLength(1);
    });

    it('should filter by search text in error message', () => {
      const result = store.testFilterLogs(logs, { search: 'authentication' });
      expect(result).toHaveLength(1);
      expect(result[0].metadata?.error?.message?.toLowerCase()).toContain('authentication');
    });

    it('should filter by tags', () => {
      const result = store.testFilterLogs(logs, { tags: { category: 'auth' } });
      expect(result).toHaveLength(2);
      expect(result.every((l) => l.metadata?.tags?.category === 'auth')).toBe(true);
    });

    it('should filter by multiple tags (must match all)', () => {
      const result = store.testFilterLogs(logs, { tags: { category: 'auth', priority: 'high' } });
      expect(result).toHaveLength(1);
      expect(result[0].metadata?.tags?.priority).toBe('high');
    });

    it('should return empty array if tags do not match', () => {
      const result = store.testFilterLogs(logs, { tags: { nonexistent: 'value' } });
      expect(result).toHaveLength(0);
    });

    it('should filter out logs without tags when filtering by tags', () => {
      const result = store.testFilterLogs(logs, { tags: { category: 'general' } });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('2');
    });

    it('should filter by traceId', () => {
      const result = store.testFilterLogs(logs, { traceId: 'trace-123' });
      expect(result).toHaveLength(1);
      expect(result[0].metadata?.traceId).toBe('trace-123');
    });

    it('should filter by service', () => {
      const result = store.testFilterLogs(logs, { service: 'worker' });
      expect(result).toHaveLength(1);
      expect(result[0].service).toBe('worker');
    });

    it('should filter by environment', () => {
      const result = store.testFilterLogs(logs, { environment: 'staging' });
      expect(result).toHaveLength(1);
      expect(result[0].environment).toBe('staging');
    });

    it('should sort by timestamp descending by default', () => {
      const result = store.testFilterLogs(logs, {});
      expect(result[0].timestamp).toBe('2024-01-01T13:00:00.000Z');
      expect(result[3].timestamp).toBe('2024-01-01T10:00:00.000Z');
    });

    it('should sort by timestamp ascending', () => {
      const result = store.testFilterLogs(logs, { orderBy: 'timestamp', orderDirection: 'asc' });
      expect(result[0].timestamp).toBe('2024-01-01T10:00:00.000Z');
      expect(result[3].timestamp).toBe('2024-01-01T13:00:00.000Z');
    });

    it('should sort by level descending', () => {
      const result = store.testFilterLogs(logs, { orderBy: 'level', orderDirection: 'desc' });
      // trace > debug > info > warn > error > fatal (higher value = less severe)
      expect(result[0].level).toBe('debug');
      expect(result[result.length - 1].level).toBe('error');
    });

    it('should sort by level ascending', () => {
      const result = store.testFilterLogs(logs, { orderBy: 'level', orderDirection: 'asc' });
      expect(result[0].level).toBe('error');
      expect(result[result.length - 1].level).toBe('debug');
    });

    it('should apply offset', () => {
      const result = store.testFilterLogs(logs, { offset: 2 });
      expect(result).toHaveLength(2);
    });

    it('should apply limit', () => {
      const result = store.testFilterLogs(logs, { limit: 2 });
      expect(result).toHaveLength(2);
    });

    it('should apply offset and limit together', () => {
      const result = store.testFilterLogs(logs, { offset: 1, limit: 2 });
      expect(result).toHaveLength(2);
    });

    it('should combine multiple filters', () => {
      const result = store.testFilterLogs(logs, {
        level: ['error', 'info', 'warn'],
        service: 'api',
        environment: 'production',
      });
      expect(result).toHaveLength(2);
      expect(result.every((l) => l.service === 'api' && l.environment === 'production')).toBe(true);
    });
  });

  describe('filterSessions', () => {
    let store: TestStoreProvider;
    let sessions: Session[];

    beforeEach(async () => {
      store = new TestStoreProvider();
      await store.init();
      sessions = [
        {
          id: 'session-1',
          startedAt: '2024-01-01T10:00:00.000Z',
          status: 'active',
          errorCount: 0,
          user: { id: 'user-1' },
        },
        {
          id: 'session-2',
          startedAt: '2024-01-01T11:00:00.000Z',
          status: 'ended',
          errorCount: 2,
          user: { id: 'user-2' },
        },
        {
          id: 'session-3',
          startedAt: '2024-01-01T12:00:00.000Z',
          status: 'crashed',
          errorCount: 5,
          user: { id: 'user-1' },
        },
        {
          id: 'session-4',
          startedAt: '2024-01-01T13:00:00.000Z',
          status: 'active',
          errorCount: 0,
        },
      ];
    });

    afterEach(async () => {
      await store.close();
    });

    it('should return all sessions if no filter criteria', () => {
      const result = store.testFilterSessions(sessions, {});
      expect(result).toHaveLength(4);
    });

    it('should filter by single status', () => {
      const result = store.testFilterSessions(sessions, { status: 'active' });
      expect(result).toHaveLength(2);
      expect(result.every((s) => s.status === 'active')).toBe(true);
    });

    it('should filter by multiple statuses', () => {
      const result = store.testFilterSessions(sessions, { status: ['active', 'crashed'] });
      expect(result).toHaveLength(3);
      expect(result.every((s) => s.status === 'active' || s.status === 'crashed')).toBe(true);
    });

    it('should filter by userId', () => {
      const result = store.testFilterSessions(sessions, { userId: 'user-1' });
      expect(result).toHaveLength(2);
      expect(result.every((s) => s.user?.id === 'user-1')).toBe(true);
    });

    it('should filter by startTime', () => {
      const result = store.testFilterSessions(sessions, { startTime: '2024-01-01T11:30:00.000Z' });
      expect(result).toHaveLength(2);
      expect(
        result.every((s) => new Date(s.startedAt) >= new Date('2024-01-01T11:30:00.000Z'))
      ).toBe(true);
    });

    it('should filter by endTime', () => {
      const result = store.testFilterSessions(sessions, { endTime: '2024-01-01T11:30:00.000Z' });
      expect(result).toHaveLength(2);
      expect(
        result.every((s) => new Date(s.startedAt) <= new Date('2024-01-01T11:30:00.000Z'))
      ).toBe(true);
    });

    it('should filter by time range', () => {
      const result = store.testFilterSessions(sessions, {
        startTime: '2024-01-01T10:30:00.000Z',
        endTime: '2024-01-01T12:30:00.000Z',
      });
      expect(result).toHaveLength(2);
    });

    it('should sort by startedAt descending by default', () => {
      const result = store.testFilterSessions(sessions, {});
      expect(result[0].startedAt).toBe('2024-01-01T13:00:00.000Z');
      expect(result[3].startedAt).toBe('2024-01-01T10:00:00.000Z');
    });

    it('should apply offset', () => {
      const result = store.testFilterSessions(sessions, { offset: 2 });
      expect(result).toHaveLength(2);
    });

    it('should apply limit', () => {
      const result = store.testFilterSessions(sessions, { limit: 2 });
      expect(result).toHaveLength(2);
    });

    it('should apply offset and limit together', () => {
      const result = store.testFilterSessions(sessions, { offset: 1, limit: 2 });
      expect(result).toHaveLength(2);
    });

    it('should combine multiple filters', () => {
      const result = store.testFilterSessions(sessions, {
        status: 'active',
        userId: 'user-1',
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('session-1');
    });
  });

  describe('clone', () => {
    let store: TestStoreProvider;

    beforeEach(async () => {
      store = new TestStoreProvider();
      await store.init();
    });

    afterEach(async () => {
      await store.close();
    });

    it('should create a deep copy of an object', () => {
      const original = { a: 1, b: { c: 2 } };
      const cloned = store.testClone(original);
      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
      expect(cloned.b).not.toBe(original.b);
    });

    it('should create a deep copy of an array', () => {
      const original = [{ a: 1 }, { b: 2 }];
      const cloned = store.testClone(original);
      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
      expect(cloned[0]).not.toBe(original[0]);
    });

    it('should handle primitives', () => {
      expect(store.testClone(42)).toBe(42);
      expect(store.testClone('hello')).toBe('hello');
      expect(store.testClone(true)).toBe(true);
      expect(store.testClone(null)).toBe(null);
    });
  });

  describe('ensureReady', () => {
    it('should throw if not ready', () => {
      const store = new TestStoreProvider();
      expect(() => store.testEnsureReady()).toThrow('test store is not initialized. Call init() first.');
    });

    it('should not throw if ready', async () => {
      const store = new TestStoreProvider();
      await store.init();
      expect(() => store.testEnsureReady()).not.toThrow();
      await store.close();
    });
  });

  describe('cleanup timer', () => {
    it('should not start timer if cleanupInterval is 0', async () => {
      const store = new TestStoreProvider({ cleanupInterval: 0 });
      await store.init();
      expect(store.hasCleanupTimer()).toBe(false);
      await store.close();
    });

    it('should start timer if cleanupInterval is positive', async () => {
      const store = new TestStoreProvider({ cleanupInterval: 1000 });
      await store.init();
      expect(store.hasCleanupTimer()).toBe(true);
      await store.close();
    });

    it('should stop timer on close', async () => {
      const store = new TestStoreProvider({ cleanupInterval: 1000 });
      await store.init();
      expect(store.hasCleanupTimer()).toBe(true);
      await store.close();
      expect(store.hasCleanupTimer()).toBe(false);
    });

    it('should call cleanup with correct cutoff date', async () => {
      const retentionPeriod = 100;
      const cleanupInterval = 50;
      const store = new TestStoreProvider({ cleanupInterval, retentionPeriod });
      await store.init();

      // Wait for the interval to fire at least once
      await new Promise((resolve) => setTimeout(resolve, cleanupInterval + 50));

      expect(store.cleanupCalled).toBe(true);
      expect(store.cleanupOlderThan).not.toBeNull();

      // The cutoff should be roughly Date.now() - retentionPeriod
      const now = Date.now();
      const actualCutoff = store.cleanupOlderThan!.getTime();
      // Allow for some timing variance
      expect(actualCutoff).toBeLessThan(now);
      expect(actualCutoff).toBeGreaterThan(now - retentionPeriod - 200);

      await store.close();
    });

    it('should stop timer even if already stopped', async () => {
      const store = new TestStoreProvider({ cleanupInterval: 1000 });
      await store.init();
      store.stopTimerForTesting();
      expect(store.hasCleanupTimer()).toBe(false);
      // Call again should not throw
      store.stopTimerForTesting();
      expect(store.hasCleanupTimer()).toBe(false);
      await store.close();
    });

    it('should not start timer if already exists', async () => {
      const store = new TestStoreProvider({ cleanupInterval: 1000 });
      await store.init();
      const firstTimer = store.hasCleanupTimer();
      store.startTimerForTesting();
      // Multiple starts should still only have one timer (the new one)
      expect(store.hasCleanupTimer()).toBe(firstTimer);
      await store.close();
    });

    it('should handle timers without unref method', async () => {
      // Save the original setInterval
      const originalSetInterval = global.setInterval;
      let realTimer: ReturnType<typeof setInterval> | null = null;

      // Mock setInterval to return a timer without unref
      global.setInterval = ((callback: () => void, ms: number) => {
        realTimer = originalSetInterval(callback, ms);
        // Create a proxy object that delegates to the real timer but has no unref
        const timerWithoutUnref = {
          [Symbol.toPrimitive]: () => realTimer![Symbol.toPrimitive]?.('number'),
          ref: () => realTimer!.ref?.(),
          hasRef: () => realTimer!.hasRef?.(),
          refresh: () => realTimer!.refresh?.(),
          // Explicitly set unref to undefined to simulate environments without it
          unref: undefined,
        } as unknown as ReturnType<typeof setInterval>;
        return timerWithoutUnref;
      }) as typeof setInterval;

      try {
        const store = new TestStoreProvider({ cleanupInterval: 1000 });
        await store.init();
        // Should not throw even without unref
        expect(store.hasCleanupTimer()).toBe(true);
        await store.close();
      } finally {
        // Clean up the real timer to prevent Jest from hanging
        if (realTimer) {
          clearInterval(realTimer);
        }
        // Restore original setInterval
        global.setInterval = originalSetInterval;
      }
    });
  });

  describe('integration through concrete implementation', () => {
    let store: TestStoreProvider;

    beforeEach(async () => {
      store = new TestStoreProvider();
      await store.init();
    });

    afterEach(async () => {
      await store.close();
    });

    it('should save and retrieve logs through the implementation', async () => {
      const log: LogEntry = {
        id: 'test-1',
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Test message',
      };

      await store.saveLog(log);
      const logs = await store.getLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].id).toBe('test-1');
    });

    it('should create and retrieve sessions through the implementation', async () => {
      const session: Session = {
        id: 'session-1',
        startedAt: new Date().toISOString(),
        status: 'active',
        errorCount: 0,
      };

      await store.createSession(session);
      const retrieved = await store.getSession('session-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe('session-1');
    });

    it('should throw when accessing store before init', async () => {
      await store.close();
      await expect(store.saveLog({
        id: 'test',
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Test',
      })).rejects.toThrow('test store is not initialized');
    });
  });

  describe('UUID Generation', () => {
    it('should use fallback UUID when crypto.randomUUID is unavailable', () => {
      const originalCrypto = global.crypto;
      
      // Mock crypto without randomUUID
      (global as any).crypto = {};

      const store = new TestStoreProvider();
      const id = store.generateId();
      
      // Should be a valid UUID format
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

      global.crypto = originalCrypto;
    });
  });
});
