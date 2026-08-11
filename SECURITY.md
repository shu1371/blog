# 安全说明

## 报告安全问题

如果发现本项目的安全漏洞，请优先使用 GitHub 的**私有漏洞报告（Private vulnerability reporting）**功能提交，避免公开披露细节。

也可以通过邮件联系维护者：lxtoxyf@163.com。

## 安全设计参考

- 后台登录使用 HMAC-SHA256 签名的 HttpOnly Cookie，12 小时会话有效。
- 管理接口未登录一律返回 401。
- 学习小结上传仅限 doc / docx / pdf，扩展名与文件头双重校验，单文件 ≤10MB。
- 存储文件使用 UUID 命名，防止路径穿越。
- 生产环境仅暴露 80/443，Node 服务不直接对外。
