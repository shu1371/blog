# lxtoxyf 个人网站设计文档

日期：2026-08-11

## 1. 背景与目标

为 lxtoxyf 打造一个部署在自有服务器上的个人网站，展示「项目作品」与「联系方式」，并提供带登录认证的内容后台，用于在线维护项目数据。整体架构与视觉参考 `Qk-max/blog` 项目，但只保留项目模块，砍掉笔记模块（后续可按需扩展）。

## 2. 用户信息

| 项 | 值 |
| --- | --- |
| 网站署名 | lxtoxyf |
| 邮箱 | lxtoxyf@163.com |
| GitHub | github.com/shu1371 |
| 域名 | lx-cloud.top（Cloudflare 托管，尚无 A 记录） |
| 服务器 | 144.34.185.9（SSH 可登录，已运行 Caddy，80/443/22 开放） |
| 内容仓库 | shu1371/blog（待用户新建，用于后台内容同步） |

## 3. 范围

### 包含

- 前台首页：hero 区、项目作品卡片、联系方式
- 前台项目页：项目完整列表
- 后台：密码登录、项目新增/编辑/删除、上下移排序
- GitHub 内容同步：后台保存时提交到内容仓库
- Docker 部署 + Caddy 反向代理 + HTTPS
- 部署文档与验证清单

### 不包含（本期）

- 笔记/博客模块（架构预留扩展位，但不实现）
- 多管理员账号、CSRF Token、登录限流、操作审计
- 阅读空间等独立站点

## 4. 架构与组件

```
lxtoxyf-site/
├── server.mjs              # Node 零依赖服务：静态文件 + API + 登录认证 + GitHub 同步
├── index.html              # 首页：hero + 项目展示 + 联系方式
├── projects.html           # 项目列表页
├── content.js              # 前台 JS：调用 API 渲染项目卡片
├── admin.html              # 后台登录页
├── dashboard.html          # 后台管理面板
├── admin.js                # 后台逻辑（登录、CRUD、排序）
├── admin.css               # 后台样式
├── assets/site.css         # 前台样式（参考项目插画风）
├── content/
│   └── projects.json       # 项目数据（初始 2 个项目）
├── Dockerfile              # node:24-alpine
├── deploy/Caddyfile        # lx-cloud.top 站点配置
└── DEPLOYMENT.md           # 部署文档
```

## 5. 数据流

### 前台读取

浏览器 → Cloudflare → Caddy（HTTPS :443）→ Node 容器 :3000 → `GET /api/projects` → 读取 `content/projects.json` → 返回 JSON → 前端渲染卡片。

### 后台保存

浏览器提交表单 → Node 校验字段与登录态 → 调 GitHub Contents API 提交 `portfolio/content/projects.json`（实际路径 `content/projects.json`）→ 成功后写入服务器本地文件 → 返回最新数据。

## 6. API 设计

| 方法 | 路径 | 说明 | 认证 |
| --- | --- | --- | --- |
| GET | `/api/projects` | 项目列表 | 无 |
| POST | `/api/admin/login` | 密码登录，签发 Cookie | 无 |
| GET | `/api/admin/session` | 会话状态 | 无 |
| GET | `/api/admin/state` | 后台初始数据 | 需登录 |
| POST | `/api/admin/projects` | 新建项目 | 需登录 |
| PUT | `/api/admin/projects/:id` | 编辑项目 | 需登录 |
| DELETE | `/api/admin/projects/:id` | 删除项目 | 需登录 |
| PUT | `/api/admin/projects/order` | 保存排序 | 需登录 |

项目字段：`id`（UUID）、`title`（≤100 字）、`url`（≤600，必须 http/https）、`summary`（≤360 字）、`tags`（≤8 个，每个 ≤24 字）。

## 7. 认证设计

- 密码从环境变量 `ADMIN_PASSWORD` 读取，不写进代码或前端。
- 登录成功生成 `payload = 过期时间戳`，用 `SESSION_SECRET` 做 HMAC-SHA256 签名，放入 `admin_session` Cookie。
- Cookie 属性：`HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`，HTTPS 下追加 `Secure`。
- 每次请求校验签名与过期时间，`timingSafeEqual` 防时序攻击。
- 管理页（`dashboard.html`）未登录时 303 跳转登录页。

