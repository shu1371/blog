# 学习小结模块实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 lxtoxyf 个人网站新增「学习小结」模块：管理员上传 doc/docx/pdf（≤10MB），访客在公开页面查看并下载。

**Architecture:** 在零依赖 `app.mjs` 中新增 multipart 解析与文档校验（扩展名白名单 + magic bytes + 10MB 上限），文件写入 `content/documents/`（UUID 存储名），元数据存 `content/documents.json` 并复用现有 `github()` 同步；前台新增 `summaries.html`，后台 dashboard 新增上传/删除区。

**Tech Stack:** Node.js 内置模块（http/fs/crypto）、原生 HTML/CSS/JS、node:test、GitHub Contents API。

## Global Constraints

- 零第三方依赖：只用 Node 内置模块。
- 允许格式：`.doc` / `.docx` / `.pdf`（大小写不敏感）。
- 大小限制：单文件 ≤ 10MB，上传请求体累计 ≤ 10MB。
- Magic bytes：`.pdf` → `%PDF-`（`25 50 44 46 2D`）；`.doc` → OLE2（`D0 CF 11 E0`）；`.docx` → ZIP（`50 4B 03 04`）。
- 元数据字段：`id / title / date / summary / filename / stored / size / type / uploadedAt`。
- `title` ≤120 字必填、`date` 格式 `YYYY-MM-DD` 必填、`summary` ≤360 字可选。
- 文档二进制不同步 GitHub；`content/documents.json` 元数据同步 GitHub。
- 下载强制 `Content-Disposition: attachment`。
- 上传仅限登录管理员；未登录返回 401。
- 用户可见错误提示为中文。
- 提交信息遵循 conventional commits。

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `app.mjs` | multipart 解析、文档校验、文档 API、元数据 GitHub 同步 |
| `summaries.html` | 前台学习小结列表页 |
| `index.html` / `projects.html` | 导航增加「学习小结」 |
| `content.js` | 增加学习小结卡片渲染 |
| `assets/site.css` | 学习小结样式（复用现有卡片类，新增少量） |
| `dashboard.html` / `admin.js` / `admin.css` | 后台学习小结上传与删除 |
| `test/documents.test.mjs` | 文档模块测试 |
| `DEPLOYMENT.md` | 文档目录与备份说明 |

---

### Task 1: 后端文档 API（app.mjs + 测试）

**Files:**
- Modify: `app.mjs`
- Test: `test/documents.test.mjs`

**Interfaces:**
- `parseMultipart(request, maxBytes)`：解析 multipart 表单，返回 `{ fields, file }`；`file = { name, filename, data: Buffer, type }`；超限抛 400。
- `validateDocumentFile(file)`：返回 `{ ext, mime }`；非法类型/magic 不匹配抛 400。
- `readDocuments()` / `saveDocuments(list, message)`：读写 `documents.json`，后者复用 `github('content/documents.json', ...)`。
- 路由：`GET /api/documents`、`GET /api/documents/:id/download`、`POST /api/admin/documents`、`DELETE /api/admin/documents/:id`；`GET /api/admin/state` 增加 `documents`。

- [ ] **Step 1: 写文档模块测试**

创建 `test/documents.test.mjs`：

```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n% test\n'), Buffer.alloc(1024, 0x20)]);
const OLE = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1]), Buffer.alloc(512, 0)]);
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]), Buffer.alloc(512, 0)]);
const OVER = Buffer.alloc(10 * 1024 * 1024 + 1, 0x41);

let base;
let server;
let origin;
let createdId = '';

before(async () => {
  base = await mkdtemp(join(tmpdir(), 'lxtoxyf-docs-'));
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

const buildMultipart = (fields, file) => {
  const boundary = '----lxtoxyf-test-boundary';
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  if (file) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: ${file.type}\r\n\r\n`));
    chunks.push(file.data);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
};

async function loginCookie() {
  const res = await request('/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'test-pass' })
  });
  return res.headers.get('set-cookie').split(';')[0];
}

async function upload(cookie, fields, file) {
  const { body, contentType } = buildMultipart(fields, file);
  return request('/api/admin/documents', {
    method: 'POST',
    headers: { cookie, 'content-type': contentType },
    body
  });
}

test('GET /api/documents 初始为空列表', async () => {
  const res = await request('/api/documents');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), []);
});

