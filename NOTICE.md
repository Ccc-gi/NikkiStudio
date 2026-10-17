# 第三方声明

部分存档检查规则算法、交互参考和染色公式来自 BuildingMomo（ChanIok，MIT）。保留的许可见 third_party/BuildingMomo-LICENSE.txt。发布包不包含其游戏图标和家具数据库；用户可选择本机已有家具 JSON，来源由用户管理。

Three.js 0.183.0 从 npm 安装，MIT；其原始 LICENSE 随 Windows 包中的依赖保留。官方许可：https://threejs.org/license/ 。

精细模式的 PCSS 软阴影辅助代码改编自 pmndrs/drei-vanilla，固定提交 28978f680f9071e4f4794611781c19f46de48e35，MIT。保留源码归属注释及 third_party/drei-vanilla-LICENSE.txt；修改包括 TypeScript 转为 JavaScript、适配 Three.js r183 的原始深度纹理，并由编辑器负责画质切换后的场景重编译。来源：https://github.com/pmndrs/drei-vanilla/blob/28978f680f9071e4f4794611781c19f46de48e35/src/core/pcss.ts 。云层和草地贴图由本项目代码原创生成，没有捆绑网络图片。

Nikki.AssetWorker 是本项目的常驻 stdio 解析器，Windows 包包含其自带 .NET 运行时的构建，依赖固定 CUE4Parse 提交 ab447bbcd4e11f426c41c417cacd937fab71c789。上游 LICENSE、NOTICE 与 NuGet 依赖许可保存在 parser-worker 中。构建脚本从上游获取依赖源码，本源码包不包含游戏资源。CUE4Parse.CLI 作为可替换的外部兼容接口由用户自备。来源：https://github.com/joric/CUE4Parse.CLI ，上游：https://github.com/FabianFG/CUE4Parse 。上游仓库声明 Apache-2.0，并另列第三方依赖许可；外部二进制的完整依赖与分发条件由其发行者提供。

cryptography、numpy、PyInstaller 及其运行时依赖的许可随构建包保留；依赖锁定与本地构建结果见发布清单。

游戏美术、归档、密钥、映射文件和真实存档不属于本项目的开源内容。源码许可证不授予这些内容的权利。

应用的小屋积木图标由本项目使用图像生成工具制作，不使用游戏官方图标。PNG 与 Windows ICO 随程序提供。
