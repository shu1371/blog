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

## 文档存储

- 学习小结文件位于 `/opt/lx-cloud.top/content/documents/`（容器内 `/app/content/documents/`）。
- 元数据为 `/opt/lx-cloud.top/content/documents.json`，随 content 目录一起纳入备份。
- 上传限制：doc / docx / pdf，单文件 ≤ 10MB。

## 项目自动同步

- 网站每 3 天自动从 GitHub（shu1371）同步项目列表；后台「从 GitHub 更新项目」按钮可立即同步。
- 同步状态记录在 `/opt/lx-cloud.top/content/github-sync.json`，随 content 目录一起备份。
- 同步只增不删：手动添加的非 GitHub 项目不会被移除；已存在条目的手动简介与标签会被保留。

## 6. 验证清单

1. `curl -I https://lx-cloud.top` 返回 200 且证书有效。
2. 首页显示全部 GitHub 项目卡片与联系方式。
3. `https://lx-cloud.top/admin.html` 登录成功。
4. 后台新建/编辑/删除/排序后，`https://github.com/shu1371/blog` 出现对应提交。
5. 后台上传 doc/docx/pdf 学习小结成功，前台「学习小结」页可下载；非法类型与超限文件被拒绝。
6. 内容目录纳入服务器备份。
