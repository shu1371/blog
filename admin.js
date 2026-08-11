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
const state = { projects: [], documents: [], projectId: '' };
const formatSize = bytes => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

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

async function loadState() {
  const data = await request('/api/admin/state');
  state.projects = data.projects;
  state.documents = data.documents || [];
  renderProjects();
  renderDocuments();
}

$('project-form').addEventListener('submit', saveProject);
$('new-project').addEventListener('click', newProject);
$('delete-project').addEventListener('click', removeProject);
$('document-form').addEventListener('submit', uploadDocument);
loadState().catch(error => {
  $('project-cards').innerHTML = `<p class="empty-state">${escape(error.message)}</p>`;
  $('document-cards').innerHTML = `<p class="empty-state">${escape(error.message)}</p>`;
});
