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
