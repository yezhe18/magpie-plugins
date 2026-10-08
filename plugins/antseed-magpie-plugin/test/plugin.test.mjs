import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import plugin, { _internal } from '../index.js';

const peerId = 'a'.repeat(40);
const offer = (extra = {}) => ({ peerId, serviceId: 'sample', protocol: 'openai-chat-completions',
  inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.3, ...extra });
const entry = (extra = {}) => ({ id: 'sample', name: 'Sample', type: 'text', peers: [offer()],
  context_length: 32768, max_output_tokens: 8192,
  capabilities: { tool_use: true, reasoning: false }, ...extra });

test('root and /v1 URL normalization; embedded credentials are refused', () => {
  assert.equal(_internal.proxyBase('http://127.0.0.1:8377/'), 'http://127.0.0.1:8377/v1');
  assert.equal(_internal.proxyBase('https://proxy.test/base/v1/'), 'https://proxy.test/base/v1');
  assert.throws(() => _internal.proxyBase('https://user:secret@proxy.test'));
});

test('stable automatic and optional pinned IDs; reputation changes do not rename them', () => {
  const a = _internal.catalogModels([entry()], 'http://local/v1', { includePinned: true });
  const b = _internal.catalogModels([entry({ peers: [offer({ reputationScore: 96, displayName: 'Changed' })] })], 'http://local/v1', { includePinned: true });
  assert.deepEqual(Object.keys(a), ['sample', peerId + '@sample']);
  assert.deepEqual(Object.keys(a), Object.keys(b));
  assert.equal(a.sample.limit.context, 32768);
  assert.equal(a.sample.capabilities.toolcall, true);
});

test('automatic route estimates use the maximum known price, including cache fallback', () => {
  const cost = _internal.costOf([offer({ cachedInputUsdPerMillion: 0.05 }), offer({ inputUsdPerMillion: 0.2, outputUsdPerMillion: 0.5 })]);
  assert.deepEqual(cost, { input: 0.2, output: 0.5, cache: { read: 0.2, write: 0.2 } });
  assert.equal(_internal.costOf([offer({ inputUsdPerMillion: undefined })]), undefined);
  assert.equal(_internal.costOf([offer({ inputUsdPerMillion: 0, outputUsdPerMillion: 0 })]).input, 0);
});

test('catalog respects capabilities and filters image/decision services and allow-list', () => {
  const models = _internal.catalogModels([entry({ context_length: undefined, max_output_tokens: undefined }), entry({ id: 'image', type: 'image' }), entry({ id: 'other' })], 'http://local/v1', { models: ['sample'] });
  assert.deepEqual(Object.keys(models), ['sample']);
  assert.equal(models.sample.limit.context, 0);
  assert.equal(models.sample.limit.output, 0);
  assert.equal(models.sample.capabilities.reasoning, false);
  assert.throws(() => _internal.catalogModels(null, 'http://local/v1', {}));
});

test('provider models hook fetches fresh metadata on each invocation', async t => {
  let revision = 0;
  const server = http.createServer((req, res) => {
    assert.equal(req.url, '/v1/models?type=text');
    assert.equal(req.headers.authorization, 'Bearer placeholder');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [entry({ id: 'revision-' + revision++ })] }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  const hooks = await plugin.server({}, { baseUrl: `http://127.0.0.1:${server.address().port}` });
  const first = await hooks.provider.models({}, { auth: { key: 'placeholder' } });
  const second = await hooks.provider.models({}, { auth: { key: 'placeholder' } });
  assert.deepEqual(Object.keys(first), ['revision-0']);
  assert.deepEqual(Object.keys(second), ['revision-1']);
});

test('transport preserves 402, SSE tool payloads, and the caller abort signal', async t => {
  const server = http.createServer((req, res) => {
    if (req.url === '/credit') return res.writeHead(402, { 'content-type': 'application/json' }).end('{"error":{"message":"insufficient_deposits"}}');
    if (req.url === '/stream') return res.writeHead(200, { 'content-type': 'text/event-stream' }).end('data: {"tool_calls":[{"function":{"name":"f","arguments":"{}"}}]}\n\n');
    res.writeHead(200);
    res.flushHeaders();
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); return new Promise(r => server.close(r)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const hooks = await plugin.server({}, { baseUrl: base });
  const loader = await hooks.auth.loader(async () => ({ key: 'placeholder' }));
  const credit = await loader.fetch(base + '/credit');
  assert.equal(credit.status, 402);
  assert.match(await credit.text(), /insufficient_deposits/);
  const stream = await loader.fetch(base + '/stream');
  assert.equal(stream.headers.get('content-type'), 'text/event-stream');
  assert.match(await stream.text(), /tool_calls/);
  const controller = new AbortController();
  const pending = loader.fetch(base + '/pending', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, e => e.name === 'AbortError');
});
