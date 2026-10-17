# 本地源码开发约定

- 源码仓库已直接位于 `NIKKI_BUILDER` 根目录，不再使用 `open_source` 子目录。后续只在当前仓库修改、测试和提交；同级 `NIKKI_BUILDER_legacy_*` 是移出的旧研究资料，不属于当前工程。
- 用户已明确授权构建 Windows Portable 免安装包，产物输出到同级 `NIKKI_BUILDER_RELEASE`。只在本源码工程持续迭代，用 Git 管理，保持源码可本地运行、功能正常。
- `project-policy.json` 的 `releaseEnabled` 已按用户指示设为 `true`。日常 CI 仍只做源码测试与审计；发布构建独立执行，不自动上传或改变 GitHub 仓库的可见性。
- 本地运行不得依赖 `dist` 内的文件。Python 虚拟环境、Node 依赖及解析器依赖可放在被忽略的 `.venv`、`node_modules` 和 `local`，它们属于运行依赖，不是产品发布包。
- 用户配置、密钥、usmap、存档、预设保存在独立用户数据目录；默认生成缓存放在工程 `local/cache`，不提交到 Git。清理缓存不得删除用户数据。显式 `--data-dir` 使用隔离数据目录中的缓存，供测试和独立配置使用。
- 使用 Python 脚本处理文件和中文数据，避免 PowerShell 编码问题。不要复制工程建立另一份工作版本。
