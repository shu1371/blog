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
