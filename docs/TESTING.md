# 测试与验收

测试分为自动回归、首次安装和真实游戏验收。合成数据测试覆盖编辑器行为与资源流程，真实解析和游戏存档兼容性需要使用匹配版本的游戏输入单独验证。

## 自动测试

安装源码依赖后，在工程目录运行：

```text
.venv\Scripts\python.exe -X utf8 -m unittest discover -s tests -v
npm test
.venv\Scripts\python.exe -X utf8 scripts/audit_release.py
```

| 范围 | 主要覆盖内容 |
| --- | --- |
| 配置与资源服务 | 空配置、输入校验、首次请求生成、缓存命中、游戏更新检测、旧缓存保留及新版本隔离 |
| 本地接口 | HTTP Origin、会话 token、私有文件访问限制及更新冲突处理 |
| 存档编辑 | 数值编辑、撤销与重做、复制、未知字段保留及导出 JSON 对比 |
| 实例编号 | 与目标存档的编号冲突处理、关联 attach_id 更新、删除后不复用已分配编号及重复对齐稳定性 |
| 预设库 | 字段与路径校验、增删改查、损坏文件处理、坐标往返、整组放置与撤销 |
| 预设预览 | 横竖视口取景、PNG 输出、缓存版本与路径校验 |

自动测试使用自主生成的微型 IoStore 目录、PaperBin、JSON 和立方体 GLB，部分用例替换转换后端。合成测试通过不能证明真实 Unreal 包可解析，也不能证明游戏会接受导出的存档。

真实游戏规则测试使用以下配置：

- `NIKKI_TEST_PAPERBIN`：实际游戏的 PaperBin 目录。
- `NIKKI_TEST_RULES`：自备规则对照 JSON；也可放在被 Git 忽略的 `local/validation-reference/build_rules_expected.json`。

未设置 PaperBin 时，真实数据测试会跳过，合成用例仍运行。游戏输入与规则对照文件不随源码提交。

## 从源码首次安装

在干净 Windows 环境中获取源码，按 [README](../README.md) 完成工具安装、依赖安装、解析器构建和启动。不复用其他环境的 `.venv`、`node_modules`、`local` 或用户配置。

记录源码提交、Windows 与工具版本、执行命令及错误信息。确认依赖可安装、资源解析器可从源码构建、空配置下可打开配置页，再继续真实游戏验收。

已有开发环境可使用独立数据目录检查空配置：

```text
.venv\Scripts\python.exe launch.py --data-dir local/isolated-data
```

该方式仍共享工程依赖与解析器，不能代替首次安装测试。`launch.py --clear-cache` 用于验证无模型缓存时的重新转换，行为见 [缓存管理](cache-management.md#清除缓存后重新加载)。

## Windows Portable 验收

在未安装 Python、Node.js、Git 和 .NET SDK 的 Windows x64 环境中，按 [Portable 使用说明](PORTABLE.md) 操作：

1. 核对 ZIP 的 SHA256，完整解压到包含中文和空格的可写路径。
2. 双击 `NikkiStudio.exe`，确认浏览器打开配置页，应用名称与图标正确。
3. 使用独立配置完成真实游戏验收，确认随包解析器可运行。
4. 退出后重新启动，确认配置、预设和缓存复用正常。
5. 使用 `Exit.cmd` 退出，确认服务停止；使用 `ClearCache.cmd` 后确认资源重新转换且私有配置与预设保留。

只在开发机屏蔽工具 PATH 不能代替干净系统验收。源码运行测试与 Portable 验收应分别记录。

## 真实游戏验收

准备自己的游戏目录、匹配版本的 AES JSON、二进制 usmap 和家园存档副本，在 Chrome 或 Edge 中检查：

1. 从空配置完成资源校验，实际加载家具模型、材质与染色。
2. 导入家园存档，检查场景列表、模型缺失提示与布局。
3. 放置家具并调整位置、旋转、缩放和配色，检查撤销与重做。
4. 创建、预览、导入和导出预设；预览操作不应改变主场景文档、选择或相机。
5. 另存为新 JSON 并重新打开，核对物品类型、变换、染色及未知字段。
6. 授权游戏存档目录后检查备份与写回；外部修改应阻止覆盖。
7. 单独检查游戏能否读取导出存档，关注物品类型、实例编号、建造限制与配色。

记录应用版本、游戏版本、浏览器、显卡环境、测试项目和结果。加载性能与兼容性结论仅适用于所记录的环境。测试报告不包含密钥、映射或完整玩家存档。

## 合成浏览器场景与更新模拟

运行 `tests/serve_fixture.py --root <隔离目录> --port 8770` 启动合成测试服务。按生成的 `fixture-inputs.json` 与 `input.usmap` 完成配置，载入 `BUILD_SAVEDATA_12345.json`，修改 X 坐标并另存为；导出内容应只改变目标字段。正式启动入口没有合成模式。

更新模拟仅修改隔离目录的 `Test.ucas` 或 PaperBin。检查旧资源接口返回 409、恢复视图可显示旧模型；错误密钥或 usmap 校验失败时 `active.json` 不切换，有效新配置启用新的资源 URL。测试不修改真实游戏文件。
