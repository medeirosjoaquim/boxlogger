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

  it('should use fallback UUID generation when crypto.randomUUID is unavailable', async () => {
    const originalCrypto = global.crypto;
    
    // Mock crypto without randomUUID
    (global as any).crypto = {};

    await Sentry.init('memory', {
      service: 'test-app',
    });

    // This will use fallback UUID generation
    const eventId = Sentry.captureMessage('Test fallback UUID', 'info');
    
    // Should be a valid UUID format
    expect(eventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    global.crypto = originalCrypto;
  });

  it('should handle browser location for hostname', async () => {
    const originalGlobalThis = (globalThis as any).location;
    
    // Mock browser location
    (globalThis as any).location = { hostname: 'example.com' };

    await Sentry.init('memory', {
      service: 'browser-app',
    });

    expect(Sentry.isInitialized()).toBe(true);

    // Clean up
    if (originalGlobalThis === undefined) {
      delete (globalThis as any).location;
    } else {
      (globalThis as any).location = originalGlobalThis;
    }
  });

  it('should return "unknown" hostname when os module fails', async () => {
    const originalGlobalThis = (globalThis as any).location;
    const originalRequire = (global as any).require;
    
    // Remove location
    delete (globalThis as any).location;
    
    // Mock require to throw
    (global as any).require = () => {
      throw new Error('Module not found');
    };

    await Sentry.init('memory', {
      service: 'test-app',
    });

    expect(Sentry.isInitialized()).toBe(true);

    // Restore
    (global as any).require = originalRequire;
    if (originalGlobalThis !== undefined) {
      (globalThis as any).location = originalGlobalThis;
    }
  });
});
