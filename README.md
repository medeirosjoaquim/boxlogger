# boxlogger

A lightweight, Sentry-compatible backend logger with pluggable storage providers for Node.js applications.

## Features

- **Pluggable Storage** - Memory, Console, or custom providers
- **Sentry-Compatible API** - Drop-in replacement for common Sentry functions
- **Browser Compatible** - Console and Memory providers work in Next.js client components
- **Session Tracking** - Track user sessions with crash detection
- **Transaction Support** - Performance monitoring with custom measurements
- **Breadcrumbs** - Event trail for debugging
- **Scoped Context** - Isolated logging contexts with tags and metadata
- **Fully Tested** - Comprehensive test coverage

## Installation

```bash
npm install @johnboxcodes/boxlogger
```

No additional dependencies required!

## Quick Start

```typescript
import * as Sentry from '@johnboxcodes/boxlogger';

// Initialize with Console (great for development!)
await Sentry.init('console', { 
  service: 'my-api',
  environment: 'development'
});

// Capture errors
try {
  await riskyOperation();
} catch (error) {
  Sentry.captureException(error, {
    tags: { section: 'payment' },
    extra: { userId: '123' }
  });
}

// Log messages
Sentry.captureMessage('Payment processed', 'info');

// Set user context
Sentry.setUser({ id: '123', email: 'user@example.com' });

// Add breadcrumbs
Sentry.addBreadcrumb({
  category: 'navigation',
  message: 'User navigated to checkout',
  level: 'info'
});
```

## Storage Providers

### Console (Development/Debugging)

Logs everything to console with beautiful colorful formatting. Perfect for development and debugging.

```typescript
await Sentry.init('console', {
  service: 'my-service',
  environment: 'development',
  minLevel: 'debug'
});
```


```typescript
import * as Sentry from '@johnboxcodes/boxlogger';

  filename: './logs.db',
  service: 'my-service',
  environment: 'production',
  minLevel: 'info'
});
```

### Memory (Testing)

```typescript
await Sentry.init('memory', {
  service: 'my-service',
  environment: 'development',
  minLevel: 'debug'
});
```

### Custom Provider

```typescript
import { create } from 'boxlogger';
import { MyCustomStore } from './my-store';

const logger = await create(new MyCustomStore(), {
  service: 'my-service'
});
```

## API Reference

### Core Functions

#### `init(provider, options)`
Initialize the logger with a storage provider.

```typescript
  filename: './logs.db',
  service: 'my-api',
  environment: 'production',
  release: '1.0.0',
  minLevel: 'info',
  ignoreErrors: [/NetworkError/],
  sampleRate: 1.0,
  beforeSend: (event) => event
});
```

#### `captureException(error, context?)`
Capture and log exceptions with optional context.

```typescript
Sentry.captureException(error, {
  tags: { section: 'api' },
  extra: { endpoint: '/users' },
  level: 'error',
  user: { id: '123' }
});
```

#### `captureMessage(message, level?)`
Log custom messages.

```typescript
Sentry.captureMessage('User action completed', 'info');
Sentry.captureMessage('Warning: High memory usage', {
  level: 'warning',
  tags: { component: 'memory-monitor' }
});
```

#### `setUser(user)`
Set user context for all subsequent logs.

```typescript
Sentry.setUser({
  id: '123',
  email: 'user@example.com',
  username: 'john_doe',
  ip_address: '{{auto}}'
});
```

#### `addBreadcrumb(breadcrumb)`
Add breadcrumb for event trail.

```typescript
Sentry.addBreadcrumb({
  category: 'http',
  message: 'API request',
  level: 'info',
  data: { url: '/api/users', method: 'GET' }
});
```

#### `withScope(callback)`
Execute code with isolated logging context.

```typescript
Sentry.withScope((scope) => {
  scope.setTag('transaction', 'payment');
  scope.setExtra('orderId', '12345');
  Sentry.captureException(error);
});
```

### Session Management

```typescript
// Start session
await Sentry.startSession({ user: { id: '123' } });

// End session
await Sentry.endSession('ended');

// Get current session
const session = Sentry.getCurrentSession();
```

### Transaction Tracking

```typescript
const transaction = Sentry.startTransaction({
  name: 'payment-processing',
  op: 'payment'
});

transaction.setTag('payment-method', 'credit-card');
transaction.setMeasurement('amount', 99.99, 'usd');
transaction.setStatus('ok');
transaction.finish();
```

### Query Logs

```typescript
// Get logs with filters
const logs = await Sentry.getLogs({
  level: 'error',
  startTime: new Date('2024-01-01'),
  limit: 100
});

// Get sessions
const sessions = await Sentry.getSessions({
  status: 'crashed'
});

// Get statistics
const stats = await Sentry.getStats();
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `service` | `string` | - | Service name |
| `environment` | `string` | `'production'` | Environment (production, development, etc.) |
| `release` | `string` | - | Release version |
| `minLevel` | `LogLevel` | `'info'` | Minimum log level |
| `ignoreErrors` | `(string\|RegExp)[]` | `[]` | Errors to ignore |
| `sampleRate` | `number` | `1.0` | Error sampling rate (0-1) |
| `messagesSampleRate` | `number` | `1.0` | Message sampling rate (0-1) |
| `beforeSend` | `function` | - | Hook to modify/filter events |
| `beforeSendMessage` | `function` | - | Hook to modify/filter messages |

## Examples

See the [examples](./examples) directory for complete examples:
- [examples/simple.js](./examples/simple.js) - Quick start example (run with `node examples/simple.js`)
- [examples/server.ts](./examples/server.ts) - Express server with error tracking
- [examples/console-demo.ts](./examples/console-demo.ts) - Console provider with colorful output
- [examples/nextjs-integration.tsx](./examples/nextjs-integration.tsx) - Next.js integration (server + client)

## Next.js Integration

The console and memory providers work in both Next.js server and client components!

```typescript
// Client component
'use client';
import * as Sentry from '@johnboxcodes/boxlogger';

// Works in the browser!
await Sentry.init('console', {
  service: 'my-nextjs-app',
  environment: 'development'
});

Sentry.captureException(error);
```

See [examples/nextjs-integration.tsx](./examples/nextjs-integration.tsx) for complete examples.

## License

MIT

## Author

johnbox codes
