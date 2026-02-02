import { MemoryStoreProvider } from './memory.js';
import type { LogEntry, Session } from '../types.js';

describe('MemoryStoreProvider', () => {
  let store: MemoryStoreProvider;

  beforeEach(async () => {
    store = new MemoryStoreProvider({ maxLogs: 100 });
    await store.init();
  });

  afterEach(async () => {
    await store.close();
  });

  describe('initialization', () => {
    it('should initialize successfully', () => {
      expect(store.isReady()).toBe(true);
      expect(store.name).toBe('memory');
    });

    it('should not be ready after close', async () => {
      await store.close();
      expect(store.isReady()).toBe(false);
    });
  });

  describe('log operations', () => {
    it('should save and retrieve a log', async () => {
      const entry: LogEntry = {
        id: 'test-1',
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Test message',
      };

      await store.saveLog(entry);
      const logs = await store.getLogs();

      expect(logs).toHaveLength(1);
      expect(logs[0].id).toBe('test-1');
      expect(logs[0].message).toBe('Test message');
    });

    it('should generate id and timestamp when not provided', async () => {
      const entry = {
        level: 'info',
        message: 'Test message without id or timestamp',
      } as LogEntry;

      await store.saveLog(entry);
      const logs = await store.getLogs();

      expect(logs).toHaveLength(1);
      expect(logs[0].id).toBeDefined();
      expect(logs[0].id).toMatch(/^[0-9a-f-]{36}$/); // UUID format
      expect(logs[0].timestamp).toBeDefined();
      expect(new Date(logs[0].timestamp).getTime()).toBeGreaterThan(0);
    });

    it('should filter logs by level', async () => {
      await store.saveLog({ id: '1', timestamp: new Date().toISOString(), level: 'error', message: 'Error' });
      await store.saveLog({ id: '2', timestamp: new Date().toISOString(), level: 'info', message: 'Info' });
      await store.saveLog({ id: '3', timestamp: new Date().toISOString(), level: 'debug', message: 'Debug' });

      const errors = await store.getLogs({ level: 'error' });
      expect(errors).toHaveLength(1);
      expect(errors[0].level).toBe('error');

      const multiple = await store.getLogs({ level: ['error', 'info'] });
      expect(multiple).toHaveLength(2);
    });

    it('should filter logs by search', async () => {
      await store.saveLog({ id: '1', timestamp: new Date().toISOString(), level: 'info', message: 'User logged in' });
      await store.saveLog({ id: '2', timestamp: new Date().toISOString(), level: 'info', message: 'Payment processed' });

      const logs = await store.getLogs({ search: 'user' });
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toContain('User');
    });

    it('should enforce max logs limit', async () => {
      for (let i = 0; i < 150; i++) {
        await store.saveLog({
          id: `log-${i}`,
          timestamp: new Date(Date.now() + i).toISOString(),
          level: 'info',
          message: `Message ${i}`,
        });
      }

      const logs = await store.getLogs();
      expect(logs.length).toBeLessThanOrEqual(100);
    });

    it('should delete logs', async () => {
      await store.saveLog({ id: '1', timestamp: new Date().toISOString(), level: 'info', message: 'Test' });
      await store.saveLog({ id: '2', timestamp: new Date().toISOString(), level: 'info', message: 'Test 2' });

      const deleted = await store.deleteLogs({ limit: 1 });
      expect(deleted).toBe(1);

      const remaining = await store.getLogs();
      expect(remaining).toHaveLength(1);
    });

    it('should delete all logs when no filter provided', async () => {
      await store.saveLog({ id: '1', timestamp: new Date().toISOString(), level: 'info', message: 'Test 1' });
      await store.saveLog({ id: '2', timestamp: new Date().toISOString(), level: 'error', message: 'Test 2' });
      await store.saveLog({ id: '3', timestamp: new Date().toISOString(), level: 'debug', message: 'Test 3' });

      const deleted = await store.deleteLogs();
      expect(deleted).toBe(3);

      const remaining = await store.getLogs();
      expect(remaining).toHaveLength(0);
    });

    it('should count logs', async () => {
      await store.saveLog({ id: '1', timestamp: new Date().toISOString(), level: 'info', message: 'Test' });
      await store.saveLog({ id: '2', timestamp: new Date().toISOString(), level: 'error', message: 'Test' });

      const total = await store.countLogs();
      expect(total).toBe(2);

      const errors = await store.countLogs({ level: 'error' });
      expect(errors).toBe(1);
    });

    it('should filter logs by time range', async () => {
      const now = Date.now();
      await store.saveLog({
        id: '1',
        timestamp: new Date(now - 3600000).toISOString(), // 1 hour ago
        level: 'info',
        message: 'Old log',
      });
      await store.saveLog({
        id: '2',
        timestamp: new Date(now).toISOString(), // now
        level: 'info',
        message: 'Current log',
      });
      await store.saveLog({
        id: '3',
        timestamp: new Date(now + 3600000).toISOString(), // 1 hour from now
        level: 'info',
        message: 'Future log',
      });

      const logsAfter = await store.getLogs({ startTime: new Date(now - 1000) });
      expect(logsAfter).toHaveLength(2);

      const logsBefore = await store.getLogs({ endTime: new Date(now + 1000) });
      expect(logsBefore).toHaveLength(2);

      const logsInRange = await store.getLogs({
        startTime: new Date(now - 1000),
        endTime: new Date(now + 1000),
      });
      expect(logsInRange).toHaveLength(1);
      expect(logsInRange[0].id).toBe('2');
    });

    it('should filter logs by logger name', async () => {
      await store.saveLog({ id: '1', timestamp: new Date().toISOString(), level: 'info', message: 'Test', logger: 'app' });
      await store.saveLog({ id: '2', timestamp: new Date().toISOString(), level: 'info', message: 'Test', logger: 'db' });

      const logs = await store.getLogs({ logger: 'app' });
      expect(logs).toHaveLength(1);
      expect(logs[0].logger).toBe('app');
    });

    it('should filter logs by service', async () => {
      await store.saveLog({ id: '1', timestamp: new Date().toISOString(), level: 'info', message: 'Test', service: 'api' });
      await store.saveLog({ id: '2', timestamp: new Date().toISOString(), level: 'info', message: 'Test', service: 'worker' });

      const logs = await store.getLogs({ service: 'api' });
      expect(logs).toHaveLength(1);
      expect(logs[0].service).toBe('api');
    });

    it('should filter logs by environment', async () => {
      await store.saveLog({ id: '1', timestamp: new Date().toISOString(), level: 'info', message: 'Test', environment: 'production' });
      await store.saveLog({ id: '2', timestamp: new Date().toISOString(), level: 'info', message: 'Test', environment: 'staging' });

      const logs = await store.getLogs({ environment: 'production' });
      expect(logs).toHaveLength(1);
      expect(logs[0].environment).toBe('production');
    });

    it('should filter logs by traceId', async () => {
      await store.saveLog({
        id: '1',
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Test',
        metadata: { traceId: 'trace-123' },
      });
      await store.saveLog({
        id: '2',
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Test',
        metadata: { traceId: 'trace-456' },
      });

      const logs = await store.getLogs({ traceId: 'trace-123' });
      expect(logs).toHaveLength(1);
      expect(logs[0].metadata?.traceId).toBe('trace-123');
    });

    it('should filter logs by tags', async () => {
      await store.saveLog({
        id: '1',
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Test',
        metadata: { tags: { region: 'us-east', env: 'prod' } },
      });
      await store.saveLog({
        id: '2',
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Test',
        metadata: { tags: { region: 'eu-west', env: 'prod' } },
      });
      await store.saveLog({
        id: '3',
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Test without tags',
      });

      const logs = await store.getLogs({ tags: { region: 'us-east' } });
      expect(logs).toHaveLength(1);
      expect(logs[0].metadata?.tags?.region).toBe('us-east');

      const logsMultipleTags = await store.getLogs({ tags: { region: 'us-east', env: 'prod' } });
      expect(logsMultipleTags).toHaveLength(1);
    });

    it('should search in error message metadata', async () => {
      await store.saveLog({
        id: '1',
        timestamp: new Date().toISOString(),
        level: 'error',
        message: 'Something failed',
        metadata: { error: { type: 'Error', message: 'Connection timeout' } },
      });
      await store.saveLog({
        id: '2',
        timestamp: new Date().toISOString(),
        level: 'error',
        message: 'Another failure',
        metadata: { error: { type: 'Error', message: 'Authentication failed' } },
      });

      const logs = await store.getLogs({ search: 'timeout' });
      expect(logs).toHaveLength(1);
      expect(logs[0].id).toBe('1');
    });

    it('should sort logs by level', async () => {
      await store.saveLog({ id: '1', timestamp: new Date().toISOString(), level: 'info', message: 'Info' });
      await store.saveLog({ id: '2', timestamp: new Date().toISOString(), level: 'error', message: 'Error' });
      await store.saveLog({ id: '3', timestamp: new Date().toISOString(), level: 'debug', message: 'Debug' });

      const logsAsc = await store.getLogs({ orderBy: 'level', orderDirection: 'asc' });
      expect(logsAsc[0].level).toBe('error');
      expect(logsAsc[1].level).toBe('info');
      expect(logsAsc[2].level).toBe('debug');

      const logsDesc = await store.getLogs({ orderBy: 'level', orderDirection: 'desc' });
      expect(logsDesc[0].level).toBe('debug');
      expect(logsDesc[2].level).toBe('error');
    });

    it('should paginate logs with offset', async () => {
      for (let i = 0; i < 10; i++) {
        await store.saveLog({
          id: `log-${i}`,
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
          level: 'info',
          message: `Message ${i}`,
        });
      }

      const logs = await store.getLogs({ offset: 3, limit: 3, orderDirection: 'asc' });
      expect(logs).toHaveLength(3);
      expect(logs[0].id).toBe('log-3');
      expect(logs[2].id).toBe('log-5');
    });
  });

  describe('session operations', () => {
    it('should create and retrieve a session', async () => {
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
      expect(retrieved!.status).toBe('active');
    });

    it('should generate defaults for session when not provided', async () => {
      const session = {} as Session;

      await store.createSession(session);
      const sessions = await store.getSessions();

      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBeDefined();
      expect(sessions[0].id).toMatch(/^[0-9a-f-]{36}$/); // UUID format
      expect(sessions[0].startedAt).toBeDefined();
      expect(new Date(sessions[0].startedAt).getTime()).toBeGreaterThan(0);
      expect(sessions[0].status).toBe('active');
      expect(sessions[0].errorCount).toBe(0);
    });

    it('should update a session', async () => {
      await store.createSession({
        id: 'session-1',
        startedAt: new Date().toISOString(),
        status: 'active',
        errorCount: 0,
      });

      await store.updateSession('session-1', {
        status: 'ended',
        errorCount: 2,
      });

      const session = await store.getSession('session-1');
      expect(session!.status).toBe('ended');
      expect(session!.errorCount).toBe(2);
    });

    it('should throw when updating non-existent session', async () => {
      await expect(
        store.updateSession('non-existent', { status: 'ended' })
      ).rejects.toThrow('Session not found: non-existent');
    });

    it('should delete a session and its logs', async () => {
      await store.createSession({
        id: 'session-1',
        startedAt: new Date().toISOString(),
        status: 'active',
        errorCount: 0,
      });

      await store.saveLog({
        id: 'log-1',
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Session log',
        sessionId: 'session-1',
      });

      await store.deleteSession('session-1');

      const session = await store.getSession('session-1');
      expect(session).toBeNull();

      const logs = await store.getLogs({ sessionId: 'session-1' });
      expect(logs).toHaveLength(0);
    });

    it('should get sessions without filter sorted by startedAt descending', async () => {
      const now = Date.now();
      await store.createSession({
        id: 'session-1',
        startedAt: new Date(now - 2000).toISOString(),
        status: 'active',
        errorCount: 0,
      });
      await store.createSession({
        id: 'session-2',
        startedAt: new Date(now).toISOString(),
        status: 'active',
        errorCount: 0,
      });
      await store.createSession({
        id: 'session-3',
        startedAt: new Date(now - 1000).toISOString(),
        status: 'ended',
        errorCount: 1,
      });

      const sessions = await store.getSessions();
      expect(sessions).toHaveLength(3);
      expect(sessions[0].id).toBe('session-2'); // most recent first
      expect(sessions[1].id).toBe('session-3');
      expect(sessions[2].id).toBe('session-1'); // oldest last
    });

    it('should filter sessions by status', async () => {
      await store.createSession({
        id: 'session-1',
        startedAt: new Date().toISOString(),
        status: 'active',
        errorCount: 0,
      });
      await store.createSession({
        id: 'session-2',
        startedAt: new Date().toISOString(),
        status: 'ended',
        errorCount: 0,
      });
      await store.createSession({
        id: 'session-3',
        startedAt: new Date().toISOString(),
        status: 'crashed',
        errorCount: 1,
      });

      const active = await store.getSessions({ status: 'active' });
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe('session-1');

      const multiple = await store.getSessions({ status: ['ended', 'crashed'] });
      expect(multiple).toHaveLength(2);
    });

    it('should filter sessions by userId', async () => {
      await store.createSession({
        id: 'session-1',
        startedAt: new Date().toISOString(),
        status: 'active',
        errorCount: 0,
        user: { id: 'user-123', email: 'user1@example.com' },
      });
      await store.createSession({
        id: 'session-2',
        startedAt: new Date().toISOString(),
        status: 'active',
        errorCount: 0,
        user: { id: 'user-456', email: 'user2@example.com' },
      });
      await store.createSession({
        id: 'session-3',
        startedAt: new Date().toISOString(),
        status: 'active',
        errorCount: 0,
      });

      const sessions = await store.getSessions({ userId: 'user-123' });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('session-1');
      expect(sessions[0].user?.id).toBe('user-123');
    });

    it('should filter sessions by time range', async () => {
      const now = Date.now();
      await store.createSession({
        id: 'session-1',
        startedAt: new Date(now - 3600000).toISOString(), // 1 hour ago
        status: 'active',
        errorCount: 0,
      });
      await store.createSession({
        id: 'session-2',
        startedAt: new Date(now).toISOString(), // now
        status: 'active',
        errorCount: 0,
      });
      await store.createSession({
        id: 'session-3',
        startedAt: new Date(now + 3600000).toISOString(), // 1 hour from now
        status: 'active',
        errorCount: 0,
      });

      const sessionsAfter = await store.getSessions({ startTime: new Date(now - 1000) });
      expect(sessionsAfter).toHaveLength(2);

      const sessionsBefore = await store.getSessions({ endTime: new Date(now + 1000) });
      expect(sessionsBefore).toHaveLength(2);

      const sessionsInRange = await store.getSessions({
        startTime: new Date(now - 1000),
        endTime: new Date(now + 1000),
      });
      expect(sessionsInRange).toHaveLength(1);
      expect(sessionsInRange[0].id).toBe('session-2');
    });

    it('should paginate sessions with offset and limit', async () => {
      const now = Date.now();
      for (let i = 0; i < 10; i++) {
        await store.createSession({
          id: `session-${i}`,
          startedAt: new Date(now + i * 1000).toISOString(),
          status: 'active',
          errorCount: 0,
        });
      }

      const sessions = await store.getSessions({ offset: 2, limit: 3 });
      expect(sessions).toHaveLength(3);
      expect(sessions[0].id).toBe('session-7'); // sorted desc, offset by 2
      expect(sessions[2].id).toBe('session-5');
    });

    it('should enforce max sessions limit with FIFO eviction', async () => {
      const storeWithLimit = new MemoryStoreProvider({ maxSessions: 3 });
      await storeWithLimit.init();

      const now = Date.now();
      // Create 5 sessions - oldest first
      for (let i = 0; i < 5; i++) {
        await storeWithLimit.createSession({
          id: `session-${i}`,
          startedAt: new Date(now + i * 1000).toISOString(),
          status: 'active',
          errorCount: 0,
        });
      }

      const sessions = await storeWithLimit.getSessions();
      expect(sessions).toHaveLength(3);
      // Oldest sessions should be evicted
      expect(sessions.find((s) => s.id === 'session-0')).toBeUndefined();
      expect(sessions.find((s) => s.id === 'session-1')).toBeUndefined();
      // Newest sessions should remain
      expect(sessions.find((s) => s.id === 'session-2')).toBeDefined();
      expect(sessions.find((s) => s.id === 'session-3')).toBeDefined();
      expect(sessions.find((s) => s.id === 'session-4')).toBeDefined();

      await storeWithLimit.close();
    });
  });

  describe('cleanup', () => {
    it('should clean up old logs', async () => {
      const now = Date.now();
      const oldDate = new Date(now - 86400000); // 1 day ago
      const recentDate = new Date(now);

      await store.saveLog({
        id: 'old-log',
        timestamp: oldDate.toISOString(),
        level: 'info',
        message: 'Old message',
      });
      await store.saveLog({
        id: 'recent-log',
        timestamp: recentDate.toISOString(),
        level: 'info',
        message: 'Recent message',
      });

      const deleted = await store.cleanup(new Date(now - 3600000)); // 1 hour ago
      expect(deleted).toBe(1);

      const logs = await store.getLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].id).toBe('recent-log');
    });

    it('should clean up ended sessions older than cutoff', async () => {
      const now = Date.now();
      const oldDate = new Date(now - 86400000); // 1 day ago

      await store.createSession({
        id: 'old-ended-session',
        startedAt: new Date(now - 90000000).toISOString(),
        endedAt: oldDate.toISOString(),
        status: 'ended',
        errorCount: 0,
      });
      await store.createSession({
        id: 'old-crashed-session',
        startedAt: new Date(now - 90000000).toISOString(),
        endedAt: oldDate.toISOString(),
        status: 'crashed',
        errorCount: 1,
      });
      await store.createSession({
        id: 'active-session',
        startedAt: oldDate.toISOString(),
        status: 'active',
        errorCount: 0,
      });
      await store.createSession({
        id: 'recent-ended-session',
        startedAt: new Date(now - 1000).toISOString(),
        endedAt: new Date(now).toISOString(),
        status: 'ended',
        errorCount: 0,
      });

      const deleted = await store.cleanup(new Date(now - 3600000)); // 1 hour ago
      expect(deleted).toBe(2); // old-ended-session and old-crashed-session

      const sessions = await store.getSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions.find((s) => s.id === 'active-session')).toBeDefined();
      expect(sessions.find((s) => s.id === 'recent-ended-session')).toBeDefined();
    });

    it('should not clean up active sessions regardless of age', async () => {
      const now = Date.now();
      const oldDate = new Date(now - 86400000 * 30); // 30 days ago

      await store.createSession({
        id: 'old-active-session',
        startedAt: oldDate.toISOString(),
        status: 'active',
        errorCount: 0,
      });

      const deleted = await store.cleanup(new Date(now));
      expect(deleted).toBe(0);

      const sessions = await store.getSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('old-active-session');
    });

    it('should return total count of deleted logs and sessions', async () => {
      const now = Date.now();
      const oldDate = new Date(now - 86400000); // 1 day ago

      // Add 3 old logs
      for (let i = 0; i < 3; i++) {
        await store.saveLog({
          id: `old-log-${i}`,
          timestamp: oldDate.toISOString(),
          level: 'info',
          message: `Old message ${i}`,
        });
      }

      // Add 2 old ended sessions
      for (let i = 0; i < 2; i++) {
        await store.createSession({
          id: `old-session-${i}`,
          startedAt: new Date(now - 90000000).toISOString(),
          endedAt: oldDate.toISOString(),
          status: 'ended',
          errorCount: 0,
        });
      }

      const deleted = await store.cleanup(new Date(now - 3600000));
      expect(deleted).toBe(5); // 3 logs + 2 sessions
    });
  });

  describe('clear and getRawData', () => {
    it('should clear all data', async () => {
      await store.saveLog({ id: '1', timestamp: new Date().toISOString(), level: 'info', message: 'Test' });
      await store.createSession({
        id: 'session-1',
        startedAt: new Date().toISOString(),
        status: 'active',
        errorCount: 0,
      });

      await store.clear();

      const logs = await store.getLogs();
      const sessions = await store.getSessions();

      expect(logs).toHaveLength(0);
      expect(sessions).toHaveLength(0);
    });

    it('should return raw data references', async () => {
      await store.saveLog({ id: '1', timestamp: new Date().toISOString(), level: 'info', message: 'Test' });
      await store.createSession({
        id: 'session-1',
        startedAt: new Date().toISOString(),
        status: 'active',
        errorCount: 0,
      });

      const rawData = store.getRawData();

      expect(rawData.logs).toHaveLength(1);
      expect(rawData.sessions.size).toBe(1);
      expect(rawData.sessions.has('session-1')).toBe(true);
    });
  });

  describe('stats', () => {
    it('should return accurate statistics', async () => {
      await store.saveLog({ id: '1', timestamp: new Date().toISOString(), level: 'error', message: 'Error' });
      await store.saveLog({ id: '2', timestamp: new Date().toISOString(), level: 'info', message: 'Info' });
      await store.createSession({
        id: 'session-1',
        startedAt: new Date().toISOString(),
        status: 'active',
        errorCount: 0,
      });

      const stats = await store.getStats();

      expect(stats.totalLogs).toBe(2);
      expect(stats.totalSessions).toBe(1);
      expect(stats.activeSessions).toBe(1);
      expect(stats.logsByLevel.error).toBe(1);
      expect(stats.logsByLevel.info).toBe(1);
    });
  });
});
