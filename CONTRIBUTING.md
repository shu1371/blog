# 贡献指南

感谢你愿意为这个项目贡献代码。

## 本地开发

```bash
npm start
```

浏览器访问 http://localhost:3000。

需要环境变量 `ADMIN_PASSWORD` 与 `SESSION_SECRET`（详见 README）。

## 测试

```bash
npm test
```

提交前请确保全部测试通过。

## 提交规范

提交信息遵循 Conventional Commits：

- `feat:` 新功能
- `fix:` 缺陷修复
- `docs:` 文档
- `test:` 测试
- `chore:` 杂项

## Pull Request

1. 从 `main` 新建分支。
2. 提交清晰的、单一职责的改动。
3. 运行并通过 `npm test`。
4. 提交 PR 并描述改动内容。
