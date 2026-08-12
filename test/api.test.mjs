import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const fixture = [
  { id: 'p1', title: '项目一', url: 'https://example.com/a', summary: '简介一', tags: ['Python'] }
];

let base;
let server;
let origin;
let createdId = '';

before(async () => {
  base = await mkdtemp(join(tmpdir(), 'lxtoxyf-api-'));
  await mkdir(join(base, 'content'), { recursive: true });
  await writeFile(join(base, 'content', 'projects.json'), JSON.stringify(fixture, null, 2));
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

async function loginCookie() {
  const res = await request('/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'test-pass' })
  });
  assert.equal(res.status, 200);
  return res.headers.get('set-cookie').split(';')[0];
}

test('GET /api/projects 返回初始项目列表', async () => {
  const res = await request('/api/projects');
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.length, 1);
  assert.equal(data[0].title, '项目一');
});

test('未知 API 路径返回 404 JSON', async () => {
  const res = await request('/api/notes');
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'not found');
});

test('未登录访问管理 API 返回 401', async () => {
  const res = await request('/api/admin/state');
  assert.equal(res.status, 401);
});

test('错误密码登录返回 401', async () => {
  const res = await request('/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'wrong' })
  });
  assert.equal(res.status, 401);
});

test('正确密码登录返回 Cookie 且会话有效', async () => {
  const cookie = await loginCookie();
  assert.ok(cookie.startsWith('admin_session='));
  const session = await request('/api/admin/session', { headers: { cookie } });
  assert.equal((await session.json()).authenticated, true);
  const state = await request('/api/admin/state', { headers: { cookie } });
  assert.equal(state.status, 200);
  assert.equal((await state.json()).projects.length, 1);
});

test('无 Cookie 与伪造 Cookie 均未认证', async () => {
  const plain = await request('/api/admin/session');
  assert.equal((await plain.json()).authenticated, false);
  const forged = await request('/api/admin/session', { headers: { cookie: 'admin_session=9999999999999.deadbeef' } });
  assert.equal((await forged.json()).authenticated, false);
});

test('新建项目成功并持久化到文件', async () => {
  const cookie = await loginCookie();
  const res = await request('/api/admin/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ title: '新项目', url: 'https://example.com/new', summary: '简介', tags: 'Node.js, 后台' })
  });
  assert.equal(res.status, 201);
  const project = await res.json();
  createdId = project.id;
  assert.equal(project.title, '新项目');
  assert.deepEqual(project.tags, ['Node.js', '后台']);
  const saved = JSON.parse(await readFile(join(base, 'content', 'projects.json'), 'utf8'));
  assert.equal(saved.length, 2);
  assert.equal(saved[0].title, '新项目');
  const list = await (await request('/api/projects')).json();
  assert.equal(list.length, 2);
});

test('缺少必填字段返回 400', async () => {
  const cookie = await loginCookie();
  const res = await request('/api/admin/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ title: '缺链接', summary: '简介' })
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /请填写/);
});

test('非法链接返回 400', async () => {
  const cookie = await loginCookie();
  const res = await request('/api/admin/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ title: '坏链接', url: 'javascript:alert(1)', summary: '简介' })
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /http/);
});

test('编辑项目成功', async () => {
  const cookie = await loginCookie();
  const res = await request('/api/admin/projects/p1', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ title: '项目一改', url: 'https://example.com/a', summary: '简介一更新', tags: 'Python, MySQL' })
  });
  assert.equal(res.status, 200);
  const project = await res.json();
  assert.equal(project.title, '项目一改');
  assert.equal(project.summary, '简介一更新');
});

test('排序保存成功', async () => {
  const cookie = await loginCookie();
  const res = await request('/api/admin/projects/order', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ ids: [createdId, 'p1'] })
  });
  assert.equal(res.status, 200);
  const ordered = (await res.json()).projects;
  assert.equal(ordered[0].id, createdId);
  assert.equal(ordered[1].id, 'p1');
});

test('删除项目成功', async () => {
  const cookie = await loginCookie();
  const res = await request(`/api/admin/projects/${createdId}`, {
    method: 'DELETE',
    headers: { cookie }
  });
  assert.equal(res.status, 200);
  const saved = JSON.parse(await readFile(join(base, 'content', 'projects.json'), 'utf8'));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, 'p1');
});

test('未提供 contentRoot 时使用 CONTENT_ROOT 环境变量', async () => {
  const envBase = await mkdtemp(join(tmpdir(), 'lxtoxyf-env-'));
  await mkdir(join(envBase, 'content'), { recursive: true });
  await writeFile(join(envBase, 'content', 'projects.json'), JSON.stringify([{ id: 'e1', title: '环境项目', url: 'https://example.com/e', summary: '简介', tags: ['Node'] }]));
  const srv = createApp({ siteRoot: repoRoot, disableAutoSync: true, env: { CONTENT_ROOT: join(envBase, 'content') } });
  await new Promise(resolve => srv.listen(0, resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/projects`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data[0].title, '环境项目');
  } finally {
    await new Promise(resolve => srv.close(resolve));
    await rm(envBase, { recursive: true, force: true });
  }
});
