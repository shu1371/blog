import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

let base;
let server;
let origin;

before(async () => {
  base = await mkdtemp(join(tmpdir(), 'lxtoxyf-static-'));
  await mkdir(join(base, 'content'), { recursive: true });
  await writeFile(join(base, 'content', 'projects.json'), '[]\n');
  server = createApp({
    siteRoot: repoRoot,
    contentRoot: join(base, 'content'),
    disableAutoSync: true,
    env: { ADMIN_PASSWORD: 'test-pass', SESSION_SECRET: 'test-secret' }
  });
  await new Promise(resolve => server.listen(0, resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  await rm(base, { recursive: true, force: true });
});

const request = (path, options = {}) => fetch(origin + path, options);

test('首页返回 200 且包含署名与联系方式', async () => {
  const res = await request('/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /lxtoxyf/i);
  assert.match(html, /lxtoxyf@163\.com/);
  assert.match(html, /github\.com\/shu1371/);
});

test('项目页返回 200', async () => {
  const res = await request('/projects.html');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /项目/);
});

test('样式与前台脚本可访问', async () => {
  const css = await request('/assets/site.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);
  const js = await request('/content.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
});

test('未登录访问后台面板 303 跳转登录页', async () => {
  const res = await request('/dashboard.html', { redirect: 'manual' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/admin.html');
});

test('学习小结页返回 200 且导航存在', async () => {
  const res = await request('/summaries.html');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /学习小结/);
});
