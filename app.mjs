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
      const notFound = error.message === 'not found' || error.code === 'ENOENT';
      const status = error.status || (notFound ? 404 : 500);
      return json(response, status, { error: notFound ? 'not found' : (error.message || '服务错误') });
    }
  });

  return server;
}
