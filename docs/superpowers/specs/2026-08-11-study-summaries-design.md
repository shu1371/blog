# 学习小结模块设计文档

日期：2026-08-11

## 1. 背景与目标

在 lxtoxyf 个人网站（https://lx-cloud.top）上新增「学习小结」模块：管理员登录后台后上传学习总结文档（仅 doc / docx / pdf，单文件 ≤10MB），访客在公开页面查看文档列表并下载。

## 2. 需求确认

| 项 | 决定 |
| --- | --- |
| 上传权限 | 仅后台管理员（需登录） |
| 访客权限 | 查看列表 + 下载 |
| 展示方式 | 卡片式：标题、日期、简介、文件类型与大小、下载按钮 |
| 允许格式 | doc / docx / pdf |
| 大小限制 | 单文件 ≤ 10MB，上传请求总大小 ≤ 10MB |
| 文件存储 | 服务器本地 `content/documents/`，二进制不同步 GitHub |
| 元数据 | `content/documents.json`，照常同步 GitHub |

## 3. 架构与存储

### 存储

- 文档文件：`content/documents/<uuid>.<ext>`（uuid 为存储名，扩展名取自白名单）
- 元数据：`content/documents.json`

```json
[
  {
    "id": "uuid",
    "title": "标题",
    "date": "2026-08-11",
    "summary": "简介",
    "filename": "原始文件名.docx",
    "stored": "<uuid>.docx",
    "size": 123456,
    "type": "docx",
    "uploadedAt": "2026-08-11T12:00:00.000Z"
  }
]
```

### 目录职责

| 文件 | 职责 |
| --- | --- |
| `app.mjs` | 新增 multipart 解析、文档校验、文档 API、GitHub 元数据同步 |
| `summaries.html` | 前台学习小结列表页 |
| `content.js` | 扩展：渲染学习小结卡片 |
| `dashboard.html` / `admin.js` / `admin.css` | 后台学习小结上传与删除 |
| `assets/site.css` | 学习小结卡片样式 |
| `test/documents.test.mjs` | 文档模块测试 |

## 4. API 设计

| 方法 | 路径 | 说明 | 认证 |
| --- | --- | --- | --- |
| GET | `/api/documents` | 文档列表（按日期倒序） | 无 |
| GET | `/api/documents/:id/download` | 下载文档 | 无 |
| POST | `/api/admin/documents` | multipart 上传 | 需登录 |
| DELETE | `/api/admin/documents/:id` | 删除文档与元数据 | 需登录 |
| GET | `/api/admin/state` | 响应增加 `documents` 字段 | 需登录 |

上传请求为 `multipart/form-data`，字段：`file`（二进制）、`title`（≤120 字，必填）、`date`（YYYY-MM-DD，必填）、`summary`（≤360 字，可选）。

## 5. 上传校验（三层）

1. **扩展名白名单**：`.doc` / `.docx` / `.pdf`（大小写不敏感）。
2. **Magic bytes**：
   - `.pdf`：文件头必须为 `%PDF-`
   - `.doc`：文件头必须为 `D0 CF 11 E0`（OLE2）
   - `.docx`：文件头必须为 `50 4B 03 04`（ZIP）
3. **大小**：单文件 ≤ 10MB，请求体累计 ≤ 10MB（超出即中止并返回 400）。

任一校验失败返回 400，中文错误提示。

## 6. 安全设计

- 上传仅限已登录管理员（`authed()` 校验）。
- 存储名使用 `randomUUID()`，与用户原始文件名解耦，防止路径穿越。
- 下载响应强制 `Content-Disposition: attachment`，浏览器直接下载、不内联渲染。
- 原始文件名在元数据中单独保存，输出时 HTML 转义。
- MIME 白名单：`application/pdf`、`application/msword`、`application/vnd.openxmlformats-officedocument.wordprocessingml.document`。
- 删除时先确认文件存在，`unlink` 文件后更新元数据并同步 GitHub。

## 7. 前台页面

- 新增 `summaries.html`（导航「学习小结」，位于项目与联系方式之间）。
- 从 `/api/documents` 加载卡片：标题、日期、简介、类型/大小、下载按钮。
- 空状态：`还没有学习小结`；加载失败提示重试。

## 8. 后台页面

- `dashboard.html` 新增「学习小结」分区：
  - 上传表单：文件选择、标题、日期、简介
  - 文档列表：标题、日期、大小、删除按钮（带确认）
- 提示复用 toast：成功「文档已上传/已删除」，失败显示服务端中文错误。

## 9. 错误处理

| 场景 | 状态码 |
| --- | --- |
| 未登录上传/删除 | 401 |
| 非法扩展名 / magic 不匹配 / 超限 / 缺字段 / 日期格式错误 | 400 |
| 文档或文件不存在 | 404 |
| 服务异常 | 500 |

## 10. 测试

`test/documents.test.mjs`（node:test，临时目录隔离，不污染仓库数据）：

1. GET /api/documents 初始为空列表
2. 未登录上传返回 401
3. 上传 `.txt` 返回 400（非法类型）
4. 上传 `.pdf` 但内容非 PDF 返回 400（magic 不匹配）
5. 上传超过 10MB 返回 400
6. 缺少标题返回 400
7. 上传合法 PDF 返回 201，文件落盘、元数据更新、列表 +1
8. 下载返回 200 且带 `Content-Disposition: attachment`
9. 删除返回 200，文件与元数据同步移除
10. 不存在的文档下载/删除返回 404

## 11. 部署

- 无需新增 Docker 挂载（`content` 目录已 rw）。
- 服务端启动时确保 `content/documents/` 目录存在（`mkdir recursive`）。
- 更新流程：本地推送 GitHub → 服务器 `git pull` → `docker build` → 重建容器。
- `DEPLOYMENT.md` 补充：文档位于 `/opt/lx-cloud.top/content/documents/`，随 content 目录一起备份。
- 部署后验证清单：
  1. 后台分别上传 doc / docx / pdf 各一次，均成功
  2. 上传 txt / 超限文件被拒绝
  3. 前台学习小结页可见并可下载
  4. GitHub 出现 `content/documents.json` 元数据提交

## 12. 不包含（本期）

- 文档在线预览（仅下载）
- 公开上传
- 文档排序拖拽（按日期倒序）
- 文档编辑（删除后重新上传）
