/**
 * Sentry.logger.* and Sentry.metrics.* namespaces.
 *
 * Run: npx tsx examples/observability.ts
 *
 * Mirrors Sentry's structured-logging and metrics APIs. boxlogger stores
 * everything locally as log records you can query later — there's no metric
 * aggregator, just per-call records.
 */

import * as Sentry from '../src/index.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await Sentry.init('console', {
    service: 'observability-demo',
    minLevel: 'debug',
  });

  // ===========================================================================
  // Sentry.logger.* — structured log lines, severity-tagged
  // ===========================================================================
  console.log('\n▶ Sentry.logger.* structured logs');

  Sentry.logger.trace('fn.entry', { fn: 'computeTax', args: { region: 'CA' } });
  Sentry.logger.debug('cache.lookup', {
    key: 'user:42',
    hit: false,
    latency_ms: 3,
  });
  Sentry.logger.info('user.signin', { user_id: 'user-42', method: 'oauth' });
  Sentry.logger.warn('queue.lag', { queue: 'orders', lag_seconds: 12 });
  Sentry.logger.error('db.timeout', {
    db: 'postgres',
    statement: 'SELECT ...',
    timeout_ms: 5000,
  });
  Sentry.logger.fatal('process.crash', { signal: 'SIGABRT' });

  // logger.fmt — template-literal helper, returns a plain string
  const orderId = 'ord_99';
  const amount = 49.95;
  const summary = Sentry.logger.fmt`order ${orderId} for $${amount} placed`;
  Sentry.logger.info(summary, { order_id: orderId, amount });

  // ===========================================================================
  // Sentry.metrics.* — counters, distributions, gauges, sets, timing
  // ===========================================================================
  console.log('\n▶ Sentry.metrics.* — emitted as debug logs locally');

  // Counter: monotonically increasing
  Sentry.metrics.increment('orders.completed', 1, { plan: 'pro' });
  Sentry.metrics.increment('orders.completed', 3, { plan: 'free' });

  // Distribution: latencies, sizes — anything where you care about the shape
  for (const ms of [120, 184, 76, 95, 230, 410, 88]) {
    Sentry.metrics.distribution('checkout.latency_ms', ms, { route: '/checkout' });
  }

  // Gauge: a point-in-time value
  Sentry.metrics.gauge('queue.depth', 12, { queue: 'orders' });
  Sentry.metrics.gauge('memory.rss_mb', process.memoryUsage().rss / 1024 / 1024);

  // Set: unique values
  Sentry.metrics.set('users.active.unique', 'user-42');
  Sentry.metrics.set('users.active.unique', 'user-43');
  Sentry.metrics.set('users.active.unique', 'user-42'); // already counted

  // Timing: a duration in seconds (default unit) or specified unit
  Sentry.metrics.timing('db.query', 0.041, 'second', { table: 'users' });
  Sentry.metrics.timing('http.duration', 184, 'millisecond', {
    route: '/api/checkout',
  });

  // ===========================================================================
  // Combined pattern: instrument a function with metrics + logger
  // ===========================================================================
  console.log('\n▶ Combined pattern around a real operation');

  async function processOrder(id: string) {
    const start = Date.now();
    Sentry.logger.info('order.processing.start', { order_id: id });

    try {
      await sleep(20 + Math.random() * 30);
      const durationMs = Date.now() - start;

      Sentry.metrics.distribution('order.processing.duration_ms', durationMs, {
        result: 'ok',
      });
      Sentry.metrics.increment('order.processed.total', 1, { result: 'ok' });
      Sentry.logger.info('order.processing.done', {
        order_id: id,
        duration_ms: durationMs,
      });
    } catch (err) {
      Sentry.metrics.increment('order.processed.total', 1, { result: 'error' });
      Sentry.logger.error('order.processing.failed', { order_id: id });
      Sentry.captureException(err);
      throw err;
    }
  }

  await Promise.all([
    processOrder('ord_1'),
    processOrder('ord_2'),
    processOrder('ord_3'),
  ]);

  // Inspect what was stored
  console.log('\n▶ Stored metric records:');
  const metricLogs = await Sentry.getLogs({ search: 'metric.' });
  for (const log of metricLogs.slice(-10)) {
    const m = log.metadata?.extra ?? {};
    console.log(`  ${log.message}  →  value=${m.value}  ${m.tag ? `(${m.tag})` : ''}`);
  }

  await Sentry.close();
}

main().catch(console.error);
