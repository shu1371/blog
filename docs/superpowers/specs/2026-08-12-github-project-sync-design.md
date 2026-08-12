# GitHub 项目自动同步设计文档

日期：2026-08-12

## 1. 背景与目标

lxtoxyf 个人网站（https://lx-cloud.top）的「项目作品」目前需要手动维护。本功能让网站每 3 天自动从 GitHub 拉取用户（shu1371）的公开仓库更新项目列表，并在后台提供「从 GitHub 更新项目」一键同步按钮，减少手工维护成本。

## 2. 需求确认

| 项 | 决定 |
| --- | --- |
| 自动同步周期 | 每 72 小时（3 天） |
| 一键更新 | 后台管理面板按钮，需登录 |
| 合并策略 | 合并保留：GitHub 仓库自动新增/更新；手动添加的非 GitHub 项目保留不删除 |
| 简介策略 | 已存在条目的手动润色简介/标签保留；缺失时用仓库描述或 README 首段生成 |
| 数据源 | `api.github.com/users/shu1371/repos`（有令牌带认证头） |
| 同步结果 | 写入 `content/github-sync.json`（时间、新增/更新数量） |

## 3. 架构与组件

| 文件 | 职责 |
| --- | --- |
| `app.mjs` | 新增 GitHub 同步服务、调度器、同步 API |
| `dashboard.html` | 项目分区增加同步按钮与上次同步时间 |
| `admin.js` | 一键同步调用与结果提示 |
| `admin.css` | 同步按钮/状态样式 |
| `test/github-sync.test.mjs` | 同步逻辑测试（mock fetch） |
| `DEPLOYMENT.md` | 同步机制说明 |

## 4. 同步逻辑 `syncProjectsFromGithub()`

1. 请求 `GET https://api.github.com/users/shu1371/repos?per_page=100&sort=updated`；若配置了 `GITHUB_TOKEN` 则附加 `Authorization: Bearer` 头，未配置也能匿名读取公开仓库。
2. 对每个仓库生成条目：
   - `id` / `title` = 仓库名
   - `url` = 仓库 `html_url`
   - `tags` = 仓库 `topics`（若返回），否则按 `language` 生成，去空、上限 8 个
   - `summary` = 仓库 `description`；为空时抓取 README（`GET /repos/:owner/:repo/readme`），取正文首个非空段落（截断 280 字）；README 失败则用 `开源项目（语言）` 兜底
3. 合并（见第 5 节）后调用现有 `saveProjects(merged, 'content: sync projects from GitHub')`，提交 GitHub 元数据并写本地。
4. 更新 `content/github-sync.json`：

```json
{
  "lastSync": "2026-08-12T12:00:00.000Z",
  "repos": 4,
  "added": 1,
  "updated": 0,
  "message": "同步完成"
}
```

## 5. 合并规则

- 以 `url` 是否为 `github.com/shu1371/` 前缀判断 GitHub 来源条目。
- 已存在的 GitHub 条目：保留原 `summary` 与 `tags`（尊重手动润色），仅刷新 `url`/`title`；若原条目缺失简介，填充生成值。
- 新仓库：生成新条目并插入列表头部（GitHub 条目区域）。
- 非 GitHub 的手动条目：位置与内容原样保留，不删除。
- 任何条目都不因 GitHub 端删除而移除（只增不删，配合合并保留策略）。

## 6. 自动调度

- 服务启动后：读取 `github-sync.json`，若文件缺失或 `lastSync` 距当前超过 72 小时，则异步触发同步（不阻塞启动响应）。
- 启动后每 6 小时检查一次，同样按 72 小时判定。
- 全局 `syncing` 标志防止并发重入；自动同步失败仅记录日志，不影响网站运行。
- 定时器在 `createApp` 返回的 server 上挂载；测试通过 `options.disableAutoSync` 控制调度：启动触发测试使用启用调度的实例并 mock fetch，其余测试禁用调度、改为直接调用同步接口。

## 7. API 设计

| 方法 | 路径 | 说明 | 认证 |
| --- | --- | --- | --- |
| POST | `/api/admin/projects/sync` | 立即同步，返回 `{ projects, lastSync, added, updated }` | 需登录 |
| GET | `/api/admin/state` | 响应增加 `githubSync` 字段（上次同步信息） | 需登录 |

路由顺序：`/api/admin/projects/sync` 必须放在 `/api/admin/projects/:id` 正则匹配之前。

## 8. 错误处理

| 场景 | 行为 |
| --- | --- |
| GitHub API 请求失败 / 限流 | 手动同步返回 500 中文错误；自动同步仅记日志 |
| 单个仓库 README 抓取失败 | 忽略该仓库的简介生成，使用兜底文案 |
| 同步进行中再次请求 | 返回当前进行中提示，不重入 |
| 未登录调用同步接口 | 401 |

## 9. 后台 UI

- 项目分区头部新增「从 GitHub 更新项目」按钮与「上次同步：X 前」文本。
- 点击后按钮进入「正在同步…」忙状态，完成后 toast 显示「同步完成：新增 X 个、更新 Y 个」并刷新列表与同步时间；失败显示错误原因。

## 10. 测试（`test/github-sync.test.mjs`）

测试中替换全局 `fetch` 模拟 GitHub 响应（不依赖真实网络）：

1. 无状态文件时启动触发同步，projects.json 合并新增仓库
2. 手动添加的非 GitHub 项目被保留
3. 已存在 GitHub 条目的手动简介/标签被保留
4. 新仓库插入列表头部
5. `github-sync.json` 正确写入（lastSync / added / updated）
6. 距上次同步 4 天 → 触发；2 天 → 不触发
7. `POST /api/admin/projects/sync` 未登录返回 401
8. 登录后调用同步接口返回最新列表与统计
9. README 抓取失败时使用兜底简介

## 11. 部署

- 无新增挂载；`github-sync.json` 位于 `content/`（已 rw，随服务器备份）。
- 更新流程：本地 → GitHub → 服务器 `git pull` → 重建镜像 → 重建容器。
- 部署验证清单：
  1. 后台点「从 GitHub 更新项目」成功，toast 显示统计
  2. `content/github-sync.json` 生成且 `lastSync` 为当前时间
  3. 项目列表保持 4 个且无重复
  4. 手动添加一个测试项目后再同步，确认被保留
  5. 重启容器后状态文件仍生效

## 12. 不包含（本期）

- GitHub 端删除仓库时同步移除站点项目（只增不删）
- 前台公开同步按钮
- 可配置的同步周期（固定 72 小时）
