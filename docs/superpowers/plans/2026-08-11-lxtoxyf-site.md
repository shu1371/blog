# lxtoxyf 个人网站实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 lxtoxyf 个人网站：项目作品 + 联系方式前台、带登录的后台管理、GitHub 内容同步，并交付 Docker/Caddy 部署产物。

**Architecture:** Node.js 零依赖 HTTP 服务提供静态页面与 JSON API；后台登录使用 HMAC-SHA256 签名 Cookie；内容保存时先通过 GitHub Contents API 同步到 `shu1371/blog`（未配置令牌时仅写本地），再写入服务器本地 `content/projects.json`；生产部署使用 Docker 容器 + 服务器现有 Caddy 反向代理。

**Tech Stack:** Node.js ≥18（内置 `http`/`crypto`/`fetch`/`node:test`）、原生 HTML/CSS/JS、Docker、Caddy、GitHub Contents API。

## Global Constraints

- 零第三方依赖：只用 Node 内置模块，`package.json` 无 dependencies。
- Node ≥ 18（本地运行测试），生产镜像 `node:24-alpine`。
- 项目字段：`id`（UUID 或固定字符串）、`title`（≤100 字）、`url`（≤600，必须 `http://` 或 `https://` 开头）、`summary`（≤360 字）、`tags`（≤8 个，每个 ≤24 字）。
- 认证：`ADMIN_PASSWORD`、`SESSION_SECRET` 从环境变量读取；Cookie `admin_session` 使用 `HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`，HTTPS 下追加 `Secure`；会话有效期 12 小时。
- GitHub 同步：`GITHUB_TOKEN` 可选；配置时先 GitHub 后本地，401/403 返回中文错误；未配置时仅写本地并返回 `{ synced: false }`。
- 同步仓库：`GITHUB_REPOSITORY` 默认 `shu1371/blog`，分支 `GITHUB_BRANCH` 默认 `main`，内容路径 `content/projects.json`。
- 页面文案：署名 lxtoxyf；tagline「持续学习，持续构建」；简介「用代码把想法变成可以运行的作品」；页脚「© 2026 LXTXYF」。
- 初始项目 2 个（financial-analysis、points-discount），数据见 Task 1。
- 所有用户可见错误提示为中文。
- 前台与后台页面为中文（`lang="zh-CN"`）。
- 提交信息遵循 conventional commits（`feat:` / `fix:` / `docs:` / `test:` / `chore:`）。

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `package.json` | 模块类型（ESM）、start/test 脚本 |
| `.gitignore` | 忽略 node_modules、env、日志 |
| `content/projects.json` | 项目数据（初始 2 个） |
| `app.mjs` | 全部后端逻辑：静态服务、API、认证、GitHub 同步（工厂函数 `createApp`） |
| `server.mjs` | 入口：读取环境变量、监听端口 |
| `test/projects.test.mjs` | 数据文件完整性测试 |
| `test/api.test.mjs` | 后端 API 测试（项目、认证、CRUD、排序、校验） |
| `test/static.test.mjs` | 静态页面服务与后台跳转测试 |
| `index.html` | 首页：hero、项目作品、联系方式 |
| `projects.html` | 项目列表页 |
| `content.js` | 前台 JS：加载并渲染项目卡片 |
| `assets/site.css` | 前台样式（参考项目插画风） |
| `admin.html` | 后台登录页 |
| `dashboard.html` | 后台管理面板 |
| `admin.js` | 后台逻辑：登录态、CRUD、排序 |
| `admin.css` | 后台样式 |
| `Dockerfile` | 生产镜像 |
| `deploy/Caddyfile` | lx-cloud.top 站点配置 |
| `DEPLOYMENT.md` | 部署文档（DNS、PAT、SSH、验证清单） |

---

### Task 1: 项目骨架与初始数据

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `content/projects.json`
- Test: `test/projects.test.mjs`

**Interfaces:**
- Produces: `content/projects.json`（2 个初始项目，字段 `id`/`title`/`url`/`summary`/`tags`）；`package.json` 提供 `npm test` 与 `npm start`。

- [ ] **Step 1: 写数据完整性测试**

创建 `test/projects.test.mjs`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('projects.json 包含初始两个项目且字段完整', async () => {
  const file = new URL('../content/projects.json', import.meta.url);
  const projects = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(projects.length, 2);
  const titles = projects.map(project => project.title);
  assert.deepEqual(titles.sort(), ['financial-analysis', 'points-discount']);
  for (const project of projects) {
    assert.ok(project.id, '缺少 id');
    assert.ok(project.url, '缺少 url');
    assert.ok(project.summary, '缺少 summary');
    assert.match(project.url, /^https?:\/\//);
    assert.ok(Array.isArray(project.tags));
    assert.ok(project.tags.length > 0);
  }
});
```

- [ ] **Step 2: 运行测试确认失败**

运行：`node --test test/`

预期：FAIL，报 `ENOENT`（`content/projects.json` 不存在）。

- [ ] **Step 3: 创建骨架文件与初始数据**

创建 `package.json`：

```json
{
  "name": "lxtoxyf-site",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node server.mjs",
    "test": "node --test test/"
  },
  "engines": {
    "node": ">=18"
  }
}
```

创建 `.gitignore`：

```text
node_modules/
.env
secrets/
*.log
.DS_Store
```

创建 `content/projects.json`：

```json
[
  {
    "id": "financial-analysis",
    "title": "financial-analysis",
    "url": "https://github.com/shu1371/financial-analysis",
    "summary": "A股金融数据分析与可视化平台，支持K线/趋势图、技术指标、双数据源回退、用户体系与游戏中心",
    "tags": ["Python", "Streamlit", "MySQL", "Plotly"]
  },
  {
    "id": "points-discount",
    "title": "points-discount",
    "url": "https://github.com/shu1371/points-discount",
    "summary": "积分优惠管理系统（C 控制台），用户/商家/管理员三角色与青铜到钻石会员等级",
    "tags": ["C"]
  }
]
```

- [ ] **Step 4: 运行测试确认通过**

运行：`node --test test/`

预期：`# pass 1`，无失败。

- [ ] **Step 5: 提交**

```bash
git add package.json .gitignore content/projects.json test/projects.test.mjs
git commit -m "chore: project skeleton and initial project data"
```

---

### Task 2: 后端服务（app.mjs + server.mjs + 全部 API 测试）

**Files:**
- Create: `app.mjs`
- Create: `server.mjs`
- Test: `test/api.test.mjs`

