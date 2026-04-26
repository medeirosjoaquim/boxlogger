# boxlogger examples

Runnable demos covering the full Sentry-compatible API surface boxlogger ships with.

All examples import from `../src/index.js` so they run against the source tree directly. To run any of them:

```bash
# TypeScript examples — use tsx (no build step needed)
npx tsx examples/<name>.ts

# JavaScript example
node examples/<name>.js   # run `npm run build` first
```

## Index

| File | Demonstrates |
|---|---|
| **[`kitchen-sink.ts`](./kitchen-sink.ts)** | Every feature in one walkthrough — start here |
| [`simple.js`](./simple.js) | Random log generator, the smallest possible intro |
| [`console-demo.ts`](./console-demo.ts) | Console store with colorful output |
| [`server.ts`](./server.ts) | Top-5 Sentry functions in a fake API server |
| [`spans.ts`](./spans.ts) | `startSpan` / `startInactiveSpan` / `startSpanManual` / `withActiveSpan` |
| [`isolation-scope.ts`](./isolation-scope.ts) | AsyncLocalStorage-backed per-request scope under concurrent load |
| [`trace-propagation.ts`](./trace-propagation.ts) | `continueTrace` + `getTraceData` for distributed tracing across services |
| [`integrations.ts`](./integrations.ts) | Custom integrations, integration lifecycle, `addIntegration` |
| [`event-processors.ts`](./event-processors.ts) | `beforeSend`, `beforeBreadcrumb`, scope + global event processors |
| [`monitors.ts`](./monitors.ts) | `captureCheckIn` + `withMonitor` for cron-style monitoring |
| [`observability.ts`](./observability.ts) | `Sentry.logger.*` and `Sentry.metrics.*` namespaces |
| [`nextjs-integration.tsx`](./nextjs-integration.tsx) | Dev-vs-prod pattern (boxlogger in dev, real Sentry in prod) |

## What's a "Sentry-compatible drop-in"?

boxlogger exposes the same API surface as `@sentry/node` so existing code that imports Sentry can switch to boxlogger without changes:

```ts
// Before
import * as Sentry from '@sentry/node';

// After — same API, no transport, local-only storage
import * as Sentry from '@johnboxcodes/boxlogger';
```

Things that work identically: capture functions, scope, breadcrumbs, integrations lifecycle, span API, trace propagation, isolation scope, `Sentry.logger.*`, `Sentry.metrics.*`, `captureCheckIn`, `withMonitor`, `captureFeedback`, `addEventProcessor`, `getClient` / `flush` / `lastEventId`. Things that no-op locally: DSN-based transport (events are stored in the chosen backend instead), source-map upload, profiling.

See [`kitchen-sink.ts`](./kitchen-sink.ts) for a tour of everything.
