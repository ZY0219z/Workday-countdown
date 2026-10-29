# Workday Escape V2.1.0 开发与个人自用验收说明

更新：2026-10-29。本文上半部描述 `codex/v2.1.0` 当前源码；V2.1.0 仍在开发中，尚未封版或发布。QA-03 六项 Windows 开发预览版验收由用户反馈 PASS；QA-04 已将候选版本及锁文件统一为 2.1.0，生成独立 Portable 并通过静态核验，**候选 EXE 未运行，等待 QA-05**，不能将开发预览版验收当作 Portable 验收通过。

主界面显示下班倒计时、业务状态、真实工作进度水槽及休息日 / 预计发薪 / 已工作摘要。原猫鱼 GIF、双层动态海水保留；隐藏、休息、下班和减少动画等状态按现有许可暂停。已工作仍为不含今天的自然日累计，入职当天为 0，不代表实际出勤天数。

真正首用（正式配置和备份均不存在）显示默认倒计时，不要求先填表。默认 08:30–18:00、周一至周五、入职 2025-07-17、每月 10 日发上月工资 / 休息日顺延、无午休加班、海蓝跟随系统。默认值后台安全落盘，失败保留提示和设置重试入口。已有配置读取原值；损坏、备份恢复或未来版本配置不默认覆盖。

手动体验（会显示真实窗口，仅由用户主动启动）：

```powershell
cd D:\Workday-countdown\desktop
npm run dev
```

先保存旧开发会话的输入再重启。右上三横线进入设置，上下班时间默认同行，入职日期 / 每月发薪日默认同行，窄窗口自动纵排。时间支持 HH:MM 键入和粘贴。Mini Switch 直接显示在设置页，保存启用后可从主界面或托盘进入；只有开关轨道或滑块点击切换，文字、图标及卡片空白不切换，Tab / Space 仍可操作。当前日常设置没有“更多设置”或设置底部退出按钮。

“今天预计下班时间”仅对当前班次生效；较早时刻按次日解释，最多额外 600 分钟。有效待保存时间与当前结果不同时，显示“当前生效 / 保存后”对照，跨日保留日期。“取消今天加班”保存后生效，不影响其他日期。历史午休、工作周、日历覆盖、主题和窗口偏好保留在完整草稿中，修改常用字段不会清空它们；正常设置不再显示高级编辑或导入 / 导出入口，配置异常时保留必要安全恢复流程。Python / POC 不自动读取或合并，旧数据不改动。

保存成功返回仪表盘，成功 / 失败 Toast 使用约 3 秒计时，不占正常布局。失败保留输入；字段错误、磁盘 / 冲突等关键原因和恢复路径不会随 Toast 消失。取消、离开或退出时，未保存内容仍通过保存 / 放弃 / 继续编辑保护。

托盘正常时按已保存的关闭策略处理，默认关闭到托盘；完全退出可右键托盘图标选择“退出程序”。托盘不能恢复或提供退出路径时，主动关闭主窗口会尝试现有安全退出协调器；配置不可读但托盘可用时保留可见窗口，提示恢复配置或通过托盘退出。取消、保存失败、超时或草稿无法确认均拒绝退出并保留 / 恢复窗口，不强制结束进程。Mini 支持返回主窗、置顶及隐藏，原主题和系统外观适配继续读取既有配置。

内置核验日历覆盖 **2024–2026**，离线可用。缺失年度沿用工作周 / 日期覆盖及估算提示，不代表已掌握该年度法定假期 / 调休。F11-B 外部年度 JSON 手动导入仍未开放，F11-C 自动更新仍为后续版本候选，均不作为本次个人自用封版前置。

正式配置位于 `%APPDATA%\Workday Escape\settings.json`，备份为同目录 `settings.backup.json`；POC 数据与正式 V2 隔离。测试必须使用既有临时配置和忽略目录，不删除真实配置来模拟首用。实际范围、QA-01 环境受限结果、QA-02 定向验证及原生待验见 [V2.1.0 任务记录](../docs/version/V2.1.0/V2.1.0_TASKS.md)。旧原生 GUI / Portable 脚本仍有旧选择器和版本断言待适配，不将历史通过数量作为当前验收结论；涉及真实窗口 / 托盘的测试和打包均须单独授权。Edge 仅为 Headless 测试工具，应用运行不依赖它。

## V2.1.0 候选构建与静态检查

QA-04 候选为 `release/qa04-v210-candidate-b87ca71/Workday-Escape-2.1.0-win-x64.exe`，100,125,924 字节（95.487522 MiB），未签名。完整 SHA-256、构建环境和核验明细见 [TASKS 的 QA-04 记录](../docs/version/V2.1.0/V2.1.0_TASKS.md#2026-10-29qa-04-portable-候选构建与静态核验)。V2.0.0 的 D16 候选及 `v2.0.0` Tag 保留。

本轮在 `desktop/` 执行了以下命令；**后续重建必须另选不存在的 release 子目录，不覆盖本候选或任何历史产物**：

```powershell
npm run package:win -- --config.directories.output=release/qa04-v210-candidate-b87ca71
```

既有命令包含 Typecheck、生产编译及 Builder 的 `--win portable --x64 --publish never`。应用身份、ASAR、asInvoker 和数据目录规则不变，未升级依赖。候选目录中的 `win-unpacked/` 和 `builder-debug.yml` 仅为构建核验材料，交付文件只有上述单个 EXE。

使用已有 7-Zip 静态测试并解包至全新的隔离目录，再运行：

```powershell
node scripts/check-v2-package.mjs release/qa04-v210-candidate-b87ca71 test-results/qa04-v210-b87ca71/extracted-payload
```

检查器明确要求 2.1.0 源 / 锁文件 / ASAR 元数据及文件名一致，校验独立载荷与 staging 的全文件哈希、生产文件白名单、资源、CSP / 权限保护、架构、体积和非生产内容。UI-13 已替换旧浪花 PNG，当前严格检查真实 SVG 波面及四张内联 SVG 插画，原 GIF / 托盘图标继续逐字节核验。**本命令不启动 EXE**；PE 版本与签名另以只读元数据核对。旧 `verify-portable.mjs` / D08 专用测试包约束不作为此候选运行验收，真正 EXE 运行脚本和用户体验留待 QA-05 单独授权，不关闭系统保护来绕过未签名提示。

---

以下全部章节为阶段 1 POC 历史说明，包括其中的版本、配置路径、API、UI 和验证命令，**不可作为当前 V2.1.0 操作或验收指南**。POC 页面 / 样式保留于 `src/renderer/src/legacy/`，相关历史测试在 `tests/legacy/`，不加载进正式生产入口。

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