**Interfaces:**
- `createApp(options)`：返回未监听的 `http.Server`。`options.siteRoot`（静态目录，默认 `process.env.SITE_ROOT` 或 cwd）、`options.contentRoot`（内容目录，默认 `join(siteRoot, 'content')`）、`options.env`（环境变量对象，默认 `process.env`）。
- `server.mjs`：`createApp()` 后监听 `process.env.PORT || 3000`。
- 路由表：`GET /api/projects`、`GET /api/admin/session`、`POST /api/admin/login`、`GET /api/admin/state`、`POST /api/admin/projects`、`PUT /api/admin/projects/:id`、`DELETE /api/admin/projects/:id`、`PUT /api/admin/projects/order`、静态文件服务。

- [ ] **Step 1: 写全部 API 测试**

创建 `test/api.test.mjs`：

```js
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
```

- [ ] **Step 2: 运行测试确认失败**

运行：`node --test test/api.test.mjs`

预期：FAIL，报 `Cannot find module '../app.mjs'`（或类似导入错误）。

- [ ] **Step 3: 实现 app.mjs 与 server.mjs**

创建 `app.mjs`：

```js
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, relative } from 'node:path';

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};
const noStore = {
  'cache-control': 'no-store, no-cache, must-revalidate, private',
  pragma: 'no-cache',
  expires: '0'
};

export function createApp(options = {}) {
  const env = options.env || process.env;
  const site = normalize(options.siteRoot || env.SITE_ROOT || process.cwd());
  const content = normalize(options.contentRoot || join(site, 'content'));
  const projectFile = join(content, 'projects.json');
  const token = env.GITHUB_TOKEN;
  const adminPassword = env.ADMIN_PASSWORD;
  const sessionSecret = env.SESSION_SECRET;
  const repo = env.GITHUB_REPOSITORY || 'shu1371/blog';
  const branch = env.GITHUB_BRANCH || 'main';

  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...noStore });
    res.end(JSON.stringify(body));
  };

  const badRequest = message => {
    const error = new Error(message);
    error.status = 400;
    return error;
  };

  const readJson = request => new Promise((resolve, reject) => {
    let raw = '';
    request.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1_000_000) request.destroy();
    });
    request.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); }
      catch { reject(badRequest('JSON 格式无效')); }
    });
  });

  const readLogin = request => new Promise((resolve, reject) => {
    let raw = '';
    request.on('data', chunk => {
      raw += chunk;
      if (raw.length > 20_000) request.destroy();
    });
    request.on('end', () => {
      try {
        if (String(request.headers['content-type'] || '').includes('application/json')) {
          return resolve(JSON.parse(raw || '{}'));
        }
        return resolve({ password: new URLSearchParams(raw).get('password') || '' });
      } catch { reject(badRequest('登录数据无效')); }
    });
  });

  const cookies = request => Object.fromEntries(
    (request.headers.cookie || '').split(';')
      .map(value => value.trim().split('=').map(decodeURIComponent))
      .filter(value => value.length === 2)
  );

  const sign = value => createHmac('sha256', sessionSecret || 'missing').update(value).digest('hex');

  const authed = request => {
    const value = cookies(request).admin_session;
    if (!value || !sessionSecret) return false;
    const [payload, signature] = value.split('.');
    const expected = Buffer.from(sign(payload || ''));
    const supplied = Buffer.from(signature || '');
    return Boolean(
      payload && signature &&
      supplied.length === expected.length &&
      timingSafeEqual(expected, supplied) &&
      Number(payload) > Date.now()
    );
  };

  const text = (value, limit) => String(value || '').trim().replace(/[\r\n]+/g, ' ').slice(0, limit);

  const tagList = value => (Array.isArray(value) ? value : String(value || '').split(','))
    .map(tag => text(tag, 24).replace(/,/g, ' '))
    .filter(Boolean)
    .slice(0, 8);

  const readProjects = async () => {
    const raw = JSON.parse(await readFile(projectFile, 'utf8'));
    return raw.map((project, index) => ({ ...project, id: project.id || `legacy-project-${index + 1}` }));
  };

  const cleanProject = (input, previous = {}) => {
    const title = text(input.title, 100);
    const url = String(input.url || '').trim().slice(0, 600);
    const summary = text(input.summary, 360);
    if (!title || !url || !summary) throw badRequest('请填写项目标题、链接和简介');
    if (!/^https?:\/\//i.test(url)) throw badRequest('项目链接必须以 http:// 或 https:// 开头');
    return { ...previous, title, url, summary, tags: tagList(input.tags) };
  };

  async function github(path, data, message, method = 'PUT') {
    if (!token) return { synced: false };
    const url = `https://api.github.com/repos/${repo}/contents/${path}`;
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    const current = await fetch(`${url}?ref=${branch}`, { headers });
    if (current.status === 401) throw new Error('GitHub 授权已失效，请更新服务器的 GITHUB_TOKEN');
    if (current.status === 403) throw new Error('GitHub 令牌没有内容写入权限，请授予 Contents 读写权限');
    if (method === 'DELETE' && current.status === 404) return { synced: true };
    if (method === 'PUT' && current.status === 404) {
      const response = await fetch(url, {
        method,
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ message, content: Buffer.from(data).toString('base64'), branch })
      });
      if (response.status === 401) throw new Error('GitHub 授权已失效，请更新服务器的 GITHUB_TOKEN');
      if (response.status === 403) throw new Error('GitHub 令牌没有内容写入权限，请授予 Contents 读写权限');
      if (!response.ok) throw new Error('GitHub 保存失败');
      return { synced: true };
    }
    if (!current.ok) throw new Error('无法读取 GitHub 文件，请检查仓库名称和分支设置');
    const sha = (await current.json()).sha;
    const body = method === 'DELETE'
      ? { message, sha, branch }
      : { message, content: Buffer.from(data).toString('base64'), branch, sha };
    const response = await fetch(url, {
      method,
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (response.status === 401) throw new Error('GitHub 授权已失效，请更新服务器的 GITHUB_TOKEN');
    if (response.status === 403) throw new Error('GitHub 令牌没有内容写入权限，请授予 Contents 读写权限');
    if (!response.ok) throw new Error(method === 'DELETE' ? 'GitHub 删除失败' : 'GitHub 保存失败');
    return { synced: true };
  }

  const saveProjects = async (projects, message) => {
    const raw = JSON.stringify(projects, null, 2) + '\n';
    const result = await github('content/projects.json', raw, message);
    await mkdir(content, { recursive: true });
    await writeFile(projectFile, raw);
    return result;
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    try {
      if (request.method === 'GET' && url.pathname === '/api/projects') {
        return json(response, 200, await readProjects());
      }
      if (request.method === 'POST' && url.pathname === '/api/admin/login') {
        const { password } = await readLogin(request);
        const supplied = Buffer.from(password || '');
        const expected = Buffer.from(adminPassword || '');
        const formLogin = !String(request.headers['content-type'] || '').includes('application/json');
        if (!adminPassword || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
          if (formLogin) {
            response.writeHead(303, { location: '/admin.html?error=password', ...noStore });
            return response.end();
          }
          return json(response, 401, { error: '密码错误' });
        }
        const payload = String(Date.now() + 12 * 3600_000);
        const secure = request.headers['x-forwarded-proto'] === 'https' || env.NODE_ENV === 'production';
        const cookie = `admin_session=${payload}.${sign(payload)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure ? '; Secure' : ''}`;
        if (formLogin) {
          response.writeHead(303, { location: '/dashboard.html', 'set-cookie': cookie, ...noStore });
          return response.end();
        }
        response.setHeader('Set-Cookie', cookie);
        return json(response, 200, { ok: true });
      }
      if (request.method === 'GET' && url.pathname === '/api/admin/session') {
        return json(response, 200, { authenticated: authed(request) });
      }
      if (url.pathname.startsWith('/api/admin/')) {
        if (!authed(request)) return json(response, 401, { error: '请先登录' });
        if (request.method === 'GET' && url.pathname === '/api/admin/state') {
          return json(response, 200, { projects: await readProjects() });
        }
        if (request.method === 'POST' && url.pathname === '/api/admin/projects') {
          const projects = await readProjects();
          const project = { id: randomUUID(), ...cleanProject(await readJson(request)) };
          projects.unshift(project);
          await saveProjects(projects, `content: add project ${project.id}`);
          return json(response, 201, project);
        }
        if (request.method === 'PUT' && url.pathname === '/api/admin/projects/order') {
          const { ids } = await readJson(request);
          const projects = await readProjects();
          if (!Array.isArray(ids) || ids.length !== projects.length || new Set(ids).size !== projects.length) {
            return json(response, 400, { error: '项目排序数据不完整' });
          }
          const byId = new Map(projects.map(project => [project.id, project]));
          if (ids.some(id => !byId.has(id))) return json(response, 400, { error: '项目排序包含未知项目' });
          const ordered = ids.map(id => byId.get(id));
          await saveProjects(ordered, 'content: reorder projects');
          return json(response, 200, { projects: ordered });
        }
        const projectMatch = url.pathname.match(/^\/api\/admin\/projects\/([\w-]+)$/);
        if (projectMatch && request.method === 'PUT') {
          const projects = await readProjects();
          const index = projects.findIndex(project => project.id === projectMatch[1]);
          if (index < 0) return json(response, 404, { error: '项目不存在' });
          projects[index] = cleanProject(await readJson(request), projects[index]);
          await saveProjects(projects, `content: update project ${projects[index].id}`);
          return json(response, 200, projects[index]);
        }
        if (projectMatch && request.method === 'DELETE') {
          const projects = await readProjects();
          const project = projects.find(item => item.id === projectMatch[1]);
          if (!project) return json(response, 404, { error: '项目不存在' });
          await saveProjects(projects.filter(item => item.id !== project.id), `content: remove project ${project.id}`);
          return json(response, 200, { deleted: true });
        }
      }
      if (request.method === 'GET' && url.pathname === '/dashboard.html' && !authed(request)) {
        response.writeHead(303, { location: '/admin.html', ...noStore });
        return response.end();
      }
      const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const path = normalize(join(site, requested));
      if (relative(site, path).startsWith('..')) throw new Error('not found');
      const data = await readFile(path);
      const filename = url.pathname.split('/').pop();
      const adminFile = ['admin.html', 'dashboard.html', 'admin.js', 'admin.css'].includes(filename);
      response.writeHead(200, {
        'content-type': mime[extname(path)] || 'application/octet-stream',
        ...(adminFile ? noStore : {})
      });
      return response.end(data);
    } catch (error) {
      const status = error.status || (error.message === 'not found' ? 404 : 500);
      return json(response, status, { error: error.message || '服务错误' });
    }
  });

  return server;
}
```

创建 `server.mjs`：

```js
import { createApp } from './app.mjs';

