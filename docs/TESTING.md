# 本地验收

自动测试使用自主生成的微型 IoStore 目录、PaperBin、JSON 和立方体 GLB。测试替换转换后端，真实 AES 索引解析、配置校验、HTTP API、缓存切换和更新冲突处理保持正式实现。合成导出通过不能证明真实 Unreal 包支持。

`python -m unittest discover -s tests -v` 覆盖空配置、无预生成模型、首次请求生成、缓存命中、游戏更新检测、错误密钥拒绝、旧缓存保留、新版本隔离、HTTP Origin/token 和私有文件访问限制。

`npm test` 使用合成存档验证数值编辑、撤销/重做、复制及未知字段保留，逐字段比较导出的 JSON。

浏览器手工验收使用 `tests/serve_fixture.py --root <隔离目录> --port 8770`。它是明确标注的合成测试服务，正式启动入口没有 fake 模式。生成的输入见 fixture-inputs.json 与 input.usmap。打开配置页填写这些输入，载入 BUILD_SAVEDATA_12345.json，编辑 X 值并另存为。导出 JSON 应只改变目标坐标。

更新模拟只改动上述隔离目录的 Test.ucas/PaperBin，不碰真实游戏。模拟更新后旧资源接口返回 409，恢复视图显示旧模型；错误密钥或 usmap 校验失败时 active.json 不切换；有效新配置启用新的资源 URL。

真实游戏验收必须单独记录：从空用户数据目录输入实际游戏、AES 和 usmap，建立索引并实际导出指定家具，再在浏览器检查显示和材质。Windows 包内置解析器；源码运行需先构建解析器。实际冷缓存场景、染色编辑与导出和独立目录 Windows EXE 验收结果见 CHANGELOG.md 的 0.2.0 条目。分类完整性、游戏服务器接受编辑存档和未来游戏版本仍需要独立验证，不得用合成结果代替。
