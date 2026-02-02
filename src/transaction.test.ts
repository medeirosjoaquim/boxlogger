/**
 * Tests for Transaction / Performance Monitoring API
 *
 * Tests:
 * - Creating transactions
 * - setMeasurement
 * - finish() calculates duration
 * - Logs during transaction get traceId
 */

import * as Sentry from './index.js';

describe('Transaction API', () => {
  beforeEach(async () => {
    await Sentry.init('memory');
  });

  afterEach(async () => {
    await Sentry.close();
  });

  // -------------------------------------------------------------------------
  // Creating Transactions
  // -------------------------------------------------------------------------
  describe('startTransaction', () => {
    it('should create a transaction with required fields', () => {
      const transaction = Sentry.startTransaction({ name: 'test-transaction' });

      expect(transaction).toBeDefined();
      expect(transaction.name).toBe('test-transaction');
      expect(transaction.traceId).toBeDefined();
      expect(transaction.traceId.length).toBe(32); // 32 hex characters
      expect(transaction.spanId).toBeDefined();
      expect(transaction.spanId.length).toBe(16); // 16 hex characters
      expect(transaction.startTimestamp).toBeDefined();
      expect(transaction.startTimestamp).toBeLessThanOrEqual(Date.now());
      expect(transaction.endTimestamp).toBeUndefined();

      transaction.finish();
    });

    it('should create a transaction with optional fields', () => {
      const transaction = Sentry.startTransaction({
        name: 'checkout',
        op: 'http.server',
        description: 'Checkout API handler',
        tags: { userId: '123' },
      });

      expect(transaction.name).toBe('checkout');
      expect(transaction.op).toBe('http.server');
      expect(transaction.description).toBe('Checkout API handler');
      expect(transaction.tags?.userId).toBe('123');

      transaction.finish();
    });

    it('should set transaction as active', () => {
      const transaction = Sentry.startTransaction({ name: 'active-test' });

      expect(Sentry.getActiveTransaction()).toBe(transaction);

      transaction.finish();
    });
  });

  // -------------------------------------------------------------------------
  // Transaction Methods
  // -------------------------------------------------------------------------
  describe('setTag', () => {
    it('should set a tag on the transaction', () => {
      const transaction = Sentry.startTransaction({ name: 'tag-test' });

      transaction.setTag('environment', 'production');
      transaction.setTag('version', '1.0.0');

      expect(transaction.tags?.environment).toBe('production');
      expect(transaction.tags?.version).toBe('1.0.0');

      transaction.finish();
    });
  });

  describe('setData', () => {
    it('should set arbitrary data on the transaction', () => {
      const transaction = Sentry.startTransaction({ name: 'data-test' });

      transaction.setData('userId', 12345);
      transaction.setData('cart', { items: 3, total: 99.99 });

      expect(transaction.data?.userId).toBe(12345);
      expect(transaction.data?.cart).toEqual({ items: 3, total: 99.99 });

      transaction.finish();
    });
  });

  describe('setMeasurement', () => {
    it('should set a measurement with value only', () => {
      const transaction = Sentry.startTransaction({ name: 'measurement-test' });

      transaction.setMeasurement('ttfb', 250);

      expect(transaction.measurements?.ttfb).toEqual({ value: 250, unit: undefined });

      transaction.finish();
    });

    it('should set a measurement with value and unit', () => {
      const transaction = Sentry.startTransaction({ name: 'measurement-unit-test' });

      transaction.setMeasurement('ttfb', 250, 'millisecond');
      transaction.setMeasurement('memory', 1024, 'byte');
      transaction.setMeasurement('cpu', 75.5, 'percent');

      expect(transaction.measurements?.ttfb).toEqual({ value: 250, unit: 'millisecond' });
      expect(transaction.measurements?.memory).toEqual({ value: 1024, unit: 'byte' });
      expect(transaction.measurements?.cpu).toEqual({ value: 75.5, unit: 'percent' });

      transaction.finish();
    });

    it('should overwrite existing measurement', () => {
      const transaction = Sentry.startTransaction({ name: 'measurement-overwrite' });

      transaction.setMeasurement('ttfb', 100, 'millisecond');
      transaction.setMeasurement('ttfb', 200, 'millisecond');

      expect(transaction.measurements?.ttfb).toEqual({ value: 200, unit: 'millisecond' });

      transaction.finish();
    });
  });

  describe('setStatus', () => {
    it('should set the transaction status', () => {
      const transaction = Sentry.startTransaction({ name: 'status-test' });

      transaction.setStatus('internal_error');

      expect(transaction.status).toBe('internal_error');

      transaction.finish();
    });
  });

  // -------------------------------------------------------------------------
  // Finish Transaction
  // -------------------------------------------------------------------------
  describe('finish', () => {
    it('should set endTimestamp', () => {
      const transaction = Sentry.startTransaction({ name: 'finish-test' });
      const startTime = transaction.startTimestamp;

      // Small delay to ensure timestamps differ
      const endTimeMin = Date.now();
      transaction.finish();
      const endTimeMax = Date.now();

      expect(transaction.endTimestamp).toBeDefined();
      expect(transaction.endTimestamp).toBeGreaterThanOrEqual(startTime);
      expect(transaction.endTimestamp).toBeGreaterThanOrEqual(endTimeMin);
      expect(transaction.endTimestamp).toBeLessThanOrEqual(endTimeMax);
    });

    it('should calculate duration correctly', async () => {
      const transaction = Sentry.startTransaction({ name: 'duration-test' });

      // Wait a bit
      await new Promise((r) => setTimeout(r, 100));

      transaction.finish();

      const duration = transaction.endTimestamp! - transaction.startTimestamp;
      expect(duration).toBeGreaterThanOrEqual(90); // Allow some timing variance
      expect(duration).toBeLessThan(300); // Should not take too long
    });

    it('should set status to ok if not already set', () => {
      const transaction = Sentry.startTransaction({ name: 'status-ok-test' });

      expect(transaction.status).toBeUndefined();

      transaction.finish();

      expect(transaction.status).toBe('ok');
    });

    it('should preserve existing status on finish', () => {
      const transaction = Sentry.startTransaction({ name: 'status-preserve-test' });

      transaction.setStatus('cancelled');
      transaction.finish();

      expect(transaction.status).toBe('cancelled');
    });

    it('should clear active transaction', () => {
      const transaction = Sentry.startTransaction({ name: 'clear-active-test' });

      expect(Sentry.getActiveTransaction()).toBe(transaction);

      transaction.finish();

      expect(Sentry.getActiveTransaction()).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Transaction Context in Logs
  // -------------------------------------------------------------------------
  describe('logs during transaction', () => {
    it('should attach traceId and spanId to logs captured during transaction', async () => {
      const transaction = Sentry.startTransaction({ name: 'log-context-test' });
      const traceId = transaction.traceId;
      const spanId = transaction.spanId;

      // Capture some events during the transaction
      Sentry.captureMessage('Test message during transaction');

      await new Promise((r) => setTimeout(r, 50));

      const logs = await Sentry.getLogs();
      expect(logs.length).toBeGreaterThan(0);

      const logEntry = logs[0];
      expect(logEntry.metadata?.traceId).toBe(traceId);
      expect(logEntry.metadata?.spanId).toBe(spanId);

      transaction.finish();
    });

    it('should attach traceId and spanId to exceptions during transaction', async () => {
      const transaction = Sentry.startTransaction({ name: 'exception-context-test' });
      const traceId = transaction.traceId;
      const spanId = transaction.spanId;

      Sentry.captureException(new Error('Test error during transaction'));

      await new Promise((r) => setTimeout(r, 50));

      const logs = await Sentry.getLogs({ level: 'error' });
      expect(logs.length).toBeGreaterThan(0);

      const logEntry = logs[0];
      expect(logEntry.metadata?.traceId).toBe(traceId);
      expect(logEntry.metadata?.spanId).toBe(spanId);

      transaction.finish();
    });

    it('should not attach traceId after transaction is finished', async () => {
      const transaction = Sentry.startTransaction({ name: 'no-context-after-finish' });
      transaction.finish();

      Sentry.captureMessage('Message after transaction finished');

      await new Promise((r) => setTimeout(r, 50));

      const logs = await Sentry.getLogs();
      const logEntry = logs.find((l) => l.message === 'Message after transaction finished');

      expect(logEntry).toBeDefined();
      expect(logEntry?.metadata?.traceId).toBeUndefined();
      expect(logEntry?.metadata?.spanId).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Multiple Transactions
  // -------------------------------------------------------------------------
  describe('multiple transactions', () => {
    it('should replace active transaction when starting a new one', () => {
      const transaction1 = Sentry.startTransaction({ name: 'first' });
      expect(Sentry.getActiveTransaction()).toBe(transaction1);

      const transaction2 = Sentry.startTransaction({ name: 'second' });
      expect(Sentry.getActiveTransaction()).toBe(transaction2);

      transaction2.finish();
      transaction1.finish();
    });

    it('should not clear active transaction if different transaction is finished', () => {
      const transaction1 = Sentry.startTransaction({ name: 'first' });
      const transaction2 = Sentry.startTransaction({ name: 'second' });

      expect(Sentry.getActiveTransaction()).toBe(transaction2);

      // Finish the first (non-active) transaction
      transaction1.finish();

      // Active transaction should still be transaction2
      expect(Sentry.getActiveTransaction()).toBe(transaction2);

      transaction2.finish();
    });
  });

  // -------------------------------------------------------------------------
  // Sentry-style Usage
  // -------------------------------------------------------------------------
  describe('Sentry-style usage', () => {
    it('should match Sentry API usage pattern', async () => {
      // This is the exact pattern from Sentry docs
      const transaction = Sentry.startTransaction({
        name: 'checkout',
        op: 'http.server',
      });

      transaction.setMeasurement('ttfb', 250, 'millisecond');

      // Simulate some work
      await new Promise((r) => setTimeout(r, 10));

      transaction.finish();

      expect(transaction.name).toBe('checkout');
      expect(transaction.op).toBe('http.server');
      expect(transaction.measurements?.ttfb).toEqual({ value: 250, unit: 'millisecond' });
      expect(transaction.status).toBe('ok');
      expect(transaction.endTimestamp).toBeGreaterThan(transaction.startTimestamp);
    });
  });
});