const port = Number(process.env.PORT || 3000);
const server = createApp();
server.listen(port, () => console.log(`lxtoxyf site listening on :${port}`));
```

- [ ] **Step 4: 运行测试确认通过**

运行：`node --test test/api.test.mjs`

预期：`# pass 12`，无失败。

- [ ] **Step 5: 本地冒烟验证**

```powershell
$env:ADMIN_PASSWORD='test-pass'; $env:SESSION_SECRET='test-secret'
node server.mjs
```

另开终端：

```powershell
curl.exe -s http://127.0.0.1:3000/api/projects
```

预期：返回包含 `financial-analysis` 与 `points-discount` 的 JSON 数组。

- [ ] **Step 6: 提交**

```bash
git add app.mjs server.mjs test/api.test.mjs
git commit -m "feat: backend server with projects API, auth and admin CRUD"
```

---

### Task 3: 前台页面

**Files:**
- Create: `index.html`
- Create: `projects.html`
- Create: `content.js`
- Create: `assets/site.css`
- Test: `test/static.test.mjs`

**Interfaces:**
- Consumes: `GET /api/projects`（返回 `[{ id, title, url, summary, tags }]`）。
- Produces: 页面根元素 `[data-projects]`；`content.js` 挂到 `window` 前自动执行加载。

- [ ] **Step 1: 写静态页面测试**

创建 `test/static.test.mjs`：

```js
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
```

- [ ] **Step 2: 运行测试确认失败**

运行：`node --test test/static.test.mjs`

预期：FAIL（首页、项目页、样式与脚本 3 个测试因文件不存在返回 404 而失败；未登录跳转测试已通过）。

- [ ] **Step 3: 实现前台页面**

