# 阶段 1 POC 收口记录

日期：2026-10-13（Asia/Shanghai）。用户已初步验收 POC，授权本地提交和阶段 2 规划。本记录补充 [POC_REPORT.md](POC_REPORT.md)，不替代原始验证记录。

## 收口检查

- 检查时位于 `codex/v2.0-poc`，HEAD 为 `191f1be583e32b1857e1972f4fde843ef7a3daf7`；已有 23 个新增 POC 文件，无已跟踪文件修改，无 `codex/v2.0` 分支。
- 已阅读报告、README、全部新增源码/测试/配置，检查锁文件来源。高置信私钥、访问令牌和含密码 URL 的模式扫描未命中，人工审查未发现凭据；不将扫描视为所有敏感信息的形式化证明。
- 新增文件均为文本。锁文件下载域名只有 `registry.npmjs.org`；不提交 EXE、DLL、截图、缓存、日志、`node_modules`、`out`、`release` 或 `test-results`。
- 原 Python 程序、原 `config.json`、资源和已跟踪的旧打包产物保持不变，原有跟踪关系不因 `.gitignore` 改变。
- 本轮不修改 POC 业务源码、依赖或 UI，仅补充收口文档并提交已验收内容。

## 依赖告警复核

执行官方源 `npm audit --json`、`npm audit --omit=dev --json`，并检查锁文件、安装包调用点和实际 ASAR。全量仍为 8 moderate、0 high、0 critical；生产依赖视角为 0。所有直接包目前声明为开发依赖，但 **Vue 的编译代码和 Electron 的运行时仍随 EXE 分发**，不能仅凭 `devDependencies` 判断运行风险。

| npm 受影响节点 | 实际安装版本 | 告警来源与用途 |
| --- | --- | --- |
| `sprintf-js` | 1.1.3 | 根源告警 GHSA-hp3w-g68c-fv3c；格式串精度未限制，可触发 RangeError / 拒绝服务 |
| `roarr` | 2.15.4 | 上述格式化库的调用者，用于代理日志 |
| `global-agent` | 3.0.0 | 引用 roarr，构建机下载代理适配 |
| `@electron/get`（builder 嵌套副本） | 3.1.0 | 引用 global-agent，路径为 `app-builder-lib/node_modules/@electron/get`；不同于 Electron npm 包的 5.x 下载器 |
| `app-builder-lib` | 26.15.3 | 下载器链及工具链互相依赖的传播告警 |
| `electron-builder` | 26.15.3 | 直接打包工具的传播告警 |
| `dmg-builder` | 26.15.3 | macOS 工具链节点，本 POC 不构建 DMG |
| `electron-builder-squirrel-windows` | 26.15.3 | Squirrel 工具链节点，本 POC 使用 portable |

8 项是多个受影响依赖节点，并非 8 个独立根源漏洞。版本已由本机安装包和锁文件核实。

可触达性结论：

1. `roarr/dist/factories/createLogger.js` 用 `sprintf` 处理消息格式。攻击者若能控制带额外参数的格式串，存在异常退出路径。[GitHub 安全公告](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)说明影响至 1.1.3，尚无补丁版本。
2. 已审查 global-agent 日志调用使用固定消息，URL、错误和代理状态作为上下文数据。未发现用户配置或下载响应直接成为这些调用的格式串。这是源码推断，不是对所有构建路径不可利用的证明。
3. 代理链在构建下载且启用代理时可能加载，属于实际开发环境暴露面；主要风险是构建可用性，不能因是开发依赖就忽略。
4. 实际 `app.asar` 只有编译后的 main/preload/renderer、Vue 静态资源和 package 元数据，未包含上述受影响库；应用无下载服务或外部格式串入口。目前未发现该告警在 POC 分发运行路径可触达。npm audit 不覆盖 Electron/Chromium 二进制本身。

升级与控制策略：

- 本轮保持锁文件和工具版本，不运行 `npm audit fix --force`。npm 建议的 builder 26.5.0 低于当前 26.15.3，是回退，不能视为无损升级；需评估其他修复是否随之回退。
- 后续每个发布候选刷新全量/生产审计、Electron 安全更新和上游公告。优先采用已消除漏洞链的新稳定 builder，再考虑兼容叶子补丁；当前无可直接采用的 sprintf-js 补丁。
- 升级单列任务，记录依赖树变化，在 Windows 重跑类型、逻辑、桌面、portable 构建及独立 EXE/目标机验收后合入。
- 构建保持官方源、固定锁文件及校验和；不把未知输入当日志格式串，不引入受影响库到运行路径，不输出代理凭据；下载失败须有界退出。
- 正式发布前，可触达漏洞必须修复；纯构建依赖残余告警需更新可触达性说明、构建控制和验收记录，不能用总数掩盖风险。

## 本轮验证结果

| 检查 | 状态 | 结果 |
| --- | --- | --- |
| `npm test` | 已验证 | 10/10 |
| `npm run test:desktop` | 已验证 | 类型检查、生产编译通过，Windows Electron 7/7 |
| `npm run verify:portable` | 已验证 | 同一 EXE 的 14 项全部通过，涵盖普通用户、受限 PATH、独立目录、离线模拟、保存、重开、原生关闭与无参数启动 |
| EXE 对照 | 已验证 | 100,093,494 字节；SHA-256 `0f332ef03fb6f3176d2981357f1700d7231d684c69cb8792d7ce419fefa67789`，与原报告一致 |
| 提交阻断项 | 已检查 | 未发现；明确保留构建依赖风险及 POC 未验证项目 |
| 干净目标机、物理断网、人工双击、下载安全提示 | 未验证 | 本机自动化不能替代，纳入正式发布门槛 |

收口提交包含源码、测试、锁文件、忽略规则及本记录，共 24 个文本文件。EXE 留在忽略目录供本地验收。收口提交 ID 由本地 Git 记录，并在正式规划分支的 TASKS 文档登记。未自动推送；阶段 2 只形成规划，不开展业务开发。
