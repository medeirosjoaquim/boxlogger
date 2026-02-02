/**
 * Console Store Provider
 *
 * Logs all data to console with colorful formatting instead of persisting.
 *
 * @module stores/console
 * @packageDocumentation
 */

import { BaseStoreProvider } from './base.js';
import type {
  StoreProviderConfig,
  LogEntry,
  Session,
  LogFilter,
  SessionFilter,
  StoreStats,
  LogLevel,
} from '../types.js';

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  
  // Log levels
  fatal: '\x1b[41m\x1b[37m', // white on red
  error: '\x1b[31m', // red
  warn: '\x1b[33m', // yellow
  info: '\x1b[36m', // cyan
  debug: '\x1b[35m', // magenta
  trace: '\x1b[90m', // gray
  
  // Elements
  timestamp: '\x1b[90m', // gray
  key: '\x1b[36m', // cyan
  string: '\x1b[32m', // green
  number: '\x1b[33m', // yellow
  boolean: '\x1b[35m', // magenta
  null: '\x1b[90m', // gray
};

export interface ConsoleStoreConfig extends StoreProviderConfig {}

export class ConsoleStoreProvider extends BaseStoreProvider {
  readonly name = 'console';

  constructor(config?: ConsoleStoreConfig) {
    super(config);
  }

  async init(): Promise<void> {
    this._ready = true;
    console.log(`${COLORS.bright}${COLORS.info}📦 Console Logger Initialized${COLORS.reset}\n`);
  }

  async close(): Promise<void> {
    console.log(`\n${COLORS.dim}📦 Console Logger Closed${COLORS.reset}`);
    this._ready = false;
  }

  private formatValue(value: unknown, indent = 0): string {
    const spaces = '  '.repeat(indent);
    
    if (value === null) return `${COLORS.null}null${COLORS.reset}`;
    if (value === undefined) return `${COLORS.null}undefined${COLORS.reset}`;
    
    if (typeof value === 'string') {
      return `${COLORS.string}"${value}"${COLORS.reset}`;
    }
    if (typeof value === 'number') {
      return `${COLORS.number}${value}${COLORS.reset}`;
    }
    if (typeof value === 'boolean') {
      return `${COLORS.boolean}${value}${COLORS.reset}`;
    }
    
    if (Array.isArray(value)) {
      if (value.length === 0) return '[]';
      const items = value.map(v => `${spaces}  ${this.formatValue(v, indent + 1)}`).join(',\n');
      return `[\n${items}\n${spaces}]`;
    }
    
    if (typeof value === 'object') {
      const entries = Object.entries(value);
      if (entries.length === 0) return '{}';
      const items = entries
        .map(([k, v]) => `${spaces}  ${COLORS.key}${k}${COLORS.reset}: ${this.formatValue(v, indent + 1)}`)
        .join(',\n');
      return `{\n${items}\n${spaces}}`;
    }
    
    return String(value);
  }

  private logEntry(entry: LogEntry): void {
    const levelColor = COLORS[entry.level];
    const levelLabel = entry.level.toUpperCase().padEnd(5);
    const timestamp = new Date(entry.timestamp).toISOString();
    
    console.log(`\n${COLORS.bright}${levelColor}[${levelLabel}]${COLORS.reset} ${COLORS.timestamp}${timestamp}${COLORS.reset}`);
    console.log(`${COLORS.bright}${entry.message}${COLORS.reset}`);
    
    if (entry.metadata) {
      const { tags, extra, user, request, error, ...rest } = entry.metadata;
      
      if (tags && Object.keys(tags).length > 0) {
        console.log(`\n  ${COLORS.key}Tags:${COLORS.reset}`);
        for (const [key, value] of Object.entries(tags)) {
          console.log(`    ${COLORS.dim}${key}:${COLORS.reset} ${this.formatValue(value)}`);
        }
      }
      
      if (user) {
        console.log(`\n  ${COLORS.key}User:${COLORS.reset}`);
        console.log(`    ${this.formatValue(user, 2)}`);
      }
      
      if (error) {
        console.log(`\n  ${COLORS.key}Error:${COLORS.reset}`);
        if (error.type) console.log(`    ${COLORS.dim}type:${COLORS.reset} ${this.formatValue(error.type)}`);
        if (error.message) console.log(`    ${COLORS.dim}message:${COLORS.reset} ${this.formatValue(error.message)}`);
        if (error.stack) {
          console.log(`    ${COLORS.dim}stack:${COLORS.reset}`);
          console.log(`${COLORS.trace}${error.stack}${COLORS.reset}`);
        }
      }
      
      if (extra && Object.keys(extra).length > 0) {
        console.log(`\n  ${COLORS.key}Extra:${COLORS.reset}`);
        console.log(`    ${this.formatValue(extra, 2)}`);
      }
      
      if (request) {
        console.log(`\n  ${COLORS.key}Request:${COLORS.reset}`);
        console.log(`    ${this.formatValue(request, 2)}`);
      }
    }
    
    console.log(`${COLORS.dim}${'─'.repeat(80)}${COLORS.reset}`);
  }

  async saveLog(entry: LogEntry): Promise<void> {
    this.ensureReady();
    this.logEntry(entry);
  }

  async getLogs(filter?: LogFilter): Promise<LogEntry[]> {
    this.ensureReady();
    console.log(`${COLORS.warn}⚠️  Console store doesn't persist logs - getLogs returns empty array${COLORS.reset}`);
    return [];
  }

  async deleteLogs(filter?: LogFilter): Promise<number> {
    this.ensureReady();
    return 0;
  }

  async countLogs(filter?: LogFilter): Promise<number> {
    this.ensureReady();
    return 0;
  }

  async createSession(session: Session): Promise<void> {
    this.ensureReady();
    console.log(`\n${COLORS.bright}${COLORS.info}🚀 SESSION STARTED${COLORS.reset}`);
    console.log(`  ${COLORS.key}ID:${COLORS.reset} ${session.id}`);
    if (session.user) {
      console.log(`  ${COLORS.key}User:${COLORS.reset} ${this.formatValue(session.user, 1)}`);
    }
    console.log(`${COLORS.dim}${'─'.repeat(80)}${COLORS.reset}\n`);
  }

  async updateSession(sessionId: string, updates: Partial<Session>): Promise<void> {
    this.ensureReady();
    if (updates.status === 'ended' || updates.status === 'crashed') {
      const icon = updates.status === 'crashed' ? '💥' : '✅';
      console.log(`\n${COLORS.bright}${icon} SESSION ${updates.status.toUpperCase()}${COLORS.reset}`);
      console.log(`  ${COLORS.key}ID:${COLORS.reset} ${sessionId}`);
      if (updates.errorCount !== undefined) {
        console.log(`  ${COLORS.key}Errors:${COLORS.reset} ${COLORS.number}${updates.errorCount}${COLORS.reset}`);
      }
      console.log(`${COLORS.dim}${'─'.repeat(80)}${COLORS.reset}\n`);
    }
  }

  async getSession(sessionId: string): Promise<Session | null> {
    this.ensureReady();
    return null;
  }

  async getSessions(filter?: SessionFilter): Promise<Session[]> {
    this.ensureReady();
    return [];
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.ensureReady();
  }

  async cleanup(olderThan: Date): Promise<number> {
    this.ensureReady();
    return 0;
  }

  async getStats(): Promise<StoreStats> {
    this.ensureReady();
    return {
      totalLogs: 0,
      totalSessions: 0,
      activeSessions: 0,
      logsByLevel: {
        fatal: 0,
        error: 0,
        warn: 0,
        info: 0,
        debug: 0,
        trace: 0,
      },
    };
  }
}
