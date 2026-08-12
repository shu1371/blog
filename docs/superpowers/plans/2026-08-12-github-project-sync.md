# GitHub 项目自动同步实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 网站每 3 天自动从 GitHub（shu1371）同步项目列表，并在后台提供「从 GitHub 更新项目」一键同步按钮。

**Architecture:** 在 `app.mjs` 中新增 GitHub 同步服务（拉取用户仓库 → 生成条目 → 合并保留 → 保存并提交元数据）、72 小时自动调度（启动检查 + 每 6 小时复查、全局同步锁）与 `POST /api/admin/projects/sync` 接口；后台 dashboard 增加同步按钮与上次同步时间展示。

**Tech Stack:** Node.js 内置模块、原生 HTML/CSS/JS、GitHub REST API、node:test。

## Global Constraints

- 同步周期：72 小时（`SYNC_THRESHOLD_MS = 72 * 3600_000`），检查间隔 6 小时（`SYNC_INTERVAL_MS = 6 * 3600_000`）。
- 数据源：`GET https://api.github.com/users/shu1371/repos?per_page=100&sort=updated`；配置 `GITHUB_TOKEN` 时附加 `Authorization: Bearer`。
- 合并策略：只增不删；非 GitHub 手动条目保留；已存在 GitHub 条目保留手动简介/标签，缺失才填充；新仓库插入列表头部。
- 简介生成：仓库 `description` → 为空抓 README 首个非空非标题段落（截断 280 字）→ 兜底 `开源项目（语言）`。
- 标签生成：仓库 `topics` → 为空用 `language`，去空、上限 8 个。
- 状态文件：`content/github-sync.json`，字段 `lastSync / repos / added / updated / message`。
- 同步接口仅限登录管理员；未登录 401；同步中再次触发返回 409。
- 测试通过 `options.disableAutoSync` 控制调度，并用 mock fetch 隔离网络。
- 用户可见错误提示为中文；提交信息遵循 conventional commits。

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `app.mjs` | 同步服务、调度器、`POST /api/admin/projects/sync`、state 增加 `githubSync` |
| `dashboard.html` | 项目分区增加同步按钮与上次同步时间 |
| `admin.js` | 一键同步调用、结果 toast、同步时间展示 |
| `admin.css` | 同步按钮/状态样式 |
| `test/github-sync.test.mjs` | 同步逻辑测试（mock fetch） |
| `DEPLOYMENT.md` | 同步机制说明 |

---

### Task 1: 后端同步服务与 API（app.mjs + 测试）

**Files:**
- Modify: `app.mjs`
- Test: `test/github-sync.test.mjs`

**Interfaces:**
- `createApp(options)` 新增 `options.disableAutoSync`（默认 false）。
- 内部：`githubFetch(path)`、`repoSummary(repo)`、`repoTags(repo)`、`syncProjectsFromGithub()`、`readSyncState()`、`shouldAutoSync()`、`maybeAutoSync()`。
- 路由：`POST /api/admin/projects/sync`（返回 `{ projects, lastSync, repos, added, updated, message }`）；`GET /api/admin/state` 增加 `githubSync`。

- [ ] **Step 1: 写同步测试**

创建 `test/github-sync.test.mjs`：

```js
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
    return { ok: false, status: 404, json: async () => ({}) };
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
```

- [ ] **Step 2: 运行测试确认失败**

运行：`node --test test/github-sync.test.mjs`

预期：FAIL（`/api/admin/projects/sync` 不存在返回 404、同步逻辑未实现）。

- [ ] **Step 3: 实现后端同步**

修改 `app.mjs`：

1) `createApp` 开头增加常量与状态（放在 `branch` 定义之后）：

```js
  const GITHUB_USER = 'shu1371';
  const SYNC_INTERVAL_MS = 6 * 3600_000;
  const SYNC_THRESHOLD_MS = 72 * 3600_000;
  const syncFile = join(content, 'github-sync.json');
  let syncing = false;
```

2) 在 `saveDocuments` 定义之后插入同步工具与调度：

