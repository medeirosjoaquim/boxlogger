/**
 * Event processors and beforeSend hooks.
 *
 * Run: npx tsx examples/event-processors.ts
 *
 * Three layers of event filtering, in the order they run:
 *   1. beforeSend / beforeSendMessage — top-level hooks at init time
 *   2. Global event processors        — addEventProcessor()
 *   3. Scope event processors         — scope.addEventProcessor()
 *
 * Each can mutate the event or drop it (return null).
 */

import * as Sentry from '../src/index.js';

async function main() {
  await Sentry.init('memory', {
    service: 'event-processors-demo',

    // ---------------------------------------------------------------------
    // Layer 1: top-level beforeSend / beforeSendMessage / beforeBreadcrumb
    // ---------------------------------------------------------------------
    beforeSend(event, hint) {
      // Add a synthetic tag based on the original exception type
      if (hint?.originalException instanceof RangeError) {
        event.tags = { ...event.tags, error_kind: 'range' };
      }
      return event;
    },

    beforeSendMessage(event) {
      // Drop heartbeats entirely
      if (event.message?.startsWith('heartbeat')) return null;
      return event;
    },

    beforeBreadcrumb(crumb) {
      // Strip secrets from breadcrumb data
      if (crumb.data && typeof crumb.data === 'object') {
        if ('password' in crumb.data) crumb.data.password = '[redacted]';
      }
      return crumb;
    },
  });

  // ---------------------------------------------------------------------
  // Layer 2: global event processors — run on EVERY captured event
  // ---------------------------------------------------------------------
  Sentry.addEventProcessor((event) => {
    // Drop anything tagged 'pii=true'
    if (event.tags?.pii === 'true') return null;

    // Stamp every event with a server identifier
    event.tags = { ...event.tags, server: process.env.HOSTNAME ?? 'local' };
    return event;
  });

  // ---------------------------------------------------------------------
  // Layer 3: scope-level event processors — run only for events captured
  // while that scope is active. Useful for per-request enrichment.
  // ---------------------------------------------------------------------
  console.log('▶ Scope-level processor: only runs in this withScope block');
  Sentry.withScope((scope) => {
    scope.addEventProcessor((event) => {
      event.extra = { ...event.extra, scope_processor_ran: true };
      return event;
    });

    Sentry.captureMessage('event inside scope with processor', 'info');
  });

  Sentry.captureMessage('event outside scope (no scope-level enrichment)', 'info');

  // ---------------------------------------------------------------------
  // Demonstrate beforeSend mutating an exception
  // ---------------------------------------------------------------------
  console.log('▶ beforeSend stamps error_kind based on the original exception');
  Sentry.captureException(new RangeError('out of range'));
  Sentry.captureException(new Error('not a range error'));

  // ---------------------------------------------------------------------
  // Demonstrate dropping
  // ---------------------------------------------------------------------
  console.log('▶ beforeSendMessage drops "heartbeat" messages');
  const id1 = Sentry.captureMessage('heartbeat ping', 'debug');
  const id2 = Sentry.captureMessage('user.signin', 'info');
  console.log(`  heartbeat returned event id: "${id1}" (empty = dropped)`);
  console.log(`  user.signin returned event id: "${id2}"`);

  // ---------------------------------------------------------------------
  // Demonstrate global processor dropping by tag
  // ---------------------------------------------------------------------
  console.log('▶ global processor drops events tagged pii=true');
  const dropped = Sentry.captureMessage('this should be dropped', {
    tags: { pii: 'true' },
  });
  const kept = Sentry.captureMessage('this should be kept', 'info');
  console.log(`  pii=true returned event id: "${dropped}" (empty = dropped)`);
  console.log(`  kept returned event id: "${kept}"`);

  // ---------------------------------------------------------------------
  // beforeBreadcrumb scrubs data
  // ---------------------------------------------------------------------
  console.log('▶ beforeBreadcrumb redacts password fields in breadcrumb data');
  Sentry.addBreadcrumb({
    category: 'auth',
    message: 'login form submitted',
    data: { username: 'alice', password: 'hunter2' },
  });
  console.log(
    '  breadcrumb stored as:',
    Sentry.getIsolationScope().getBreadcrumbs().slice(-1)[0]?.data
  );

  // ---------------------------------------------------------------------
  // Inspect what survived
  // ---------------------------------------------------------------------
  console.log('\n▶ Events that made it to storage:');
  const logs = await Sentry.getLogs({ limit: 20 });
  for (const log of logs) {
    console.log(
      `  [${log.level}] ${log.message}` +
        (log.metadata?.tags
          ? ` tags=${JSON.stringify(log.metadata.tags)}`
          : '') +
        (log.metadata?.extra?.scope_processor_ran
          ? ' (scope-processor ran)'
          : '')
    );
  }

  await Sentry.close();
}

main().catch(console.error);
