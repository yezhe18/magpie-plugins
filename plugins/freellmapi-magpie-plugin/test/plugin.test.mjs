import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import plugin, { _internal } from '../index.js';

const base = 'http://127.0.0.1:3001/v1';
const data = [
  { id: 'auto', owned_by: 'freellmapi', available: true, context_length: 128000 },
  { id: 'fusion', owned_by: 'freellmapi', available: true },
  { id: 'claude-alias', owned_by: 'freellmapi', available: true },
  { id: 'auto:coding', owned_by: 'freellmapi', available: true },
  { id: 'fixture-ready', name: 'Ready', owned_by: 'groq', available: true, execution_status: 'ready', context_window: 128000, supported_parameters: ['tools', 'temperature'] },
  { id: 'fixture-exhausted', owned_by: 'groq', available: true, execution_status: 'exhausted' },
  { id: 'fixture-keyless', owned_by: 'groq', available: false, execution_status: 'needsKey' },
];

test('only callable models and the default auto route are exposed', () => {
  const models = _internal.modelsOf(data, base);
  assert.deepEqual(Object.keys(models).sort(), ['auto', 'fixture-ready']);
  assert.equal(models['fixture-ready'].api.id, 'fixture-ready');
  assert.equal(models.auto.capabilities.toolcall, true);
  assert.equal(models['fixture-ready'].limit.context, 128000);
  assert.equal(models['fixture-ready'].limit.output, 0);
  assert.equal(models['fixture-ready'].capabilities.input.image, false);
  assert.equal('cost' in models['fixture-ready'], false);
});

test('auto is not advertised when every actual route is exhausted', () => {
  assert.deepEqual(Object.keys(_internal.modelsOf(data.filter(m => m.id !== 'fixture-ready'), base)), []);
});

test('profile opt-in and overrides preserve upstream model identifiers', () => {
  const models = _internal.modelsOf(data, base, { models: ['auto:coding'], modelMetadata: { 'auto:coding': { tools: true, vision: true, context: 64000, output: 4096 } } });
  assert.deepEqual(Object.keys(models), ['auto:coding']);
  assert.equal(models['auto:coding'].api.id, 'auto:coding');
  assert.equal(models['auto:coding'].capabilities.toolcall, true);
  assert.equal(models['auto:coding'].capabilities.input.image, true);
  assert.deepEqual(models['auto:coding'].limit, { context: 64000, output: 4096 });
});

test('the endpoint keeps subpaths and rejects embedded credentials', () => {
  assert.equal(_internal.proxyBase('http://127.0.0.1:3001/'), base);
  assert.equal(_internal.proxyBase(base + '/'), base);
  assert.equal(_internal.proxyBase('https://example.com/router'), 'https://example.com/router/v1');
  for (const value of ['file:///tmp/router', 'https://secret@example.com', base + '?key=secret']) assert.throws(() => _internal.proxyBase(value));
});

test('discovery refreshes readiness, retains auth, and does not disclose error bodies', async () => {
  let status = 200, catalog = data, calls = 0;
  const mock = http.createServer((req, res) => {
    calls++;
    assert.equal(req.url, '/v1/models?available=true&execution_status=ready');
    assert.equal(req.headers.authorization, 'Bearer fixture-unified');
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(status === 200 ? { data: catalog } : { secret: 'sensitive-body' }));
  });
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  try {
    const hooks = await plugin.server({}, { baseUrl: `http://127.0.0.1:${mock.address().port}` });
    assert.deepEqual(Object.keys(await hooks.provider.models({}, { auth: { key: 'fixture-unified' } })).sort(), ['auto', 'fixture-ready']);
    catalog = data.filter(m => m.id !== 'fixture-ready');
    assert.deepEqual(Object.keys(await hooks.provider.models({}, { auth: { key: 'fixture-unified' } })), []);
    status = 401;
    await assert.rejects(() => hooks.provider.models({}, { auth: { key: 'fixture-unified' } }), error => /HTTP 401/.test(error.message) && !/sensitive-body|fixture-unified/.test(error.message));
    assert.equal(calls, 3);
  } finally { mock.closeAllConnections(); await new Promise(resolve => mock.close(resolve)); }
});

test('stream bytes and Retry-After reach the caller unchanged', async () => {
  const mock = http.createServer((req, res) => {
    res.writeHead(429, { 'content-type': 'text/event-stream', 'retry-after': '30' });
    res.end('data: {"error":"quota"}\n\n');
  });
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  try {
    const hooks = await plugin.server({});
    const loaded = await hooks.auth.loader(async () => ({ key: 'fixture-unified' }));
    assert.equal(loaded.apiKey, 'fixture-unified');
    const response = await loaded.fetch(`http://127.0.0.1:${mock.address().port}/v1/chat/completions`);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '30');
    assert.equal(await response.text(), 'data: {"error":"quota"}\n\n');
    const controller = new AbortController(); controller.abort();
    await assert.rejects(() => loaded.fetch(`http://127.0.0.1:${mock.address().port}`, { signal: controller.signal }), error => error.name === 'AbortError');
  } finally { mock.closeAllConnections(); await new Promise(resolve => mock.close(resolve)); }
});
