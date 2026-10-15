# Workday Escape V2.0.0 · D11 开发版

2026-10-15：当前默认页面已切换为正式仪表盘与设置中心。所有业务显示来自 Main 的统一 Snapshot，首次未配置时明确填写上下班时间及发薪日，点击保存后才初始化 `%APPDATA%\Workday Escape\settings.json`。不自动读取、合并或覆盖旧 Python / POC 配置；在设置的数据页主动选择来源、预览字段并确认。旧版源码/配置/资源保留。

开发者手动体验（会显示真实窗口，仅由用户主动启动）：

```powershell
cd D:\Workday-countdown\desktop
npm run dev
```

已安装依赖时直接运行；或 `npm run build` 后手动 `npm run preview`。首次设置可留空入职日，必须明确上下班时间和发薪日。已有正式配置直接进入仪表盘；设置采用草稿、显式保存/取消、离开三选，真正退出由 Main 三选保护。首轮排班完整校验可能需要数十秒，忙碌期间保留窗口与输入；性能预算尚待D15实测，未因本轮放宽。

海蓝默认，珊瑚可选，支持亮/深/系统。原始蓝猫抱灰鱼暂为静态；托盘/真实迷你和动画尚未实施，点击关闭当前仍真正退出，不隐藏成不可恢复进程。窗口/托盘设置仅保存相应偏好。内置2024–2026、周规则与日期覆盖可用；外部年度包导入暂未开放，F11及V2最终发布要求仍保留。

验证：`npm run typecheck`、`npm run test:unit`、`npm run test:desktop`（隐藏、不抢焦点）、`npm run test:d11:visual`（真正Headless）。测试使用隔离TEMP，不写真实配置；GUI/Portable验证必须另获授权。测试所用Edge是开发工具，不是软件运行依赖。组件/截图和具体结果见版本TASKS/UI_PLAN/TEST_PLAN；旧 `release/` EXE是历史产物，不能当作D11新版体验入口，本轮没有重新打包或发布。

---

以下为阶段1 POC历史说明，不代表当前默认页面/API。POC页面/样式另保留于 `src/renderer/src/legacy/`，相关历史测试在 `tests/legacy/`，不加载进正式生产入口。

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
