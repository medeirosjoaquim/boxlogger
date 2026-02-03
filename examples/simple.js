// Simple example - run with: node examples/simple.js
// This uses the built package, so run `npm run build` first

import * as Sentry from '../dist/index.js';

const errorMessages = [
  'Database connection failed',
  'API timeout exceeded',
  'Invalid user input',
  'Payment processing error',
  'File not found',
  'Network error',
  'Authentication failed',
  'Rate limit exceeded',
];

const infoMessages = [
  'User logged in',
  'Order processed',
  'Email sent',
  'Cache cleared',
  'Backup completed',
  'Report generated',
];

const sections = ['auth', 'payment', 'api', 'database', 'email', 'storage'];

function randomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function randomNumber(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function main() {
  // Initialize with console provider for colorful output
  await Sentry.init('console', {
    service: 'simple-example',
    environment: 'development',
    minLevel: 'debug',
  });

  console.log('🚀 Starting logger demo (press Ctrl+C to stop)...\n');

  let counter = 0;

  setInterval(() => {
    counter++;

    // Set random user
    Sentry.setUser({
      id: `user-${randomNumber(1, 100)}`,
      email: `user${randomNumber(1, 100)}@example.com`,
    });

    const action = randomNumber(1, 4);

    switch (action) {
      case 1:
        // Log info message
        Sentry.info(randomItem(infoMessages), {
          extra: { 
            counter,
            timestamp: Date.now(),
            value: randomNumber(1, 1000),
          },
        });
        break;

      case 2:
        // Log warning
        Sentry.warn('High resource usage detected', {
          tags: { section: randomItem(sections) },
          extra: { 
            cpu: `${randomNumber(50, 95)}%`,
            memory: `${randomNumber(60, 90)}%`,
          },
        });
        break;

      case 3:
        // Capture error
        const error = new Error(randomItem(errorMessages));
        Sentry.captureException(error, {
          tags: { 
            section: randomItem(sections),
            severity: randomNumber(1, 5),
          },
          extra: { 
            attemptNumber: randomNumber(1, 3),
            errorCode: `ERR_${randomNumber(1000, 9999)}`,
          },
        });
        break;

      case 4:
        // Debug message
        Sentry.debug('Processing request', {
          extra: {
            requestId: `req-${randomNumber(10000, 99999)}`,
            duration: `${randomNumber(10, 500)}ms`,
          },
        });
        break;
    }
  }, 2000); // Every 2 seconds
}

main().catch(console.error);

