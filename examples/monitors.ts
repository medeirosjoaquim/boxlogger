/**
 * Cron monitoring with captureCheckIn + withMonitor.
 *
 * Run: npx tsx examples/monitors.ts
 *
 * `captureCheckIn` records the start/end of a scheduled task. `withMonitor`
 * wraps a callback and emits the in_progress / ok / error check-ins for you.
 *
 * In real Sentry these check-ins would be visible on the Crons dashboard.
 * In boxlogger they're stored as local logs you can inspect via getLogs().
 */

import * as Sentry from '../src/index.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Manual check-in flow — for cases where withMonitor doesn't fit
// ---------------------------------------------------------------------------
async function manualCheckIn() {
  console.log('▶ Manual check-in flow');

  const checkInId = Sentry.captureCheckIn({
    monitorSlug: 'data-export',
    status: 'in_progress',
  });
  console.log(`  start  → check-in ${checkInId}`);

  const start = Date.now();
  try {
    await sleep(20);
    // ...do work...

    Sentry.captureCheckIn({
      monitorSlug: 'data-export',
      status: 'ok',
      checkInId,
      duration: (Date.now() - start) / 1000,
    });
    console.log(`  finish → ok`);
  } catch (err) {
    Sentry.captureCheckIn({
      monitorSlug: 'data-export',
      status: 'error',
      checkInId,
      duration: (Date.now() - start) / 1000,
    });
    Sentry.captureException(err);
  }
}

// ---------------------------------------------------------------------------
// Recommended: withMonitor handles everything for you
// ---------------------------------------------------------------------------
async function withMonitorSync() {
  console.log('\n▶ withMonitor wrapping a sync task');

  const result = Sentry.withMonitor(
    'compute-tax',
    () => {
      // Synchronous work
      const total = [1, 2, 3, 4, 5].reduce((a, b) => a + b, 0);
      return total;
    },
    { schedule: { type: 'interval', value: 1, unit: 'hour' } }
  );

  console.log(`  result: ${result}`);
}

async function withMonitorAsync() {
  console.log('\n▶ withMonitor wrapping an async task');

  await Sentry.withMonitor(
    'nightly-cleanup',
    async () => {
      Sentry.addBreadcrumb({
        category: 'cron',
        message: 'cleanup starting',
        level: 'info',
      });
      await sleep(30);
      Sentry.addBreadcrumb({
        category: 'cron',
        message: 'cleanup done',
        level: 'info',
      });
    },
    {
      schedule: { type: 'crontab', value: '0 3 * * *' },
      timezone: 'UTC',
      checkinMargin: 5,
      maxRuntime: 60,
    }
  );

  console.log('  done — withMonitor automatically reported ok');
}

async function withMonitorFailure() {
  console.log('\n▶ withMonitor with a failing task');

  try {
    await Sentry.withMonitor('flaky-job', async () => {
      await sleep(15);
      throw new Error('upstream API timed out');
    });
  } catch (err) {
    // withMonitor reports status=error and rethrows; you decide what to do.
    Sentry.captureException(err);
    console.log('  task threw — withMonitor reported error');
  }
}

async function main() {
  await Sentry.init('memory', {
    service: 'monitors-demo',
  });

  await manualCheckIn();
  await withMonitorSync();
  await withMonitorAsync();
  await withMonitorFailure();

  // ---------------------------------------------------------------------------
  // Inspect the captured check-ins
  // ---------------------------------------------------------------------------
  console.log('\n▶ All check-in records stored locally:');
  const logs = await Sentry.getLogs({ search: 'checkin' });
  for (const log of logs) {
    const tags = log.metadata?.tags ?? {};
    console.log(
      `  [${log.level}] ${log.message} ` +
        `(slug=${tags['monitor.slug']}, status=${tags['monitor.status']})`
    );
  }

  await Sentry.close();
}

main().catch(console.error);
