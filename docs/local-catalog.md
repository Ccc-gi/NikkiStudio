# 本机家具目录与图标

家具名称来自当前 `X6Game/Saved/PaperBin` 的 TbItem 本地化记录，预览图来自物品配置的明确资源引用。分类来自 HomeNew 标签、物品标签数组和 DT_HomeObjectUIHierarchyType 的中文名称、图标与层级。目录不依赖研究版 JSON 或预导出图片；可选外部元数据用于尚未取得本机名称的回退与尺寸信息，设置页把这一项标为“家具名称与尺寸”。建造限制不再来自该文件，见 `adapters/build_rules.py`。

`adapters/paperbin_catalog.py` 解析已观察并验证的紧凑整数、字符串与目录关联。未知格式返回兼容性诊断，不覆写已存在的目录缓存。“设置 → 资源管理”显示解析覆盖数量；没有当前目录记录的物品保留 ID 与“未分类”，不推测名称或分类。

图标通过 `/api/icon/{version}/{package}.png` 按需读取，只允许当前配置明确引用的资源。普通 Texture2D 直接导出；游戏的 ExternalPaper2dAtlas 图标读取 PaperSprite 的图集引用与 BakedSourceUV / BakedSourceDimension，再裁剪原始像素。图标、图集与属性 JSON 存在用户私有版本缓存，源码不包含这些文件。最近两张解码后的图集留在内存，避免逐张图标重复解码。

资源版本已有 PaperBin、归档、密钥、usmap、解析器与家具数据指纹。游戏更新后新版本使用独立缓存，旧图标缓存保留。目录解析器另使用 `catalog-v1.json` 标识其结构，不因仅新增目录功能而使现有模型缓存失效。正常增量家具与图标自动读取；紧凑结构、标签表或图集布局发生不支持的变化时仍需要更新适配器，并在资源管理中明确提示。

`Runtime.validation_rules()` 把每件物品的建造规则、可用的染色方案与可建造区域一起交给 `/save_validation_rules.json`，编辑器的“建造合法性”开关与存档检查都读它。三者都来自游戏自身数据，不需要用户配置：规则由 `adapters/build_rules.py` 从 PaperBin 读出，染色方案由 `dyeSchemes` 汇总自 `parse_dye` 的 HomeColor 表，区域多边形与扩建解锁随编辑器内置（`adapters/build_area.py`）。读不出的记录标为“待确认”而不是编造限制，导出检查对它们只报告不判定。

规则读法见 `adapters/build_rules.py`：缩放范围按记录中出现的三个特征浮点对（0.7/1.3、0.7/2、0.1/2）判定，未出现则不可缩放；旋转的 Pitch/Roll 许可按四段记录布局各自读出，Yaw 从不受限。对 1342 件已知规则实测：缩放零误报零漏报，旋转 99.5% 正确。游戏更新改变紧凑布局时，读不出的部分会自动落入“待确认”，不会给出错误限制。

验证：`python -m unittest discover -s tests -p test_catalog.py` 检查整数边界、名称/分类关联、图集裁剪像素、路径限制与版本缓存隔离；`test_build_rules.py` 检查四段记录布局的旋转读法、缩放判定、未知布局返回 `None` 与接口返回形状，设 `NIKKI_TEST_PAPERBIN` 指向本机 PaperBin 时另比对 `tests/fixtures/build_rules_expected.json`（1342 件，缩放须全对、旋转须 ≥99%）；`node tests/save_validation.mjs` 检查缩放/旋转判定、区域多边形、染色两项与修正导出。实际游戏读取覆盖测试与浏览器验收另行记录，合成测试不能替代真实游戏兼容性验证。
