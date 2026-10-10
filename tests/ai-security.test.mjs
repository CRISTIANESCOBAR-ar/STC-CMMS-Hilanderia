import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSummary } from '../src/utils/formatSummary.js';
import { requestGemini } from '../src/services/geminiGateway.js';
import { validateGeminiRequest, nextQuota, QUOTA_WINDOW_MS, QUOTA_REQUESTS } from '../functions/geminiPolicy.js';

test('summary escapes stored and generated HTML while preserving supported formatting', () => {
  const output = formatSummary('*Urgente*\n<img src=x onerror="alert(1)"> _revisar_ & datos');
  assert.equal(output, '<b>Urgente</b><br/>&lt;img src=x onerror=&quot;alert(1)&quot;&gt; <i>revisar</i> &amp; datos');
  assert.equal(formatSummary('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(formatSummary(null), '');
});

test('gateway returns cloud response and sends only present fields', async () => {
  const result = await requestGemini(async payload => {
    assert.deepEqual(payload, { model: 'gemini-2.5-flash', prompt: 'Resumen' });
    return { data: { text: 'Listo' } };
  }, { prompt: 'Resumen' });
  assert.deepEqual(result, { text: 'Listo', source: 'cloud' });
});

for (const code of ['functions/permission-denied', 'functions/unauthenticated', 'functions/resource-exhausted', 'functions/invalid-argument']) {
  test(`gateway preserves ${code} without alternate request`, async () => {
    let calls = 0;
    const denied = Object.assign(new Error('Rechazado'), { code });
    await assert.rejects(requestGemini(async () => { calls++; throw denied; }, { prompt: 'Resumen' }), error => error === denied);
    assert.equal(calls, 1);
  });
}

test('gateway reports unavailable service and empty response without retry', async () => {
  await assert.rejects(requestGemini(async () => { throw Object.assign(new Error('Offline'), { code: 'functions/unavailable' }); }), /GEMINI_UNAVAILABLE/);
  await assert.rejects(requestGemini(async () => ({ data: { text: ' ' } })), /GEMINI_UNAVAILABLE/);
});

test('server accepts daily report and normalizes current OCR image payload', () => {
  assert.equal(validateGeminiRequest({ prompt: 'Resumen' }).body.contents[0].parts[0].text, 'Resumen');
  const result = validateGeminiRequest({ parts: [{ text: 'Leer planilla' }, { inline_data: { mime_type: 'image/jpeg', data: 'YWJj' } }] });
  assert.deepEqual(result.body.contents[0].parts[1], { inlineData: { mimeType: 'image/jpeg', data: 'YWJj' } });
  assert.equal(result.body.generationConfig.maxOutputTokens, 8192);
});

test('server rejects unsupported models, oversized text, remote files and arbitrary configuration', () => {
  const invalidPayloads = [null, [], { prompt: 42 }, {}, { prompt: 'a'.repeat(120001) },
    { prompt: 'Resumen', model: '../other-model' },
    { parts: [{ text: 'a'.repeat(120001) }] },
    { parts: [{ fileData: { fileUri: 'https://example.com/private' } }] },
    { parts: [{ inline_data: { mime_type: 'text/html', data: 'YWJj' } }] },
    { parts: [{ text: 'a', inlineData: {} }] },
    { prompt: 'Resumen', generationConfig: { maxOutputTokens: 8193 } },
    { prompt: 'Resumen', generationConfig: { temperature: -1 } },
    { prompt: 'Resumen', generationConfig: { candidateCount: 10 } },
    { parts: [{ inline_data: { mime_type: 'image/jpeg', data: 'A'.repeat(8000000) } }] },
  ];
  for (const payload of invalidPayloads) assert.throws(() => validateGeminiRequest(payload));
});

test('quota allows bounded requests then rejects until window expires', () => {
  const now = 1000000;
  let quota = null;
  for (let index = 0; index < QUOTA_REQUESTS; index++) quota = nextQuota(quota, now + index);
  assert.equal(quota.count, QUOTA_REQUESTS);
  assert.equal(nextQuota(quota, now + 100), null);
  assert.deepEqual(nextQuota(quota, now + QUOTA_WINDOW_MS), { count: 1, windowStart: now + QUOTA_WINDOW_MS });
  assert.equal(nextQuota({ windowStart: now, count: -1 }, now), null);
});