```js
  const githubFetch = async path => {
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`https://api.github.com${path}`, { headers });
    if (!response.ok) throw new Error(`GitHub 请求失败（${response.status}）`);
    return response.json();
  };

  const repoSummary = async repo => {
    if (repo.description && String(repo.description).trim()) return text(repo.description, 280);
    try {
      const readme = await githubFetch(`/repos/${repo.full_name}/readme`);
      const decoded = Buffer.from(readme.content, 'base64').toString('utf8');
      const paragraph = decoded
        .replace(/\r/g, '')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#') && !line.startsWith('![') && !line.startsWith('```'))
        .find(Boolean) || '';
      return text(paragraph, 280) || `开源项目（${repo.language || 'GitHub'}）`;
    } catch {
      return `开源项目（${repo.language || 'GitHub'}）`;
    }
  };

  const repoTags = repo => {
    const topics = Array.isArray(repo.topics) ? repo.topics : [];
    return tagList(topics.length ? topics : (repo.language ? [repo.language] : []));
  };

  const readSyncState = async () => {
    try {
      const raw = JSON.parse(await readFile(syncFile, 'utf8'));
      return raw && raw.lastSync ? raw : null;
    } catch {
      return null;
    }
  };

  const shouldAutoSync = async () => {
    const state = await readSyncState();
    if (!state) return true;
    return Date.now() - new Date(state.lastSync).getTime() > SYNC_THRESHOLD_MS;
  };

  const syncProjectsFromGithub = async () => {
    if (syncing) return { syncing: true };
    syncing = true;
    try {
      const repos = await githubFetch(`/users/${GITHUB_USER}/repos?per_page=100&sort=updated`);
      const current = await readProjects();
      const byName = new Map();
      for (const repo of repos) {
        if (!repo.fork) byName.set(repo.name, repo);
      }
      const merged = [];
      const existing = new Set();
      for (const project of current) {
        if (project.url && /github\.com\/shu1371\//.test(project.url)) {
          const repo = byName.get(project.id) || byName.get(project.title);
          if (repo) {
            merged.push({ ...project, url: repo.html_url });
            existing.add(repo.name);
          } else {
            merged.push(project);
          }
        } else {
          merged.push(project);
        }
      }
      let added = 0;
      let updated = 0;
      const inserts = [];
      for (const repo of repos) {
        if (repo.fork) continue;
        if (existing.has(repo.name)) {
          const found = merged.find(p => p.id === repo.name || p.title === repo.name);
          if (found && (!found.summary || !found.tags || !found.tags.length)) {
            if (!found.summary) found.summary = await repoSummary(repo);
            if (!found.tags || !found.tags.length) found.tags = repoTags(repo);
            updated += 1;
          }
        } else {
          inserts.push({
            id: repo.name,
            title: repo.name,
            url: repo.html_url,
            summary: await repoSummary(repo),
            tags: repoTags(repo)
          });
          added += 1;
        }
      }
      merged.unshift(...inserts);
      await saveProjects(merged, 'content: sync projects from GitHub');
      const state = {
        lastSync: new Date().toISOString(),
        repos: repos.length,
        added,
        updated,
        message: '同步完成'
      };
      await mkdir(content, { recursive: true });
      await writeFile(syncFile, JSON.stringify(state, null, 2) + '\n');
      return { projects: merged, ...state };
    } finally {
      syncing = false;
    }
  };

  const maybeAutoSync = async () => {
    if (options.disableAutoSync) return;
    try {
      if (await shouldAutoSync()) {
        const result = await syncProjectsFromGithub();
        console.log(`auto sync projects: added=${result.added} updated=${result.updated}`);
      }
    } catch (error) {
      console.error('auto sync failed:', error.message);
    }
  };
```

3) 在管理区认证之后、`/api/admin/state` 分支内增加 `githubSync` 字段，并新增同步接口（放在项目路由之前）：

```js
        if (request.method === 'GET' && url.pathname === '/api/admin/state') {
          return json(response, 200, {
            projects: await readProjects(),
            documents: await readDocuments(),
            githubSync: await readSyncState()
          });
        }
        if (request.method === 'POST' && url.pathname === '/api/admin/projects/sync') {
          if (syncing) return json(response, 409, { error: '同步正在进行中，请稍候' });
          try {
            return json(response, 200, await syncProjectsFromGithub());
          } catch (error) {
            return json(response, 500, { error: error.message || '同步失败' });
          }
        }
```

4) 在 `return server;` 之前启动调度：

```js
  if (!options.disableAutoSync) {
    setTimeout(() => { maybeAutoSync(); }, 1000);
    setInterval(() => { maybeAutoSync(); }, SYNC_INTERVAL_MS).unref();
  }
```

- [ ] **Step 4: 运行测试确认通过**

运行：`node --test test/github-sync.test.mjs`

预期：`# pass 7`，无失败。

- [ ] **Step 5: 全量测试确认无回归**

运行：`node --test`

预期：`# pass 36`（原 29 + 新增 7）。

- [ ] **Step 6: 提交**

```bash
git add app.mjs test/github-sync.test.mjs
git commit -m "feat: auto sync projects from GitHub every 3 days with admin trigger"
```

---

### Task 2: 后台一键更新按钮

