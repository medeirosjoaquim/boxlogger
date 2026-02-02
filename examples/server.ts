/**
 * Example Server with Sentry-Compatible Error Tracking
 *
 * Demonstrates the Top 5 Sentry Functions:
 * 1. captureException() - The Error Workhorse
 * 2. captureMessage() - Custom Alerts
 * 3. setUser() - User Context
 * 4. addBreadcrumb() - Event Trail
 * 5. withScope() - Isolated Context
 *
 * Run with: npx tsx examples/server.ts
 */

import * as Sentry from '../src/index.js';

// =============================================================================
// Server Configuration & Initialization
// =============================================================================

async function initSentry() {
  await Sentry.init('memory', {
    service: 'example-api',
    environment: 'development',
    release: '1.0.0',
    minLevel: 'debug',

    // Filter out known non-actionable errors
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'Network request failed',
      /AbortError/i,
    ],

    // Sample 100% in dev, would be lower in production
    sampleRate: 1.0,
    messagesSampleRate: 1.0,

    // Filter sensitive data before storing
    beforeSend(event, hint) {
      // Remove sensitive headers
      if (event.metadata?.extra?.headers) {
        const headers = event.metadata.extra.headers as Record<string, string>;
        delete headers['authorization'];
        delete headers['cookie'];
      }

      // Filter password from error messages
      if (event.message?.toLowerCase().includes('password')) {
        event.message = event.message.replace(/password[=:]\S+/gi, 'password=[FILTERED]');
      }

      return event;
    },
  });

  console.log('[Sentry] Initialized with memory provider');
}

// =============================================================================
// Simulated Database & Services
// =============================================================================

interface User {
  id: string;
  email: string;
  name: string;
  plan: 'free' | 'pro' | 'enterprise';
}

interface Order {
  id: string;
  userId: string;
  amount: number;
  status: 'pending' | 'paid' | 'failed';
}

const users: Map<string, User> = new Map([
  ['user_123', { id: 'user_123', email: 'alice@example.com', name: 'Alice', plan: 'pro' }],
  ['user_456', { id: 'user_456', email: 'bob@example.com', name: 'Bob', plan: 'free' }],
]);

const orders: Map<string, Order> = new Map();

// Simulated external payment service (sometimes fails)
async function chargePaymentProvider(amount: number): Promise<{ transactionId: string }> {
  await delay(100);

  // Simulate random failures (30% failure rate)
  if (Math.random() < 0.3) {
    throw new Error(`Payment gateway timeout after 30s`);
  }

  // Simulate insufficient funds for large amounts
  if (amount > 10000) {
    const error = new Error('Insufficient funds');
    (error as any).code = 'INSUFFICIENT_FUNDS';
    throw error;
  }

  return { transactionId: `txn_${Date.now()}` };
}

// =============================================================================
// Request Handler Helpers
// =============================================================================

interface Request {
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
  userId?: string;
}