## 8. GitHub 同步设计

- 目标仓库：`shu1371/blog`，分支 `main`，路径 `content/projects.json`。
- 使用环境变量 `GITHUB_TOKEN`（fine-grained PAT，仅该仓库 Contents 读写权限）。
- 每次写入：先查文件 SHA → 带 SHA 提交（PUT）→ 写本地。
- 令牌失效（401）或权限不足（403）时返回明确中文错误提示。

## 9. 页面与内容

### 首页 index.html

- 顶部导航：首页 / 项目 / 联系方式 + GitHub 外链
- hero：名字 lxtoxyf、tagline「持续学习，持续构建」、简短介绍「用代码把想法变成可以运行的作品」、装饰插画
- 项目作品卡片区（API 加载）
- 联系方式区：邮箱 lxtoxyf@163.com、GitHub 按钮
- 页脚：© 2026 lxtoxyf

### 项目页 projects.html

- 从 `/api/projects` 加载全部项目卡片（标题、简介、标签、仓库链接）

### 后台

- admin.html：密码登录（错误时提示）
- dashboard.html：项目列表、新建/编辑表单、删除按钮、上下移排序、保存提示

## 10. 视觉设计

- 参考项目插画风：颗粒纹理背景、贴纸/徽章装饰、暖色卡片
- 字体：Baloo 2（标题）+ Noto Sans SC（正文）
- 主色、间距、圆角在 `assets/site.css` 中定义，与参考项目气质一致但配色可微调

## 11. 初始项目数据

| 标题 | 简介 | 标签 | 链接 |
| --- | --- | --- | --- |
| financial-analysis | A股金融数据分析与可视化平台，支持K线/指标、双数据源回退、用户体系与游戏中心 | Python, Streamlit, MySQL, Plotly | github.com/shu1371/financial-analysis |
| points-discount | 积分优惠管理系统（C控制台），用户/商家/管理员角色与会员等级 | C | github.com/shu1371/points-discount |

## 12. 部署方案

1. Cloudflare：添加 A 记录 `lx-cloud.top → 144.34.185.9`，代理开启（橙云）。
2. GitHub：用户新建空仓库 `shu1371/blog`；创建 fine-grained PAT，仅授权该仓库 Contents 读写，令牌放入服务器 secrets。
3. 服务器（SSH）：
   - 拉取代码 → `docker build -t lxtoxyf-site:latest .`
   - `docker run`：env-file 注入 `ADMIN_PASSWORD`、`GITHUB_TOKEN`、`SESSION_SECRET`；挂载 `content` 目录；加入 Caddy 所在 Docker 网络。
4. Caddy：Caddyfile 增加：

   ```caddy
   lx-cloud.top {
       encode zstd gzip
       reverse_proxy lxtoxyf-site:3000
   }
   ```

   然后 `caddy validate` + `caddy reload`，自动签发 HTTPS 证书。
5. 验证清单：证书生效、首页 200、API 返回项目 JSON、后台登录、增删改与排序全部可用、内容同步产生 GitHub 提交。

## 13. 错误处理

- 字段校验：必填、URL 协议、长度限制，错误返回中文提示。
- 文件缺失/路径越界：返回 404。
- 服务异常：返回 500 JSON，日志输出具体原因。
- GitHub 401/403：明确提示更新令牌或授予权限。
- 排序提交：校验 ID 数量与完整性，防止部分提交。

## 14. 验证与测试

本地流程：

1. `node server.mjs` 启动，设置测试环境变量。
2. `curl /api/projects` 返回初始 2 个项目。
3. 登录接口正确签发/拒绝 Cookie。
4. 后台完成新建、编辑、删除、排序，确认 `projects.json` 更新、GitHub 提交产生（配置令牌时）。
5. 未登录访问管理 API 返回 401。

部署后按第 12 节验证清单逐项检查。

## 15. 后续扩展

- 笔记模块：新增 `notes/*.md`、笔记 API 与笔记页即可复用现有后台架构。
- 多管理员、CSRF、限流：按需在生产化阶段补充。
