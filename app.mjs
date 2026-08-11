import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
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
  const content = normalize(options.contentRoot || env.CONTENT_ROOT || join(site, 'content'));
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
      const notFound = error.message === 'not found' || error.code === 'ENOENT';
      const status = error.status || (notFound ? 404 : 500);
      return json(response, status, { error: notFound ? 'not found' : (error.message || '服务错误') });
    }
  });

  return server;
}