创建 `index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="lxtoxyf 的个人网站：项目作品与联系方式。" />
    <title>lxtoxyf · 个人网站</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;600;700;800&family=Noto+Sans+SC:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="assets/site.css" />
  </head>
  <body>
    <div class="grain" aria-hidden="true"></div>
    <header class="site-header wrap">
      <a class="brand" href="index.html" aria-label="lxtoxyf 主页"><span class="brand-mark">LX</span><span>lxtoxyf 的空间</span></a>
      <nav class="site-nav" aria-label="主导航">
        <a href="index.html" aria-current="page">首页</a>
        <a href="projects.html">项目</a>
        <a href="#contact">联系方式</a>
      </nav>
      <a class="header-link" href="https://github.com/shu1371" target="_blank" rel="noopener noreferrer">GitHub <span>↗</span></a>
    </header>
    <main id="top">
      <section class="page-hero wrap">
        <div>
          <p class="eyebrow">PERSONAL SITE</p>
          <h1>你好，我是<br /><strong>lxtoxyf</strong><i>!</i></h1>
          <p class="lede">持续学习，持续构建。用代码把想法变成可以运行的作品。</p>
          <div class="actions">
            <a class="button button-primary" href="projects.html">查看我的项目 <span>→</span></a>
            <a class="button button-quiet" href="#contact">联系我 <span>→</span></a>
          </div>
        </div>
        <div class="hero-art" aria-label="代码创作主题插画">
          <span class="hero-sticker">BUILD<br />SAFELY</span>
          <span class="hero-spark">✦</span>
          <span class="hero-badge">♥</span>
          <div class="code-window"><small>lxtoxyf@site:~$</small><b>&lt; build /&gt;</b><i>learn · build · share</i></div>
        </div>
      </section>
      <section class="ribbon" aria-label="技能关键词">
        <div class="ribbon-inner">
          <span>PYTHON</span><b>✦</b><span>STREAMLIT</span><b>✦</b><span>MYSQL</span><b>✦</b><span>PLOTLY</span><b>✦</b><span>C</span><b>✦</b><span>GITHUB</span><b>✦</b>
        </div>
      </section>
      <section class="section wrap">
        <div class="section-head">
          <div><p class="eyebrow">PROJECTS</p><h2>我的项目作品</h2></div>
          <a class="button button-primary" href="projects.html">全部项目 <span>→</span></a>
        </div>
        <div class="grid" data-projects></div>
      </section>
      <section id="contact" class="section section-alt">
        <div class="wrap">
          <div class="section-head"><div><p class="eyebrow">CONTACT</p><h2>保持联系</h2></div></div>
          <div class="contact-grid">
            <a class="contact-card" href="mailto:lxtoxyf@163.com">
              <span class="contact-icon">✉</span>
              <h3>邮箱</h3>
              <p>lxtoxyf@163.com</p>
            </a>
            <a class="contact-card" href="https://github.com/shu1371" target="_blank" rel="noopener noreferrer">
              <span class="contact-icon">⌥</span>
              <h3>GitHub</h3>
              <p>github.com/shu1371</p>
            </a>
          </div>
        </div>
      </section>
    </main>
    <footer class="site-footer wrap">
      <div>
        <p class="footer-title">持续学习，<br /><strong>持续构建。</strong></p>
        <a class="footer-link" href="https://github.com/shu1371" target="_blank" rel="noopener noreferrer">GitHub ↗</a>
      </div>
      <div class="footer-side">
        <a href="mailto:lxtoxyf@163.com">lxtoxyf@163.com</a>
        <a href="#top">回到顶部 ↑</a>
        <small>© 2026 LXTXYF</small>
      </div>
    </footer>
    <script src="content.js"></script>
  </body>
</html>
```

创建 `projects.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="lxtoxyf 的项目作品列表。" />
    <title>项目 · lxtoxyf</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;600;700;800&family=Noto+Sans+SC:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="assets/site.css" />
  </head>
  <body>
    <div class="grain" aria-hidden="true"></div>
    <header class="site-header wrap">
      <a class="brand" href="index.html" aria-label="lxtoxyf 主页"><span class="brand-mark">LX</span><span>lxtoxyf 的空间</span></a>
      <nav class="site-nav" aria-label="主导航">
        <a href="index.html">首页</a>
        <a href="projects.html" aria-current="page">项目</a>
        <a href="index.html#contact">联系方式</a>
      </nav>
      <a class="header-link" href="https://github.com/shu1371" target="_blank" rel="noopener noreferrer">GitHub <span>↗</span></a>
    </header>
    <main id="top">
      <section class="page-intro wrap">
        <p class="eyebrow">PROJECTS</p>
        <h1>项目作品</h1>
        <p>这里记录我做过并公开分享的项目。</p>
      </section>
      <section class="section wrap">
        <div class="grid" data-projects></div>
      </section>
    </main>
    <footer class="site-footer wrap">
      <div>
        <p class="footer-title">持续学习，<br /><strong>持续构建。</strong></p>
        <a class="footer-link" href="https://github.com/shu1371" target="_blank" rel="noopener noreferrer">GitHub ↗</a>
      </div>
      <div class="footer-side">
        <a href="mailto:lxtoxyf@163.com">lxtoxyf@163.com</a>
        <a href="index.html">回到首页 ↑</a>
        <small>© 2026 LXTXYF</small>
      </div>
    </footer>
    <script src="content.js"></script>
  </body>
</html>
```

创建 `content.js`：

```js
const escape = value => String(value || '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
const tags = items => (items || []).map(tag => `<li>${escape(tag)}</li>`).join('');

async function loadProjects() {
  const target = document.querySelector('[data-projects]');
  if (!target) return;
  const response = await fetch('/api/projects');
  if (!response.ok) throw new Error('加载失败');
  const projects = await response.json();
  target.innerHTML = projects.map(project => `<article class="feature"><div class="feature-art"><span>↗</span></div><div class="feature-copy"><p class="eyebrow">PROJECT</p><h3>${escape(project.title)}</h3><p>${escape(project.summary)}</p><ul class="tags">${tags(project.tags)}</ul><a class="button button-primary" href="${escape(project.url)}" target="_blank" rel="noopener noreferrer">查看项目仓库 <span>↗</span></a></div></article>`).join('') || '<p>暂时还没有公开项目。</p>';
}

loadProjects().catch(() => {
  const target = document.querySelector('[data-projects]');
  if (target) target.innerHTML = '<p>内容加载失败，请稍后重试。</p>';
});
```

创建 `assets/site.css`：

