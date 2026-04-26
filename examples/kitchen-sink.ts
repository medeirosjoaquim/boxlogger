/**
 * boxlogger kitchen-sink
 *
 * One linear walkthrough of every Sentry-compatible feature. Run with:
 *   npx tsx examples/kitchen-sink.ts
 *
 * Each section is independent — feel free to delete the ones you don't need
 * and use the rest as a scaffold. The console store is used so you can see
 * everything as it happens; swap to 'memory' if you want to inspect via
 * Sentry.getLogs() at the end instead.
 */

import * as Sentry from '../src/index.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // ===========================================================================
  // 1. init() — the full Sentry options shape
  // ===========================================================================

  await Sentry.init('console', {
    // boxlogger basics
    service: 'kitchen-sink',
    environment: 'development',
    release: '1.0.0',
    minLevel: 'debug',
    enableSessions: true,

    // Sentry-compatible options (accepted; transport is no-op locally)
    dsn: 'https://abc123@o111.ingest.sentry.io/222',
    tracesSampleRate: 1.0,
    sampleRate: 1.0,
    messagesSampleRate: 1.0,

    // Error filtering — strings match substrings, RegExp full-matches.
    ignoreErrors: ['ResizeObserver loop limit exceeded', /^AbortError/i],

    // Initial scope is applied before integrations run.
    initialScope: {
      tags: { region: 'us-east-1' },
      contexts: { runtime: { name: 'node', version: process.version } },
    },

    // beforeSend gives you one last chance to mutate or drop an exception event.
    beforeSend(event, hint) {
      if (hint?.originalException instanceof Error) {
        // Strip secrets from arbitrary error messages
        event.message = event.message.replace(/password=\S+/g, 'password=[redacted]');
      }
      return event;
    },

    beforeSendMessage(event) {
      // Drop noisy heartbeat messages but keep everything else
      if (event.message?.startsWith('heartbeat')) return null;
      return event;
    },

    beforeBreadcrumb(crumb) {
      // Drop debug-level breadcrumbs entirely
      if (crumb.level === 'debug') return null;
      return crumb;
    },
  });

  banner('1. Capture functions');

  // ===========================================================================
  // 2. captureException / captureMessage / captureEvent
  // ===========================================================================

  Sentry.captureException(new Error('Database timeout'), {
    level: 'error',
    tags: { db: 'postgres', operation: 'select' },
    extra: { duration_ms: 5012, query: 'SELECT * FROM users WHERE ...' },
    fingerprint: ['db', 'timeout', 'postgres'],
  });

  Sentry.captureMessage('Payment processed', {
    level: 'info',
    tags: { provider: 'stripe' },
    extra: { amount: 99.99 },
  });

  // Low-level: fully constructed event
  const eventId = Sentry.captureEvent({
    message: 'Custom event from worker',
    level: 'warning',
    tags: { source: 'worker' },
    user: { id: 'worker-7', segment: 'background' },
  });
  console.log(`  captured event id: ${eventId}`);
  console.log(`  Sentry.lastEventId() = ${Sentry.lastEventId()}`);

  banner('2. Scope: tags, extras, user, contexts, breadcrumbs');

  // ===========================================================================
  // 3. Setting global context (sticky for the rest of the run)
  // ===========================================================================

  Sentry.setUser({
    id: 'user-42',
    email: 'alice@example.com',
    username: 'alice',
    segment: 'pro',
    ip_address: '{{auto}}',
  });

  Sentry.setTag('feature_flag.checkout_v2', 'on');
  Sentry.setTags({ deployment: 'blue', cluster: 'us-east' });
  Sentry.setExtra('build_sha', 'a1b2c3d4');
  Sentry.setContext('app', { name: 'kitchen-sink', uptime_s: process.uptime() });

  Sentry.addBreadcrumb({
    category: 'navigation',
    message: 'User opened /checkout',
    level: 'info',
    data: { from: '/cart', to: '/checkout' },
  });
  Sentry.addBreadcrumb({
    category: 'http',
    message: 'GET /api/inventory → 200',
    level: 'info',
    data: { duration_ms: 41 },
  });

  banner('3. withScope: isolated context per operation');

  // ===========================================================================
  // 4. withScope — temporary context that doesn't pollute the global scope
  // ===========================================================================

  Sentry.withScope((scope) => {
    scope.setTag('transaction', 'payment');
    scope.setExtra('order_id', 'ord_99');
    scope.setFingerprint(['payment', 'failure', 'declined']);

    // Anything captured inside this block carries those tags
    Sentry.captureException(new Error('Card declined'), { level: 'warning' });
  });

  // The above tags are gone now that we exited the scope.

  banner('4. withIsolationScope: per-request isolation (concurrent-safe)');

  // ===========================================================================
  // 5. withIsolationScope — backed by AsyncLocalStorage on Node so concurrent
  // requests don't leak tags into each other.
  // ===========================================================================

  async function handleRequest(reqId: string) {
    return Sentry.withIsolationScopeAsync(async (scope) => {
      scope.setTag('request_id', reqId);
      scope.setUser({ id: `user-${reqId}` });
      await sleep(20 + Math.random() * 40);
      Sentry.captureMessage(`request ${reqId} done`, 'info');
      return reqId;
    });
  }

  await Promise.all([handleRequest('r1'), handleRequest('r2'), handleRequest('r3')]);

  banner('5. Span API: tracing with auto-finish');

  // ===========================================================================
  // 6. startSpan — lightweight tracing shim. Spans share a traceId so you can
  // correlate logs captured during the span via metadata.traceId.
  // ===========================================================================

  await Sentry.startSpan({ name: 'checkout', op: 'http.server' }, async (span) => {
    span.setAttribute('http.method', 'POST');
    span.setAttribute('http.target', '/api/checkout');

    await Sentry.startSpan({ name: 'db.query.user', op: 'db' }, async (child) => {
      child.setAttribute('db.system', 'postgres');
      child.setAttribute('db.statement', 'SELECT * FROM users WHERE id = $1');
      await sleep(15);
    });

    await Sentry.startSpan({ name: 'http.payment', op: 'http.client' }, async (child) => {
      child.setAttribute('http.url', 'https://api.stripe.com/v1/charges');
      child.setStatus({ code: 1 });
      await sleep(35);
    });

    span.setStatus('ok');
  });

  // Inactive span — you control when to end it
  const bgSpan = Sentry.startInactiveSpan({ name: 'background.flush', op: 'task' });
  await sleep(10);
  bgSpan.setAttribute('items_flushed', 42);
  bgSpan.end();

  // Manual lifecycle
  Sentry.startSpanManual({ name: 'manual.work' }, (span, finish) => {
    span.setAttribute('work', 'true');
    setTimeout(() => {
      span.setStatus('ok');
      finish();
    }, 5);
  });

  await sleep(20);

  banner('6. Trace propagation: continueTrace + getTraceData');

  // ===========================================================================
  // 7. Distributed tracing — receive trace headers, run code in that trace
  // context, send headers along to downstream services.
  // ===========================================================================

  const incoming = {
    sentryTrace: '0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-1',
    baggage: 'sentry-environment=prod,sentry-release=1.0.0',
  };

  Sentry.continueTrace(incoming, () => {
    const ctx = Sentry.getPropagationContext();
    console.log(`  inherited traceId: ${ctx?.traceId}`);
    console.log(`  inherited DSC:`, ctx?.dsc);

    // Headers to forward to a downstream HTTP call
    const headers = Sentry.getTraceData();
    console.log(`  outgoing headers:`, headers);
  });

  banner('7. Custom integrations + lifecycle');

  // ===========================================================================
  // 8. Integrations — register your own setup hooks. processEvent is registered
  // as a global event processor automatically.
  // ===========================================================================

  Sentry.addIntegration({
    name: 'AddRequestId',
    setup() {
      console.log('  [integration] AddRequestId setup');
    },
    processEvent(event) {
      event.tags = { ...event.tags, request_id: 'req-' + Math.random().toString(36).slice(2, 8) };
      return event;
    },
  });

  Sentry.captureMessage('event with auto request_id', 'info');

  console.log('  default integrations:', Sentry.getDefaultIntegrations().map((i) => i.name));
  console.log('  AddRequestId installed:', !!Sentry.getIntegrationByName('AddRequestId'));

  banner('8. Event processors — drop or mutate any event');

  // ===========================================================================
  // 9. addEventProcessor — runs before storage on every captured event.
  // ===========================================================================

  Sentry.addEventProcessor((event) => {
    // Drop anything tagged 'sensitive'
    if (event.tags?.sensitive === 'true') return null;
    // Otherwise stamp with received_at
    event.extra = { ...event.extra, received_at: new Date().toISOString() };
    return event;
  });

  Sentry.captureMessage('this one is dropped', { tags: { sensitive: 'true' } });
  Sentry.captureMessage('this one is kept', 'info');

  banner('9. captureCheckIn + withMonitor (cron)');

  // ===========================================================================
  // 10. Cron monitoring — wraps a callback with check-in reporting.
  // ===========================================================================

  await Sentry.withMonitor(
    'nightly-cleanup',
    async () => {
      Sentry.addBreadcrumb({ category: 'cron', message: 'cleanup started' });
      await sleep(20);
      Sentry.addBreadcrumb({ category: 'cron', message: 'cleanup done' });
    },
    { schedule: { type: 'crontab', value: '0 3 * * *' }, timezone: 'UTC' }
  );

  banner('10. captureFeedback');

  // ===========================================================================
  // 11. User feedback
  // ===========================================================================

  Sentry.captureFeedback({
    name: 'Alice',
    email: 'alice@example.com',
    message: 'Loving the new checkout flow!',
    associatedEventId: eventId,
  });

  banner('11. Sentry.logger.* — structured logs');

  // ===========================================================================
  // 12. Sentry.logger namespace
  // ===========================================================================

  Sentry.logger.info('user.signin', { user_id: 'user-42', method: 'oauth' });
  Sentry.logger.warn('cache.miss', { key: 'inventory:abc', latency_ms: 240 });
  Sentry.logger.error('queue.dead_letter', { queue: 'orders', count: 3 });

  // Template literal helper — produces a plain string from the template
  const userId = 42;
  console.log('  logger.fmt example →', Sentry.logger.fmt`user ${userId} signed in`);

  banner('12. Sentry.metrics.*');

  // ===========================================================================
  // 13. Metrics — counters, distributions, gauges, sets, timing
  // ===========================================================================

  Sentry.metrics.increment('orders.completed', 1, { plan: 'pro' });
  Sentry.metrics.distribution('checkout.latency_ms', 184, { route: '/checkout' });
  Sentry.metrics.gauge('queue.depth', 12, { queue: 'orders' });
  Sentry.metrics.set('users.active.unique', 'user-42');
  Sentry.metrics.timing('db.query', 0.041, 'second', { table: 'users' });

  banner('13. Sessions — Sentry release-health style');

  // ===========================================================================
  // 14. Sessions
  // ===========================================================================

  await Sentry.startSession({ user: { id: 'user-42' }, deviceId: 'mac-1' });
  Sentry.info('session activity 1');
  Sentry.warn('session activity 2');
  // Accepts both Sentry-spec ('exited' | 'crashed' | 'abnormal' | 'ok')
  // and boxlogger-legacy ('ended') input values.
  await Sentry.endSession('exited');

  banner('14. Client + flush + lastEventId + close');

  // ===========================================================================
  // 15. Client API — for SDK utilities and integrations.
  // ===========================================================================

  const client = Sentry.getClient();
  console.log('  DSN parsed:', client?.getDsn());
  console.log('  options.environment:', client?.getOptions().environment);
  console.log('  transport:', client?.getTransport()); // undefined — boxlogger is local-only

  await Sentry.flush(2000); // resolves true immediately

  console.log('  lastEventId:', Sentry.lastEventId());

  // Inspect what got stored
  const stats = await Sentry.getStats();
  console.log(`  total logs stored: ${stats.totalLogs}`);
  console.log('  by level:', stats.logsByLevel);

  await Sentry.close();
  console.log('\n✅ Kitchen sink complete.');
}

function banner(title: string) {
  console.log('\n' + '─'.repeat(72));
  console.log(`▶ ${title}`);
  console.log('─'.repeat(72));
}

main().catch((err) => {
  console.error('Demo failed:', err);
  process.exit(1);
});
