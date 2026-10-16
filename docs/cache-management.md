# 缓存与卸载

默认资源缓存位于工程 `local/cache`（Git 忽略）。版本目录保存模型、材质、贴图及图标；`preset-previews` 保存可再生成缩略图。游戏更新不会自动删除旧版本。

配置、密钥、映射输入、预设仍在 `%LOCALAPPDATA%/NikkiStudio`。显式 `--data-dir` 或 `NIKKI_STUDIO_DATA` 使用该独立目录的 `cache`，用于隔离实例和测试。

设置 → 资源管理显示资源缓存、历史版本、测试产物、遗留用户目录缓存和已登记的跨盘转换临时文件。可以清理旧版本（保留当前激活版本）和当前浏览器的资源缓存。新资源响应使用 `no-store`，避免浏览器长期保存模型的第二份副本；页面关闭前的模型仍在内存中。

在工程目录执行，所有命令不加 `--apply` 时只显示统计：

```text
.venv\Scripts\python.exe scripts/manage_cache.py status
.venv\Scripts\python.exe scripts/manage_cache.py migrate --apply
.venv\Scripts\python.exe scripts/manage_cache.py old --apply
.venv\Scripts\python.exe scripts/manage_cache.py clear --apply
.venv\Scripts\python.exe scripts/manage_cache.py uninstall --apply
```

迁移会停止使用同一用户目录的 8768/8769 服务，保持版本、缓存 epoch 和当前版本指针；跨盘逐文件校验后才移除原件，目标冲突不覆盖。使用其他端口时须先关闭那个实例。

`clear` 停止本地服务并移除全部资源缓存及已登记的游戏盘临时转换目录，保留配置和预设。`uninstall` 额外移除工程 `test-results` 和源码 Python 编译缓存。不会卸载 Python/Node，不修改游戏文件，也不删除用户下载的存档。

彻底卸载步骤：

1. 另存为未保存的存档，导出预设备份。
2. 在每个用过的浏览器和地址（含其他端口）清理资源缓存；勾选卸载选项可同时移除该地址的编辑器偏好、目录授权和实例编号预留。浏览器是否执行 `Clear-Site-Data` 由浏览器支持情况决定；不支持时请在浏览器站点设置删除该地址的数据。
3. 关闭所有编辑器标签页，执行 `scripts/manage_cache.py uninstall --apply --remove-user-data`（使用上述虚拟环境 Python）。这会删除配置、密钥和持久化预设，因此必须先备份。
4. 删除工程目录，其中包括 `.venv`、`node_modules`、本地解析器、构建中间文件和运行日志。

工程外同级 `NIKKI_BUILDER_legacy_*` 是用户保留的历史资料，不属于此清理范围。旧版本中未登记的系统临时目录也不会按名称猜测删除。新跨盘转换目录登记后可清理；正常转换结束会立即移除。

当前没有自动容量淘汰策略。容量管理采用显式清理，避免自动删除需要恢复的旧版本。

## 清除缓存后重新加载

先另存为编辑器中尚未保存的修改，关闭旧编辑器标签页。在工程目录运行：

```text
.venv\Scripts\python.exe launch.py --clear-cache
```

该操作正常关闭使用同一数据目录的 8768/8769 服务，等待转换退出，删除全部版本的生成资源缓存和旧缓存恢复指针，随后重新校验资源并打开浏览器缓存清理页。AES、usmap、目录配置、预设和存档保留。清理期间若转换未结束或目录含链接则停止，允许稍后重试。

资源 URL 包含游戏输入指纹与缓存代次，清缓存时更新代次。UI、配置及资源响应使用 `no-store`，生成资源由后端磁盘缓存复用；旧浏览器副本可在设置中请求清理。

这个操作用于验证无模型缓存时的转换与加载，不会移除已安装依赖、解析器或用户配置，不能代替从源码首次安装测试。