```css
:root {
  --ink: #2b2118;
  --paper: #fdf6e9;
  --card: #ffffff;
  --accent: #f59e0b;
  --accent-2: #ef6c57;
  --green: #2f9e6e;
  --line: rgba(43, 33, 24, 0.12);
  --shadow: 0 10px 30px rgba(43, 33, 24, 0.08);
  --radius: 20px;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  font-family: 'Noto Sans SC', sans-serif;
  color: var(--ink);
  background: var(--paper);
  line-height: 1.7;
}
a { color: inherit; text-decoration: none; }
img { max-width: 100%; }
.wrap { max-width: 1080px; margin: 0 auto; padding: 0 24px; }
.grain {
  position: fixed; inset: 0; pointer-events: none; opacity: 0.05; z-index: 0;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='0.6'/%3E%3C/svg%3E");
}
.site-header {
  position: relative; z-index: 1;
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding-top: 24px; padding-bottom: 24px;
}
.brand { display: flex; align-items: center; gap: 10px; font-family: 'Baloo 2', cursive; font-weight: 700; font-size: 18px; }
.brand-mark {
  display: inline-grid; place-items: center; width: 38px; height: 38px;
  background: var(--ink); color: var(--paper); border-radius: 12px; font-size: 14px;
}
.site-nav { display: flex; gap: 22px; font-weight: 500; }
.site-nav a { padding: 6px 2px; border-bottom: 2px solid transparent; }
.site-nav a[aria-current="page"] { border-bottom-color: var(--accent); }
.header-link {
  display: inline-flex; align-items: center; gap: 4px;
  background: var(--ink); color: var(--paper); padding: 9px 16px; border-radius: 999px;
  font-size: 14px; font-weight: 600;
}
.page-hero {
  position: relative; z-index: 1;
  display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 48px; align-items: center;
  padding-top: 56px; padding-bottom: 64px;
}
.eyebrow {
  margin: 0 0 10px; font-family: 'Baloo 2', cursive; font-size: 13px; letter-spacing: 2px;
  color: var(--accent-2); font-weight: 700;
}
.page-hero h1 {
  margin: 0 0 16px; font-family: 'Baloo 2', cursive; font-size: 56px; line-height: 1.15; font-weight: 800;
}
.page-hero h1 strong { color: var(--accent); }
.page-hero h1 i { color: var(--accent-2); font-style: normal; }
.lede { margin: 0 0 28px; font-size: 18px; max-width: 34em; }
.actions { display: flex; gap: 12px; flex-wrap: wrap; }
.button {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 12px 22px; border-radius: 999px; font-weight: 700; font-size: 15px;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.button:hover { transform: translateY(-2px); }
.button-primary { background: var(--accent); color: #fff; box-shadow: var(--shadow); }
.button-quiet { background: transparent; border: 2px solid var(--ink); }
.hero-art { position: relative; min-height: 260px; }
.hero-sticker {
  position: absolute; top: 0; left: 8%; transform: rotate(-8deg);
  background: var(--green); color: #fff; font-family: 'Baloo 2', cursive; font-weight: 800;
  padding: 14px 18px; border-radius: 16px; box-shadow: var(--shadow); font-size: 14px; line-height: 1.2;
}
.hero-spark { position: absolute; top: 18px; right: 16%; font-size: 32px; color: var(--accent); transform: rotate(12deg); }
.hero-badge {
  position: absolute; bottom: 18px; left: 4%;
  display: grid; place-items: center; width: 46px; height: 46px;
  background: var(--accent-2); color: #fff; border-radius: 50%; font-size: 20px;
}
.code-window {
  position: absolute; right: 0; bottom: 24px; width: 78%;
  background: #241d15; color: #f6e7c8; border-radius: 16px; padding: 18px 20px;
  box-shadow: var(--shadow); font-family: 'Baloo 2', cursive;
}
.code-window small { display: block; color: #8f8371; margin-bottom: 10px; font-size: 13px; }
.code-window b { display: block; font-size: 22px; color: var(--accent); }
.code-window i { display: block; margin-top: 6px; font-size: 13px; color: var(--green); }
.ribbon {
  position: relative; z-index: 1; overflow: hidden;
  background: var(--ink); color: var(--paper); padding: 14px 0;
}
.ribbon-inner {
  display: flex; gap: 18px; align-items: center; justify-content: center; flex-wrap: wrap;
  font-family: 'Baloo 2', cursive; font-weight: 700; letter-spacing: 1px; font-size: 14px;
}
.ribbon-inner b { color: var(--accent); }
.section { position: relative; z-index: 1; padding-top: 72px; padding-bottom: 72px; }
.section-alt { background: #f6ecd9; }
.section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 36px; }
.section-head h2 { margin: 0; font-family: 'Baloo 2', cursive; font-size: 34px; font-weight: 800; }
.section-head h2 em { color: var(--accent); font-style: normal; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 24px; }
.feature {
  display: flex; flex-direction: column; gap: 18px;
  background: var(--card); border-radius: var(--radius); padding: 24px;
  box-shadow: var(--shadow); border: 1px solid var(--line);
}
.feature-art {
  display: grid; place-items: center; height: 96px; border-radius: 14px;
  background: #f3e7cf; font-size: 30px; color: var(--accent);
}
.feature h3 { margin: 4px 0 8px; font-family: 'Baloo 2', cursive; font-size: 22px; }
.feature p { margin: 0 0 12px; color: #5a4e3e; }
.tags { display: flex; flex-wrap: wrap; gap: 8px; list-style: none; margin: 0 0 16px; padding: 0; }
.tags li {
  background: #f3e7cf; color: #6b4f1d; border-radius: 999px;
  padding: 4px 12px; font-size: 13px; font-weight: 600;
}
.contact-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 24px; }
.contact-card {
  display: block; background: var(--card); border-radius: var(--radius); padding: 28px;
  box-shadow: var(--shadow); border: 1px solid var(--line);
  transition: transform 0.15s ease;
}
.contact-card:hover { transform: translateY(-3px); }
.contact-icon {
  display: grid; place-items: center; width: 48px; height: 48px;
  background: var(--ink); color: var(--paper); border-radius: 14px; font-size: 20px; margin-bottom: 14px;
}
.contact-card h3 { margin: 0 0 4px; font-family: 'Baloo 2', cursive; font-size: 20px; }
.contact-card p { margin: 0; color: #5a4e3e; }
.page-intro { position: relative; z-index: 1; padding-top: 56px; padding-bottom: 16px; }
.page-intro h1 { margin: 0 0 10px; font-family: 'Baloo 2', cursive; font-size: 46px; }
.page-intro p:last-child { margin: 0; color: #5a4e3e; font-size: 17px; }
.site-footer {
  position: relative; z-index: 1;
  display: flex; justify-content: space-between; align-items: flex-end; gap: 24px;
  padding-top: 48px; padding-bottom: 40px;
}
.footer-title { margin: 0 0 10px; font-family: 'Baloo 2', cursive; font-size: 26px; line-height: 1.3; }
.footer-title strong { color: var(--accent); }
.footer-link { color: var(--accent-2); font-weight: 700; }
.footer-side { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; color: #5a4e3e; font-size: 14px; }
@media (max-width: 760px) {
  .site-header { flex-wrap: wrap; }
  .site-nav { order: 3; width: 100%; justify-content: space-between; gap: 8px; }
  .page-hero { grid-template-columns: 1fr; padding-top: 36px; }
  .hero-art { min-height: 220px; }
  .page-hero h1 { font-size: 40px; }
  .section-head { flex-direction: column; align-items: flex-start; }
  .site-footer { flex-direction: column; align-items: flex-start; }
  .footer-side { align-items: flex-start; }
}
```

- [ ] **Step 4: 运行测试确认通过**

运行：`node --test test/`

预期：`# pass 17`（projects 1 + api 12 + static 4），无失败。

