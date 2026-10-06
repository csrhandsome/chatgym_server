import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHarness, credentials, imageDataUrl, planRequest, validPlan, withModelReplies } from './fixtures';

// Separate regression suite for multipart parsing. All model requests are mocked;
// invalid input must fail before the model or SSE response starts.
describe('multipart request validation regressions', () => {
  const h = createHarness();
  let token: string;
  beforeAll(async () => {
    const post = (path: string) => h.app.handle(new Request(`http://localhost${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials),
    }));
    expect((await post('/api/auth/register')).status).toBe(201);
    const response = await post('/api/auth/login');
    expect(response.status).toBe(200);
    token = (await response.json() as { token: string }).token;
  });
  afterAll(() => h.close());

  const purposes = ['{broken', '', 'null', '{}', '"food"', '[1]'];
  const details = ['{broken', '', 'null', '{}', '"low"', '[1]', '["ultra"]'];
  const planPayloads = ['{broken', '', 'null', '[]', '"bad"', '12', '{"inputImages":{}}', '{"user":[]}'];

  function formFor(path: string) {
    const form = new FormData();
    if (path.includes('/plan')) form.set('payload', JSON.stringify(planRequest()));
    else form.append('images', new File([Buffer.from(imageDataUrl.split(',')[1]!, 'base64')], 'camera.png', { type: 'image/png' }));
    return form;
  }
  const postForm = (path: string, body: FormData, authenticated = true) => h.app.handle(new Request(`http://localhost${path}`, {
    method: 'POST', headers: authenticated ? { authorization: `Bearer ${token}` } : {}, body,
  }));

  for (const path of ['/api/agent/plan', '/api/agent/plan/stream', '/api/agent/vlm/analyze', '/api/agent/vlm/analyze/stream']) {
    const fields: Array<[string, string[]]> = path.includes('/plan')
      ? [['payload', planPayloads], ['request', ['{broken']], ['inputImagePurposes', purposes], ['inputImageDetails', details]]
      : [['purposes', purposes], ['details', details]];
    for (const [field, values] of fields) for (const value of values) {
      test(`${path}: ${field}=${value || '(empty)'} returns JSON 422 without invoking provider`, async () => {
        const form = formFor(path);
        if (field === 'request') form.delete('payload');
        form.set(field, value);
        const result = await withModelReplies([], async () => {
          const response = await postForm(path, form);
          const raw = await response.text();
          expect(response.status).toBe(422);
          expect(response.headers.get('content-type')).toContain('application/json');
          expect(response.headers.get('access-control-allow-origin')).toBe('*');
          expect(JSON.parse(raw)).toEqual({ message: 'invalid JSON payload' });
          expect(raw).not.toContain('event:');
        });
        expect(result.calls).toHaveLength(0);
        expect(h.runtime.workoutMemoryStore.getSummary().totalStoredSessions).toBe(0);
      });
    }
    test(`${path}: unauthenticated invalid multipart still returns 401 first`, async () => {
      const form = formFor(path);
      form.set(path.includes('/plan') ? 'payload' : 'purposes', '{broken');
      const response = await postForm(path, form, false);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ message: 'authorization token required' });
    });
  }
  for (const path of ['/api/agent/plan', '/api/agent/plan/stream']) {
    test(`${path}: valid request alias and purpose/detail arrays remain accepted`, async () => {
      const form = new FormData();
      form.set('request', JSON.stringify(planRequest()));
      form.set('inputImagePurposes', '["训练上下文"]');
      form.set('inputImageDetails', '["low"]');
      await withModelReplies([JSON.stringify(validPlan())], async () => {
        const response = await postForm(path, form);
        expect(response.status).toBe(200);
        const raw = await response.text();
        if (path.endsWith('/stream')) { expect(raw).toContain('event: final'); expect(raw).not.toContain('event: error'); }
        else expect(JSON.parse(raw).plan.title).toBe(validPlan().title);
      });
    });
  }
});
