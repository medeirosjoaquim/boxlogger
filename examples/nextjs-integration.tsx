/**
 * Next.js Integration Example
 * 
 * This example shows how to use boxlogger in development and Sentry in production.
 * In development, logs go to console with colorful output.
 * In production, errors are sent to Sentry for monitoring.
 */

// ============================================================================
// Conditional Initialization Helper
// ============================================================================

// lib/logger.ts
const isDevelopment = process.env.NODE_ENV === 'development';

if (isDevelopment) {
  // Development: Use boxlogger with console output
  const boxlogger = await import('@johnboxcodes/boxlogger');
  
  await boxlogger.init('console', {
    service: 'my-nextjs-app',
    environment: 'development',
    minLevel: 'debug',
  });
  
  // Re-export as Sentry for consistent API
  export * as Sentry from '@johnboxcodes/boxlogger';
} else {
  // Production: Use real Sentry
  export * as Sentry from '@sentry/nextjs';
}

// ============================================================================
// Server Configuration (sentry.server.config.ts)
// ============================================================================

import * as Sentry from '@sentry/nextjs';

if (process.env.NODE_ENV === 'development') {
  // Development: Use boxlogger
  const boxlogger = await import('@johnboxcodes/boxlogger');
  await boxlogger.init('console', {
    service: 'my-nextjs-app-server',
    environment: 'development',
    minLevel: 'debug',
  });
  
  // Monkey-patch Sentry methods to use boxlogger
  Object.assign(Sentry, boxlogger);
} else {
  // Production: Use real Sentry
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    enableLogs: true,
  });
}

// ============================================================================
// Edge Configuration (sentry.edge.config.ts)
// ============================================================================

import * as Sentry from '@sentry/nextjs';

if (process.env.NODE_ENV === 'development') {
  // Development: Use boxlogger (works in Edge runtime!)
  const boxlogger = await import('@johnboxcodes/boxlogger');
  await boxlogger.init('console', {
    service: 'my-nextjs-app-edge',
    environment: 'development',
    minLevel: 'info',
  });
  
  Object.assign(Sentry, boxlogger);
} else {
  // Production: Use real Sentry
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
  });
}

// ============================================================================
// Client Configuration (instrumentation-client.ts)
// ============================================================================

'use client';
import * as Sentry from '@sentry/nextjs';

if (process.env.NODE_ENV === 'development') {
  // Development: Use boxlogger in browser
  const boxlogger = await import('@johnboxcodes/boxlogger');
  await boxlogger.init('console', {
    service: 'my-nextjs-app-client',
    environment: 'development',
    minLevel: 'error',
  });
  
  Object.assign(Sentry, boxlogger);
} else {
  // Production: Use real Sentry
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    enableLogs: true,
    integrations: [
      Sentry.replayIntegration(),
    ],
  });
}

// ============================================================================
// Usage in Your App (same API everywhere!)
// ============================================================================

// app/api/users/route.ts
import { Sentry } from '@/lib/logger';

export async function GET() {
  try {
    const users = await fetchUsers();
    return Response.json({ users });
  } catch (error) {
    // Works with both boxlogger (dev) and Sentry (prod)
    Sentry.captureException(error, {
      tags: { endpoint: '/api/users' },
      extra: { method: 'GET' },
    });
    
    return Response.json(
      { error: 'Failed to fetch users' },
      { status: 500 }
    );
  }
}

// ============================================================================
// Benefits
// ============================================================================

/**
 * Development:
 * - Beautiful colorful console output
 * - No Sentry quota usage
 * - Instant feedback
 * - Works offline
 * 
 * Production:
 * - Full Sentry features (alerts, dashboards, replays)
 * - Error aggregation
 * - Performance monitoring
 * - User feedback
 * 
 * Same API everywhere - just change NODE_ENV!
 */
