# Workday Escape 🐟

> 今天你摸鱼了吗？距离下班还有多久？
>
> 一款轻量、简单、有点趣味的 **Windows 桌面下班倒计时工具**。打开就能看到剩余时间，顺便期待下一次休息日和发薪日。

**[⬇️ 下载最新版本](https://github.com/ZY0219z/Workday-countdown/releases/latest)** · [查看 v2.1.1 更新说明](https://github.com/ZY0219z/Workday-countdown/releases/tag/v2.1.1) · [反馈问题](https://github.com/ZY0219z/Workday-countdown/issues)

**适用平台：Windows x64 · 单文件 Portable EXE · 无需安装**

## ✨ 功能一览

| 功能 | 说明 |
| --- | --- |
| ⏳ 下班倒计时 | 实时显示距离下班还有多久，自动识别上班前、工作中、下班后与休息日 |
| 🌊 工作进度 | 用海水进度槽直观展示当天进度，附带小猫小鱼的趣味元素 |
| 🌴 下个休息日 | 显示距离下一个休息日还有几天 |
| 💰 预计发薪日 | 根据设置的发薪规则显示下一次预计发薪时间 |
| 📅 已工作天数 | 按入职日期计算自然日天数，不代表实际出勤天数 |
| 🕒 今日临时调整 | 可以仅调整当前班次的预计下班时间，不改变日常下班时间 |
| 🪟 迷你窗口 | 需要时切换到更轻便的倒计时小窗 |
| 🐱 系统托盘 | 支持托盘访问与退出，关闭主窗口时可继续在后台使用 |
| ⚙️ 设置保存 | 工作时间、入职日期等设置自动存放在当前 Windows 用户的数据目录 |

它不是考勤系统，也不是工作管理平台；只是一个让工作日稍微有趣一点的桌面小工具。

## 🚀 下载与使用

1. 打开 **[Releases](https://github.com/ZY0219z/Workday-countdown/releases/latest)**，下载最新版本的 \`Workday-Escape-*-Portable.zip\`。
2. 解压压缩包，获得 **\`Workday Escape.exe\`**。
3. **双击 EXE 即可使用**。首次打开也可以先直接看倒计时，再按需调整上下班时间。

如果朋友直接把 \`Workday Escape.exe\` 发给你，也可以直接双击运行；**无需安装程序、Node.js、Python 或手动选择配置路径**。

> [!NOTE]
> 当前 Windows EXE **尚未进行数字签名**，第一次运行可能出现 Windows 安全提示。请从本项目官方 Release 页面获取文件，并根据 Release 页面公布的 SHA-256 校验完整性。

## ⚙️ 设置与数据

- 右上角菜单可进入设置，调整上班时间、下班时间、入职日期和每月发薪日。
- “今天预计下班时间”只影响当前班次，适合临时加班等情况。
- 迷你窗口可在设置中启用，之后从主窗口或托盘使用。
- 配置由程序自动管理，不需要用户找文件或指定安装目录。

设置文件通常位于：

\`\`\`text
%APPDATA%\Workday Escape\settings.json
\`\`\`

同目录还会保留配置备份。请不要为了排查问题随意删除配置文件；**更换 EXE 所在文件夹不会主动清空已有设置**。

### 关于休息日与节假日

当前版本内置的已核验中国工作日历覆盖 **2024–2026 年**。超出已核验年度时，软件会按已有工作周规则等提供估算，**不代表自动掌握该年度最新法定节假日与调休安排**。后续年度自动更新目前不是 v2.1.1 已实现的功能。

## 🛠️ 技术栈与本地开发

正式桌面版使用 **Vue 3 + TypeScript + Electron**。项目仍保留早期 Python 原型代码；当前 Release 交付的是 \`desktop/\` 下的 Electron 版本，而不是根目录的 Python 程序。

开发环境：Windows x64、Node.js **22.12+**，首次安装依赖与打包需要联网。

\`\`\`powershell
cd desktop
npm ci
npm run dev
\`\`\`

常用检查和构建命令：

\`\`\`powershell
npm run typecheck
npm run package:win
\`\`\`

\`package:win\` 负责构建 Windows x64 Portable EXE，**不会自动创建 GitHub Release**。开发与验收细节以对应版本记录为准。

## 📁 仓库结构

\`\`\`text
desktop/                 # 当前 Vue + TypeScript + Electron 桌面程序
docs/version/            # 各版本需求、任务及验收记录
docs/ROADMAP.md          # 历史规划与候选需求
workday_counter.py       # 早期 Python 原型（非当前正式版）
\`\`\`

- [v2.1.1 版本目标](docs/version/V2.1.1/V2.1.1_REQUIREMENTS.md)
- [v2.1.1 开发与验收记录](docs/version/V2.1.1/V2.1.1_TASKS.md)
- [历史路线图 / 需求方向](docs/ROADMAP.md)

## 💬 反馈与说明

遇到影响使用的问题，可以在 [Issues](https://github.com/ZY0219z/Workday-countdown/issues) 中说明软件版本、Windows 版本、复现步骤和错误提示。反馈时请避免附上个人配置文件、系统用户名或其他隐私信息。

项目以个人使用体验为优先，不承诺跨所有 Windows 环境兼容，也不计划发展成复杂的企业管理系统。

---

**摸鱼一小步，下班一大步。** 🐟
