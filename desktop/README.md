# Workday Escape 开发者文档

桌面版使用 **Vue 3、TypeScript 和 Electron**。当前源码为 **v2.1.2 候选**，正式发布版本为 **v2.1.1**。下载与使用请看 [项目首页](../README.md)，已发布资产见 [GitHub Release](https://github.com/ZY0219z/Workday-countdown/releases/tag/v2.1.1)。

## 开发环境与启动

开发和 Windows 打包使用 Windows x64、Node.js 22.12 或更新的版本。首次安装依赖及下载构建工具需要联网。从仓库根目录运行以下命令。

```powershell
cd desktop
npm ci
npm run dev
```

`npm run dev` 会打开开发窗口。以下命令在 `desktop/` 下执行，分别用于类型检查和生产构建。生产构建包含类型检查，输出到 `out/`。

```powershell
npm run typecheck
npm run build
```

## 代码结构

| 目录 | 内容 |
| --- | --- |
| [src/main/](src/main/) | Electron 主进程，负责窗口、托盘、配置存储和 IPC |
| [src/preload/](src/preload/) | 主窗口和 Mini 的受限接口 |
| [src/renderer/](src/renderer/) | Vue 仪表盘、设置及 Mini 界面 |
| [src/domain/](src/domain/) 和 [src/shared/](src/shared/) | 日历、班次等业务计算，以及类型、数据契约和校验 |
| [resources/calendar/](resources/calendar/) | 已核验的 2024–2027 年离线工作日历 |
| [tests/](tests/) 和 [scripts/](scripts/) | 测试、打包和静态检查脚本 |

正式配置位于 `%APPDATA%\Workday Escape\settings.json`，备份为同目录下的 `settings.backup.json`。应用自动读取和保存设置，数据目录与 EXE 的位置无关。测试使用项目已有的临时配置机制，避免读写正式数据。

IPC 校验已登记窗口、当前主 Frame、精确页面 URL 和窗口角色。Main 和 Mini 使用各自登记的 URL 加载页面。渲染进程启用 `contextIsolation` 和 `sandbox`，并关闭 `nodeIntegration`。

## Portable 构建

从 `desktop/` 运行构建命令，每次选择一个新的输出目录，保留历史候选。

```powershell
npm run package:win -- --config.directories.output=release/local-v212-example
```

该命令使用 electron-builder 生成 Windows x64 Portable `Workday Escape.exe`。`--publish never` 使构建与发布分开。候选 ZIP `Workday-Escape-v2.1.2-Portable.zip` 的根目录只有这个 EXE，`win-unpacked/` 等构建产物用于本地核验。

- [V2.1.2 年度维护及候选验收记录](../docs/version/V2.1.2/V2.1.2_TASKS.md)
- [V2.1.2 2027 年日历核验](../docs/version/V2.1.2/D04_CALENDAR_VERIFICATION.md#year2027)
- [V2.1.1 构建、产物身份及验收记录](../docs/version/V2.1.1/V2.1.1_TASKS.md)
- [V2.1.0 历史任务记录](../docs/version/V2.1.0/V2.1.0_TASKS.md)

## 历史 POC

根目录的 Python 原型和桌面版阶段 1 POC 均为历史实现。下方的版本号、命令、配置路径和验证结果属于阶段 1。

<details>
<summary>查看阶段 1 POC 开发与验证记录</summary>

# Workday Escape V2.0 阶段 1 POC

此目录是当前仓库内的 Vue 3 + TypeScript + Electron 工程。根目录的 Python 程序、`config.json`、资源和原 PyInstaller 产物均保留。

仅实现基础窗口、同日上下班时间配置、每秒更新的下班倒计时、JSON 保存及退出。使用电脑本地日期和时间；下班后显示 `00:00:00`，次日重新计算。尚未上班时仍显示距离当天下班的剩余时间。节假日、发薪日、入职天数、加班、小鱼动画均未迁移。

## 开发与构建

构建机需要 Windows x64 和 Node.js 22.12+（本次使用 22.18.0）。终端进入此目录后执行：

```powershell
npm ci --registry=https://registry.npmjs.org
npm run dev
```

首轮依赖安装和打包会下载 npm 包、Electron、NSIS 等工具，构建机此时需要联网。项目未更改全局 npm 源。

如果构建环境需使用已有的 `HTTP_PROXY` / `HTTPS_PROXY`，在当前 PowerShell 会话中执行 `$env:ELECTRON_GET_USE_PROXY = 'true'`；首次运行开发或桌面测试时，Electron npm 包会按需下载官方运行时。生产 EXE 不需要此变量。Electron-builder 的工具下载若需代理，可在该构建会话中设置 `$env:GLOBAL_AGENT_HTTP_PROXY = $env:HTTP_PROXY` 和 `$env:GLOBAL_AGENT_HTTPS_PROXY = $env:HTTPS_PROXY`。

```powershell
npm test
npm run test:desktop
npm run package:win
npm run verify:portable
```

`package:win` 先类型检查和编译，再运行 `electron-builder --win portable --x64 --publish never`。不自动发布或推送。

唯一分发文件为：

```text
release/Workday-Escape-2.0.0-win-x64.exe
```

`release/win-unpacked/` 和构建元数据仅供开发检查，不需随 EXE 分发。仅将上述 EXE 复制给用户。EXE 包含 Electron 运行时，启动时允许向系统临时目录解压；最终用户不需要安装 Python、Node.js 或手动部署 DLL。实际验证范围与限制见 `../docs/version/V2.0.0/POC_REPORT.md`。

## 配置和进程边界

正常运行将配置保存到 `%APPDATA%\Workday Escape POC\settings.json`，不读取或覆盖原版 `config.json`。首次启动使用 `08:30` / `18:00`；保存后在重启时加载。损坏配置显示提示，保留原文件，只有用户点击保存后才替换。读写失败会反馈给页面。

主进程使用 Node 的文件 API；渲染进程关闭 Node 集成，启用 `contextIsolation` 和 `sandbox`。Preload 是单个 CommonJS 文件，只暴露固定的 `loadSettings`、`saveSettings` 和 `quit`，不暴露任意 IPC、文件路径或命令执行。主进程校验请求窗口、主框架和配置内容。禁止页面导航、弹出窗口和权限请求；运行时不加载远程内容。

## 验证说明

逻辑测试覆盖时间边界、跨日刷新、无效输入和配置保留。桌面测试使用 Electron 自带 Chromium，无需另行下载浏览器。所有测试使用 `--user-data-dir` 指定一次性配置目录，测试产物位于忽略的 `test-results/`。

便携验证脚本将一个 EXE 复制到系统临时目录内的独立目录，以仅含 Windows 系统目录的 `PATH` 启动，使用无服务的代理与 Chromium 离线模式检查本地运行，并验证保存、关闭与重开。脚本为本地调试连接绕过构建机 HTTP 代理；仅自动化验证时开启本地调试端口，正常用户启动不启用。第三次启动不传任何参数，检查原生窗口出现和正常关闭。代理阻断与离线模拟不等同于物理断网，也不等同于无开发环境的干净电脑测试；报告分别记录。

默认 Electron 图标和未签名 EXE 均为本阶段 POC 的限制。未新增托盘、主题、自动更新、后端或数据库。

阶段 1 本地提交前的文件检查、依赖告警分析和验证复核见 [POC_CLOSEOUT.md](../docs/version/V2.0.0/POC_CLOSEOUT.md)。

</details>
