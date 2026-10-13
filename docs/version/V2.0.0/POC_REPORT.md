# Workday Escape V2.0.0 — 阶段 1 技术验证报告

验证日期：2026-10-13（Asia/Shanghai）。范围：技术可行性 POC，不代表完整 V2.0 已交付。

## 1. 开发前检查与原始结构

- 当前本地目录：`D:\Workday-countdown`，直接在此仓库工作，未克隆、未创建独立仓库。
- 初始分支：`main`；`git status --porcelain=v1 -uall` 输出为空，无未提交修改。
- 原始最新提交：`191f1be583e32b1857e1972f4fde843ef7a3daf7`，`feat：进度条UI优化`，2026-06-08。
- 前两次提交：`55c4b65`（加班时间）、`9a1dbd1`（V1.0.0）。以本地源码和提交为依据，未查询或修改 GitHub 远程状态。
- 初始无 `codex/v2.0-poc` 同名分支；在确认工作区干净后创建该分支。
- 仓库和 `D:\` 未发现适用的 `AGENTS.md`。原仓库无 `.gitignore` 或 Node 工程。
- 原有跟踪文件共 4,366 个，包括 Python 虚拟环境、缓存与历史打包产物。本阶段不删除、不取消跟踪、不修改这些文件。

```text
Workday-countdown/
├─ workday_counter.py            # Tkinter 主程序，约 1,100 行
├─ config.json                   # 原用户配置
├─ Workday_Escape.spec            # PyInstaller 单 EXE 配置
├─ assets/image/
│  ├─ fish.jpg
│  ├─ wave.svg
│  ├─ wave.png
│  └─ wave-fin.png
├─ convert_svg.py                # CairoSVG 转换辅助脚本
├─ test_image.py                 # PIL/Tkinter 图片加载检查
├─ dist/Workday_Escape.exe        # 已有旧版 EXE
├─ build/Workday_Escape/          # 已有构建中间文件
├─ build/摸鱼倒计时/              # 已有历史构建中间文件
├─ __pycache__/                  # 已有 Python 缓存
└─ venv/                         # 已有且已跟踪的 Python 虚拟环境
```

### 原有功能与后续迁移范围

| 功能 | 当前代码行为 | POC 范围 / 后续迁移 |
| --- | --- | --- |
| 入职日期和天数 | `start_date`；计算 `max(0, today - start_date)`，实际为自然日差，不是扣除休息日的工作日总数 | 仅记录；后续确认名称与业务口径 |
| 上下班时间与倒计时 | `work_start_time` / `work_end_time`；区分休息日、尚未上班、上班中、已下班，每秒刷新 | POC 仅同日时间和到当天下班的倒计时；未加入休息日规则 |
| 发薪日 | 月内 1–31 号，短月取月末，遇休息日顺延到工作日 | 仅记录；原版 `today >= 本月基础发薪日` 直接计算下月，后续应确认发薪当天及顺延期间的规则 |
| 节假日与调休 | `HOLIDAYS`、`WORK_WEEKENDS` 硬编码 2024–2026；调休优先于节假日和双休判断 | 仅识别源码，不在本阶段核验日历准确性；后续建立可维护离线数据和边界测试 |
| 加班 | `overtime_minutes`，0–600 分钟，延长下班时间和进度分母；正常下班后才显示加班状态 | 未迁移；旧配置持久化该值，未自动跨日清除，后续确认语义 |
| 工作进度和小鱼 | `FishProgressBar` Canvas，平滑进度、约 50ms 动画、鱼与浪花图片，部分粒子代码已禁用 | 保留资源，后续独立迁移；POC 无进度条或动画 |
| JSON 配置 | 开发时写脚本旁，冻结后写 EXE 旁的 `config.json`；根配置含上述五个业务字段 | 原文件保留；POC 仅独立保存两个时间字段到用户数据目录 |
| 原 EXE 打包 | `.spec` 将主程序、依赖和 `assets` 交给 `EXE`，无 `COLLECT`，`console=False`，资源通过 `sys._MEIPASS` 查找 | 原 PyInstaller 单文件方案保留，不重新打包或运行旧版 |

根目录原配置包含 `start_date`、`salary_day`、`work_start_time`、`work_end_time`、`overtime_minutes`；本阶段不迁移、不覆盖其内容。

## 2. 技术栈与选型理由

| 工具 | 锁定版本 | 理由 |
| --- | --- | --- |
| Vue | 3.5.43 | 响应式页面、可复用组件，逐步替换 Tkinter UI |
| TypeScript | 5.9.3 | 固定配置和 Preload 契约，提前发现进程边界类型问题 |
| Electron | 44.7.0 | 随应用包含 Chromium / Node 运行时，用户无需开发环境 |
| electron-vite | 5.0.0 | 分别构建主进程、Preload、渲染进程并支持本地开发 |
| Vite / Vue 插件 | 7.3.7 / 6.0.10 | Vite 7 与 electron-vite 5 的官方 peer 范围兼容 |
| electron-builder | 26.15.3 | Windows x64 `portable` 目标，将运行资源包含在一个 EXE 中 |
| vue-tsc / Playwright | 3.3.13 / 1.64.0 | Vue 类型检查及真实 Electron 窗口验证；仅构建与测试使用 |

所有直接依赖均固定版本，`package-lock.json` 已生成。无后端、数据库、UI 组件库、状态管理库或配置保存库；使用 Node 文件 API 保存两个字段。

主进程负责窗口、固定路径的配置读写和退出；Vue 只负责输入与倒计时。Preload 编译为单个 CommonJS 文件，仅暴露 `loadSettings`、`saveSettings`、`quit`。窗口明确启用 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`、`webSecurity: true`。主进程校验 IPC 的窗口、主框架 URL 及时间内容；拒绝导航、新窗口和权限请求。

