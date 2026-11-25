# 🐟 Workday Escape

> 今天你摸鱼了吗？

Workday Escape 是一个轻量、有趣的 Windows 桌面下班倒计时工具。打开就能看到距离下班还有多久，也能顺便看看下个休息日、下次预计发薪日和已工作天数。单文件 EXE，双击即用。

![Workday Escape v2.1.3 工作中主界面，显示下班倒计时、加班快捷开关和工作进度](docs/assets/screenshots/01-dashboard.png)

以下均为 v2.1.3 实机截图，使用独立示例配置。

## 核心功能

- 实时下班倒计时和可视化工作进度，区分工作中、休息日和下班后。
- 查看距离下个休息日还有多久、下次预计发薪日，以及从入职起算的已工作自然日。
- 在主界面快速设置、修改或取消加班，支持跨日结束时间，班次冲突会明确提示。
- 切换到 Mini 迷你窗口查看倒计时，或从系统托盘恢复和退出应用。
- 在设置中调整上下班时间、入职日期、发薪日，并按需启用迷你窗。

## 更多界面

精简后的设置页面、已下班状态，以及加班设置和取消弹窗。

<p>
  <img src="docs/assets/screenshots/02-settings.png" alt="v2.1.3 精简设置页，包含上下班时间、入职日期、发薪日和迷你窗开关" width="340">
  <img src="docs/assets/screenshots/03-offwork.png" alt="v2.1.3 已下班状态，显示当天工作已结束" width="340">
</p>
<p>
  <img src="docs/assets/screenshots/04-overtime-settings.png" alt="v2.1.3 加班设置弹窗，可选择加班结束时间" width="340">
  <img src="docs/assets/screenshots/05-overtime-cancel.png" alt="v2.1.3 加班取消弹窗，显示黄色月亮、加班时间卡片及到点就跑按钮" width="340">
</p>

## 下载与使用

当前正式版为 **v2.1.3**。

**[下载最新 Windows x64 便携版](https://github.com/ZY0219z/Workday-countdown/releases/latest)**

1. 在发布页下载 `Workday-Escape-v2.1.3-Portable.zip`。
2. 解压后双击 `Workday Escape.exe`。

无需安装软件、Node.js 或 Python。软件会自动保存设置，无需手动指定配置文件路径。

## 注意事项与反馈

- EXE 尚未签名，首次运行可能出现 Windows 安全提醒。
- v2.1.3 内置已核验的 **2024–2027 年**中国工作日历。超出范围时按已有规则估算，后续年度数据随新 EXE 更新，应用内不提供在线自动更新。
- 新版沿用原有配置目录。保存超过 600 分钟的加班记录后，不保证可直接降级至 v2.1.2。
- 兼容性以实际测试环境为准。

遇到问题时，可到 [GitHub Issues](https://github.com/ZY0219z/Workday-countdown/issues) 提供软件版本、Windows 版本和复现步骤。

[开发者文档](desktop/README.md)
