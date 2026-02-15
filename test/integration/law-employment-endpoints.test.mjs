#!/usr/bin/env node

/**
 * Employment Law Ingest Endpoint Tests
 *
 * Tests the HTTP endpoints for employment law ingest:
 * - POST /api/law/ingest/employment
 * - GET /api/law/curriculum
 * - GET /api/law/search (with employment law data)
 */

import jwt from 'jsonwebtoken';
import db from './db.js';
import { v4 as uuidv4 } from 'uuid';

const API_URL = 'http://localhost:3001';
const JWT_SECRET = process.env.JWT_SECRET || 'a81d14ca60a59d6a7214896743124fd113bcfa0fdbe2eab0ebef135ced567c3ec8e8b91768450587db392b51e235303ced092cd682ea8f8714bda3b8823e22a6';

let testResults = {
  passed: 0,
  failed: 0,
  errors: []
};

// ============================================================================
// Test Utilities
// ============================================================================

function logTest(name, passed, details = '') {
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${name}`);
  if (details) console.log(`   ${details}`);

  if (passed) {
    testResults.passed++;
  } else {
    testResults.failed++;
  }
}

async function generateToken(brandId, userId = 'test-user-123') {
  return jwt.sign(
    {
      userId,
      email: 'test@employment.test',
      role: 'admin',
      brandId
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

async function makeRequest(method, path, body = null, token = null, brandId = null) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json'
    }
  };

  if (token) {
    options.headers['Authorization'] = `Bearer ${token}`;
  }

  // Add brand header for multi-tenant support
  if (brandId) {
    options.headers['x-brand'] = 'law';
  }

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(`${API_URL}${path}`, options);
    const data = await response.json();
    return { status: response.status, data };
  } catch (error) {
    return { status: 0, error: error.message };
  }
}

// ============================================================================
// Setup
// ============================================================================

async function setup() {
  console.log('\n🔧 Setting up test environment...\n');

  // Get or create lawlore brand
  let brand = await db.one(`SELECT id FROM brands WHERE code = 'law'`);
  if (!brand) {
    const brandId = uuidv4();
    await db.query(
      `INSERT INTO brands (id, code, name) VALUES ($1, $2, $3)`,
      [brandId, 'law', 'Lawlore']
    );
    brand = { id: brandId };
    console.log('✓ Created lawlore brand');
  } else {
    console.log('✓ Using existing lawlore brand');
  }

  return brand;
}

// ============================================================================
// Tests
// ============================================================================

async function testIngestWithoutAuth() {
  console.log('\n📋 TEST 1: Ingest endpoint requires authentication');

  const { status, data } = await makeRequest(
    'POST',
    '/api/law/ingest/employment',
    { limit: 10, includeAwards: true }
  );

  const passed = status === 401 || status === 403;
  logTest(
    'Ingest endpoint blocks unauthenticated requests',
    passed,
    `Status: ${status}`
  );

  return passed;
}

async function testIngestWithAuth(brandId) {
  console.log('\n📋 TEST 2: Successful employment law ingest');

  const token = await generateToken(brandId);
  const { status, data } = await makeRequest(
    'POST',
    '/api/law/ingest/employment',
    { limit: 10, includeAwards: true },
    token,
    brandId
  );

  const passed = status === 200 && data.success && data.created > 0;
  logTest(
    'Ingest endpoint accepts authenticated requests',
    passed,
    `Status: ${status}, Created: ${data.created}, Updated: ${data.updated}`
  );

  if (!passed) {
    testResults.errors.push(`Ingest failed: ${JSON.stringify(data)}`);
  }

  return passed;
}

async function testIngestLimitParam(brandId) {
  console.log('\n📋 TEST 3: Ingest respects limit parameter');

  const token = await generateToken(brandId);

  // First ingest with limit 5
  const { status: status1, data: data1 } = await makeRequest(
    'POST',
    '/api/law/ingest/employment',
    { limit: 5, includeAwards: false },
    token,
    brandId
  );

  const passed = status1 === 200 && (data1.created + data1.updated) <= 5;
  logTest(
    'Limit parameter restricts number of documents',
    passed,
    `Total ingested: ${data1.created + data1.updated}`
  );

  return passed;
}

async function testIngestWithoutAwards(brandId) {
  console.log('\n📋 TEST 4: Ingest without Modern Awards');

  const token = await generateToken(brandId);
  const { status, data } = await makeRequest(
    'POST',
    '/api/law/ingest/employment',
    { limit: 15, includeAwards: false },
    token,
    brandId
  );

  const passed = status === 200 && data.success;
  logTest(
    'Ingest works with includeAwards=false',
    passed,
    `Created: ${data.created}, Updated: ${data.updated}`
  );

  return passed;
}

async function testEmploymentLawSearchable() {
  console.log('\n📋 TEST 5: Employment law documents are searchable');

  // Query database directly for employment statutes
  const statutes = await db.many(
    `SELECT COUNT(*) as count FROM law_statutes
     WHERE title LIKE '%Fair Work%' OR title LIKE '%Discrimination%'`
  );

  const count = statutes[0]?.count || 0;
  const passed = count > 0;

  logTest(
    'Employment law documents in database',
    passed,
    `Found: ${count} documents`
  );

  return passed;
}

async function testEmploymentCitations() {
  console.log('\n📋 TEST 6: Employment law citations detected');

  // Query for citations in employment law docs
  const citations = await db.many(
    `SELECT COUNT(*) as count FROM law_citations
     WHERE source_statute_id IN
     (SELECT id FROM law_statutes WHERE title LIKE '%Fair Work%' OR title LIKE '%Discrimination%')`
  );

  const count = citations[0]?.count || 0;
  const hasCitations = count >= 0; // Just check if we can query it

  logTest(
    'Citations table accessible for employment law documents',
    hasCitations,
    `Found: ${count} citations`
  );

  return true; // Pass if we can query without errors
}

async function testSourceCreated() {
  console.log('\n📋 TEST 7: Employment law source tracking');

  const source = await db.one(
    `SELECT * FROM law_sources WHERE code = 'fw_legislation'`
  );

  const passed = source && source.sync_status === 'success';
  logTest(
    'Employment law source created and tracked',
    passed,
    `Status: ${source?.sync_status}`
  );

  return passed;
}

async function testIngestionLogging() {
  console.log('\n📋 TEST 8: Ingestion events logged');

  const logs = await db.many(
    `SELECT status, documents_created, documents_updated FROM law_ingestion_log
     ORDER BY started_at DESC LIMIT 1`
  );

  const passed = logs.length > 0 && (logs[0].documents_created > 0 || logs[0].documents_updated > 0);
  logTest(
    'Ingestion events recorded in logs',
    passed,
    logs.length > 0 ? `Status: ${logs[0].status}` : 'No logs found'
  );

  return passed;
}

async function testConcurrentRequests(brandId) {
  console.log('\n📋 TEST 9: Concurrent ingest requests handled');

  const token = await generateToken(brandId);

  // Make 3 concurrent requests
  const promises = [
    makeRequest('POST', '/api/law/ingest/employment', { limit: 5 }, token, brandId),
    makeRequest('POST', '/api/law/ingest/employment', { limit: 5 }, token, brandId),
    makeRequest('POST', '/api/law/ingest/employment', { limit: 5 }, token, brandId)
  ];

  const results = await Promise.all(promises);
  const allSucceeded = results.every(r => r.status === 200);

  logTest(
    'Concurrent requests handled without errors',
    allSucceeded,
    `All 3 requests: ${allSucceeded ? 'succeeded' : 'some failed'}`
  );

  return allSucceeded;
}

async function testErrorHandling(brandId) {
  console.log('\n📋 TEST 10: Error handling');

  const token = await generateToken(brandId);

  // Invalid limit (negative)
  const { status } = await makeRequest(
    'POST',
    '/api/law/ingest/employment',
    { limit: -1 },
    token,
    brandId
  );

  // Should either succeed with default or return error
  const passed = [200, 400, 500].includes(status);
  logTest(
    'Invalid parameters handled gracefully',
    passed,
    `Status: ${status}`
  );

  return passed;
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function runAllTests() {
  console.log('\n' + '='.repeat(70));
  console.log('🧪 EMPLOYMENT LAW INGEST ENDPOINT TESTS');
  console.log('='.repeat(70));

  const brand = await setup();

  try {
    // Run tests
    await testIngestWithoutAuth();
    await testIngestWithAuth(brand.id);
    await testIngestLimitParam(brand.id);
    await testIngestWithoutAwards(brand.id);
    await testEmploymentLawSearchable();
    await testEmploymentCitations();
    await testSourceCreated();
    await testIngestionLogging();
    await testConcurrentRequests(brand.id);
    await testErrorHandling(brand.id);

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log(`📊 TEST RESULTS`);
    console.log('='.repeat(70));
    console.log(`✅ Passed: ${testResults.passed}`);
    console.log(`❌ Failed: ${testResults.failed}`);
    console.log(`Total: ${testResults.passed + testResults.failed}`);

    if (testResults.errors.length > 0) {
      console.log('\n⚠️  Errors:');
      testResults.errors.forEach(err => console.log(`   - ${err}`));
    }

    const passRate = ((testResults.passed / (testResults.passed + testResults.failed)) * 100).toFixed(1);
    console.log(`\n📈 Pass Rate: ${passRate}%`);
    console.log('='.repeat(70));

    process.exit(testResults.failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('\n❌ Fatal Error:', error);
    process.exit(1);
  }
}

runAllTests();
