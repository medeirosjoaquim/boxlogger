/**
 * Isolation scope under concurrent load.
 *
 * Run: npx tsx examples/isolation-scope.ts
 *
 * The big problem this solves: if you set a tag on the global scope and then
 * two requests run concurrently, they will see each other's tags. boxlogger's
 * `withIsolationScope` is backed by AsyncLocalStorage so each "request" gets a
 * private scope that follows its async work across awaits.
 *
 * This is what makes boxlogger usable as a `@sentry/node` drop-in inside
 * Express, Fastify, Next.js API routes, etc. — the same isolation Sentry's
 * own SDK provides for per-request context.
 */

import * as Sentry from '../src/index.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --------------------------------------------------------------------------
// A toy "request handler" that simulates real-world async work
// --------------------------------------------------------------------------
async function handleRequest(reqId: string, userId: string) {
  return Sentry.withIsolationScopeAsync(async (scope) => {
    // Per-request setup — these tags are guaranteed to NOT leak into other
    // concurrent requests because each request has its own ALS frame.
    scope.setTag('request.id', reqId);
    scope.setUser({ id: userId, segment: 'pro' });
    scope.setContext('request', { method: 'POST', url: '/api/checkout' });

    Sentry.addBreadcrumb({
      category: 'request',
      message: `start ${reqId}`,
      level: 'info',
    });

    // Simulate auth lookup
    await sleep(10 + Math.random() * 30);

    // The active scope here is OUR forked scope — even after the await.
    Sentry.captureMessage(`Request ${reqId} authorized`, 'info');

    // Simulate DB work
    await sleep(20 + Math.random() * 30);

    // Pretend half the requests fail
    if (Math.random() < 0.5) {
      Sentry.captureException(new Error(`payment failed for ${reqId}`));
      return { reqId, ok: false };
    }

    Sentry.addBreadcrumb({
      category: 'request',
      message: `complete ${reqId}`,
      level: 'info',
    });

    return { reqId, ok: true };
  });
}

async function main() {
  await Sentry.init('memory', {
    service: 'isolation-demo',
    enableSessions: false,
  });

  // Set something on the GLOBAL isolation scope — these stick around for
  // the whole process and are inherited by every request fork.
  Sentry.getIsolationScope().setTag('deployment', 'blue');

  // Fire 8 concurrent requests
  console.log('▶ Firing 8 concurrent requests...\n');
  const results = await Promise.all([
    handleRequest('r1', 'user-1'),
    handleRequest('r2', 'user-2'),
    handleRequest('r3', 'user-3'),
    handleRequest('r4', 'user-4'),
    handleRequest('r5', 'user-5'),
    handleRequest('r6', 'user-6'),
    handleRequest('r7', 'user-7'),
    handleRequest('r8', 'user-8'),
  ]);

  console.log('Results:', results);

  // Inspect the captured events — every event tagged with the correct request
  // and user, no cross-talk.
  console.log('\n▶ Captured events with request scoping:\n');
  const logs = await Sentry.getLogs({ limit: 100 });
  for (const log of logs) {
    const reqId = log.metadata?.tags?.['request.id'] ?? '—';
    const userId = log.metadata?.user?.id ?? '—';
    console.log(
      `  [${log.level.padEnd(5)}] req=${reqId.padEnd(4)} user=${String(userId).padEnd(8)} ${log.message}`
    );
  }

  // Verify isolation: the global scope did NOT pick up any per-request tags
  console.log('\n▶ Global isolation scope tags after the run:');
  console.log(' ', Sentry.getIsolationScope().getTags());
  // Should only show {deployment: 'blue'} — the per-request tags never leaked.

  await Sentry.close();
}

main().catch(console.error);