interface Response {
  status: number;
  body: unknown;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// DEMO 1: captureException() - The Error Workhorse
// =============================================================================

/**
 * Demonstrates captureException with full context
 */
async function handlePayment(req: Request): Promise<Response> {
  const { orderId, amount } = req.body as { orderId: string; amount: number };

  // -------------------------------------------------------------------------
  // 4. addBreadcrumb() - Track what happened before the error
  // -------------------------------------------------------------------------
  Sentry.addBreadcrumb({
    category: 'payment',
    message: 'Payment initiated',
    level: 'info',
    data: { orderId, amount },
  });

  try {
    // Simulate payment processing
    Sentry.addBreadcrumb({
      category: 'payment',
      message: 'Calling payment gateway',
      level: 'info',
      data: { provider: 'stripe', amount },
    });

    const result = await chargePaymentProvider(amount);

    // Success breadcrumb
    Sentry.addBreadcrumb({
      category: 'payment',
      message: 'Payment succeeded',
      level: 'info',
      data: { transactionId: result.transactionId },
    });

    // Update order
    orders.set(orderId, {
      id: orderId,
      userId: req.userId!,
      amount,
      status: 'paid',
    });

    return { status: 200, body: { success: true, transactionId: result.transactionId } };
  } catch (error) {
    // -------------------------------------------------------------------------
    // 1. captureException() - Capture with full context
    // -------------------------------------------------------------------------
    Sentry.captureException(error, {
      tags: {
        section: 'payment',
        provider: 'stripe',
        orderId,
      },
      extra: {
        amount,
        userId: req.userId,
        timestamp: Date.now(),
        requestPath: req.path,
      },
      level: 'error',
    });

    // Update order status
    orders.set(orderId, {
      id: orderId,
      userId: req.userId!,
      amount,
      status: 'failed',
    });

    return {
      status: 500,
      body: { error: 'Payment failed', message: (error as Error).message },
    };
  }
}

// =============================================================================
// DEMO 2: captureMessage() - Custom Alerts
// =============================================================================

/**
 * Demonstrates captureMessage for business events
 */
async function handleLogin(req: Request): Promise<Response> {
  const { email, ipAddress } = req.body as { email: string; ipAddress: string };

  Sentry.addBreadcrumb({
    category: 'auth',
    message: 'Login attempt',
    level: 'info',
    data: { email, ipAddress },
  });

  // Simulate checking for suspicious activity
  const failedAttempts = Math.floor(Math.random() * 10);

  if (failedAttempts >= 5) {
    // -------------------------------------------------------------------------
    // 2. captureMessage() - Alert for security events
    // -------------------------------------------------------------------------
    Sentry.captureMessage('Suspicious login attempt detected', {
      level: 'warning',
      tags: {
        section: 'security',
        threat_level: failedAttempts >= 8 ? 'high' : 'medium',
      },
      extra: {
        email,
        ipAddress,
        failedAttempts,
        lastAttemptTime: new Date().toISOString(),
      },
    });

    return { status: 429, body: { error: 'Too many login attempts' } };
  }

  // Find user
  const user = Array.from(users.values()).find((u) => u.email === email);

  if (!user) {
    Sentry.captureMessage('Login failed: user not found', 'info');
    return { status: 401, body: { error: 'Invalid credentials' } };
  }

  // -------------------------------------------------------------------------
  // 3. setUser() - Set user context for all subsequent events
  // -------------------------------------------------------------------------
  Sentry.setUser({
    id: user.id,
    email: user.email,
    username: user.name,
    segment: user.plan,
    ip_address: ipAddress,
  });

  // Log successful login
  Sentry.captureMessage('User logged in successfully', {
    level: 'info',
    tags: { plan: user.plan },
  });

  return { status: 200, body: { userId: user.id, name: user.name } };
}

// =============================================================================
// DEMO 3: setUser() - User Context
// =============================================================================

/**
 * Demonstrates setUser for attribution
 */
async function handleUserProfile(req: Request): Promise<Response> {
  const userId = req.headers['x-user-id'];

  if (!userId) {
    return { status: 401, body: { error: 'Unauthorized' } };
  }

  const user = users.get(userId);

  if (!user) {
    // Capture exception with user context attempt
    Sentry.captureException(new Error(`User not found: ${userId}`), {
      tags: { section: 'profile' },
    });
    return { status: 404, body: { error: 'User not found' } };
  }

  // -------------------------------------------------------------------------
  // 3. setUser() - User context for error attribution
  // -------------------------------------------------------------------------
  Sentry.setUser({
    id: user.id,
    email: user.email,
    username: user.name,
    segment: user.plan,
    ip_address: '{{auto}}', // Auto-detect in real scenarios
  });

  Sentry.addBreadcrumb({
    category: 'navigation',
    message: 'Viewed profile',
    level: 'info',
  });

  return { status: 200, body: user };
}

// =============================================================================
// DEMO 4: addBreadcrumb() - Event Trail
// =============================================================================

/**
 * Demonstrates breadcrumbs for debugging complex flows
 */
async function handleCheckout(req: Request): Promise<Response> {
  const { items, shippingAddress } = req.body as {
    items: Array<{ productId: string; quantity: number; price: number }>;
    shippingAddress: string;
  };

  // -------------------------------------------------------------------------
  // 4. addBreadcrumb() - Build event trail for debugging
  // -------------------------------------------------------------------------

  // Step 1: Cart validation
  Sentry.addBreadcrumb({
    category: 'checkout',
    message: 'Validating cart items',
    level: 'info',
    data: { itemCount: items.length },
  });

  const totalAmount = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  // Step 2: Inventory check
  Sentry.addBreadcrumb({
    category: 'checkout',
    message: 'Checking inventory',
    level: 'info',
    data: { products: items.map((i) => i.productId) },
  });

  // Simulate inventory issue
  if (items.some((item) => item.quantity > 100)) {
    Sentry.addBreadcrumb({
      category: 'checkout',
      message: 'Inventory check failed',
      level: 'warning',
      data: { reason: 'Quantity exceeds available stock' },
    });

    Sentry.captureException(new Error('Checkout failed: insufficient inventory'), {
      tags: { section: 'checkout', step: 'inventory' },
    });

    return { status: 400, body: { error: 'Insufficient inventory' } };
  }

  // Step 3: Address validation
  Sentry.addBreadcrumb({
    category: 'checkout',
    message: 'Validating shipping address',
    level: 'info',
    data: { address: shippingAddress.substring(0, 20) + '...' },
  });

  // Step 4: Create order
  const orderId = `order_${Date.now()}`;
  Sentry.addBreadcrumb({
    category: 'checkout',
    message: 'Creating order',
    level: 'info',
    data: { orderId, totalAmount },
  });

  // Step 5: Process payment (may fail - see payment handler)
  const paymentResult = await handlePayment({
    ...req,
    body: { orderId, amount: totalAmount },
  });

  if (paymentResult.status !== 200) {
    return paymentResult;
  }

  // Step 6: Success
  Sentry.addBreadcrumb({
    category: 'checkout',
    message: 'Checkout completed successfully',
    level: 'info',
    data: { orderId },
  });

  Sentry.captureMessage('High-value order completed', {
    level: 'info',
    tags: { orderValue: totalAmount > 1000 ? 'high' : 'normal' },
    extra: { orderId, totalAmount, itemCount: items.length },
  });

  return { status: 200, body: { orderId, totalAmount } };
}

// =============================================================================
// DEMO 5: withScope() - Isolated Context
// =============================================================================

/**
 * Demonstrates withScope for isolated error context
 */
async function handleBatchOperation(req: Request): Promise<Response> {
  const { operations } = req.body as {
    operations: Array<{ type: string; data: unknown }>;
  };

  const results: Array<{ index: number; success: boolean; error?: string }> = [];

  for (let i = 0; i < operations.length; i++) {
    const operation = operations[i];

    // -------------------------------------------------------------------------
    // 5. withScope() - Isolated context per operation
    // -------------------------------------------------------------------------
    const result = Sentry.withScope((scope) => {
      // Set operation-specific context
      scope.setTag('operation_type', operation.type);
      scope.setTag('operation_index', String(i));
      scope.setExtra('operation_data', operation.data);
      scope.setFingerprint(['batch-operation', operation.type]);

      try {
        // Simulate operation processing
        if (operation.type === 'invalid') {
          throw new Error(`Unknown operation type: ${operation.type}`);
        }

        if (operation.type === 'risky' && Math.random() < 0.5) {
          throw new Error('Risky operation failed randomly');
        }

        return { index: i, success: true };
      } catch (error) {
        // Capture with isolated scope - only affects this operation
        Sentry.captureException(error);

        return { index: i, success: false, error: (error as Error).message };
      }
    });

    results.push(result);
  }

  const failures = results.filter((r) => !r.success);
  if (failures.length > 0) {
    Sentry.captureMessage(`Batch operation completed with ${failures.length} failures`, {
      level: 'warning',
      extra: { totalOperations: operations.length, failures: failures.length },
    });
  }

  return { status: 200, body: { results } };
}

// =============================================================================
// DEMO 6: startTransaction() - Performance Monitoring
// =============================================================================

/**
 * Demonstrates transaction/span for performance tracing
 */
async function handleApiRequest(req: Request): Promise<Response> {
  // Start a transaction for the entire request
  const transaction = Sentry.startTransaction({
    name: `${req.method} ${req.path}`,
    op: 'http.server',
    description: 'API request handler',
  });

  transaction.setTag('http.method', req.method);
  transaction.setTag('http.url', req.path);

  try {
    // Simulate some work with timing
    const startDb = Date.now();
    await delay(50); // Simulate DB query
    transaction.setMeasurement('db.query', Date.now() - startDb, 'millisecond');

    const startProcess = Date.now();
    await delay(30); // Simulate processing
    transaction.setMeasurement('processing', Date.now() - startProcess, 'millisecond');

    transaction.setStatus('ok');
    transaction.setData('response.status', 200);

    return { status: 200, body: { message: 'Request processed' } };
  } catch (error) {
    transaction.setStatus('internal_error');
    Sentry.captureException(error);
    return { status: 500, body: { error: 'Internal error' } };
  } finally {
    transaction.finish();
  }
}

// =============================================================================
// Simulated Request Router
// =============================================================================

async function handleRequest(req: Request): Promise<Response> {
  console.log(`\n[${req.method}] ${req.path}`);

  // Add request breadcrumb
  Sentry.addBreadcrumb({
    category: 'http',
    message: `${req.method} ${req.path}`,
    level: 'info',
    data: {
      method: req.method,
      url: req.path,
    },
  });

  switch (req.path) {
    case '/login':
      return handleLogin(req);
    case '/profile':
      return handleUserProfile(req);
    case '/checkout':
      return handleCheckout(req);
    case '/batch':
      return handleBatchOperation(req);
    case '/api':
      return handleApiRequest(req);
    default:
      return { status: 404, body: { error: 'Not found' } };
  }
}

// =============================================================================
// Main Demo Runner
// =============================================================================

async function runDemo() {
  console.log('='.repeat(70));
  console.log('Sentry-Compatible Logger Demo - Top 5 Functions');
  console.log('='.repeat(70));

  await initSentry();

  // Demo 1: Login with user context (setUser, captureMessage)
  console.log('\n--- Demo 1: Login Flow (setUser, captureMessage) ---');
  await handleRequest({
    method: 'POST',
    path: '/login',
    headers: {},
    body: { email: 'alice@example.com', ipAddress: '192.168.1.1' },
  });

  // Demo 2: Profile access (setUser, addBreadcrumb)
  console.log('\n--- Demo 2: Profile Access (setUser, addBreadcrumb) ---');
  await handleRequest({
    method: 'GET',
    path: '/profile',
    headers: { 'x-user-id': 'user_123' },
  });

  // Demo 3: Checkout flow with error (addBreadcrumb, captureException)
  console.log('\n--- Demo 3: Checkout Flow (addBreadcrumb, captureException) ---');
  await handleRequest({
    method: 'POST',
    path: '/checkout',
    headers: { 'x-user-id': 'user_123' },
    userId: 'user_123',
    body: {
      items: [
        { productId: 'prod_1', quantity: 2, price: 49.99 },
        { productId: 'prod_2', quantity: 1, price: 199.99 },
      ],
      shippingAddress: '123 Main St, Anytown, USA',
    },
  });

  // Demo 4: Batch operation with scoped errors (withScope, captureException)
  console.log('\n--- Demo 4: Batch Operations (withScope, captureException) ---');
  await handleRequest({
    method: 'POST',
    path: '/batch',
    headers: { 'x-user-id': 'user_123' },
    userId: 'user_123',
    body: {
      operations: [
        { type: 'create', data: { name: 'Item 1' } },
        { type: 'invalid', data: {} }, // Will fail
        { type: 'risky', data: { value: 100 } }, // May fail
        { type: 'update', data: { id: '123' } },
      ],
    },
  });

  // Demo 5: API request with transaction (startTransaction)
  console.log('\n--- Demo 5: API Request with Transaction ---');
  await handleRequest({
    method: 'GET',
    path: '/api',
    headers: {},
  });

  // Demo 6: Clear user on logout
  console.log('\n--- Demo 6: Logout (clear user context) ---');
  Sentry.setUser(null);
  console.log('[Auth] User logged out, context cleared');

  // Wait for async logging
  await delay(100);

  // Print summary
  console.log('\n' + '='.repeat(70));
  console.log('Demo Complete - Log Summary');
  console.log('='.repeat(70));

  const stats = await Sentry.getStats();
  console.log(`Total logs captured: ${stats.totalLogs}`);
  console.log('Logs by level:', stats.logsByLevel);

  const logs = await Sentry.getLogs({ limit: 20 });
  console.log(`\nRecent logs (${logs.length}):`);
  logs.forEach((log, i) => {
    const tags = log.metadata?.tags
      ? ` [${Object.entries(log.metadata.tags)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ')}]`
      : '';
    console.log(`  ${i + 1}. [${log.level.toUpperCase()}] ${log.message}${tags}`);
  });

  await Sentry.close();
  console.log('\n[Sentry] Closed');
}

// Run the demo
runDemo().catch(console.error);
