/**
 * Distributed trace propagation across services.
 *
 * Run: npx tsx examples/trace-propagation.ts
 *
 * Demonstrates Sentry-compatible distributed tracing:
 *   - parse incoming `sentry-trace` + `baggage` headers (continueTrace)
 *   - run downstream code inside that trace context
 *   - serialize outgoing trace headers (getTraceData) to forward to other services
 *
 * No network here — we mock a 3-service chain (gateway → orders → payments)
 * and just verify the trace-ids line up.
 */

import * as Sentry from '../src/index.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// "Service A" — the gateway. Originates a trace.
// ---------------------------------------------------------------------------
async function gateway() {
  return Sentry.startSpan(
    { name: 'POST /checkout', op: 'http.server' },
    async (span) => {
      console.log('[gateway] traceId =', span.spanContext().traceId);

      // Build outgoing headers for the downstream call
      const outgoing = Sentry.getTraceData();
      console.log('[gateway] outgoing headers:', outgoing);

      // Call orders with those headers
      const result = await ordersService(outgoing);
      span.setStatus('ok');
      return result;
    }
  );
}

// ---------------------------------------------------------------------------
// "Service B" — orders. Continues the trace from incoming headers.
// ---------------------------------------------------------------------------
async function ordersService(headers: Record<string, string | undefined>) {
  return Sentry.continueTrace(
    {
      sentryTrace: headers['sentry-trace'],
      baggage: headers.baggage,
    },
    async () => {
      return Sentry.startSpan(
        { name: 'orders.create', op: 'rpc.server' },
        async (span) => {
          console.log('[orders] traceId =', span.spanContext().traceId);
          await sleep(15);

          // Forward the trace to payments
          const outgoing = Sentry.getTraceData();
          const result = await paymentsService(outgoing);
          span.setStatus('ok');
          return result;
        }
      );
    }
  );
}

// ---------------------------------------------------------------------------
// "Service C" — payments. Receives the trace from orders.
// ---------------------------------------------------------------------------
async function paymentsService(headers: Record<string, string | undefined>) {
  return Sentry.continueTrace(
    {
      sentryTrace: headers['sentry-trace'],
      baggage: headers.baggage,
    },
    async () => {
      return Sentry.startSpan(
        { name: 'stripe.charge', op: 'http.client' },
        async (span) => {
          console.log('[payments] traceId =', span.spanContext().traceId);
          await sleep(20);
          span.setAttribute('amount', 9999);
          span.setStatus('ok');
          return { paid: true };
        }
      );
    }
  );
}

// ---------------------------------------------------------------------------
// Showcase: receiving a trace from outside (e.g. an incoming HTTP request)
// ---------------------------------------------------------------------------
async function inboundTraceExample() {
  // These would come from the request headers in a real server
  const incomingHeaders = {
    'sentry-trace': '0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-1',
    baggage:
      'sentry-environment=prod,sentry-release=1.2.3,sentry-public_key=abc,sentry-trace_id=0af7651916cd43dd8448eb211c80319c',
  };

  Sentry.continueTrace(
    {
      sentryTrace: incomingHeaders['sentry-trace'],
      baggage: incomingHeaders.baggage,
    },
    () => {
      const ctx = Sentry.getPropagationContext();
      console.log('\n▶ Inbound trace inherited:');
      console.log('  traceId:', ctx?.traceId);
      console.log('  spanId :', ctx?.spanId);
      console.log('  sampled:', ctx?.sampled);
      console.log('  DSC    :', ctx?.dsc);

      // Subsequent capture-events inherit the trace via the propagation context
      Sentry.captureMessage('handled inbound request', 'info');
    }
  );
}

async function main() {
  await Sentry.init('console', {
    service: 'trace-demo',
    minLevel: 'debug',
    tracesSampleRate: 1.0,
  });

  console.log('▶ End-to-end chain: gateway → orders → payments\n');
  await gateway();

  await inboundTraceExample();

  await Sentry.close();
}

main().catch(console.error);