test('未登录上传返回 401', async () => {
  const { body, contentType } = buildMultipart({ title: '小结', date: '2026-08-11' }, { filename: 'a.pdf', type: 'application/pdf', data: PDF });
  const res = await request('/api/admin/documents', { method: 'POST', headers: { 'content-type': contentType }, body });
  assert.equal(res.status, 401);
});

test('上传 txt 返回 400', async () => {
  const cookie = await loginCookie();
  const res = await upload(cookie, { title: '小结', date: '2026-08-11' }, { filename: 'a.txt', type: 'text/plain', data: Buffer.from('hello') });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /只支持/);
});

test('扩展名与内容不匹配返回 400', async () => {
  const cookie = await loginCookie();
  const res = await upload(cookie, { title: '小结', date: '2026-08-11' }, { filename: 'a.pdf', type: 'application/pdf', data: Buffer.from('not a pdf at all') });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /不匹配/);
});

test('超过 10MB 返回 400', async () => {
  const cookie = await loginCookie();
  const res = await upload(cookie, { title: '小结', date: '2026-08-11' }, { filename: 'big.pdf', type: 'application/pdf', data: OVER });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /10MB/);
});

test('缺少标题返回 400', async () => {
  const cookie = await loginCookie();
  const res = await upload(cookie, { date: '2026-08-11' }, { filename: 'a.pdf', type: 'application/pdf', data: PDF });
  assert.equal(res.status, 400);
});

test('上传合法 PDF 返回 201 且文件落盘', async () => {
  const cookie = await loginCookie();
  const res = await upload(cookie, { title: '第一篇小结', date: '2026-08-11', summary: '简介内容' }, { filename: 'summary.pdf', type: 'application/pdf', data: PDF });
  assert.equal(res.status, 201);
  const doc = await res.json();
  createdId = doc.id;
  assert.equal(doc.title, '第一篇小结');
  assert.equal(doc.type, 'pdf');
  assert.equal(doc.size, PDF.length);
  const files = await readdir(join(base, 'content', 'documents'));
  assert.equal(files.length, 1);
  assert.ok(files[0].endsWith('.pdf'));
  const meta = JSON.parse(await readFile(join(base, 'content', 'documents.json'), 'utf8'));
  assert.equal(meta.length, 1);
  assert.equal(meta[0].filename, 'summary.pdf');
  const list = await (await request('/api/documents')).json();
  assert.equal(list.length, 1);
});

test('下载返回 200 且带 attachment 头', async () => {
  const res = await request(`/api/documents/${createdId}/download`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /attachment/);
  const data = Buffer.from(await res.arrayBuffer());
  assert.deepEqual(data.subarray(0, 5), Buffer.from('%PDF-'));
});

test('删除文档后文件与元数据同步移除', async () => {
  const cookie = await loginCookie();
  const res = await request(`/api/admin/documents/${createdId}`, { method: 'DELETE', headers: { cookie } });
  assert.equal(res.status, 200);
  const files = await readdir(join(base, 'content', 'documents'));
  assert.equal(files.length, 0);
  const meta = JSON.parse(await readFile(join(base, 'content', 'documents.json'), 'utf8'));
  assert.equal(meta.length, 0);
});

