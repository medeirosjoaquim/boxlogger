# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-02-02

### Added
- **Console storage provider** with colorful output for debugging
- **Browser compatibility** - Console and Memory providers now work in browser environments
- Next.js client component support
- Browser-compatible UUID generation (no node:crypto dependency)
- Next.js integration example with server and client usage
- Graceful handling of null/undefined in captureException

### Changed
- Replaced `node:crypto` and `node:os` imports with browser-compatible alternatives
- Made `process` access safe for browser environments
- `pid` field is now optional (undefined in browser)

## [0.1.0] - 2026-02-02

### Added
- Initial release
- Sentry-compatible API with top 5 functions (captureException, captureMessage, setUser, addBreadcrumb, withScope)
- SQLite storage provider with persistent logging
- Memory storage provider for development/testing
- **Console storage provider with colorful output for debugging**
- Session tracking with crash detection
- Transaction support for performance monitoring
- Breadcrumb trail for debugging
- Scoped context with tags and metadata
- Configurable sampling rates
- Error filtering with ignoreErrors patterns
- beforeSend and beforeSendMessage hooks
- Comprehensive TypeScript types
- Full test coverage