- [ ] **Step 5: 浏览器目视检查**

```powershell
$env:ADMIN_PASSWORD='test-pass'; $env:SESSION_SECRET='test-secret'
node server.mjs
```

浏览器打开 `http://127.0.0.1:3000`，确认：首页 hero、项目卡片（2 个项目）、联系方式两卡片、页脚渲染正常，导航可跳转。

- [ ] **Step 6: 提交**

```bash
git add index.html projects.html content.js assets/site.css test/static.test.mjs
git commit -m "feat: public pages with project cards and contact section"
```

---

### Task 4: 后台管理页面

**Files:**
- Create: `admin.html`
- Create: `dashboard.html`
- Create: `admin.js`
- Create: `admin.css`

**Interfaces:**
- Consumes: `POST /api/admin/login`（表单提交，成功 303 → `/dashboard.html`，失败 303 → `/admin.html?error=password`）、`GET /api/admin/state`、`POST /api/admin/projects`、`PUT /api/admin/projects/:id`、`DELETE /api/admin/projects/:id`、`PUT /api/admin/projects/order`。
- Produces: `admin.js` 使用 DOM id：`project-count`、`project-cards`、`project-form`、`project-form-mode`、`project-title`、`project-url`、`project-summary`、`project-tags`、`save-project`、`new-project`、`delete-project`、`status`。

- [ ] **Step 1: 实现登录页**

创建 `admin.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>后台登录 · lxtoxyf</title>
    <link rel="stylesheet" href="admin.css" />
  </head>
  <body>
    <main class="login-page">
      <form class="login-card" action="/api/admin/login" method="post">
        <span class="login-mark">LX</span>
        <h1>后台登录</h1>
        <input type="password" name="password" placeholder="管理员密码" autofocus required />
        <button type="submit" class="login-button">登 录</button>
        <p id="login-error" class="login-error" hidden>密码错误，请重试。</p>
      </form>
    </main>
    <script>
      if (new URLSearchParams(location.search).get('error') === 'password') {
        document.getElementById('login-error').hidden = false;
      }
    </script>
  </body>
</html>
```

- [ ] **Step 2: 实现管理面板**

创建 `dashboard.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>内容管理 · lxtoxyf</title>
    <link rel="stylesheet" href="admin.css" />
  </head>
  <body>
    <header class="admin-header">
      <span class="admin-brand">LXTXYF · 内容管理</span>
      <a href="index.html">返回网站</a>
    </header>
    <main class="admin-main">
      <section class="admin-col">
        <div class="panel-head"><h1>项目</h1><span id="project-count"></span></div>
        <div id="project-cards" class="item-list"></div>
      </section>
      <section class="admin-col">
        <form id="project-form" class="panel-form">
          <h2 id="project-form-mode">新建项目</h2>
          <label>标题
            <input id="project-title" maxlength="100" required placeholder="项目名称" />
          </label>
          <label>链接
            <input id="project-url" maxlength="600" required placeholder="https://github.com/..." />
          </label>
          <label>简介
            <textarea id="project-summary" maxlength="360" rows="3" required placeholder="一句话介绍"></textarea>
          </label>
          <label>标签（逗号分隔，最多 8 个）
            <input id="project-tags" maxlength="200" placeholder="Python, MySQL" />
          </label>
          <div class="form-actions">
            <button type="submit" id="save-project" class="primary">保存</button>
            <button type="button" id="new-project" class="quiet">新建</button>
            <button type="button" id="delete-project" class="danger" hidden>删除</button>
          </div>
        </form>
        <p id="status" class="toast" role="status"></p>
      </section>
    </main>
    <script src="admin.js"></script>
  </body>
</html>
```

- [ ] **Step 3: 实现后台逻辑**

创建 `admin.js`：

```js
const $ = id => document.getElementById(id);
const request = (url, options = {}) => fetch(url, {
  credentials: 'same-origin',
  cache: 'no-store',
  headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  ...options
}).then(async response => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error || '请求失败');
  return data;
});
const escape = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const tags = items => (items || []).map(tag => `<span>${escape(tag)}</span>`).join('');
const state = { projects: [], projectId: '' };

function notify(message, type = 'success') {
  const toast = $('status');
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { toast.className = 'toast'; }, 4200);
}

function setBusy(button, busy) {
  button.disabled = busy;
  button.dataset.label ||= button.innerHTML;
  if (busy) button.textContent = '正在保存…';
  else button.innerHTML = button.dataset.label;
}

function renderProjects() {
  $('project-count').textContent = `${state.projects.length} 个项目`;
  $('project-cards').innerHTML = state.projects.map((project, index) => `<div class="card-stack"><button class="item-card ${project.id === state.projectId ? 'selected' : ''}" type="button" data-project-id="${escape(project.id)}"><span class="card-symbol">↗</span><span class="card-copy"><strong>${escape(project.title)}</strong><small>${escape(project.summary)}</small><span class="tag-row">${tags(project.tags)}</span></span></button><div class="order-controls"><span>前台第 ${index + 1} 位</span><button type="button" data-project-move="${escape(project.id)}" data-direction="-1" ${index === 0 ? 'disabled' : ''} aria-label="项目上移">↑</button><button type="button" data-project-move="${escape(project.id)}" data-direction="1" ${index === state.projects.length - 1 ? 'disabled' : ''} aria-label="项目下移">↓</button></div></div>`).join('') || '<p class="empty-state">还没有项目。点击“新建项目”创建第一张卡片。</p>';
  document.querySelectorAll('[data-project-id]').forEach(card => card.addEventListener('click', () => selectProject(card.dataset.projectId)));
  document.querySelectorAll('[data-project-move]').forEach(button => button.addEventListener('click', () => moveProject(button.dataset.projectMove, Number(button.dataset.direction))));
}

function newProject() {
  state.projectId = '';
  $('project-form').reset();
  $('project-form-mode').textContent = '新建项目';
  $('delete-project').hidden = true;
  renderProjects();
}

function selectProject(id) {
  const project = state.projects.find(item => item.id === id);
  if (!project) return newProject();
  state.projectId = project.id;
  $('project-title').value = project.title || '';
  $('project-url').value = project.url || '';
  $('project-summary').value = project.summary || '';
  $('project-tags').value = (project.tags || []).join(', ');
  $('project-form-mode').textContent = '编辑项目';
  $('delete-project').hidden = false;
  renderProjects();
}

async function moveProject(id, direction) {
  const index = state.projects.findIndex(project => project.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= state.projects.length) return;
  const ids = state.projects.map(project => project.id);
  [ids[index], ids[target]] = [ids[target], ids[index]];
  try {
    const result = await request('/api/admin/projects/order', { method: 'PUT', body: JSON.stringify({ ids }) });
    state.projects = result.projects;
    renderProjects();
    notify('排序已保存');
  } catch (error) {
    notify(error.message, 'error');
  }
}

async function saveProject(event) {
  event.preventDefault();
  const payload = {
    title: $('project-title').value,
    url: $('project-url').value,
    summary: $('project-summary').value,
    tags: $('project-tags').value
  };
  const button = $('save-project');
  setBusy(button, true);
  try {
    if (state.projectId) {
      await request(`/api/admin/projects/${encodeURIComponent(state.projectId)}`, { method: 'PUT', body: JSON.stringify(payload) });
      notify('项目已更新');
    } else {
      await request('/api/admin/projects', { method: 'POST', body: JSON.stringify(payload) });
      notify('项目已创建');
    }
    await loadState();
    newProject();
  } catch (error) {
    notify(error.message, 'error');
  } finally {
    setBusy(button, false);
  }
}

async function removeProject() {
  if (!state.projectId) return;
  if (!window.confirm('确定删除这个项目吗？')) return;
  try {
    await request(`/api/admin/projects/${encodeURIComponent(state.projectId)}`, { method: 'DELETE' });
    notify('项目已删除');
    await loadState();
    newProject();
  } catch (error) {
    notify(error.message, 'error');
  }
}

async function loadState() {
  const data = await request('/api/admin/state');
  state.projects = data.projects;
  renderProjects();
}

$('project-form').addEventListener('submit', saveProject);
$('new-project').addEventListener('click', newProject);
$('delete-project').addEventListener('click', removeProject);
loadState().catch(error => {
  $('project-cards').innerHTML = `<p class="empty-state">${escape(error.message)}</p>`;
});
```

