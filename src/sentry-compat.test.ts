/**
 * Tests for Sentry-compatible API
 *
 * Tests the Top 5 Sentry Functions for Next.js Production Apps:
 * 1. captureException
 * 2. captureMessage
 * 3. setUser
 * 4. addBreadcrumb
 * 5. withScope
 */

import * as Sentry from './index.js';

describe('Sentry-Compatible API', () => {
  beforeEach(async () => {
    await Sentry.init('memory');
  });

  afterEach(async () => {
    await Sentry.close();
  });

  // -------------------------------------------------------------------------
  // 1. captureException - The Error Workhorse
  // -------------------------------------------------------------------------
  describe('captureException', () => {
    it('should capture an error and return event ID', async () => {
      const error = new Error('Test error');
      const eventId = Sentry.captureException(error);

      expect(eventId).toBeDefined();
      expect(typeof eventId).toBe('string');
      expect(eventId.length).toBe(36); // UUID format

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs({ level: 'error' });
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].metadata?.error?.message).toBe('Test error');
    });

    it('should capture with full context', async () => {
      const error = new Error('Payment failed');
      Sentry.captureException(error, {
        tags: {
          section: 'checkout',
          userId: '123',
        },
        extra: {
          orderId: 'ORD-456',
          amount: 99.99,
        },
        level: 'error',
      });

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();

      expect(logs[0].metadata?.tags?.section).toBe('checkout');
      expect(logs[0].metadata?.tags?.userId).toBe('123');
      expect(logs[0].metadata?.extra?.orderId).toBe('ORD-456');
      expect(logs[0].metadata?.extra?.amount).toBe(99.99);
    });

    it('should capture string as error', async () => {
      Sentry.captureException('Something went wrong');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].metadata?.error?.message).toBe('Something went wrong');
    });
  });

  // -------------------------------------------------------------------------
  // 2. captureMessage - Custom Alerts
  // -------------------------------------------------------------------------
  describe('captureMessage', () => {
    it('should capture a simple message', async () => {
      const eventId = Sentry.captureMessage('User signed up');

      expect(eventId).toBeDefined();
      expect(typeof eventId).toBe('string');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].message).toBe('User signed up');
      expect(logs[0].level).toBe('info');
    });

    it('should capture with severity level', async () => {
      Sentry.captureMessage('Suspicious login attempt', 'warning');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].message).toBe('Suspicious login attempt');
      expect(logs[0].level).toBe('warn');
    });

    it('should capture with full context', async () => {
      Sentry.captureMessage('High-value transaction completed', {
        level: 'info',
        tags: {
          transactionType: 'purchase',
          amount: 'high',
        },
        extra: {
          orderId: 'ORD-789',
          amount: 5000,
          userTier: 'premium',
        },
      });

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].metadata?.tags?.transactionType).toBe('purchase');
      expect(logs[0].metadata?.extra?.amount).toBe(5000);
      expect(logs[0].metadata?.extra?.userTier).toBe('premium');
    });
  });

  // -------------------------------------------------------------------------
  // 3. setUser - User Context
  // -------------------------------------------------------------------------
  describe('setUser', () => {
    it('should set user context', async () => {
      Sentry.setUser({
        id: '123',
        email: 'user@example.com',
        username: 'testuser',
      });

      Sentry.captureMessage('Test with user');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].metadata?.user?.id).toBe('123');
      expect(logs[0].metadata?.user?.email).toBe('user@example.com');
    });

    it('should support segment field', async () => {
      Sentry.setUser({
        id: '456',
        segment: 'enterprise',
      });

      Sentry.captureMessage('Premium user action');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].metadata?.user?.segment).toBe('enterprise');
    });

    it('should support {{auto}} IP address', async () => {
      Sentry.setUser({
        id: '789',
        ip_address: '{{auto}}',
      });

      Sentry.captureMessage('Auto IP test');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].metadata?.user?.ip_address).toBe('{{auto}}');
    });

    it('should clear user with null', async () => {
      Sentry.setUser({ id: '123' });
      Sentry.setUser(null);

      Sentry.captureMessage('No user');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].metadata?.user).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 4. addBreadcrumb - Event Trail
  // -------------------------------------------------------------------------
  describe('addBreadcrumb', () => {
    it('should add navigation breadcrumb', async () => {
      Sentry.addBreadcrumb({
        category: 'navigation',
        message: 'Navigated to /checkout',
        level: 'info',
        data: {
          from: '/cart',
          to: '/checkout',
        },
      });

      Sentry.captureMessage('Checkout started');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      const breadcrumbs = logs[0].metadata?.extra?._breadcrumbs as any[];

      expect(breadcrumbs).toBeDefined();
      expect(breadcrumbs.length).toBeGreaterThan(0);
      expect(breadcrumbs[0].category).toBe('navigation');
      expect(breadcrumbs[0].data?.from).toBe('/cart');
    });

    it('should add timestamp to breadcrumbs', async () => {
      Sentry.addBreadcrumb({
        category: 'ui.click',
        message: 'Button clicked',
      });

      Sentry.captureMessage('Test');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      const breadcrumbs = logs[0].metadata?.extra?._breadcrumbs as any[];

      expect(breadcrumbs[0].timestamp).toBeDefined();
      expect(typeof breadcrumbs[0].timestamp).toBe('number');
    });

    it('should support API breadcrumbs', async () => {
      Sentry.addBreadcrumb({
        category: 'api',
        message: 'API request started',
        level: 'info',
        data: { endpoint: '/api/users', method: 'GET' },
      });

      Sentry.addBreadcrumb({
        category: 'api',
        message: 'API request completed',
        level: 'info',
        data: { endpoint: '/api/users', status: 200 },
      });

      Sentry.captureException(new Error('Subsequent error'));

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      const breadcrumbs = logs[0].metadata?.extra?._breadcrumbs as any[];

      expect(breadcrumbs.length).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // 5. withScope - Isolated Context
  // -------------------------------------------------------------------------
  describe('withScope', () => {
    it('should create isolated scope', async () => {
      // Set global tag
      Sentry.setTag('global', 'yes');

      // Create isolated scope
      Sentry.withScope((scope) => {
        scope.setTag('scoped', 'yes');
        scope.setExtra('orderId', '12345');
        Sentry.captureMessage('In scope');
      });

      // Log outside scope
      Sentry.captureMessage('Outside scope');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();

      // Sort by timestamp to ensure order
      logs.sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      // First log should have scoped tag
      expect(logs[0].metadata?.tags?.scoped).toBe('yes');
      expect(logs[0].metadata?.extra?.orderId).toBe('12345');

      // Second log should NOT have scoped tag
      expect(logs[1].metadata?.tags?.scoped).toBeUndefined();
    });

    it('should support setFingerprint', async () => {
      Sentry.withScope((scope) => {
        scope.setFingerprint(['payment', 'order-123']);
        Sentry.captureException(new Error('Payment failed'));
      });

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      const fingerprint = logs[0].metadata?.extra?._fingerprint as string[];

      expect(fingerprint).toEqual(['payment', 'order-123']);
    });

    it('should support nested scopes', async () => {
      Sentry.withScope((outerScope) => {
        outerScope.setTag('level', 'outer');

        Sentry.withScope((innerScope) => {
          innerScope.setTag('level', 'inner');
          Sentry.captureMessage('Inner scope');
        });

        Sentry.captureMessage('Outer scope');
      });

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();

      logs.sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      expect(logs[0].metadata?.tags?.level).toBe('inner');
      expect(logs[1].metadata?.tags?.level).toBe('outer');
    });

    it('should return callback result', () => {
      const result = Sentry.withScope((scope) => {
        scope.setTag('test', 'value');
        return 'hello';
      });

      expect(result).toBe('hello');
    });
  });

  // -------------------------------------------------------------------------
  // Additional Sentry Functions
  // -------------------------------------------------------------------------
  describe('configureScope', () => {
    it('should configure global scope', async () => {
      Sentry.configureScope((scope) => {
        scope.setTag('environment', 'test');
        scope.setTag('release', '1.0.0');
      });

      Sentry.captureMessage('Test');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].metadata?.tags?.environment).toBe('test');
      expect(logs[0].metadata?.tags?.release).toBe('1.0.0');
    });
  });

  describe('setContext', () => {
    it('should set named context', async () => {
      Sentry.setContext('payment', {
        processor: 'stripe',
        orderId: '12345',
      });

      Sentry.captureMessage('Payment processed');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      const contexts = logs[0].metadata?.extra?._contexts as any;

      expect(contexts?.payment?.processor).toBe('stripe');
      expect(contexts?.payment?.orderId).toBe('12345');
    });
  });

  // -------------------------------------------------------------------------
  // ignoreErrors - Error Filtering by Pattern
  // -------------------------------------------------------------------------
  describe('ignoreErrors', () => {
    it('should ignore errors matching string pattern', async () => {
      await Sentry.close();
      await Sentry.init('memory', {
        ignoreErrors: ['ResizeObserver loop limit exceeded'],
      });

      // This should be ignored
      Sentry.captureException(new Error('ResizeObserver loop limit exceeded'));

      // This should be captured
      Sentry.captureException(new Error('Real error'));

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs.length).toBe(1);
      expect(logs[0].metadata?.error?.message).toBe('Real error');
    });

    it('should ignore errors matching RegExp pattern', async () => {
      await Sentry.close();
      await Sentry.init('memory', {
        ignoreErrors: [/Failed to fetch/i],
      });

      // These should all be ignored (case insensitive)
      Sentry.captureException(new Error('Failed to fetch'));
      Sentry.captureException(new Error('FAILED TO FETCH'));
      Sentry.captureException(new Error('Network error: failed to fetch resource'));

      // This should be captured
      Sentry.captureException(new Error('Server error'));

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs.length).toBe(1);
      expect(logs[0].metadata?.error?.message).toBe('Server error');
    });

    it('should support multiple patterns', async () => {
      await Sentry.close();
      await Sentry.init('memory', {
        ignoreErrors: [
          'ResizeObserver loop limit exceeded',
          'Network request failed',
          /Failed to fetch/i,
        ],
      });

      // All of these should be ignored
      Sentry.captureException(new Error('ResizeObserver loop limit exceeded'));
      Sentry.captureException(new Error('Network request failed'));
      Sentry.captureException(new Error('failed to fetch data'));

      // This should be captured
      Sentry.captureException(new Error('Database connection error'));

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs.length).toBe(1);
      expect(logs[0].metadata?.error?.message).toBe('Database connection error');
    });

    it('should still return event ID for ignored errors', async () => {
      await Sentry.close();
      await Sentry.init('memory', {
        ignoreErrors: ['Ignored error'],
      });

      const eventId = Sentry.captureException(new Error('Ignored error'));

      // Should return a valid UUID even though the error is ignored
      expect(eventId).toBeDefined();
      expect(typeof eventId).toBe('string');
      expect(eventId.length).toBe(36);

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs.length).toBe(0);
    });

    it('should work with string errors', async () => {
      await Sentry.close();
      await Sentry.init('memory', {
        ignoreErrors: ['Ignored string error'],
      });

      // This should be ignored
      Sentry.captureException('Ignored string error');

      // This should be captured
      Sentry.captureException('Captured string error');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs.length).toBe(1);
      expect(logs[0].metadata?.error?.message).toBe('Captured string error');
    });
  });

  // -------------------------------------------------------------------------
  // sampleRate - Event Sampling
  // -------------------------------------------------------------------------
  describe('sampleRate', () => {
    it('should drop all errors when sampleRate is 0', async () => {
      await Sentry.close();
      await Sentry.init('memory', { sampleRate: 0 });

      for (let i = 0; i < 10; i++) {
        const eventId = Sentry.captureException(new Error(`Error ${i}`));
        expect(eventId).toBe('');
      }

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs.length).toBe(0);
    });

    it('should capture all errors when sampleRate is 1', async () => {
      await Sentry.close();
      await Sentry.init('memory', { sampleRate: 1 });

      for (let i = 0; i < 5; i++) {
        const eventId = Sentry.captureException(new Error(`Error ${i}`));
        expect(eventId).not.toBe('');
        expect(eventId.length).toBe(36);
      }

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs.length).toBe(5);
    });

    it('should drop all messages when messagesSampleRate is 0', async () => {
      await Sentry.close();
      await Sentry.init('memory', { messagesSampleRate: 0 });

      for (let i = 0; i < 10; i++) {
        const eventId = Sentry.captureMessage(`Message ${i}`);
        expect(eventId).toBe('');
      }

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs.length).toBe(0);
    });

    it('should capture all messages when messagesSampleRate is 1', async () => {
      await Sentry.close();
      await Sentry.init('memory', { messagesSampleRate: 1 });

      for (let i = 0; i < 5; i++) {
        const eventId = Sentry.captureMessage(`Message ${i}`);
        expect(eventId).not.toBe('');
        expect(eventId.length).toBe(36);
      }

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs.length).toBe(5);
    });

    it('should sample errors and messages independently', async () => {
      await Sentry.close();
      await Sentry.init('memory', {
        sampleRate: 0,
        messagesSampleRate: 1,
      });

      // Errors should be dropped
      const errorId = Sentry.captureException(new Error('Dropped error'));
      expect(errorId).toBe('');

      // Messages should be captured
      const messageId = Sentry.captureMessage('Captured message');
      expect(messageId).not.toBe('');
      expect(messageId.length).toBe(36);

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs.length).toBe(1);
      expect(logs[0].message).toBe('Captured message');
    });
  });

  // -------------------------------------------------------------------------
  // beforeSend - Event Filtering/Modification Hook
  // -------------------------------------------------------------------------
  describe('beforeSend', () => {
    it('should allow modifying event data', async () => {
      await Sentry.close();
      await Sentry.init('memory', {
        beforeSend(event) {
          // Add custom metadata
          event.metadata = {
            ...event.metadata,
            extra: {
              ...event.metadata?.extra,
              processed: true,
              customField: 'added-by-hook',
            },
          };
          return event;
        },
      });

      Sentry.captureException(new Error('Test error'));

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs.length).toBe(1);
      expect(logs[0].metadata?.extra?.processed).toBe(true);
      expect(logs[0].metadata?.extra?.customField).toBe('added-by-hook');
    });

    it('should drop event when returning null', async () => {
      await Sentry.close();
      await Sentry.init('memory', {
        beforeSend(event) {
          // Filter out errors containing 'ignore'
          if (event.message?.includes('ignore')) {
            return null;
          }
          return event;
        },
      });

      // This should be dropped
      const droppedId = Sentry.captureException(new Error('Please ignore this'));
      expect(droppedId).toBe('');

      // This should be captured
      const capturedId = Sentry.captureException(new Error('Important error'));
      expect(capturedId).not.toBe('');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs.length).toBe(1);
      expect(logs[0].metadata?.error?.message).toBe('Important error');
    });

    it('should receive hint with originalException', async () => {
      let receivedHint: any = null;
      const originalError = new Error('Original error');

      await Sentry.close();
      await Sentry.init('memory', {
        beforeSend(event, hint) {
          receivedHint = hint;
          return event;
        },
      });

      Sentry.captureException(originalError);

      await new Promise((r) => setTimeout(r, 50));
      expect(receivedHint).toBeDefined();
      expect(receivedHint.originalException).toBe(originalError);
    });
  });

  // -------------------------------------------------------------------------
  // beforeSendMessage - Message Event Filtering/Modification Hook
  // -------------------------------------------------------------------------
  describe('beforeSendMessage', () => {
    it('should allow modifying message event data', async () => {
      await Sentry.close();
      await Sentry.init('memory', {
        beforeSendMessage(event) {
          // Modify the message
          event.message = `[MODIFIED] ${event.message}`;
          event.metadata = {
            ...event.metadata,
            tags: {
              ...event.metadata?.tags,
              modified: 'true',
            },
          };
          return event;
        },
      });

      Sentry.captureMessage('Original message');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs.length).toBe(1);
      expect(logs[0].message).toBe('[MODIFIED] Original message');
      expect(logs[0].metadata?.tags?.modified).toBe('true');
    });

    it('should drop message when returning null', async () => {
      await Sentry.close();
      await Sentry.init('memory', {
        beforeSendMessage(event) {
          // Filter out messages containing 'password'
          if (event.message?.includes('password')) {
            return null;
          }
          return event;
        },
      });

      // This should be dropped
      const droppedId = Sentry.captureMessage('User password changed');
      expect(droppedId).toBe('');

      // This should be captured
      const capturedId = Sentry.captureMessage('User email changed');
      expect(capturedId).not.toBe('');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs.length).toBe(1);
      expect(logs[0].message).toBe('User email changed');
    });

    it('should receive hint with originalMessage', async () => {
      let receivedHint: any = null;
      const originalMessage = 'Test message';

      await Sentry.close();
      await Sentry.init('memory', {
        beforeSendMessage(event, hint) {
          receivedHint = hint;
          return event;
        },
      });

      Sentry.captureMessage(originalMessage);

      await new Promise((r) => setTimeout(r, 50));
      expect(receivedHint).toBeDefined();
      expect(receivedHint.originalMessage).toBe(originalMessage);
    });

    it('should not affect captureException', async () => {
      await Sentry.close();
      await Sentry.init('memory', {
        beforeSendMessage() {
          // Drop all messages
          return null;
        },
      });

      // Messages should be dropped
      const messageId = Sentry.captureMessage('Dropped message');
      expect(messageId).toBe('');

      // Exceptions should still be captured
      const exceptionId = Sentry.captureException(new Error('Captured exception'));
      expect(exceptionId).not.toBe('');

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs.length).toBe(1);
      expect(logs[0].metadata?.error?.message).toBe('Captured exception');
    });
  });

  // -------------------------------------------------------------------------
  // captureEvent - Low-level Event Capture
  // -------------------------------------------------------------------------
  describe('captureEvent', () => {
    it('should capture a raw event and return event ID', async () => {
      const eventId = Sentry.captureEvent({
        message: 'Manual event',
        level: 'info',
      });

      expect(eventId).toBeDefined();
      expect(typeof eventId).toBe('string');
      expect(eventId.length).toBe(36); // UUID format

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].message).toBe('Manual event');
      expect(logs[0].level).toBe('info');
    });

    it('should use provided event_id if given', async () => {
      const customId = '12345678-1234-1234-1234-123456789012';
      const eventId = Sentry.captureEvent({
        event_id: customId,
        message: 'Custom ID event',
      });

      expect(eventId).toBe(customId);
    });

    it('should capture event with tags and extra', async () => {
      Sentry.captureEvent({
        message: 'Tagged event',
        level: 'warning',
        tags: { source: 'manual', module: 'payments' },
        extra: { orderId: '123', amount: 99.99 },
      });

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].metadata?.tags?.source).toBe('manual');
      expect(logs[0].metadata?.tags?.module).toBe('payments');
      expect(logs[0].metadata?.extra?.orderId).toBe('123');
      expect(logs[0].metadata?.extra?.amount).toBe(99.99);
      expect(logs[0].level).toBe('warn');
    });

    it('should capture event with user context', async () => {
      Sentry.captureEvent({
        message: 'User event',
        user: {
          id: 'user-123',
          email: 'user@example.com',
          username: 'testuser',
        },
      });

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].metadata?.user?.id).toBe('user-123');
      expect(logs[0].metadata?.user?.email).toBe('user@example.com');
    });

    it('should capture event with contexts', async () => {
      Sentry.captureEvent({
        message: 'Context event',
        contexts: {
          payment: { processor: 'stripe', status: 'failed' },
          browser: { name: 'Chrome', version: '120' },
        },
      });

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      const contexts = logs[0].metadata?.extra?._contexts as any;
      expect(contexts?.payment?.processor).toBe('stripe');
      expect(contexts?.payment?.status).toBe('failed');
      expect(contexts?.browser?.name).toBe('Chrome');
    });

    it('should capture event with fingerprint', async () => {
      Sentry.captureEvent({
        message: 'Fingerprint event',
        fingerprint: ['payment', 'stripe', 'failed'],
      });

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      const fingerprint = logs[0].metadata?.extra?._fingerprint as string[];
      expect(fingerprint).toEqual(['payment', 'stripe', 'failed']);
    });

    it('should capture event with breadcrumbs', async () => {
      Sentry.captureEvent({
        message: 'Breadcrumb event',
        breadcrumbs: [
          {
            category: 'navigation',
            message: 'Navigated to checkout',
            level: 'info',
            timestamp: Date.now() / 1000,
          },
          {
            category: 'api',
            message: 'API call started',
            level: 'info',
            data: { endpoint: '/api/charge' },
          },
        ],
      });

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      const breadcrumbs = logs[0].metadata?.extra?._breadcrumbs as any[];
      expect(breadcrumbs.length).toBe(2);
      expect(breadcrumbs[0].category).toBe('navigation');
      expect(breadcrumbs[1].category).toBe('api');
    });

    it('should capture exception event', async () => {
      Sentry.captureEvent({
        level: 'error',
        exception: {
          values: [
            {
              type: 'TypeError',
              value: 'Cannot read property x of undefined',
              stacktrace: {
                frames: [
                  {
                    filename: 'app.js',
                    function: 'processData',
                    lineno: 42,
                    colno: 15,
                    in_app: true,
                  },
                  {
                    filename: 'utils.js',
                    function: 'helper',
                    lineno: 10,
                    colno: 5,
                    in_app: true,
                  },
                ],
              },
            },
          ],
        },
      });

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].level).toBe('error');
      expect(logs[0].metadata?.error?.type).toBe('TypeError');
      expect(logs[0].metadata?.error?.message).toBe('Cannot read property x of undefined');
      expect(logs[0].metadata?.error?.stack).toContain('processData');
      expect(logs[0].message).toBe('TypeError: Cannot read property x of undefined');
    });

    it('should merge event data with scope data', async () => {
      // Set global context
      Sentry.setTag('environment', 'test');
      Sentry.setUser({ id: 'global-user' });
      Sentry.addBreadcrumb({
        category: 'global',
        message: 'Global breadcrumb',
      });

      // Capture event with its own context
      Sentry.captureEvent({
        message: 'Merged event',
        tags: { source: 'event' },
        extra: { eventData: 'value' },
      });

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();

      // Should have both global and event tags
      expect(logs[0].metadata?.tags?.environment).toBe('test');
      expect(logs[0].metadata?.tags?.source).toBe('event');
      expect(logs[0].metadata?.extra?.eventData).toBe('value');

      // Breadcrumbs from scope should be included
      const breadcrumbs = logs[0].metadata?.extra?._breadcrumbs as any[];
      expect(breadcrumbs.some((b: any) => b.category === 'global')).toBe(true);
    });

    it('should use default message when no message provided', async () => {
      Sentry.captureEvent({
        level: 'info',
        tags: { test: 'value' },
      });

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].message).toBe('Event captured');
    });

    it('should capture event within scope', async () => {
      Sentry.withScope((scope) => {
        scope.setTag('scoped', 'yes');
        scope.setExtra('scopeData', 'scopeValue');

        Sentry.captureEvent({
          message: 'Scoped event',
          tags: { eventTag: 'eventValue' },
        });
      });

      await new Promise((r) => setTimeout(r, 50));
      const logs = await Sentry.getLogs();
      expect(logs[0].metadata?.tags?.scoped).toBe('yes');
      expect(logs[0].metadata?.tags?.eventTag).toBe('eventValue');
      expect(logs[0].metadata?.extra?.scopeData).toBe('scopeValue');
    });
  });
});
