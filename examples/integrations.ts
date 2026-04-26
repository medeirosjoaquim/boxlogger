/**
 * Integrations: lifecycle, custom integrations, defaults.
 *
 * Run: npx tsx examples/integrations.ts
 *
 * boxlogger accepts the Sentry integration shape so existing integrations
 * (or yours) can be passed at init time. The lifecycle is exactly Sentry's:
 *   1. setupOnce()       — runs once across all clients
 *   2. setup(client)     — runs after the client is created
 *   3. afterAllSetup()   — runs after every integration's setup completes
 *   4. processEvent(e,h) — registered as a global event processor
 */

import * as Sentry from '../src/index.js';

// ---------------------------------------------------------------------------
// Custom integration #1 — request-id stamping
// ---------------------------------------------------------------------------
function requestIdIntegration(): Sentry.SentryIntegration {
  return {
    name: 'RequestId',
    setupOnce() {
      console.log('  [RequestId] setupOnce()');
    },
    setup() {
      console.log('  [RequestId] setup()');
    },
    afterAllSetup() {
      console.log('  [RequestId] afterAllSetup()');
    },
    processEvent(event) {
      // Stamp every event with a request-id if one isn't already set.
      if (!event.tags?.request_id) {
        event.tags = {
          ...event.tags,
          request_id: 'req-' + Math.random().toString(36).slice(2, 10),
        };
      }
      return event;
    },
  };
}

// ---------------------------------------------------------------------------
// Custom integration #2 — drop-PII filter
// ---------------------------------------------------------------------------
function piiScrubberIntegration(): Sentry.SentryIntegration {
  const PII_KEYS = ['password', 'authorization', 'cookie', 'set-cookie'];
  return {
    name: 'PIIScrubber',
    processEvent(event) {
      if (event.extra) {
        for (const key of Object.keys(event.extra)) {
          if (PII_KEYS.includes(key.toLowerCase())) {
            event.extra[key] = '[scrubbed]';
          }
        }
      }
      return event;
    },
  };
}

// ---------------------------------------------------------------------------
// Custom integration #3 — registers an event processor that drops anything
// matching a deny-list of message prefixes.
// ---------------------------------------------------------------------------
function dropNoiseIntegration(prefixes: string[]): Sentry.SentryIntegration {
  return {
    name: 'DropNoise',
    setupOnce() {
      Sentry.addEventProcessor((event) => {
        if (event.message && prefixes.some((p) => event.message!.startsWith(p))) {
          return null; // drop
        }
        return event;
      });
    },
  };
}

async function main() {
  console.log('▶ init() with custom integrations\n');

  await Sentry.init('console', {
    service: 'integrations-demo',
    integrations: [
      requestIdIntegration(),
      piiScrubberIntegration(),
      dropNoiseIntegration(['heartbeat', 'noisy:']),
    ],
    // Default integrations (OnUncaughtException, OnUnhandledRejection) install
    // automatically. Pass `defaultIntegrations: false` to opt out, or pass an
    // array to fully replace the defaults.
  });

  console.log('\n▶ Installed integrations:');
  for (const name of [
    'RequestId',
    'PIIScrubber',
    'DropNoise',
    'OnUncaughtException',
    'OnUnhandledRejection',
  ]) {
    const installed = Sentry.getIntegrationByName(name) ? '✓' : ' ';
    console.log(`  [${installed}] ${name}`);
  }

  console.log('\n▶ Capture an event — RequestId stamps a tag:');
  Sentry.captureMessage('hello', 'info');

  console.log('\n▶ PIIScrubber strips sensitive extras:');
  Sentry.captureMessage('login attempt', {
    level: 'info',
    extra: {
      username: 'alice',
      password: 'hunter2',
      authorization: 'Bearer abc123',
    },
  });

  console.log('\n▶ DropNoise drops events whose message has a denied prefix:');
  Sentry.captureMessage('heartbeat ping', 'debug');
  Sentry.captureMessage('noisy: spam', 'debug');
  Sentry.captureMessage('important business event', 'info');

  // ---------------------------------------------------------------------------
  // Late-bound integration via addIntegration()
  // ---------------------------------------------------------------------------
  console.log('\n▶ Late-bound integration via addIntegration():');
  Sentry.addIntegration({
    name: 'LateAddedTag',
    setup() {
      console.log('  [LateAddedTag] setup() — installed post-init');
    },
    processEvent(event) {
      event.tags = { ...event.tags, late_added: 'true' };
      return event;
    },
  });
  Sentry.captureMessage('event after late integration', 'info');

  // ---------------------------------------------------------------------------
  // Inspect captured events
  // ---------------------------------------------------------------------------
  console.log('\n▶ Inspecting captured events:');
  const logs = await Sentry.getLogs({ limit: 20 });
  for (const log of logs) {
    const tags = log.metadata?.tags ?? {};
    const tagPairs = Object.entries(tags)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    console.log(`  [${log.level}] ${log.message} (${tagPairs})`);
  }

  await Sentry.close();
}

main().catch(console.error);