- [ ] **Step 4: 实现后台样式**

创建 `admin.css`：

```css
:root {
  --ink: #2b2118;
  --paper: #fdf6e9;
  --card: #ffffff;
  --accent: #f59e0b;
  --danger: #d64545;
  --line: rgba(43, 33, 24, 0.12);
  --shadow: 0 10px 30px rgba(43, 33, 24, 0.08);
}
* { box-sizing: border-box; }
body {
  margin: 0; font-family: 'Noto Sans SC', 'Microsoft YaHei', sans-serif;
  color: var(--ink); background: var(--paper); line-height: 1.6;
}
a { color: inherit; text-decoration: none; }
button { font: inherit; cursor: pointer; }
.login-page { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
.login-card {
  width: 100%; max-width: 360px; background: var(--card); border-radius: 20px;
  box-shadow: var(--shadow); border: 1px solid var(--line); padding: 36px 32px;
  display: flex; flex-direction: column; gap: 16px;
}
.login-mark {
  display: grid; place-items: center; width: 48px; height: 48px;
  background: var(--ink); color: var(--paper); border-radius: 14px;
  font-weight: 800; font-size: 16px;
}
.login-card h1 { margin: 0; font-size: 24px; }
.login-card input {
  border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px;
  font-size: 15px; width: 100%;
}
.login-button {
  background: var(--accent); color: #fff; border: 0; border-radius: 999px;
  padding: 12px; font-weight: 700; font-size: 15px;
}
.login-error { margin: 0; color: var(--danger); font-size: 14px; }
.admin-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 28px; background: var(--ink); color: var(--paper);
}
.admin-brand { font-weight: 800; letter-spacing: 1px; }
.admin-header a { font-size: 14px; opacity: 0.85; }
.admin-main {
  display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 28px;
  max-width: 1100px; margin: 0 auto; padding: 32px 24px 60px;
}
.panel-head { display: flex; align-items: baseline; justify-content: space-between; }
.panel-head h1 { margin: 0 0 16px; font-size: 26px; }
.panel-head span { color: #6b6b6b; font-size: 14px; }
.item-list { display: flex; flex-direction: column; gap: 14px; }
.card-stack { display: flex; flex-direction: column; gap: 6px; }
.item-card {
  display: flex; gap: 14px; text-align: left; width: 100%;
  background: var(--card); border: 2px solid transparent; border-radius: 16px;
  box-shadow: var(--shadow); padding: 16px;
}
.item-card.selected { border-color: var(--accent); }
.card-symbol { font-size: 20px; color: var(--accent); }
.card-copy { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.card-copy strong { font-size: 16px; }
.card-copy small { color: #6b6b6b; }
.tag-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.tag-row span {
  background: #f3e7cf; color: #6b4f1d; border-radius: 999px;
  padding: 2px 10px; font-size: 12px;
}
.order-controls {
  display: flex; align-items: center; gap: 8px; padding-left: 4px;
  font-size: 13px; color: #6b6b6b;
}
.order-controls button {
  width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--line);
  background: #fff; font-size: 14px;
}
.order-controls button:disabled { opacity: 0.4; cursor: default; }
.empty-state { color: #6b6b6b; }
.panel-form {
  background: var(--card); border-radius: 20px; box-shadow: var(--shadow);
  border: 1px solid var(--line); padding: 26px;
  display: flex; flex-direction: column; gap: 14px;
}
.panel-form h2 { margin: 0 0 6px; font-size: 20px; }
.panel-form label { display: flex; flex-direction: column; gap: 6px; font-size: 14px; font-weight: 600; }
.panel-form input, .panel-form textarea {
  border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px;
  font-size: 14px; font-family: inherit; width: 100%;
}
.form-actions { display: flex; gap: 10px; margin-top: 6px; }
.form-actions button {
  border: 0; border-radius: 999px; padding: 10px 20px; font-weight: 700; font-size: 14px;
}
.form-actions .primary { background: var(--accent); color: #fff; }
.form-actions .quiet { background: #f0ead9; color: var(--ink); }
.form-actions .danger { background: var(--danger); color: #fff; }
.toast {
  min-height: 20px; margin: 10px 0 0; font-size: 14px; color: var(--ink);
}
.toast.show.error { color: var(--danger); font-weight: 600; }
.toast.show.success { color: #2f9e6e; font-weight: 600; }
@media (max-width: 820px) {
  .admin-main { grid-template-columns: 1fr; }
}
```

- [ ] **Step 5: 运行全部测试确认无回归**

运行：`node --test test/`

预期：`# pass 17`，无失败。

- [ ] **Step 6: 浏览器目视检查后台流程**

```powershell
$env:ADMIN_PASSWORD='test-pass'; $env:SESSION_SECRET='test-secret'
node server.mjs
```

浏览器打开 `http://127.0.0.1:3000/admin.html`：

