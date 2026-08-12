import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const fakeRepos = [
  { name: 'new-repo', full_name: 'shu1371/new-repo', html_url: 'https://github.com/shu1371/new-repo', description: '新仓库简介', language: 'Python', topics: ['python', 'sync'], fork: false },
  { name: 'financial-analysis', full_name: 'shu1371/financial-analysis', html_url: 'https://github.com/shu1371/financial-analysis', description: '', language: 'Python', topics: [], fork: false }
];
const readmeText = '# 标题\n\n第一段简介内容。\n\n第二段内容。';
const realFetch = globalThis.fetch;

let base;
let server;
let origin;

async function startApp(disableAutoSync, initialProjects, initialSync) {
  base = await mkdtemp(join(tmpdir(), 'lxtoxyf-sync-'));
  await mkdir(join(base, 'content'), { recursive: true });
  await writeFile(join(base, 'content', 'projects.json'), JSON.stringify(initialProjects, null, 2));
  if (initialSync) {
    await writeFile(join(base, 'content', 'github-sync.json'), JSON.stringify(initialSync, null, 2));
  }
  server = createApp({
    siteRoot: repoRoot,
    contentRoot: join(base, 'content'),
    disableAutoSync,
    env: { ADMIN_PASSWORD: 'test-pass', SESSION_SECRET: 'test-secret' }
  });
  await new Promise(resolve => server.listen(0, resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
}

async function stopApp() {
  if (server) await new Promise(resolve => server.close(resolve));
  if (base) await rm(base, { recursive: true, force: true });
  server = null;
  base = null;
}

async function loginCookie() {
  const res = await fetch(`${origin}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'test-pass' })
  });
  return res.headers.get('set-cookie').split(';')[0];
}

before(() => {
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.includes('/users/shu1371/repos')) {
      return { ok: true, status: 200, json: async () => fakeRepos };
    }
    if (path.includes('/readme')) {
      return { ok: true, status: 200, json: async () => ({ content: Buffer.from(readmeText).toString('base64') }) };
    }
    return realFetch(url, options);
  };
});

after(async () => {
  await stopApp();
  delete globalThis.fetch;
});

test('无状态文件且启用调度时启动自动同步', async () => {
  await startApp(false, []);
  await sleep(2200);
  const projects = JSON.parse(await readFile(join(base, 'content', 'projects.json'), 'utf8'));
  assert.equal(projects.length, 2);
  assert.equal(projects[0].id, 'new-repo');
  const syncState = JSON.parse(await readFile(join(base, 'content', 'github-sync.json'), 'utf8'));
  assert.ok(syncState.lastSync);
  assert.equal(syncState.added, 2);
  await stopApp();
});

test('距上次同步 4 天时启动自动同步', async () => {
  const old = { lastSync: new Date(Date.now() - 4 * 86400_000).toISOString() };
  await startApp(false, [], old);
  await sleep(2200);
  const projects = JSON.parse(await readFile(join(base, 'content', 'projects.json'), 'utf8'));
  assert.equal(projects.length, 2);
  await stopApp();
});

test('距上次同步 2 天时启动不触发同步', async () => {
  const recent = { lastSync: new Date(Date.now() - 2 * 86400_000).toISOString() };
  await startApp(false, [], recent);
  await sleep(2200);
  const projects = JSON.parse(await readFile(join(base, 'content', 'projects.json'), 'utf8'));
  assert.equal(projects.length, 0);
  await stopApp();
});

test('手动同步接口未登录返回 401', async () => {
  await startApp(true, []);
  const res = await fetch(`${origin}/api/admin/projects/sync`, { method: 'POST' });
  assert.equal(res.status, 401);
  await stopApp();
});

test('手动同步合并保留手动项目与手动简介', async () => {
  const initial = [
    { id: 'manual-project', title: '手动项目', url: 'https://example.com/manual', summary: '手动简介', tags: ['Demo'] },
    { id: 'financial-analysis', title: 'financial-analysis', url: 'https://github.com/shu1371/financial-analysis', summary: '手动润色的简介', tags: ['Python', '自定义'] }
  ];
  await startApp(true, initial);
  const cookie = await loginCookie();
  const res = await fetch(`${origin}/api/admin/projects/sync`, { method: 'POST', headers: { cookie } });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.added, 1);
  assert.equal(data.projects.length, 3);
  assert.equal(data.projects[0].id, 'new-repo');
  const manual = data.projects.find(p => p.id === 'manual-project');
  assert.ok(manual);
  assert.equal(manual.summary, '手动简介');
  const existing = data.projects.find(p => p.id === 'financial-analysis');
  assert.equal(existing.summary, '手动润色的简介');
  assert.deepEqual(existing.tags, ['Python', '自定义']);
  await stopApp();
});

test('README 简介用于无描述仓库且写入状态文件', async () => {
  await startApp(true, []);
  const cookie = await loginCookie();
  const res = await fetch(`${origin}/api/admin/projects/sync`, { method: 'POST', headers: { cookie } });
  const data = await res.json();
  const repo = data.projects.find(p => p.id === 'financial-analysis');
  assert.equal(repo.summary, '第一段简介内容。');
  const syncState = JSON.parse(await readFile(join(base, 'content', 'github-sync.json'), 'utf8'));
  assert.equal(syncState.added, 2);
  assert.ok(syncState.lastSync);
  await stopApp();
});
