import * as Sentry from '../src/index.js';

async function demo() {
  // Initialize with console provider
  await Sentry.init('console', {
    service: 'demo-app',
    environment: 'development',
    minLevel: 'debug',
    enableSessions: true,
  });

  // Set user context
  Sentry.setUser({
    id: '123',
    email: 'user@example.com',
    username: 'demo_user',
  });

  // Add some tags
  Sentry.setTag('version', '1.0.0');
  Sentry.setTag('region', 'us-east-1');

  // Log different levels
  Sentry.captureMessage('Application started', 'info');
  Sentry.captureMessage('This is a debug message', 'debug');
  Sentry.captureMessage('Warning: High memory usage', 'warning');

  // Capture an error
  try {
    throw new Error('Something went wrong!');
  } catch (error) {
    Sentry.captureException(error, {
      tags: { section: 'payment' },
      extra: {
        orderId: '12345',
        amount: 99.99,
        items: ['item1', 'item2'],
      },
    });
  }

  // Use scoped context
  Sentry.withScope((scope) => {
    scope.setTag('transaction', 'checkout');
    scope.setExtra('cartTotal', 299.99);
    Sentry.captureMessage('Checkout completed', 'info');
  });

  // Start a session
  await Sentry.startSession({ user: { id: '123' } });

  // Simulate some activity
  Sentry.info('User viewed product page');
  Sentry.warn('Cart is about to expire');

  // End session
  await Sentry.endSession('ended');

  await Sentry.close();
}

demo().catch(console.error);
