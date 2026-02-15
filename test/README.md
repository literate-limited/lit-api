# Test Structure

This directory contains all test files organized by type and feature.

## Directories

### `/integration`
Integration tests that verify end-to-end functionality.

**Includes:**
- Feature-specific tests (law, employment, SSO, etc.)
- Full workflow tests
- Comprehensive test suites
- Test runner orchestration

**Run all integration tests:**
```bash
npm test                    # Runs main test suite
npm run test:comprehensive  # Runs comprehensive tests
npm run test:core          # Runs full flow tests
npm run test:security      # Runs security tests
npm run test:errors        # Runs error handling tests
```

### `/unit`
Unit tests for individual functions and services.

**Current:** S3 service tests, credits service tests

### `/e2e`
End-to-end tests for complete user workflows.

**Current:** TTV workflow tests

### `/services`
Service-level tests (database, API, etc.).

**Includes:**
- S3 service tests
- Credits service tests

### `/fixtures`
Test data and fixtures.

**Includes:**
- Test data generators
- Mock objects
- Sample data

### `/experimental`
Development and experimental tests (not part of standard test suite).

**Includes:**
- Curriculum tests
- Phase 2 pathway tests
- Alternative implementations

## File Naming

Tests follow this naming convention:

- **Integration tests:** `{feature}.test.js` or `{feature}.test.mjs`
  - Examples: `law-employment-ingest.test.mjs`, `auth-sso.test.js`

- **Unit tests:** `{service}.test.js`
  - Examples: `s3.service.test.js`, `credits.service.test.js`

- **E2E tests:** `{workflow}.e2e.test.js`
  - Examples: `ttv-workflow.e2e.test.js`

## Running Tests

```bash
# From api/ directory
npm test                  # Main test runner
npm run test:core        # Full flow tests
npm run test:security    # Security tests
npm run test:errors      # Error handling tests
npm run test:comprehensive # Comprehensive tests
npm run test:curriculum  # Experimental curriculum tests
```

## Setup

All tests use `test/setup.js` for configuration and test database setup.

Import database and fixtures:
```javascript
import db from '../db.js';
import { testData } from '../fixtures/test-data.js';
```

## Adding New Tests

1. **For integration tests:** Add to `/integration` with pattern `{feature}.test.js`
2. **For unit tests:** Add to `/unit` with pattern `{service}.test.js`
3. **For E2E tests:** Add to `/e2e` with pattern `{workflow}.e2e.test.js`
4. **For experimental:** Add to `/experimental` until ready for main suite
5. Update package.json scripts if creating a new standard test suite

## Deprecated

Root-level test files (test-*.js, test-*.mjs) have been consolidated into this directory.