生产页面只加载本地编译资源，CSP 禁止联网连接。仅本地开发模式允许 Vite 热更新所需样式和 WebSocket。正常用户启动不启用调试端口。

官方依据：[Electron 安全建议](https://www.electronjs.org/docs/latest/tutorial/security)、[electron-vite 依赖与沙箱说明](https://electron-vite.org/guide/dependency-handling)、[electron-builder portable 选项](https://www.electron.build/docs/api/app-builder-lib.interface.portableoptions/)。具体构建行为另核对已安装 26.15.3 的 `portable.nsi`，不将网站 next 版选项作为当前版本的唯一依据。

## 3. 新增与修改文件

原有跟踪文件未修改。新增文件如下：

```text
.gitignore
desktop/
├─ package.json / package-lock.json
├─ electron.vite.config.ts
├─ electron-builder.yml
├─ tsconfig.node.json / tsconfig.web.json
├─ README.md
├─ src/main/index.ts
├─ src/main/settings-store.ts
├─ src/preload/index.ts
├─ src/shared/settings.ts
├─ src/shared/countdown.ts
├─ src/renderer/index.html
├─ src/renderer/src/App.vue
├─ src/renderer/src/main.ts
├─ src/renderer/src/env.d.ts
├─ src/renderer/src/style.css
├─ playwright.config.ts
├─ tests/desktop.spec.ts
├─ scripts/test-logic.mjs
└─ scripts/verify-portable.mjs
docs/version/V2.0.0/POC_REPORT.md
```

`.gitignore` 忽略新依赖、`desktop/out`、`desktop/release`、测试截图/日志和新缓存；忽略规则不会删除或取消跟踪历史 `build`、`dist`、`venv`、`__pycache__`。

## 4. 构建方式与实际验证

### 环境与命令

本次环境：Windows 11 家庭中文版，10.0.26100，x64；Node 22.18.0，npm 10.9.3。全部基于当前 Windows 主机；不以跨平台构建代替 Windows 运行验证。

```powershell
cd D:\Workday-countdown\desktop
npm ci --registry=https://registry.npmjs.org
npm test
npm run test:desktop
npm run package:win
npm run verify:portable
```

构建脚本先执行类型检查和 electron-vite 编译，确保官方 Electron 运行时可用，再运行 `electron-builder --win portable --x64 --publish never`。builder 使用 `node_modules/electron/dist` 中的同版本官方运行时；配置为 ASAR、x64、启动器 `requestExecutionLevel: user`、应用 `requestedExecutionLevel: asInvoker`、每次独立临时解压目录 `unpackDirName: false`。正常运行配置位于 `%APPDATA%\Workday Escape POC\settings.json`，不要求 EXE 所在目录可写。

构建机首次下载依赖与工具需要网络；最终 EXE 的运行条件单独验证。当前 npm 全局源指向无响应的内网地址，本项目命令临时改用官方 npm 源，未修改全局配置。

### 开发中失败与处理记录

| 项目 | 状态 | 事实与处理 |
| --- | --- | --- |
| 默认 npm 源版本查询 | 失败 | 内网源查询无响应，停止后按命令使用官方源；安装成功 |
| 首轮类型检查 | 失败（已修复） | 测试环境变量类型、窗口声明和内部偏好诊断类型需补全；修复后通过 |
| 首轮桌面测试启动 | 失败（下载阶段） | Electron 按需下载未用环境代理，出现 `fetch failed`；尚未进入窗口逻辑 |
| Electron 官方安装器经代理下载 | 失败（已替代完成） | 官方 ZIP 端点 HEAD 成功，但安装器临时文件持续为 0 字节；Windows curl 整包下载又超时，最终从同一官方端点分段下载并合并，完整 SHA-256 校验通过后解压到本项目依赖目录 |
| Windows builder 工具预下载 | 失败（已解决） | 临时 TLS 握手失败，重试后可用；旧 winCodeSign 包中 macOS 符号链接权限告警未阻止 Windows 文件提取，实际 portable 构建成功 |
| 首轮 portable 自动验证 | 失败（脚本已修复） | 自动化客户端的本地 CDP 连接被环境 HTTP 代理影响，60 秒超时；清理又遇 Windows 文件短暂占用。为客户端设置本地 `NO_PROXY`，并增加文件锁释放重试；不更改应用后，最终验证全部通过 |
| 倒计时与配置逻辑 | 已验证 | `npm test`：10/10 通过 |
| TypeScript / Vue 类型与生产编译 | 已验证 | 最终 `test:desktop` 和 `package:win` 均完成类型检查和三进程生产编译 |

官方 Electron ZIP：158,293,649 字节，SHA-256 为 `eee30dc8fa1f5ea95490e59f44e46ea68dd24c6e93d22facf70fe5c2d4c2665c`，与 npm 官方包中的 `checksums.json` 完全一致。没有使用第三方替代运行时，也没有跳过完整性校验。以上失败是本轮开发和验证过程中真实出现的问题；最终结果如下。

### 最终结果矩阵

| 验证项 | 状态 | 实际结果和边界 |
| --- | --- | --- |
| 逻辑测试 | 已验证 | 10/10；时间格式、同日约束、上班前、上下班边界、秒数、跨日、缺失/损坏配置、保存和无效保存保留 |
| Windows Electron 桌面测试 | 已验证 | 7/7，实际启动窗口；包含隔离偏好、Preload 边界、每秒更新、保存/重开、离线重载、无效 IPC 输入、配置损坏、保存失败、退出按钮及原生关闭 |
| 类型检查与生产构建 | 已验证 | main / preload / renderer 分别编译成功；Preload 为单个 CJS 文件 |
| portable 构建 | 已验证 | `npm run package:win` 退出码 0，生成指定命名的 x64 目标 EXE；未发布 |
| 单个 EXE 分发 | 已验证 | 独立目录仅复制一个 EXE；三次启动后目录仍只有该文件，无需外置 DLL 或资源文件夹 |
| 不安装启动、脱离开发目录 | 已验证 | 在系统临时目录的中文/空格路径启动副本；Vue 页面实际从临时解压目录内的 `resources/app.asar` 加载 |
| 普通用户权限 | 已验证 | 本次宿主进程无管理员令牌；启动器和内部应用 manifest 均为 `asInvoker`，实际启动成功，无提权需求 |
| 无参数启动 | 已验证 | 第三次不传调试、profile、proxy 等参数，Windows 原生窗口正常出现并关闭；这是自动化直接打开 EXE，未记录人工鼠标双击 |
| Python / Node 独立性 | 已验证（本机范围） | 运行 PATH 只有 `C:\WINDOWS\System32;C:\WINDOWS`，移除开发环境变量；ASAR 只有已编译代码、Vue 资源及 package 元数据，不含 Python 或外部 npm 模块 |
| 外部运行库 | 已验证（有限范围） | 本机运行无需额外部署运行库；对内部主 EXE 与 6 个根目录 DLL 的 PE 静态导入检查未发现未随包提供的 VC 运行库。动态加载和干净机器兼容性未全面验证 |
| 时间配置与实时倒计时 | 已验证 | 保存为 00:00–23:59，JSON 写入隔离用户数据目录；观察倒计时减少 1–2 秒，符合每秒更新；重开读取相同配置 |
| 关闭与重开 | 已验证 | 退出按钮与 Windows 原生窗口关闭均使 portable 启动器正常以 0 退出；重开成功，无残留 Workday Escape 进程 |
| 离线模拟 | 已验证 | 无服务代理阻断网络，Chromium offline 后重载仍正常显示、读配置；生产 CSP 为 `connect-src 'none'` |
| 实际物理断网 | 未验证 | 未禁用主机网卡，也未在物理断网的第二台机器运行 |
| 无 Python / Node 的干净第二台电脑 | 未验证 | 构建机已安装开发环境；PATH 限制和包内容审查不能替代此测试 |
| EXE 签名和下载后 SmartScreen | 未验证（下载行为） | Authenticode 查询已确认两个 EXE 均为 `NotSigned`；未验证下载后的 SmartScreen、杀软和企业策略 |

便携自动验证共 14 项检查通过。完整逐项记录在忽略的 `desktop/test-results/portable-verification.json`；截图为 `poc-window.png`、`portable-window.png`；静态导入记录为 `pe-imports.json`。这些是本机验证产物，不参与 EXE 分发和 Git 提交。自动化使用一次性 `--user-data-dir` 避免覆盖用户配置，正常无参数启动使用独立 POC 默认目录。

## 5. EXE 文件与大小

实际输出路径：`desktop/release/Workday-Escape-2.0.0-win-x64.exe`。

- 实际大小：**100,093,494 字节 = 95.46 MiB**（约 100.09 MB）。
- SHA-256：`0f332ef03fb6f3176d2981357f1700d7231d684c69cb8792d7ce419fefa67789`。
- Windows 版本资源：portable `ProductVersion` 为 `2.0.0`，内部应用为 `2.0.0.0`，均已读取实际文件核实。
- builder 产出未签名 EXE；只分发该文件。`release/win-unpacked` 与中间元数据无需提供给用户。
- 保留的旧版 `dist/Workday_Escape.exe` 为 18,063,535 字节；Electron POC 包体明显增大，这是引入自带 Chromium 运行时的实际成本。

## 6. 单文件免安装结论

**在本次 Windows 11 x64 普通用户环境及已完成的检查范围内，满足单文件免安装分发要求，阶段 1 技术 POC 成立。** 一个 EXE 已独立完成启动、渲染、时间配置、每秒倒计时、关闭和重开。内部运行资源自动解压到系统临时目录，配置与 Chromium 用户数据保存在用户数据目录；无需用户手动部署 Python、Node.js、DLL 或资源文件夹。

这一结论是技术可行性证据，不代表完整 V2.0 业务迁移完成，也不代表所有目标 Windows 环境均已验收。干净第二台机器、真实物理断网和下载后的系统安全提示仍列为未验证。

## 7. 当前问题与限制

- POC 只支持同日班次；下班时间必须晚于上班时间。未迁移业务日历、加班、发薪日、入职统计、进度及动画。
- 使用本机时间；不校验系统时间准确性。
- 构建依赖完整 `npm audit` 当前报告 8 项 moderate、0 high、0 critical，来自 builder 下载代理相关的 `sprintf-js` 间接依赖链；官方 npm 当前最新 `sprintf-js` 为 1.1.3，无可直接使用的补丁版本。未执行自动降级或无关依赖重构。`npm audit --omit=dev` 为 0；此结果不代表 Electron 二进制已接受全面安全审计。
- 未签名、使用默认 Electron 图标；尚未验证从互联网下载后 SmartScreen 行为或杀软环境。
- 单 EXE 约 95.46 MiB；启动需要临时解压空间，其包体与启动成本高于现有 Python EXE。未做包体优化或启动性能基准。
- 未在卸载 Python/Node 的干净第二台 Windows 电脑上测试，PATH 限制与包内容检查只能提供本机范围内的独立性证据。
- 代理阻断 / Chromium offline 仅为离线模拟，未物理断开主机网络。
- 尚未验证全部 Windows 版本、企业策略、受限临时目录、磁盘空间不足等运行环境。

## 8. 后续完整重构建议与 Git 状态

本阶段完成后停止，不自动进入下一阶段。

建议在用户确认后，先在无开发环境的 Windows 标准用户机器上复测此单 EXE，覆盖真实断网、双击、保存、关闭和重开；再确定下一阶段的业务规则与迁移验收清单。将日历、发薪日、入职天数与加班计算提取为独立 TypeScript 逻辑，先覆盖边界，再逐项迁移页面。旧配置导入应显式设计版本和备份，避免自动覆盖。小鱼动画和完整 UI 在基础业务稳定后迁移。签名、图标、包体与 Windows 兼容矩阵应在正式发布阶段处理。

Git 分支为 `codex/v2.0-poc`，HEAD 仍为 `191f1be583e32b1857e1972f4fde843ef7a3daf7`。原有 4,366 个跟踪文件保持不变，`git diff` 为空；`.gitignore`、`desktop/` 源码及本报告共 23 个新增未提交文件。`node_modules`、`out`、`release`、测试/下载临时产物均被忽略；本次下载分段与失败运行残留已按确切路径清理，验证证据和最终 EXE 保留。未自动提交、未推送、未修改远程仓库；未执行 reset、clean 或删除历史产物。

阶段 1 首次交付到此停止。用户随后已授权 POC 收口及阶段 2 规划，更新的提交前审查与依赖风险分析见 [POC_CLOSEOUT.md](POC_CLOSEOUT.md)。上面的 Git 状态是首次交付时的历史快照；后续规划不表示已实现完整业务。
