# lxtoxyf 个人网站

一个部署在自有服务器上的个人网站：展示项目作品与联系方式，内置带登录认证的内容后台，后台保存的内容会自动同步到 GitHub。

## 在线地址

- 网站：https://lx-cloud.top
- 后台：https://lx-cloud.top/admin.html

## 功能特性

- **项目作品展示**：标题、简介、标签、仓库链接，前台从 API 动态加载
- **联系方式**：邮箱、GitHub 外链
- **内容后台**：密码登录（HMAC-SHA256 签名 Cookie，12 小时会话），项目新增 / 编辑 / 删除 / 上下移排序
- **内容同步**：后台每次保存同时写入 GitHub 仓库（Contents API）与服务器本地，双重备份
- **零依赖后端**：仅使用 Node.js 内置模块（`http` / `crypto` / `fetch`），无第三方依赖

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | 原生 HTML / CSS / JavaScript |
| 后端 | Node.js（ESM，零第三方依赖） |
| 内容存储 | JSON（`content/projects.json`） |
| 认证 | HMAC-SHA256 签名 Cookie |
| 部署 | Docker + Caddy 反向代理 + Cloudflare DNS |
| 内容同步 | GitHub Contents API |

## 目录结构

```text
lxtoxyf-site/
├── server.mjs              # 服务入口
├── app.mjs                 # 后端逻辑：静态文件、API、认证、GitHub 同步
├── index.html              # 首页
├── projects.html           # 项目列表页
├── content.js              # 前台 JS：加载并渲染项目卡片
├── admin.html              # 后台登录页
├── dashboard.html          # 后台管理面板
├── admin.js / admin.css    # 后台逻辑与样式
├── assets/site.css         # 前台样式
├── content/projects.json   # 项目数据
├── test/                   # node:test 测试（18 项）
├── Dockerfile              # 生产镜像
├── deploy/Caddyfile        # 站点配置
└── DEPLOYMENT.md           # 部署文档
```

## 本地开发

```bash
npm start
```

浏览器访问 http://localhost:3000。

需要设置环境变量：

- `ADMIN_PASSWORD`：后台登录密码（必填，否则无法登录）
- `SESSION_SECRET`：会话签名密钥（必填）
- `GITHUB_TOKEN`：GitHub 令牌（可选，配置后后台保存会同步到仓库）
- `PORT`：监听端口（默认 3000）

PowerShell 示例：

```powershell
$env:ADMIN_PASSWORD='你的密码'
$env:SESSION_SECRET='随机字符串'
npm start
```

## 测试

```bash
npm test
```

共 18 项测试，覆盖项目 API、登录认证、增删改排序、字段校验、静态页面与内容目录环境变量。

## 部署

完整的 Cloudflare DNS、Docker、Caddy 接入与验证清单见 [DEPLOYMENT.md](DEPLOYMENT.md)。

## 内容维护

登录后台后即可在线维护项目数据：

1. 访问 `https://lx-cloud.top/admin.html`
2. 输入管理员密码登录
3. 新建、编辑、删除项目，或使用 ↑ ↓ 调整展示顺序
4. 每次保存会自动提交到本仓库的 `content/projects.json` 并写入服务器本地
