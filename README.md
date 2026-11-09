# 🐟 Workday Escape

> 今天你摸鱼了吗？

Workday Escape 是一个轻量、有趣的 Windows 桌面下班倒计时工具。打开就能看到距离下班还有多久，也能顺便看看下个休息日、下次预计发薪日和已工作天数。单文件 EXE，双击即用。

![Workday Escape 工作中主界面，显示下班倒计时和工作进度](docs/assets/screenshots/01-dashboard.png)

## 核心功能

- 实时下班倒计时和可视化工作进度，区分工作中、休息日和下班后。
- 查看距离下个休息日还有多久、下次预计发薪日，以及从入职起算的已工作自然日。
- 临时调整当天预计下班时间，日常上下班时间继续按原设置计算。
- 切换到 Mini 迷你窗口查看倒计时，或从系统托盘恢复和退出应用。
- 在设置中调整上下班时间、入职日期、发薪日，并按需启用迷你窗。

## 更多界面

设置页面和已下班状态。

<p>
  <img src="docs/assets/screenshots/02-settings.png" alt="设置页面，包含上下班时间、临时下班时间、入职日期和发薪日" width="340">
  <img src="docs/assets/screenshots/03-offwork.png" alt="已下班状态，显示当天工作已结束" width="340">
</p>

## 下载与使用

**[下载最新 Windows x64 便携版](https://github.com/ZY0219z/Workday-countdown/releases/latest)**

1. 在发布页下载 `Workday-Escape-v2.1.1-Portable.zip`。
2. 解压后双击 `Workday Escape.exe`。

无需安装软件、Node.js 或 Python。软件会自动保存设置，无需手动指定配置文件路径。

## 注意事项与反馈

- EXE 尚未签名，首次运行可能出现 Windows 安全提醒。
- 当前正式下载 v2.1.1 内置已核验的 **2024–2026 年**中国工作日历。v2.1.2 候选将覆盖范围扩展到 **2024–2027 年**。超出范围时按已有规则估算，年度数据随 EXE 版本更新。
- 兼容性以实际测试环境为准。

遇到问题时，可到 [GitHub Issues](https://github.com/ZY0219z/Workday-countdown/issues) 提供软件版本、Windows 版本和复现步骤。

[开发者文档](desktop/README.md)
