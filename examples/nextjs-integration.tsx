/**
 * Next.js Integration Example
 * 
 * This example shows how to use boxlogger in Next.js applications.
 * The console provider works in both server and client components!
 */

// ============================================================================
// Server-side usage (API routes, Server Components, Server Actions)
// ============================================================================

// lib/logger.ts
import * as Sentry from '@johnboxcodes/boxlogger';

// Initialize once (in a server-only file)
await Sentry.init('console', {
  service: 'my-nextjs-app',
  environment: process.env.NODE_ENV,
  minLevel: 'debug',
});

export { Sentry };

// ============================================================================
// API Route Example
// ============================================================================

// app/api/users/route.ts
import { Sentry } from '@/lib/logger';

export async function GET() {
  try {
    Sentry.info('Fetching users');
    
    const users = await fetchUsers();
    
    return Response.json({ users });
  } catch (error) {
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
// Server Action Example
// ============================================================================

// app/actions.ts
'use server';

import { Sentry } from '@/lib/logger';

export async function createUser(formData: FormData) {
  try {
    const name = formData.get('name');
    
    Sentry.info('Creating user', { extra: { name } });
    
    // Create user logic...
    
    return { success: true };
  } catch (error) {
    Sentry.captureException(error, {
      tags: { action: 'createUser' },
    });
    
    return { success: false, error: 'Failed to create user' };
  }
}

// ============================================================================
// Client Component Example (Browser-safe!)
// ============================================================================

// app/components/ErrorBoundary.tsx
'use client';

import { useEffect } from 'react';
import * as Sentry from '@johnboxcodes/boxlogger';

// Initialize for client-side (console provider only)
if (typeof window !== 'undefined') {
  Sentry.init('console', {
    service: 'my-nextjs-app-client',
    environment: process.env.NODE_ENV,
    minLevel: 'error',
  }).catch(console.error);
}

export function ErrorBoundary({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      Sentry.captureException(event.error, {
        tags: { source: 'window.onerror' },
      });
    };

    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  return <>{children}</>;
}

// ============================================================================
// Client Component with Error Handling
// ============================================================================

// app/components/UserForm.tsx
'use client';

import { useState } from 'react';
import * as Sentry from '@johnboxcodes/boxlogger';

export function UserForm() {
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        body: JSON.stringify({ name: 'John' }),
      });

      if (!response.ok) {
        throw new Error('Failed to create user');
      }

      Sentry.info('User created successfully');
    } catch (error) {
      Sentry.captureException(error, {
        tags: { component: 'UserForm' },
      });
      
      setError('Something went wrong');
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="error">{error}</div>}
      <button type="submit">Create User</button>
    </form>
  );
}

// ============================================================================
// Notes
// ============================================================================

/**
 * IMPORTANT:
 * 
 * 1. Console provider works everywhere (server + client)
 * 2. SQLite provider only works server-side (requires Node.js)
 * 3. Memory provider works everywhere but doesn't persist
 * 
 * For production:
 * - Use SQLite on server-side for persistent logs
 * - Use console on client-side for debugging
 * - Consider separate init() calls for server vs client
 */
