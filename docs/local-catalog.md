# 本机家具目录与图标

家具名称来自当前 `X6Game/Saved/PaperBin` 的 TbItem 本地化记录，预览图来自物品配置的明确资源引用。分类来自 HomeNew 标签、物品标签数组和 DT_HomeObjectUIHierarchyType 的中文名称、图标与层级。目录不依赖研究版 JSON 或预导出图片；可选外部元数据只用于尚未取得本机名称的回退与尺寸信息。

`adapters/paperbin_catalog.py` 解析已观察并验证的紧凑整数、字符串与目录关联。未知格式返回兼容性诊断，不覆写已存在的目录缓存。“设置 → 资源管理”显示解析覆盖数量；没有当前目录记录的物品保留 ID 与“未分类”，不推测名称或分类。

图标通过 `/api/icon/{version}/{package}.png` 按需读取，只允许当前配置明确引用的资源。普通 Texture2D 直接导出；游戏的 ExternalPaper2dAtlas 图标读取 PaperSprite 的图集引用与 BakedSourceUV / BakedSourceDimension，再裁剪原始像素。图标、图集与属性 JSON 存在用户私有版本缓存，源码不包含这些文件。最近两张解码后的图集留在内存，避免逐张图标重复解码。

资源版本已有 PaperBin、归档、密钥、usmap 与解析器指纹。游戏更新后新版本使用独立缓存，旧图标缓存保留。目录解析器另使用 `catalog-v1.json` 标识其结构，不因仅新增目录功能而使现有模型缓存失效。正常增量家具与图标自动读取；紧凑结构、标签表或图集布局发生不支持的变化时仍需要更新适配器，并在资源管理中明确提示。

验证：`python -m unittest discover -s tests -p test_catalog.py` 检查整数边界、名称/分类关联、图集裁剪像素、路径限制与版本缓存隔离。实际游戏读取覆盖测试与浏览器验收另行记录，合成测试不能替代真实游戏兼容性验证。
