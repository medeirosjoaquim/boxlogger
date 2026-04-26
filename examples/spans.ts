/**
 * Span API in depth.
 *
 * Run: npx tsx examples/spans.ts
 *
 * boxlogger's span shim mirrors `@sentry/node`'s call signatures:
 *   - startSpan(ctx, cb)         — auto-finishes when callback returns/throws
 *   - startInactiveSpan(ctx)     — manual end(), not promoted to active
 *   - startSpanManual(ctx, cb)   — auto-active, you call finish()
 *   - withActiveSpan(span, cb)   — temporarily promote a span as active
 *   - getActiveSpan() / getRootSpan()
 *
 * Every span carries traceId + spanId. Child spans inherit traceId from the
 * active parent so you can stitch a tree.
 */

import * as Sentry from '../src/index.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await Sentry.init('memory', {
    service: 'spans-demo',
    minLevel: 'debug',
    tracesSampleRate: 1.0,
  });

  // -------------------------------------------------------------------------
  // 1. Auto-finishing span around an async operation
  // -------------------------------------------------------------------------
  await Sentry.startSpan(
    { name: 'GET /api/orders', op: 'http.server' },
    async (span) => {
      // OpenTelemetry-style attributes
      span.setAttribute('http.method', 'GET');
      span.setAttribute('http.target', '/api/orders');
      span.setAttribute('http.status_code', 200);

      // Nested child span — inherits traceId
      await Sentry.startSpan(
        { name: 'db.query orders', op: 'db' },
        async (child) => {
          child.setAttributes({
            'db.system': 'postgres',
            'db.statement': 'SELECT * FROM orders WHERE user_id = $1',
            'db.row_count': 12,
          });
          await sleep(20);
        }
      );

      // Sibling child — different op
      await Sentry.startSpan(
        { name: 'fetch inventory', op: 'http.client' },
        async (child) => {
          child.setAttribute('http.url', 'https://inventory.example.com/v1/check');
          child.setStatus({ code: 1 }); // OK
          await sleep(15);
        }
      );

      span.setStatus('ok');
    }
  );

  // -------------------------------------------------------------------------
  // 2. Inactive span — useful for measuring something out-of-band
  // -------------------------------------------------------------------------
  const flushSpan = Sentry.startInactiveSpan({
    name: 'background.flush',
    op: 'task',
  });
  await sleep(10);
  flushSpan.setAttribute('items', 42);
  flushSpan.end(); // you must end inactive spans manually

  // -------------------------------------------------------------------------
  // 3. Manual lifecycle — useful when end-time isn't tied to callback return
  // -------------------------------------------------------------------------
  Sentry.startSpanManual({ name: 'streaming.upload', op: 'task' }, (span, finish) => {
    span.setAttribute('protocol', 's3');
    // Pretend a stream eventually closes; this would be `stream.on('end', finish)`
    setTimeout(() => {
      span.setStatus('ok');
      finish();
    }, 25);
  });

  // -------------------------------------------------------------------------
  // 4. withActiveSpan — temporarily promote a pre-built span
  // -------------------------------------------------------------------------
  const heldSpan = Sentry.startInactiveSpan({ name: 'held', op: 'custom' });
  Sentry.withActiveSpan(heldSpan, () => {
    // Anything inside this block sees `heldSpan` as the active span
    const active = Sentry.getActiveSpan();
    console.log('active inside block:', active?.spanContext().traceId);
  });
  heldSpan.end();
  console.log('active outside block:', Sentry.getActiveSpan()); // null

  // -------------------------------------------------------------------------
  // 5. Span error handling — startSpan auto-fails the span if the callback throws
  // -------------------------------------------------------------------------
  try {
    await Sentry.startSpan({ name: 'risky' }, async () => {
      await sleep(5);
      throw new Error('something blew up');
    });
  } catch (e) {
    // boxlogger has already set status to 'internal_error' and finished the span.
    Sentry.captureException(e);
  }

  // -------------------------------------------------------------------------
  // 6. Span events
  // -------------------------------------------------------------------------
  await Sentry.startSpan({ name: 'cache.lookup', op: 'cache' }, (span) => {
    span.addEvent('cache.miss', { key: 'user:42' });
    span.addEvent('cache.write', { key: 'user:42', size_bytes: 384 });
  });

  // -------------------------------------------------------------------------
  // 7. updateName — useful when the route is only known after auth resolves
  // -------------------------------------------------------------------------
  await Sentry.startSpan(
    { name: 'GET /unknown', op: 'http.server' },
    (span) => {
      // ...resolve route...
      span.updateName('GET /api/users/:id');
    }
  );

  // Inspect what was logged
  await sleep(50);
  const logs = await Sentry.getLogs({ search: 'span.end' });
  console.log(`\nCaptured ${logs.length} span-end records.`);

  await Sentry.close();
}

main().catch(console.error);
