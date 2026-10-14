# Nikki Studio

本地家园 JSON 存档编辑器，Windows 首发。工程只分发代码和通用依赖，不包含游戏模型、贴图、AES、usmap 或玩家存档。

资源流程：启动时读取当前游戏的归档目录索引；使用家具时解析它的配置；导入存档时合并这份存档实际使用的模型和材质依赖，通过常驻解析器复用游戏挂载进行转换；结果留在用户缓存。不会预先导出整个家具库。

## 玩家使用

解压 Windows 发布包，运行 `NikkiStudio.exe`。无需安装 Python 或 Node.js。

首次页面选择游戏目录，粘贴自己取得的 AES JSON，选择匹配的 usmap 二进制文件。Windows 发行版已包含常驻资源解析器，无需另选 cue4parse.exe，也无需安装 .NET。解析器原生解压依赖会按上游机制初始化，首次配置需要可用的网络或已存在的本地依赖。源码环境可以构建常驻解析器，也保留用户自备 CUE4Parse.CLI 的兼容接口。

AES 与 usmap 参考链接在配置页中；服务不会抓取它们。`/mappings` 返回的 JSON 是元数据，要取得实际 `.usmap` 文件。AES 只送给回环地址上的本地服务。配置、输入文件和缓存默认在 `%LOCALAPPDATA%/NikkiStudio`，可以用 `--data-dir` 或 `NIKKI_STUDIO_DATA` 更改。

配置通过后进入编辑器，可以打开 JSON，也可以从顶部列表载入所选安装目录的家园存档。首次显示某个模型需要转换；再次使用命中本地缓存。另存为通过浏览器下载 JSON。原来的“选择游戏目录”按钮用于浏览器授权存档写回，模型资源配置使用顶部“资源配置”。Chrome/Edge 支持写回目录授权；写回前备份并检查外部修改。

游戏发生更新时提示重新校验，当前版本资源接口停止继续提供旧版本结果。旧缓存保留，“旧缓存恢复视图”只显示已生成的模型；不会把旧数据宣称为当前游戏结果。重新校验成功后资源 URL 改变，浏览器不会复用旧版本模型。

## 开发运行

需要 Python 3.11+、Node.js LTS（npm）。从工程目录运行：

```text
py -3 -X utf8 scripts/setup_dependencies.py
.venv/Scripts/python.exe launch.py
```

或者安装 requirements.txt、运行 `npm ci` 后执行 `py -3 -X utf8 start.py --port 8768`。路径依据源码位置解析，不依赖当前终端目录。

```text
py -3 -X utf8 -m unittest discover -s tests -v
npm test
py -3 -X utf8 scripts/audit_release.py
py -3 -X utf8 scripts/build_release.py
```

构建常驻解析器需要 .NET 10 SDK 和 Git：运行 `py -3 -X utf8 scripts/build_parser_worker.py`，脚本使用固定的 CUE4Parse 源码提交，输出自带运行时的解析器到 local/parser-worker。构建 Windows 包：在构建环境安装 `requirements-build.txt`，再运行 `scripts/build_release.py --windows`。输出在 dist。所有发布文件使用明确的允许清单，并再次检查游戏包、模型、密钥字面值和电脑路径。

## 当前兼容边界

- PaperBin 适配器针对已观察的 HomeObject 紧凑结构，静态组件和部分骨骼组件已支持；未知结构保留存档并显示占位。
- 蓝图在使用时导出模板、解析父模板和组件挂接树，运行时动画、特效和可配置部件仍为参考姿态。
- 同一资源出现于多个归档时，按 CUE4Parse 的数字 `_P` 读取优先级选择；最高优先级仍有多个候选时拒绝任意选择。新的游戏专有覆盖规则需要扩展适配器。
- 缺少部分归档密钥时，允许查看已验证归档的家具，同时明确提示覆盖不完整；不能保证未解锁归档没有更新同名资源。
- 本版索引覆盖 IoStore utoc/ucas；独立 pak 的变化纳入更新指纹，但尚未建立其中的资源目录。主要以独立 pak 存储模型的游戏版本需要补充归档适配器。
- 材质使用当前游戏中的明确引用及限定目录内的同材质贴图配对，合批解析父材质。原生 BC 贴图通过标准 KTX2 无重压缩传给支持的 GPU，其他格式或缺少 GPU 扩展时走 PNG 兼容路径。染色配置从当前游戏 PaperBin 读取，支持组合组件、独立区域、纹理变体和调色遮罩。UE 分层地形、镜面、水体和运行时特效的着色仍有近似，建造限制未完成；模型全部就绪不代表完全复现游戏引擎效果。
- 资源更新指纹包含完整 utoc 哈希、ucas/pak 文件名、大小与修改时间、PaperBin/usmap/AES/解析器与关键程序集内容哈希、适配器版本及清缓存代次。恶意保持大文件大小和时间不变的内容替换不在自动检测保证范围内。

查看 [架构说明](docs/ARCHITECTURE.md) 和 [测试说明](docs/TESTING.md)。第三方来源与许可见 NOTICE.md。

### 清缓存进行冷启动测试

先另存为编辑器中尚未保存的修改，关闭旧编辑器标签页。Windows 发行版运行 NikkiStudio.exe --clear-cache；源码环境运行 python launch.py --clear-cache。该操作正常关闭使用同一数据目录的 8768/8769 服务，等待转换退出，删除生成的资源缓存和旧缓存恢复指针，随后重新校验资源并打开浏览器缓存清理页。AES、usmap、目录配置和存档保留。下一次导入按需重新转换模型和贴图。清理期间若转换未结束或目录含链接则停止，允许稍后重试。此操作会删除所有旧版本资源缓存，适用于首次加载测试。

资源 URL 包含游戏输入指纹与缓存代次；清缓存时更新代次，下一次导入不会命中旧 HTTP 资源缓存。UI 与配置接口保持 no-store，版本化模型与贴图使用浏览器标准 HTTP 缓存，避免重复写入 CacheStorage。
