import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('projects.json 包含全部 GitHub 项目且字段完整', async () => {
  const file = new URL('../content/projects.json', import.meta.url);
  const projects = JSON.parse(await readFile(file, 'utf8'));
  assert.ok(projects.length >= 4, '至少包含 4 个已知项目');
  const titles = projects.map(project => project.title);
  for (const expected of ['vulhub-lab', 'financial-analysis', 'points-discount', 'blog']) {
    assert.ok(titles.includes(expected), `缺少项目 ${expected}`);
  }
  for (const project of projects) {
    assert.ok(project.id, '缺少 id');
    assert.ok(project.url, '缺少 url');
    assert.ok(project.summary, '缺少 summary');
    assert.match(project.url, /^https?:\/\//);
    assert.ok(Array.isArray(project.tags));
    assert.ok(project.tags.length > 0);
  }
});
