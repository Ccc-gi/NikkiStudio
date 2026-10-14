# 本地验收

自动测试使用自主生成的微型 IoStore 目录、PaperBin、JSON 和立方体 GLB。测试替换转换后端，真实 AES 索引解析、配置校验、HTTP API、缓存切换和更新冲突处理保持正式实现。合成导出通过不能证明真实 Unreal 包支持。

`python -m unittest discover -s tests -v` 覆盖空配置、无预生成模型、首次请求生成、缓存命中、游戏更新检测、错误密钥拒绝、旧缓存保留、新版本隔离、HTTP Origin/token 和私有文件访问限制。

真实游戏规则验收需设置 NIKKI_TEST_PAPERBIN，并通过 NIKKI_TEST_RULES 指定用户自己的规则对照 JSON；也可放在忽略的 local/validation-reference/build_rules_expected.json。未设置 PaperBin 时跳过真实数据测试，合成用例仍运行。游戏规则对照文件不随源码提交。

预设的验收分两层：`test_presets.py` 覆盖字段与路径校验、重名覆盖、损坏文件跳过和增删改查；`tests/presets.mjs` 覆盖场景与存档坐标互转的往返、整组落地后相对布局不变、放置一组物品只占一次撤销，以及删除高号物品后新建的物品不复用腾出的 instanceID。两者都用合成数据，不读写用户目录。

instanceID 冲突的依据来自一次真实对局：同一份导出里 91 行新建物品中，号是游戏先前没有的 25 行全部保住类型，号是游戏已有过的 66 行全部被换回旧类型，以「该号游戏是否见过」为判据 91/91 全中；而这 91 行输入时的 `bIsAdd` 一律为 `false` 却仍有 25 行被接受，故该标志不是判据。进一步做了对照实验：把那份导出原样保留内容、只把这 91 行的号整体移到游戏从没用过的号段，同一份存档即被游戏正常载入，物品类型不再被替换。据此确认判据是 instanceID 本身。同一实验也说明「键顺序」与「数值精度」不是判据：被正常载入的那份里 `furnitureInfo` 键序与游戏自己的写法并不一致。

编号保存回归：node tests/save_identity.mjs、node tests/instance_id_lifetime.mjs。真实 TARGET 与 bug 的保存输出已对比用户验证正常的修复文件；只重新编号 70 件冲突物品，保留物品类型、变换和染色。保存前仅修改输出副本，并记录编号上限。

`npm test` 使用合成存档验证数值编辑、撤销/重做、复制及未知字段保留，逐字段比较导出的 JSON；同一组还覆盖导入存档时的编号对齐——与目标存档不冲突的行不动、冲突的行换到两侧最大号之后、其 `attach_id` 跟着改、再次对齐不再变化。

浏览器手工验收使用 `tests/serve_fixture.py --root <隔离目录> --port 8770`。它是明确标注的合成测试服务，正式启动入口没有 fake 模式。生成的输入见 fixture-inputs.json 与 input.usmap。打开配置页填写这些输入，载入 BUILD_SAVEDATA_12345.json，编辑 X 值并另存为。导出 JSON 应只改变目标坐标。

更新模拟只改动上述隔离目录的 Test.ucas/PaperBin，不碰真实游戏。模拟更新后旧资源接口返回 409，恢复视图显示旧模型；错误密钥或 usmap 校验失败时 active.json 不切换；有效新配置启用新的资源 URL。

真实游戏验收必须单独记录：从空用户数据目录输入实际游戏、AES 和 usmap，建立索引并实际导出指定家具，再在浏览器检查显示和材质。Windows 包内置解析器；源码运行需先构建解析器。实际冷缓存场景、染色编辑与导出和独立目录 Windows EXE 验收结果见 CHANGELOG.md 的 0.2.0 条目。分类完整性、游戏服务器接受编辑存档和未来游戏版本仍需要独立验证，不得用合成结果代替。