test('不存在的文档返回 404', async () => {
  const res = await request('/api/documents/nonexistent/download');
  assert.equal(res.status, 404);
  const cookie = await loginCookie();
  const del = await request('/api/admin/documents/nonexistent', { method: 'DELETE', headers: { cookie } });
  assert.equal(del.status, 404);
});
```

- [ ] **Step 2: 运行测试确认失败**

运行：`node --test test/documents.test.mjs`

预期：FAIL（`/api/documents` 返回 404 或路由不存在）。

- [ ] **Step 3: 实现后端文档功能**

修改 `app.mjs`：

1) 导入行增加 `unlink`：

```js
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
```

2) 在 `tagList` 定义之后插入常量与工具：

```js
  const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
  const DOC_TYPES = {
    doc: { ext: 'doc', magic: [0xd0, 0xcf, 0x11, 0xe0], mime: 'application/msword' },
    docx: { ext: 'docx', magic: [0x50, 0x4b, 0x03, 0x04], mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    pdf: { ext: 'pdf', magic: [0x25, 0x50, 0x44, 0x46, 0x2d], mime: 'application/pdf' }
  };

  const splitMultipart = (body, delimiter) => {
    const parts = [];
    let cursor = 0;
    while (true) {
      const at = body.indexOf(delimiter, cursor);
      if (at < 0) break;
      let start = at + delimiter.length;
      if (body[start] === 0x2d && body[start + 1] === 0x2d) break;
      if (body[start] === 0x0d && body[start + 1] === 0x0a) start += 2;
      else { cursor = start; continue; }
      const next = body.indexOf(delimiter, start);
      if (next < 0) break;
      let end = next;
      if (body[end - 2] === 0x0d && body[end - 1] === 0x0a) end -= 2;
      parts.push(body.slice(start, end));
      cursor = next;
    }
    return parts;
  };

  const parseMultipart = async (request, maxBytes) => {
    const contentType = String(request.headers['content-type'] || '');
    const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!match) throw badRequest('缺少 multipart boundary');
    const delimiter = Buffer.from(`--${(match[1] || match[2]).trim()}`);
    const chunks = [];
    let total = 0;
    for await (const chunk of request) {
      total += chunk.length;
      if (total > maxBytes) throw badRequest('文件超过 10MB 限制');
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    const fields = {};
    let file = null;
    for (const part of splitMultipart(body, delimiter)) {
      const headerEnd = part.indexOf('\r\n\r\n');
      if (headerEnd < 0) continue;
      const headers = part.slice(0, headerEnd).toString('utf8');
      const content = part.slice(headerEnd + 4);
      const disposition = headers.match(/Content-Disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i);
      if (!disposition) continue;
      const name = disposition[1];
      const filename = disposition[2];
      if (filename !== undefined) {
        const type = String(headers.match(/Content-Type:\s*([^\r\n]+)/i)?.[1] || '').trim();
        file = { name, filename, data: content, type };
      } else {
        fields[name] = content.toString('utf8');
      }
    }
    return { fields, file };
  };

  const cleanDocumentMeta = fields => {
    const title = text(fields.title, 120);
    const date = String(fields.date || '').trim();
    const summary = text(fields.summary, 360);
    if (!title || !date) throw badRequest('请填写标题和日期');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('日期格式不正确');
    return { title, date, summary };
  };

  const validateDocumentFile = file => {
    if (!file || !file.data || !file.data.length) throw badRequest('请选择要上传的文件');
    if (file.data.length > MAX_DOCUMENT_BYTES) throw badRequest('文件超过 10MB 限制');
    const filename = String(file.filename || '');
    const ext = filename.toLowerCase().split('.').pop();
    const type = DOC_TYPES[ext];
    if (!type) throw badRequest('只支持 doc、docx、pdf 格式');
    const magic = Buffer.from(type.magic);
    if (file.data.length < magic.length || !file.data.subarray(0, magic.length).equals(magic)) {
      throw badRequest('文件内容与扩展名不匹配');
    }
    return type;
  };

  const documentFile = join(content, 'documents.json');
  const documentDir = join(content, 'documents');

  const readDocuments = async () => {
    try {
      const raw = JSON.parse(await readFile(documentFile, 'utf8'));
      return Array.isArray(raw) ? raw : [];
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  };

  const saveDocuments = async (documents, message) => {
    const raw = JSON.stringify(documents, null, 2) + '\n';
    const result = await github('content/documents.json', raw, message);
    await mkdir(content, { recursive: true });
    await writeFile(documentFile, raw);
    return result;
  };
```

3) 在 `/api/projects` 路由之后插入公开文档路由：

```js
      if (request.method === 'GET' && url.pathname === '/api/documents') {
        return json(response, 200, await readDocuments());
      }
      if (request.method === 'GET' && url.pathname.startsWith('/api/documents/') && url.pathname.endsWith('/download')) {
        const id = decodeURIComponent(url.pathname.split('/').slice(-2)[0]);
        const documents = await readDocuments();
        const doc = documents.find(item => item.id === id);
        if (!doc) return json(response, 404, { error: '文档不存在' });
        try {
          const data = await readFile(join(documentDir, doc.stored));
          const type = DOC_TYPES[doc.type] || {};
          const filename = encodeURIComponent(doc.filename || 'document');
          response.writeHead(200, {
            'content-type': type.mime || 'application/octet-stream',
            'content-length': data.length,
            'content-disposition': `attachment; filename="${filename}"`
          });
          return response.end(data);
        } catch (error) {
          if (error.code === 'ENOENT') return json(response, 404, { error: '文档文件不存在' });
          throw error;
        }
      }
```

4) 在管理区认证之后、`/api/admin/state` 分支内增加 `documents` 字段，并新增上传/删除分支：

```js
        if (request.method === 'GET' && url.pathname === '/api/admin/state') {
          return json(response, 200, { projects: await readProjects(), documents: await readDocuments() });
        }
        if (request.method === 'POST' && url.pathname === '/api/admin/documents') {
          const { fields, file } = await parseMultipart(request, MAX_DOCUMENT_BYTES);
          const meta = cleanDocumentMeta(fields);
          const type = validateDocumentFile(file);
          const id = randomUUID();
          const stored = `${id}.${type.ext}`;
          await mkdir(documentDir, { recursive: true });
          await writeFile(join(documentDir, stored), file.data);
          const documents = await readDocuments();
          const document = {
            id,
            title: meta.title,
            date: meta.date,
            summary: meta.summary,
            filename: String(file.filename || '').slice(0, 255),
            stored,
            size: file.data.length,
            type: type.ext,
            uploadedAt: new Date().toISOString()
          };
          documents.unshift(document);
          await saveDocuments(documents, `content: add document ${id}`);
          return json(response, 201, document);
        }
        if (request.method === 'DELETE' && url.pathname.startsWith('/api/admin/documents/')) {
          const id = decodeURIComponent(url.pathname.split('/').pop());
          const documents = await readDocuments();
          const index = documents.findIndex(item => item.id === id);
          if (index < 0) return json(response, 404, { error: '文档不存在' });
          const document = documents[index];
          await unlink(join(documentDir, document.stored)).catch(error => {
            if (error.code !== 'ENOENT') throw error;
          });
          documents.splice(index, 1);
          await saveDocuments(documents, `content: remove document ${id}`);
          return json(response, 200, { deleted: true });
        }
```

注意：`POST /api/admin/documents` 与 `DELETE /api/admin/documents/:id` 分支必须放在 `/api/admin/projects` 相关分支之前或之后均可，但必须在 `projectMatch` 正则之前，避免把 `documents` 误匹配为项目 ID。

- [ ] **Step 4: 运行测试确认通过**

运行：`node --test test/documents.test.mjs`

预期：`# pass 10`，无失败。

- [ ] **Step 5: 运行全量测试确认无回归**

运行：`node --test`

预期：`# pass 28`（原有 18 + 新增 10）。

- [ ] **Step 6: 提交**

```bash
git add app.mjs test/documents.test.mjs
git commit -m "feat: study summaries upload, list and download APIs"
```

---

### Task 2: 前台学习小结页面

**Files:**
- Create: `summaries.html`
- Modify: `index.html`、`projects.html`（导航加「学习小结」）
- Modify: `content.js`（渲染学习小结卡片）
- Modify: `assets/site.css`（下载按钮与大小标签沿用现有类，无需新增即可满足；确认即可）
- Test: `test/static.test.mjs`（增加学习小结页断言）

**Interfaces:**
- Consumes: `GET /api/documents`（返回 `[{ id, title, date, summary, filename, size, type }]`）。
- Produces: 页面根元素 `[data-documents]`；导航链接 `summaries.html`。

- [ ] **Step 1: 增加静态测试**

在 `test/static.test.mjs` 追加：

```js
test('学习小结页返回 200 且导航存在', async () => {
  const res = await request('/summaries.html');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /学习小结/);
});
```

- [ ] **Step 2: 运行测试确认失败**

运行：`node --test test/static.test.mjs`

预期：FAIL（`summaries.html` 不存在，返回 404）。

- [ ] **Step 3: 实现前台页面**

创建 `summaries.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="lxtoxyf 的学习小结文档。" />
    <title>学习小结 · lxtoxyf</title>
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
        <a href="projects.html">项目</a>
        <a href="summaries.html" aria-current="page">学习小结</a>
        <a href="index.html#contact">联系方式</a>
      </nav>
      <a class="header-link" href="https://github.com/shu1371" target="_blank" rel="noopener noreferrer">GitHub <span>↗</span></a>
    </header>
    <main id="top">
      <section class="page-intro wrap">
        <p class="eyebrow">SUMMARIES</p>
        <h1>学习小结</h1>
        <p>每一段学习的沉淀，整理成可下载的文档。</p>
      </section>
      <section class="section wrap">
        <div class="grid" data-documents></div>
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

修改 `index.html` 与 `projects.html` 的导航，在「项目」与「联系方式」之间加入：

```html
        <a href="summaries.html">学习小结</a>
```

修改 `content.js`，追加：

```js
const formatSize = bytes => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

async function loadDocuments() {
  const target = document.querySelector('[data-documents]');
  if (!target) return;
  const response = await fetch('/api/documents');
  if (!response.ok) throw new Error('加载失败');
  const documents = await response.json();
  target.innerHTML = documents.map(doc => `<article class="feature"><div class="feature-art"><span>↓</span></div><div class="feature-copy"><p class="eyebrow">${escape(doc.date)}</p><h3>${escape(doc.title)}</h3><p>${escape(doc.summary)}</p><ul class="tags"><li>${escape(String(doc.type || '').toUpperCase())}</li><li>${escape(formatSize(doc.size))}</li></ul><a class="button button-primary" href="/api/documents/${encodeURIComponent(doc.id)}/download" target="_blank" rel="noopener noreferrer">下载文档 <span>↓</span></a></div></article>`).join('') || '<p>还没有学习小结。</p>';
}
```

并把文件末尾改为：

```js
Promise.all([loadProjects(), loadDocuments()]).catch(() => {
  document.querySelectorAll('[data-projects],[data-documents]').forEach(element => {
    element.innerHTML = '<p>内容加载失败，请稍后重试。</p>';
  });
});
```

- [ ] **Step 4: 运行测试确认通过**

运行：`node --test`

预期：`# pass 29`（原 28 + 静态测试新增 1）。

- [ ] **Step 5: 提交**

```bash
git add summaries.html index.html projects.html content.js test/static.test.mjs
git commit -m "feat: public study summaries page"
```

---

### Task 3: 后台学习小结管理

**Files:**
- Modify: `dashboard.html`、`admin.js`、`admin.css`

**Interfaces:**
- Consumes: `GET /api/admin/state`（含 `documents`）、`POST /api/admin/documents`（multipart）、`DELETE /api/admin/documents/:id`。
- Produces: DOM id：`document-form`、`document-file`、`document-title`、`document-date`、`document-summary`、`save-document`、`document-count`、`document-cards`。

- [ ] **Step 1: dashboard 增加学习小结分区**

在 `dashboard.html` 的 `</main>` 之前追加：

```html
      <section class="admin-col">
        <div class="panel-head"><h1>学习小结</h1><span id="document-count"></span></div>
        <form id="document-form" class="panel-form">
          <h2>上传学习小结</h2>
          <label>文件（doc / docx / pdf，≤10MB）
            <input id="document-file" type="file" accept=".doc,.docx,.pdf" required />
          </label>
          <label>标题
            <input id="document-title" maxlength="120" required placeholder="小结标题" />
          </label>
          <label>日期
            <input id="document-date" type="date" required />
          </label>
          <label>简介（可选）
            <textarea id="document-summary" maxlength="360" rows="2" placeholder="一句话简介"></textarea>
          </label>
          <div class="form-actions">
            <button type="submit" id="save-document" class="primary">上传</button>
          </div>
        </form>
        <div id="document-cards" class="item-list"></div>
      </section>
```

同时把主布局从两列改为三列（项目、编辑表单、学习小结）：`admin-main` 的 `grid-template-columns` 改为 `repeat(3, 1fr)`，窄屏回退单列。

- [ ] **Step 2: admin.js 增加文档逻辑**

在 `state` 定义处增加 `documents: []`，追加以下函数：

```js
const formatSize = bytes => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

function renderDocuments() {
  $('document-count').textContent = `${state.documents.length} 篇小结`;
  $('document-cards').innerHTML = state.documents.map(doc => `<div class="card-stack"><div class="item-card"><span class="card-symbol">↓</span><span class="card-copy"><strong>${escape(doc.title)}</strong><small>${escape(doc.filename)} · ${escape(doc.date)} · ${escape(formatSize(doc.size))}</small></span></div><div class="order-controls"><button type="button" class="danger-link" data-document-delete="${escape(doc.id)}">删除</button></div></div>`).join('') || '<p class="empty-state">还没有学习小结。</p>';
  document.querySelectorAll('[data-document-delete]').forEach(button => button.addEventListener('click', () => removeDocument(button.dataset.documentDelete)));
}

async function uploadDocument(event) {
  event.preventDefault();
  const file = $('document-file').files[0];
  if (!file) return notify('请选择文件', 'error');
  const form = new FormData();
  form.append('file', file);
  form.append('title', $('document-title').value);
  form.append('date', $('document-date').value);
  form.append('summary', $('document-summary').value);
  const button = $('save-document');
  setBusy(button, true);
  try {
    const response = await fetch('/api/admin/documents', { method: 'POST', credentials: 'same-origin', body: form });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || '上传失败');
    notify('文档已上传');
    $('document-form').reset();
    $('document-date').value = new Date().toISOString().slice(0, 10);
    await loadState();
  } catch (error) {
    notify(error.message, 'error');
  } finally {
    setBusy(button, false);
  }
}

async function removeDocument(id) {
  if (!window.confirm('确定删除这份学习小结吗？')) return;
  try {
    await request(`/api/admin/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
    notify('文档已删除');
    await loadState();
  } catch (error) {
    notify(error.message, 'error');
  }
}
```

修改 `loadState`：

```js
async function loadState() {
  const data = await request('/api/admin/state');
  state.projects = data.projects;
  state.documents = data.documents || [];
  renderProjects();
  renderDocuments();
}
```

在初始化区追加：

```js
$('document-form').addEventListener('submit', uploadDocument);
```

并在 `loadState().catch(...)` 里同时兜底文档列表：

```js
loadState().catch(error => {
  $('project-cards').innerHTML = `<p class="empty-state">${escape(error.message)}</p>`;
  $('document-cards').innerHTML = `<p class="empty-state">${escape(error.message)}</p>`;
});
```

- [ ] **Step 3: admin.css 调整**

`admin-main` 改为三列：

```css
.admin-main {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px;
  max-width: 1280px; margin: 0 auto; padding: 32px 24px 60px;
}
```

追加删除链接样式：

```css
.danger-link {
  border: 1px solid var(--danger); color: var(--danger); background: #fff;
  border-radius: 999px; padding: 6px 14px; font-size: 13px; font-weight: 600;
}
.danger-link:hover { background: var(--danger); color: #fff; }
```

窄屏回退（已有媒体查询）把列数改回 1。

- [ ] **Step 4: 运行全量测试确认无回归**

运行：`node --test`

预期：`# pass 29`，无失败。

- [ ] **Step 5: 提交**

```bash
git add dashboard.html admin.js admin.css
git commit -m "feat: admin study summaries upload and delete"
```

---

### Task 4: 部署文档与收尾

**Files:**
- Modify: `DEPLOYMENT.md`

- [ ] **Step 1: 更新部署文档**

在 `DEPLOYMENT.md` 的「验证清单」前追加：

```markdown
## 文档存储

- 学习小结文件位于 `/opt/lx-cloud.top/content/documents/`（容器内 `/app/content/documents/`）。
- 元数据为 `/opt/lx-cloud.top/content/documents.json`，随 content 目录一起纳入备份。
- 上传限制：doc / docx / pdf，单文件 ≤ 10MB。
```

- [ ] **Step 2: 全量测试**

运行：`node --test`

预期：`# pass 29`，无失败。

- [ ] **Step 3: 提交**

```bash
git add DEPLOYMENT.md
git commit -m "docs: study summaries storage and backup notes"
```

---

## 收尾检查（全部任务完成后）

1. `node --test` 全绿（29 项）。
2. 本地起服，上传/下载/删除流程通过浏览器或 curl 验证。
3. 推送 GitHub → 服务器 `git pull` → `docker build` → 重建容器（挂载不变）。
4. 部署后按设计文档第 11 节验证清单逐项确认。

## 自查记录

**规格覆盖：** 存储（Task 1）、API（Task 1）、三层校验（Task 1）、安全（Task 1/3）、前台页面（Task 2）、后台（Task 3）、错误处理（Task 1 测试）、部署（Task 4）。

**类型与命名一致性：** `documents.json` 字段在 Task 1 定义、Task 2/3 消费；DOM id 在 Task 3 与 admin.js 一致；`parseMultipart` / `validateDocumentFile` 签名在测试与实现间一致。
