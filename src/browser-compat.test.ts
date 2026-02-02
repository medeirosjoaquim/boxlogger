import * as Sentry from './index.js';

describe('Browser Compatibility', () => {
  beforeEach(async () => {
    if (Sentry.isInitialized()) {
      await Sentry.close();
    }
  });

  afterEach(async () => {
    if (Sentry.isInitialized()) {
      await Sentry.close();
    }
  });

  it('should work with console provider (browser-safe)', async () => {
    await Sentry.init('console', {
      service: 'browser-app',
      environment: 'development',
    });

    expect(Sentry.isInitialized()).toBe(true);

    // Should not throw
    Sentry.captureMessage('Test from browser', 'info');
    Sentry.captureException(new Error('Browser error'));
  });

  it('should work with memory provider (browser-safe)', async () => {
    await Sentry.init('memory', {
      service: 'browser-app',
    });

    expect(Sentry.isInitialized()).toBe(true);

    Sentry.captureMessage('Memory test', 'info');
    const logs = await Sentry.getLogs();
    expect(logs.length).toBeGreaterThan(0);
  });

  it('should handle missing process.env gracefully', async () => {
    const originalProcess = global.process;
    
    // Simulate browser environment
    (global as any).process = undefined;

    await Sentry.init('console', {
      service: 'browser-app',
    });

    expect(Sentry.isInitialized()).toBe(true);

    global.process = originalProcess;
  });
});