1. 输入错误密码 → 提示“密码错误”。
2. 输入 `test-pass` → 跳转 dashboard，显示 2 个项目。
3. 新建一个项目 → 保存成功提示、列表 +1。
4. 编辑该项目 → 保存成功提示。
5. 上下移排序 → 提示“排序已保存”。
6. 删除该项目 → 确认后列表 -1。
7. 未登录直接访问 `/dashboard.html` → 跳转登录页。

- [ ] **Step 7: 提交**

```bash
git add admin.html dashboard.html admin.js admin.css
git commit -m "feat: admin login and project management panel"
```

---

### Task 5: 部署产物与文档

**Files:**
- Create: `Dockerfile`
- Create: `deploy/Caddyfile`
- Create: `DEPLOYMENT.md`

**Interfaces:**
- `Dockerfile`：`node:24-alpine`，复制 `package.json`、`server.mjs`、`app.mjs`，监听 3000。
- `deploy/Caddyfile`：`lx-cloud.top` 站点块，`reverse_proxy lxtoxyf-site:3000`（追加到服务器现有 Caddyfile）。
- `DEPLOYMENT.md`：Cloudflare A 记录、GitHub 仓库与 PAT、SSH 部署命令、验证清单。

- [ ] **Step 1: 创建 Dockerfile**

创建 `Dockerfile`：

```dockerfile
FROM node:24-alpine
WORKDIR /app
COPY package.json server.mjs app.mjs /app/
ENV SITE_ROOT=/app/site \
    CONTENT_ROOT=/app/content \
    NODE_ENV=production
CMD ["node", "server.mjs"]
```

- [ ] **Step 2: 创建 Caddy 站点配置**

创建 `deploy/Caddyfile`：

```caddy
lx-cloud.top {
    encode zstd gzip
    reverse_proxy lxtoxyf-site:3000
}
```

- [ ] **Step 3: 创建部署文档**

创建 `DEPLOYMENT.md`：

````markdown
# lxtoxyf 个人网站部署说明

## 1. Cloudflare DNS

在 Cloudflare 的 `lx-cloud.top` 中添加 A 记录：

| 类型 | 名称 | 内容 | 代理 |
| --- | --- | --- | --- |
| A | @ | 144.34.185.9 | 开启（橙云） |

## 2. GitHub 内容仓库与令牌

1. 在 GitHub 新建空仓库 `shu1371/blog`（默认分支 main）。
2. 在 GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens 创建令牌：
   - Repository access：仅 `shu1371/blog`
   - Permissions → Contents：Read and write
3. 复制令牌，保存到服务器 secrets 文件（见第 4 步）。

## 3. 上传代码

```bash
cd lxtoxyf-site
git branch -M main
git remote add origin git@github.com:shu1371/blog.git
git push -u origin main
```

## 4. 服务器部署

```bash
ssh root@144.34.185.9
mkdir -p /opt/lx-cloud.top/{app,site,content,secrets}
cd /opt/lx-cloud.top/app
git clone https://github.com/shu1371/blog.git .
```

同步静态文件与内容（开发机推送后服务器拉取）：

```bash
cd /opt/lx-cloud.top/app && git pull
rsync -a --exclude .git /opt/lx-cloud.top/app/ /opt/lx-cloud.top/site/
```

创建 secrets 文件：

```bash
cat > /opt/lx-cloud.top/secrets/site.env <<'EOF'
ADMIN_PASSWORD=请设置一个强密码
GITHUB_TOKEN=上一步创建的令牌
SESSION_SECRET=请设置一段随机字符串
EOF
chmod 600 /opt/lx-cloud.top/secrets/site.env
```

构建并启动：

```bash
docker build -t lxtoxyf-site:latest /opt/lx-cloud.top/app
docker run -d \
  --name lxtoxyf-site \
  --restart unless-stopped \
  --env-file /opt/lx-cloud.top/secrets/site.env \
  -v /opt/lx-cloud.top/site:/app/site:ro \
  -v /opt/lx-cloud.top/content:/app/content:rw \
  --network proxy \
  lxtoxyf-site:latest
```

## 5. Caddy 接入

在服务器现有 Caddyfile 末尾追加：

```caddy
lx-cloud.top {
    encode zstd gzip
    reverse_proxy lxtoxyf-site:3000
}
```

验证并热加载：

```bash
docker exec caddy caddy validate --config /etc/caddy/Caddyfile
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

## 6. 验证清单

1. `curl -I https://lx-cloud.top` 返回 200 且证书有效。
2. 首页显示 2 个项目卡片与联系方式。
3. `https://lx-cloud.top/admin.html` 登录成功。
4. 后台新建/编辑/删除/排序后，`https://github.com/shu1371/blog` 出现对应提交。
5. 内容目录纳入服务器备份。
````

- [ ] **Step 4: 本机构建验证（可选）**

先检查 Docker 是否可用：

```powershell
docker version
```

若可用：

```powershell
docker build -t lxtoxyf-site:latest .
```

预期：`Successfully tagged lxtoxyf-site:latest`。

若本机没有 Docker，跳过本步，构建在第 4 步服务器部署时进行。

- [ ] **Step 5: 运行全部测试确认无回归**

运行：`node --test test/`

预期：`# pass 17`，无失败。

- [ ] **Step 6: 提交**

```bash
git add Dockerfile deploy/Caddyfile DEPLOYMENT.md
git commit -m "docs: deployment artifacts and instructions"
```

---

## 收尾检查（全部任务完成后）

1. `node --test test/` 全绿（17 个测试）。
2. `node server.mjs` 本地起服，前台页面与后台流程目视通过。
3. 提交历史包含 5 个任务提交。
4. 将实现结果交给用户，按 `DEPLOYMENT.md` 第 1、2 步请用户完成 Cloudflare 记录与 GitHub 仓库/PAT 创建。

## 自查记录

**规格覆盖：**
- 架构与目录结构 → Task 1/2/3/4/5 文件结构
- API 设计与校验 → Task 2（api.test.mjs 13 项）
- 认证设计 → Task 2（登录/会话/伪造 Cookie 测试）
- GitHub 同步 → Task 2（`github()` 实现；未配置令牌时仅本地）
- 页面与内容 → Task 3（首页/项目页/联系方式/初始 2 项目）
- 后台功能 → Task 4（登录页、面板、CRUD、排序）
- 视觉设计 → Task 3（site.css 插画风）
- 部署方案 → Task 5（Dockerfile、Caddyfile、DEPLOYMENT.md、验证清单）
- 错误处理 → Task 2（校验、404/500、GitHub 401/403 中文提示）
- 验证与测试 → Task 2/3/4/5 每任务测试步骤

**类型与命名一致性：** `createApp(options)` 签名全计划一致；路由、DOM id、项目字段名在 Task 2/3/4 间一致（`title`/`url`/`summary`/`tags`/`id`）。
