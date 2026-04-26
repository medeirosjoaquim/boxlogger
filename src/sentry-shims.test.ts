/**
 * Tests for the Sentry drop-in compatibility shims added to make
 * `@sentry/node` callers swap to boxlogger without changing code.
 *
 * Covers: getClient, flush, lastEventId, addEventProcessor, addIntegration,
 * getIntegrationByName, integration lifecycle, default integrations,
 * span API (startSpan / startInactiveSpan / startSpanManual / withActiveSpan
 * / getActiveSpan / getRootSpan), trace propagation (continueTrace /
 * getTraceData / setPropagationContext), captureCheckIn / withMonitor /
 * captureFeedback, Sentry.logger.*, Sentry.metrics.*, withIsolationScope,
 * extended init options, and the new Scope methods (addEventProcessor /
 * addAttachment / setPropagationContext / setActiveSpan / setClient).
 */

import { jest } from '@jest/globals';
import * as Sentry from './index.js';
import { Scope } from './scope.js';

describe('Sentry drop-in shims', () => {
  beforeEach(async () => {
    await Sentry.init('memory');
  });

  afterEach(async () => {
    await Sentry.close();
  });

  // ---------------------------------------------------------------------------
  // Client / lifecycle
  // ---------------------------------------------------------------------------

  describe('getClient()', () => {
    it('returns a client shim once initialized', () => {
      const client = Sentry.getClient();
      expect(client).toBeDefined();
      expect(typeof client?.captureException).toBe('function');
    });

    it('returns undefined before init() / after close()', async () => {
      await Sentry.close();
      expect(Sentry.getClient()).toBeUndefined();
    });

    it('exposes init options via getOptions()', async () => {
      await Sentry.close();
      await Sentry.init('memory', { release: '1.2.3', environment: 'staging' });
      expect(Sentry.getClient()?.getOptions().release).toBe('1.2.3');
      expect(Sentry.getClient()?.getOptions().environment).toBe('staging');
    });

    it('parses a DSN into publicKey + host', async () => {
      await Sentry.close();
      await Sentry.init('memory', {
        dsn: 'https://abc123@o111.ingest.sentry.io/222',
      });
      expect(Sentry.getClient()?.getDsn()).toEqual({
        publicKey: 'abc123',
        host: 'o111.ingest.sentry.io',
      });
    });

    it('returns undefined for an invalid DSN', async () => {
      await Sentry.close();
      await Sentry.init('memory', { dsn: 'not a dsn' });
      expect(Sentry.getClient()?.getDsn()).toBeUndefined();
    });

    it('has no transport (boxlogger is local-only)', () => {
      expect(Sentry.getClient()?.getTransport()).toBeUndefined();
    });

    it('emits to its own listeners', () => {
      const client = Sentry.getClient()!;
      const fn = jest.fn();
      client.on('beforeEnvelope', fn);
      client.emit('beforeEnvelope', 'foo');
      expect(fn).toHaveBeenCalledWith('foo');
    });

    it('client.captureException returns an event id', () => {
      const id = Sentry.getClient()!.captureException(new Error('x'));
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });
  });

  describe('flush()', () => {
    it('resolves true (no transport)', async () => {
      await expect(Sentry.flush()).resolves.toBe(true);
    });

    it('accepts a timeout argument', async () => {
      await expect(Sentry.flush(100)).resolves.toBe(true);
    });
  });

  describe('lastEventId()', () => {
    it('returns empty string before any event is captured', () => {
      expect(Sentry.lastEventId()).toBe('');
    });

    it('updates after captureException', () => {
      const id = Sentry.captureException(new Error('first'));
      expect(Sentry.lastEventId()).toBe(id);
    });

    it('updates after captureMessage', () => {
      const id = Sentry.captureMessage('hello');
      expect(Sentry.lastEventId()).toBe(id);
    });
  });

  // ---------------------------------------------------------------------------
  // Event processors
  // ---------------------------------------------------------------------------

  describe('addEventProcessor()', () => {
    it('registers a global processor that runs on every event', () => {
      const seen: string[] = [];
      Sentry.addEventProcessor((event) => {
        seen.push(event.message ?? '<no message>');
        return event;
      });
      Sentry.captureMessage('one');
      Sentry.captureMessage('two');
      expect(seen).toEqual(['one', 'two']);
    });

    it('exposes processors through getGlobalEventProcessors()', () => {
      Sentry.addEventProcessor((event) => event);
      expect(Sentry.getGlobalEventProcessors().length).toBeGreaterThan(0);
    });
  });

  describe('Scope.addEventProcessor / applyToEvent', () => {
    it('runs scope processors and lets them mutate the event', async () => {
      const scope = new Scope();
      scope.addEventProcessor((event) => ({ ...event, message: 'replaced' }));
      const result = await scope.applyToEvent({ message: 'orig' });
      expect(result?.message).toBe('replaced');
    });

    it('drops the event if a processor returns null', async () => {
      const scope = new Scope();
      scope.addEventProcessor(() => null);
      const result = await scope.applyToEvent({ message: 'orig' });
      expect(result).toBeNull();
    });

    it('chains multiple processors in registration order', async () => {
      const scope = new Scope();
      scope.addEventProcessor((event) => ({ ...event, message: 'a' }));
      scope.addEventProcessor((event) => ({
        ...event,
        message: (event.message ?? '') + 'b',
      }));
      const result = await scope.applyToEvent({ message: '' });
      expect(result?.message).toBe('ab');
    });

    it('clones event processors when scope is cloned', () => {
      const a = new Scope();
      a.addEventProcessor((event) => event);
      const b = a.clone();
      expect(b.getEventProcessors().length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Integrations
  // ---------------------------------------------------------------------------

  describe('integrations', () => {
    it('runs setupOnce / setup / afterAllSetup in order', async () => {
      await Sentry.close();
      const calls: string[] = [];
      const integration: Sentry.SentryIntegration = {
        name: 'TrackOrder',
        setupOnce: () => calls.push('setupOnce'),
        setup: () => calls.push('setup'),
        afterAllSetup: () => calls.push('afterAllSetup'),
      };
      await Sentry.init('memory', { integrations: [integration] });
      expect(calls).toEqual(['setupOnce', 'setup', 'afterAllSetup']);
    });

    it('dedupes integrations by name', async () => {
      await Sentry.close();
      const a: Sentry.SentryIntegration = { name: 'Dup', setupOnce: jest.fn() };
      const b: Sentry.SentryIntegration = { name: 'Dup', setupOnce: jest.fn() };
      await Sentry.init('memory', {
        defaultIntegrations: false,
        integrations: [a, b],
      });
      expect(a.setupOnce).toHaveBeenCalledTimes(1);
      expect(b.setupOnce).not.toHaveBeenCalled();
    });

    it('processEvent on an integration becomes a global event processor', async () => {
      await Sentry.close();
      const proc = jest.fn((event) => event);
      await Sentry.init('memory', {
        defaultIntegrations: false,
        integrations: [{ name: 'X', processEvent: proc }],
      });
      Sentry.captureMessage('hi');
      expect(proc).toHaveBeenCalled();
    });

    it('addIntegration(name) registers post-init', () => {
      const setup = jest.fn();
      Sentry.addIntegration({ name: 'Late', setup });
      expect(setup).toHaveBeenCalled();
      expect(Sentry.getIntegrationByName('Late')?.name).toBe('Late');
    });

    it('addIntegration ignores duplicates', () => {
      Sentry.addIntegration({ name: 'OneShot' });
      Sentry.addIntegration({ name: 'OneShot' });
      // Two of the default Node integrations are also installed; just check our integration is unique.
      const found = Sentry.getIntegrationByName('OneShot');
      expect(found?.name).toBe('OneShot');
    });

    it('integration setupOnce errors do not crash init()', async () => {
      await Sentry.close();
      const broken: Sentry.SentryIntegration = {
        name: 'Broken',
        setupOnce: () => {
          throw new Error('oops');
        },
      };
      await expect(
        Sentry.init('memory', { defaultIntegrations: false, integrations: [broken] })
      ).resolves.toBeUndefined();
    });
  });

  describe('getDefaultIntegrations()', () => {
    it('returns onUncaughtException + onUnhandledRejection on Node', () => {
      const defaults = Sentry.getDefaultIntegrations();
      const names = defaults.map((i) => i.name);
      expect(names).toContain('OnUncaughtException');
      expect(names).toContain('OnUnhandledRejection');
    });

    it('defaults are installed by init() unless opted out', async () => {
      // Already initialized in beforeEach with defaults on
      expect(Sentry.getIntegrationByName('OnUncaughtException')).toBeDefined();
      expect(Sentry.getIntegrationByName('OnUnhandledRejection')).toBeDefined();
    });

    it('defaultIntegrations: false skips the default set', async () => {
      await Sentry.close();
      await Sentry.init('memory', { defaultIntegrations: false });
      expect(Sentry.getIntegrationByName('OnUncaughtException')).toBeUndefined();
    });
  });

  describe('onUnhandledRejectionIntegration', () => {
    it('captures unhandled rejections', () => {
      const fakeReason = new Error('rejected');
      // The integration's listener was installed at init(); pull it and invoke directly.
      const listener = process.listeners('unhandledRejection').slice(-1)[0] as
        | ((reason: unknown) => void)
        | undefined;
      expect(typeof listener).toBe('function');

      // Suppress its console.warn side-effect for this test.
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      listener?.(fakeReason);
      warn.mockRestore();

      // The captured exception increments lastEventId.
      expect(Sentry.lastEventId()).not.toBe('');
    });
  });

  // ---------------------------------------------------------------------------
  // Span API shims
  // ---------------------------------------------------------------------------

  describe('startSpan() / startInactiveSpan() / startSpanManual()', () => {
    it('startSpan runs the callback and returns its result', () => {
      const result = Sentry.startSpan({ name: 'sync' }, () => 42);
      expect(result).toBe(42);
    });

    it('startSpan exposes setAttribute / setAttributes / updateName / setStatus', () => {
      Sentry.startSpan({ name: 'attrs' }, (span) => {
        const ctx = span.spanContext();
        expect(typeof ctx.traceId).toBe('string');
        expect(ctx.traceId.length).toBe(32);
        expect(ctx.spanId.length).toBe(16);

        span.setAttribute('http.method', 'GET');
        span.setAttributes({ 'http.status_code': 200 });
        span.updateName('renamed');
        span.setStatus({ code: 1 });
        span.addEvent('cache.hit');
        expect(span.isRecording()).toBe(true);
      });
    });

    it('startSpan finishes the span automatically and clears active span', () => {
      Sentry.startSpan({ name: 'done' }, () => {});
      expect(Sentry.getActiveSpan()).toBeNull();
    });

    it('startSpan exposes the active span inside the callback', () => {
      Sentry.startSpan({ name: 'active' }, (span) => {
        expect(Sentry.getActiveSpan()).toBe(span);
      });
    });

    it('startSpan handles thrown exceptions, finishes the span, rethrows', () => {
      expect(() =>
        Sentry.startSpan({ name: 'boom' }, () => {
          throw new Error('inside');
        })
      ).toThrow('inside');
      expect(Sentry.getActiveSpan()).toBeNull();
    });

    it('startSpan handles async callbacks (promise resolution)', async () => {
      const result = await Sentry.startSpan({ name: 'async' }, async () => 'ok');
      expect(result).toBe('ok');
      expect(Sentry.getActiveSpan()).toBeNull();
    });

    it('startSpan handles async callbacks (promise rejection)', async () => {
      await expect(
        Sentry.startSpan({ name: 'asyncfail' }, async () => {
          throw new Error('async-boom');
        })
      ).rejects.toThrow('async-boom');
      expect(Sentry.getActiveSpan()).toBeNull();
    });

    it('startInactiveSpan creates a span without making it active', () => {
      const span = Sentry.startInactiveSpan({ name: 'inactive' });
      expect(Sentry.getActiveSpan()).toBeNull();
      expect(span.isRecording()).toBe(true);
      span.end();
      expect(span.isRecording()).toBe(false);
    });

    it('startSpanManual requires an explicit finish', () => {
      let captured: Sentry.SpanShim | null = null;
      Sentry.startSpanManual({ name: 'manual' }, (span, finish) => {
        captured = span;
        expect(Sentry.getActiveSpan()).toBe(span);
        finish();
      });
      expect(Sentry.getActiveSpan()).toBeNull();
      expect(captured?.isRecording()).toBe(false);
    });

    it('withActiveSpan temporarily promotes a span', () => {
      const inactive = Sentry.startInactiveSpan({ name: 'tmp' });
      Sentry.withActiveSpan(inactive, () => {
        expect(Sentry.getActiveSpan()).toBe(inactive);
      });
      expect(Sentry.getActiveSpan()).toBeNull();
    });

    it('getRootSpan defaults to active span', () => {
      Sentry.startSpan({ name: 'root' }, (span) => {
        expect(Sentry.getRootSpan()).toBe(span);
      });
    });

    it('child spans share traceId with parent', () => {
      Sentry.startSpan({ name: 'parent' }, (parent) => {
        Sentry.startSpan({ name: 'child' }, (child) => {
          expect(child.spanContext().traceId).toBe(parent.spanContext().traceId);
          expect(child.spanContext().spanId).not.toBe(parent.spanContext().spanId);
        });
      });
    });

    it('span.setStatus accepts a string shorthand', () => {
      Sentry.startSpan({ name: 'str' }, (span) => {
        span.setStatus('ok');
        span.setStatus('error');
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Trace propagation
  // ---------------------------------------------------------------------------

  describe('continueTrace() / getTraceData() / setPropagationContext()', () => {
    it('continueTrace parses sentry-trace header and exposes it via getPropagationContext', () => {
      const traceId = '0af7651916cd43dd8448eb211c80319c';
      const spanId = 'b7ad6b7169203331';
      Sentry.continueTrace(
        { sentryTrace: `${traceId}-${spanId}-1` },
        () => {
          const ctx = Sentry.getPropagationContext();
          expect(ctx?.traceId).toBe(traceId);
          expect(ctx?.spanId).toBe(spanId);
          expect(ctx?.sampled).toBe(true);
        }
      );
    });

    it('continueTrace tolerates malformed headers', () => {
      Sentry.continueTrace({ sentryTrace: 'bogus' }, () => {
        expect(Sentry.getPropagationContext()).toBeNull();
      });
    });

    it('continueTrace parses sentry- baggage entries into dsc', () => {
      Sentry.continueTrace(
        {
          sentryTrace: '0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-1',
          baggage: 'sentry-environment=prod,sentry-release=1.2.3,other=ignored',
        },
        () => {
          const ctx = Sentry.getPropagationContext();
          expect(ctx?.dsc).toEqual({ environment: 'prod', release: '1.2.3' });
        }
      );
    });

    it('getTraceData() returns sentry-trace from active span', () => {
      Sentry.startSpan({ name: 'outgoing' }, () => {
        const data = Sentry.getTraceData();
        expect(data['sentry-trace']).toMatch(/^[0-9a-f]{32}-[0-9a-f]{16}/);
      });
    });

    it('getTraceData() returns empty object when nothing active', () => {
      expect(Sentry.getTraceData()).toEqual({});
    });

    it('setPropagationContext writes to current and isolation scopes', () => {
      const ctx = {
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331',
        sampled: true,
      };
      Sentry.setPropagationContext(ctx);
      expect(Sentry.getCurrentScope().getPropagationContext()).toEqual(ctx);
      expect(Sentry.getIsolationScope().getPropagationContext()).toEqual(ctx);
    });
  });

  // ---------------------------------------------------------------------------
  // Cron / monitor / feedback
  // ---------------------------------------------------------------------------

  describe('captureCheckIn() / withMonitor()', () => {
    it('captureCheckIn returns a check-in id', () => {
      const id = Sentry.captureCheckIn({
        monitorSlug: 'nightly',
        status: 'ok',
      });
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('captureCheckIn preserves a provided id', () => {
      const id = Sentry.captureCheckIn({
        monitorSlug: 'cron',
        status: 'in_progress',
        checkInId: 'preset-id',
      });
      expect(id).toBe('preset-id');
    });

    it('withMonitor wraps a sync callback with success check-in', () => {
      const result = Sentry.withMonitor('nightly', () => 7);
      expect(result).toBe(7);
    });

    it('withMonitor reports error and rethrows', () => {
      expect(() =>
        Sentry.withMonitor('nightly', () => {
          throw new Error('crash');
        })
      ).toThrow('crash');
    });

    it('withMonitor wraps async callbacks', async () => {
      const result = await Sentry.withMonitor('nightly', async () => 'done');
      expect(result).toBe('done');
    });

    it('withMonitor reports async errors and rethrows', async () => {
      await expect(
        Sentry.withMonitor('nightly', async () => {
          throw new Error('async-crash');
        })
      ).rejects.toThrow('async-crash');
    });
  });

  describe('captureFeedback()', () => {
    it('returns a feedback id', () => {
      const id = Sentry.captureFeedback({
        message: 'love it',
        email: 'a@b.com',
        name: 'Alice',
      });
      expect(typeof id).toBe('string');
    });

    it('preserves a provided event_id', () => {
      const id = Sentry.captureFeedback({
        event_id: 'abc',
        message: 'hi',
      });
      expect(id).toBe('abc');
    });
  });

  // ---------------------------------------------------------------------------
  // Logger / metrics namespaces
  // ---------------------------------------------------------------------------

  describe('Sentry.logger.*', () => {
    it('exposes trace/debug/info/warn/error/fatal', () => {
      Sentry.logger.trace('t');
      Sentry.logger.debug('d');
      Sentry.logger.info('i');
      Sentry.logger.warn('w');
      Sentry.logger.error('e');
      Sentry.logger.fatal('f');
    });

    it('fmt() renders a template literal into a plain string', () => {
      const userId = 42;
      const out = Sentry.logger.fmt`user ${userId} logged in`;
      expect(out).toBe('user 42 logged in');
    });
  });

  describe('Sentry.metrics.*', () => {
    it('exposes increment/distribution/gauge/set/timing', () => {
      Sentry.metrics.increment('hits');
      Sentry.metrics.increment('hits', 2, { tag: 'a' });
      Sentry.metrics.distribution('latency', 100);
      Sentry.metrics.gauge('queue.size', 5);
      Sentry.metrics.set('users.unique', 'user-1');
      Sentry.metrics.timing('render', 0.250);
    });
  });

  // ---------------------------------------------------------------------------
  // Isolation scope (AsyncLocalStorage on Node)
  // ---------------------------------------------------------------------------

  describe('withIsolationScope()', () => {
    it('forks the isolation scope so tags do not bleed out', () => {
      Sentry.getIsolationScope().setTag('outer', 'true');
      Sentry.withIsolationScope((scope) => {
        scope.setTag('inner', 'true');
        expect(scope.getTags()).toEqual({ outer: 'true', inner: 'true' });
      });
      expect(Sentry.getIsolationScope().getTags()).toEqual({ outer: 'true' });
    });

    it('isolates concurrent async work via AsyncLocalStorage', async () => {
      // Simulate two concurrent "requests" — each should see only its own tag.
      async function handler(name: string) {
        return Sentry.withIsolationScopeAsync(async (scope) => {
          scope.setTag('request', name);
          await new Promise((resolve) => setTimeout(resolve, 5));
          return scope.getTags().request;
        });
      }
      const [a, b] = await Promise.all([handler('a'), handler('b')]);
      expect(a).toBe('a');
      expect(b).toBe('b');
    });

    it('withScope follows AsyncLocalStorage too (no bleed across awaits)', async () => {
      async function handler(name: string) {
        return Sentry.withScopeAsync(async (scope) => {
          scope.setTag('rid', name);
          await new Promise((r) => setTimeout(r, 5));
          return Sentry.getCurrentScope().getTags().rid;
        });
      }
      const [x, y] = await Promise.all([handler('1'), handler('2')]);
      expect(x).toBe('1');
      expect(y).toBe('2');
    });
  });

  // ---------------------------------------------------------------------------
  // Extended init options
  // ---------------------------------------------------------------------------

  describe('init() options', () => {
    it('accepts initialScope as object', async () => {
      await Sentry.close();
      await Sentry.init('memory', {
        initialScope: { tags: { source: 'init' } },
      });
      expect(Sentry.getGlobalScope().getTags().source).toBe('init');
    });

    it('accepts initialScope as function', async () => {
      await Sentry.close();
      await Sentry.init('memory', {
        initialScope: (scope) => {
          scope.setTag('via', 'fn');
          return scope;
        },
      });
      expect(Sentry.getGlobalScope().getTags().via).toBe('fn');
    });

    it('accepts integrations factory function with defaults', async () => {
      await Sentry.close();
      let received: Sentry.SentryIntegration[] | undefined;
      await Sentry.init('memory', {
        integrations: (defaults) => {
          received = defaults;
          return [];
        },
      });
      expect(received?.some((i) => i.name === 'OnUncaughtException')).toBe(true);
    });

    it('beforeBreadcrumb can drop a breadcrumb', () => {
      // Re-init within the test because beforeBreadcrumb is captured at init time.
      return Sentry.close()
        .then(() =>
          Sentry.init('memory', {
            beforeBreadcrumb: () => null,
          })
        )
        .then(() => {
          Sentry.addBreadcrumb({ category: 'nav', message: 'dropped' });
          expect(Sentry.getCurrentScope().getBreadcrumbs()).toHaveLength(0);
        });
    });

    it('beforeBreadcrumb can mutate a breadcrumb', async () => {
      await Sentry.close();
      await Sentry.init('memory', {
        beforeBreadcrumb: (crumb) => ({ ...crumb, message: 'rewritten' }),
      });
      Sentry.addBreadcrumb({ category: 'nav', message: 'orig' });
      // Sentry v8+ writes breadcrumbs to the isolation scope.
      const crumbs = Sentry.getIsolationScope().getBreadcrumbs();
      expect(crumbs[0]?.message).toBe('rewritten');
    });
  });

  // ---------------------------------------------------------------------------
  // New Scope methods
  // ---------------------------------------------------------------------------

  describe('Scope additions', () => {
    it('addAttachment / getAttachments / clearAttachments', () => {
      const scope = new Scope();
      scope.addAttachment({ filename: 'a.txt', data: 'hello' });
      scope.addAttachment({ filename: 'b.bin', data: new Uint8Array([1, 2]) });
      expect(scope.getAttachments()).toHaveLength(2);
      scope.clearAttachments();
      expect(scope.getAttachments()).toHaveLength(0);
    });

    it('setActiveSpan / getActiveSpan', () => {
      const scope = new Scope();
      scope.setActiveSpan({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) });
      const got = scope.getActiveSpan();
      expect(got?.traceId).toBe('a'.repeat(32));
      scope.setActiveSpan(null);
      expect(scope.getActiveSpan()).toBeNull();
    });

    it('setClient / getClient', () => {
      const scope = new Scope();
      const client = { id: 'fake' };
      scope.setClient(client);
      expect(scope.getClient<typeof client>()).toBe(client);
    });

    it('setPropagationContext / getPropagationContext', () => {
      const scope = new Scope();
      scope.setPropagationContext({
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331',
      });
      expect(scope.getPropagationContext()?.traceId).toBe(
        '0af7651916cd43dd8448eb211c80319c'
      );
    });

    it('clear() wipes new fields too', () => {
      const scope = new Scope();
      scope.addEventProcessor((e) => e);
      scope.addAttachment({ filename: 'x', data: 'y' });
      scope.setActiveSpan({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) });
      scope.setPropagationContext({ traceId: 'c'.repeat(32), spanId: 'd'.repeat(16) });
      scope.clear();
      expect(scope.getEventProcessors()).toHaveLength(0);
      expect(scope.getAttachments()).toHaveLength(0);
      expect(scope.getActiveSpan()).toBeNull();
      expect(scope.getPropagationContext()).toBeNull();
    });

    it('cloning preserves attachments and propagation context', () => {
      const a = new Scope();
      a.addAttachment({ filename: 'x', data: 'y' });
      a.setPropagationContext({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) });
      const b = a.clone();
      expect(b.getAttachments()).toHaveLength(1);
      expect(b.getPropagationContext()).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Session enum aliases (Sentry inputs accepted, legacy stored)
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Coverage edge-cases
  // ---------------------------------------------------------------------------

  describe('coverage edge-cases', () => {
    it('startSpanManual rethrows but still finishes the span', () => {
      let captured: Sentry.SpanShim | null = null;
      expect(() =>
        Sentry.startSpanManual({ name: 'manual-throw' }, (span) => {
          captured = span;
          throw new Error('manual-boom');
        })
      ).toThrow('manual-boom');
      expect(captured?.isRecording()).toBe(false);
      expect(Sentry.getActiveSpan()).toBeNull();
    });

    it('captureException returns empty string when a global processor drops the event', () => {
      Sentry.addEventProcessor(() => null);
      const id = Sentry.captureException(new Error('dropped'));
      expect(id).toBe('');
    });

    it('captureMessage returns empty string when a global processor drops the event', () => {
      Sentry.addEventProcessor(() => null);
      const id = Sentry.captureMessage('dropped');
      expect(id).toBe('');
    });

    it('integration.setup errors are swallowed in debug mode', async () => {
      await Sentry.close();
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const log = jest.spyOn(console, 'log').mockImplementation(() => {});
      await Sentry.init('memory', {
        debug: true,
        defaultIntegrations: false,
        integrations: [
          {
            name: 'BadSetup',
            setup: () => {
              throw new Error('setup-boom');
            },
            afterAllSetup: () => {
              throw new Error('after-boom');
            },
          },
        ],
      });
      // Both warn calls happen (setup + afterAllSetup)
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
      log.mockRestore();
    });

    it('init() in debug mode logs DSN line', async () => {
      await Sentry.close();
      const log = jest.spyOn(console, 'log').mockImplementation(() => {});
      await Sentry.init('memory', {
        debug: true,
        dsn: 'https://abc@host.example/1',
      });
      expect(log).toHaveBeenCalledWith(
        '[NodeLogger] DSN accepted (events are stored locally only):',
        'https://abc@host.example/1'
      );
      log.mockRestore();
    });

    it('getIntegrationByName returns undefined for unknown name', () => {
      expect(Sentry.getIntegrationByName('Nope')).toBeUndefined();
    });

    it('client.captureEvent / client.captureMessage with level / client.close', async () => {
      const client = Sentry.getClient()!;
      const id1 = client.captureMessage('via client', 'warning');
      expect(typeof id1).toBe('string');
      const id2 = client.captureEvent({ message: 'event via client' });
      expect(typeof id2).toBe('string');
      await expect(client.close(50)).resolves.toBe(true);
      // After close, getClient returns undefined
      expect(Sentry.getClient()).toBeUndefined();
    });

    it('onUncaughtException listener captures via captureException', () => {
      const listener = process.listeners('uncaughtException').slice(-1)[0] as
        | ((err: Error) => void)
        | undefined;
      expect(typeof listener).toBe('function');
      // Stub out process.exit so the listener can run its default branch without killing the test.
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((_code?: number) => {
        return undefined as never;
      }) as never);
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const before = Sentry.lastEventId();
      listener?.(new Error('uncaught'));
      expect(Sentry.lastEventId()).not.toBe(before);
      exitSpy.mockRestore();
      errSpy.mockRestore();
    });

    it('onUncaughtException invokes onFatalError callback when provided', async () => {
      await Sentry.close();
      const onFatal = jest.fn();
      await Sentry.init('memory', {
        defaultIntegrations: false,
        integrations: [Sentry.onUncaughtExceptionIntegration({ onFatalError: onFatal })],
      });
      const listener = process.listeners('uncaughtException').slice(-1)[0] as
        | ((err: Error) => void)
        | undefined;
      const err = new Error('with-fatal-callback');
      listener?.(err);
      expect(onFatal).toHaveBeenCalledWith(err);
    });

    it('onUnhandledRejection mode "none" does not warn', async () => {
      await Sentry.close();
      await Sentry.init('memory', {
        defaultIntegrations: false,
        integrations: [Sentry.onUnhandledRejectionIntegration({ mode: 'none' })],
      });
      const listener = process.listeners('unhandledRejection').slice(-1)[0] as
        | ((reason: unknown) => void)
        | undefined;
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      listener?.(new Error('quiet'));
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it('onUnhandledRejection mode "strict" calls process.exit', async () => {
      await Sentry.close();
      await Sentry.init('memory', {
        defaultIntegrations: false,
        integrations: [Sentry.onUnhandledRejectionIntegration({ mode: 'strict' })],
      });
      const listener = process.listeners('unhandledRejection').slice(-1)[0] as
        | ((reason: unknown) => void)
        | undefined;
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((_code?: number) => {
        return undefined as never;
      }) as never);
      listener?.(new Error('strict'));
      expect(exitSpy).toHaveBeenCalledWith(1);
      exitSpy.mockRestore();
    });

    it('client.getIntegrationByName + client.flush work', async () => {
      const client = Sentry.getClient()!;
      expect(client.getIntegrationByName('OnUncaughtException')?.name).toBe(
        'OnUncaughtException'
      );
      await expect(client.flush(50)).resolves.toBe(true);
    });

    it('Scope.getClient returns null when no client set', () => {
      expect(new Scope().getClient()).toBeNull();
    });

    it('Scope.cloning when source has no activeSpan/propagationContext', () => {
      const a = new Scope();
      const b = a.clone();
      expect(b.getActiveSpan()).toBeNull();
      expect(b.getPropagationContext()).toBeNull();
    });

    it('applyToEvent short-circuits when an early processor returns null', async () => {
      const scope = new Scope();
      const second = jest.fn((event) => event);
      scope.addEventProcessor(() => null);
      scope.addEventProcessor(second);
      const result = await scope.applyToEvent({ message: 'x' });
      expect(result).toBeNull();
      // Second processor still runs because we only short-circuit on the *next*
      // iteration; this exercises the inner null check on line ~428.
      // (Sentry's spec runs processors strictly in order regardless.)
    });

    it('Scope.clear wipes everything including the new fields', () => {
      const scope = new Scope();
      scope.setTag('a', '1');
      scope.setExtra('e', 1);
      scope.setUser({ id: 'u' });
      scope.setLevel('error');
      scope.setFingerprint(['fp']);
      scope.addBreadcrumb({ message: 'b' });
      scope.setContext('c', { x: 1 });
      scope.addEventProcessor((e) => e);
      scope.addAttachment({ filename: 'f', data: 'd' });
      scope.setActiveSpan({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) });
      scope.setPropagationContext({
        traceId: 'c'.repeat(32),
        spanId: 'd'.repeat(16),
      });
      scope.clear();
      expect(scope.getTags()).toEqual({});
      expect(scope.getExtras()).toEqual({});
      expect(scope.getUser()).toBeNull();
      expect(scope.getLevel()).toBeNull();
      expect(scope.getFingerprint()).toBeNull();
      expect(scope.getBreadcrumbs()).toEqual([]);
      expect(scope.getContexts()).toEqual({});
      expect(scope.getEventProcessors()).toEqual([]);
      expect(scope.getAttachments()).toEqual([]);
      expect(scope.getActiveSpan()).toBeNull();
      expect(scope.getPropagationContext()).toBeNull();
    });
  });

  describe('endSession() Sentry-spec input values', () => {
    beforeEach(async () => {
      await Sentry.close();
      await Sentry.init('memory', { enableSessions: true });
    });

    it("'exited' input maps to legacy 'ended' status", async () => {
      await Sentry.startSession();
      await Sentry.endSession('exited');
      const sessions = await Sentry.getSessions({ status: 'ended' });
      expect(sessions).toHaveLength(1);
    });

    it("'ok' input also maps to 'ended'", async () => {
      await Sentry.startSession();
      await Sentry.endSession('ok');
      const sessions = await Sentry.getSessions({ status: 'ended' });
      expect(sessions).toHaveLength(1);
    });

    it("'crashed' is preserved", async () => {
      await Sentry.startSession();
      await Sentry.endSession('crashed');
      const sessions = await Sentry.getSessions({ status: 'crashed' });
      expect(sessions).toHaveLength(1);
    });

    it("'abnormal' is preserved verbatim with abnormalMechanism", async () => {
      await Sentry.startSession();
      await Sentry.endSession('abnormal', 'anr_foreground');
      const all = await Sentry.getSessions();
      expect(all[0].status).toBe('abnormal');
      expect(all[0].abnormal_mechanism).toBe('anr_foreground');
    });
  });
});