**Files:**
- Modify: `dashboard.html`、`admin.js`、`admin.css`

**Interfaces:**
- Consumes: `POST /api/admin/projects/sync`（返回 `{ projects, added, updated, lastSync }`）、`GET /api/admin/state`（含 `githubSync`）。
- Produces: DOM id `sync-projects`、`sync-status`。

- [ ] **Step 1: dashboard 增加同步栏**

在 `dashboard.html` 项目分区 `panel-head` 之后插入：

```html
        <div class="sync-bar">
          <button type="button" id="sync-projects" class="quiet">从 GitHub 更新项目</button>
          <span id="sync-status">上次同步：—</span>
        </div>
```

- [ ] **Step 2: admin.js 增加同步逻辑**

追加函数：

```js
function updateSyncStatus(githubSync) {
  const el = $('sync-status');
  if (!githubSync || !githubSync.lastSync) { el.textContent = '上次同步：—'; return; }
  const elapsed = Date.now() - new Date(githubSync.lastSync).getTime();
  const mins = Math.floor(elapsed / 60000);
  const label = mins < 1 ? '刚刚' : mins < 60 ? `${mins} 分钟前` : `${Math.floor(mins / 60)} 小时前`;
  el.textContent = `上次同步：${label}`;
}

async function syncProjects() {
  const button = $('sync-projects');
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = '正在同步…';
  try {
    const data = await request('/api/admin/projects/sync', { method: 'POST' });
    notify(`同步完成：新增 ${data.added} 个、更新 ${data.updated} 个`);
    state.projects = data.projects;
    renderProjects();
    updateSyncStatus(data);
  } catch (error) {
    notify(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = '从 GitHub 更新项目';
  }
}
```

修改 `loadState` 增加同步状态展示：

```js
async function loadState() {
  const data = await request('/api/admin/state');
  state.projects = data.projects;
  state.documents = data.documents || [];
  renderProjects();
  renderDocuments();
  updateSyncStatus(data.githubSync);
}
```

初始化区增加事件绑定：

```js
$('sync-projects').addEventListener('click', syncProjects);
```

- [ ] **Step 3: admin.css 增加样式**

追加：

```css
.sync-bar { display: flex; align-items: center; gap: 12px; margin: 0 0 16px; }
.sync-bar button {
  border: 1px solid var(--line); background: #f0ead9; border-radius: 999px;
  padding: 8px 16px; font-weight: 600; font-size: 13px;
}
.sync-bar button:disabled { opacity: 0.6; cursor: default; }
.sync-bar span { font-size: 13px; color: #6b6b6b; }
```

- [ ] **Step 4: 全量测试确认无回归**

运行：`node --test`

预期：`# pass 36`，无失败。

- [ ] **Step 5: 提交**

```bash
git add dashboard.html admin.js admin.css
git commit -m "feat: one-click sync projects button in admin panel"
```

---

### Task 3: 部署文档与收尾

**Files:**
- Modify: `DEPLOYMENT.md`

- [ ] **Step 1: 更新部署文档**

在 `DEPLOYMENT.md` 的「文档存储」之后追加：

```markdown
## 项目自动同步

- 网站每 3 天自动从 GitHub（shu1371）同步项目列表；后台「从 GitHub 更新项目」按钮可立即同步。
- 同步状态记录在 `/opt/lx-cloud.top/content/github-sync.json`，随 content 目录一起备份。
- 同步只增不删：手动添加的非 GitHub 项目不会被移除；已存在条目的手动简介与标签会被保留。
```

- [ ] **Step 2: 全量测试**

运行：`node --test`

预期：`# pass 36`，无失败。

- [ ] **Step 3: 提交**

```bash
git add DEPLOYMENT.md
git commit -m "docs: project auto sync notes"
```

---

## 收尾检查（全部任务完成后）

1. `node --test` 全绿（36 项）。
2. 本地起服验证：后台点按钮同步成功、状态文件生成、项目无重复。
3. 推送 GitHub → 服务器 `git pull` → 重建镜像 → 重建容器。
4. 部署后验证：点「从 GitHub 更新项目」→ 成功提示；`github-sync.json` 生成；项目列表 4 个无重复。

## 自查记录

**规格覆盖：** 同步逻辑（Task 1）、合并保留（Task 1 测试）、72h 调度（Task 1）、接口（Task 1）、状态文件（Task 1）、后台按钮（Task 2）、部署说明（Task 3）。

**类型与命名一致性：** `githubSync` 字段在 app.mjs 与 admin.js 一致；`sync-projects` / `sync-status` DOM id 在 dashboard 与 admin.js 一致；测试与实现使用相同的 `disableAutoSync` 选项。
