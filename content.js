const escape = value => String(value || '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
const tags = items => (items || []).map(tag => `<li>${escape(tag)}</li>`).join('');
const formatSize = bytes => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

async function loadProjects() {
  const target = document.querySelector('[data-projects]');
  if (!target) return;
  const response = await fetch('/api/projects');
  if (!response.ok) throw new Error('加载失败');
  const projects = await response.json();
  target.innerHTML = projects.map(project => `<article class="feature"><div class="feature-art"><span>↗</span></div><div class="feature-copy"><p class="eyebrow">PROJECT</p><h3>${escape(project.title)}</h3><p>${escape(project.summary)}</p><ul class="tags">${tags(project.tags)}</ul><a class="button button-primary" href="${escape(project.url)}" target="_blank" rel="noopener noreferrer">查看项目仓库 <span>↗</span></a></div></article>`).join('') || '<p>暂时还没有公开项目。</p>';
}

async function loadDocuments() {
  const target = document.querySelector('[data-documents]');
  if (!target) return;
  const response = await fetch('/api/documents');
  if (!response.ok) throw new Error('加载失败');
  const documents = await response.json();
  target.innerHTML = documents.map(doc => `<article class="feature"><div class="feature-art"><span>↓</span></div><div class="feature-copy"><p class="eyebrow">${escape(doc.date)}</p><h3>${escape(doc.title)}</h3><p>${escape(doc.summary)}</p><ul class="tags"><li>${escape(String(doc.type || '').toUpperCase())}</li><li>${escape(formatSize(doc.size))}</li></ul><a class="button button-primary" href="/api/documents/${encodeURIComponent(doc.id)}/download" target="_blank" rel="noopener noreferrer">下载文档 <span>↓</span></a></div></article>`).join('') || '<p>还没有学习小结。</p>';
}

Promise.all([loadProjects(), loadDocuments()]).catch(() => {
  document.querySelectorAll('[data-projects],[data-documents]').forEach(element => {
    element.innerHTML = '<p>内容加载失败，请稍后重试。</p>';
  });
});
