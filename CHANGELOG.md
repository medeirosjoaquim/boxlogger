# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-02-02

### Added
- Initial release
- Sentry-compatible API with top 5 functions (captureException, captureMessage, setUser, addBreadcrumb, withScope)
- SQLite storage provider with persistent logging
- Memory storage provider for development/testing
- Session tracking with crash detection
- Transaction support for performance monitoring
- Breadcrumb trail for debugging
- Scoped context with tags and metadata
- Configurable sampling rates
- Error filtering with ignoreErrors patterns
- beforeSend and beforeSendMessage hooks
- Comprehensive TypeScript types
- Full test coverage
