# D10 隔离组件预览

从 `desktop/` 执行 `npm run preview:components`，按 Vite 实际输出地址访问 `/preview/index.html`（默认仅绑定 `127.0.0.1`，不自动打开浏览器）。只查看时手动启动；结束用 Ctrl+C。此入口不在 Electron 生产构建中。

- 默认 system/ocean；下拉可查看亮/深、海蓝/珊瑚，以及系统/应用减少动画。
- 固定输入的四种主题、八类状态、空值、0 值、跨夜结束日期、估算和发薪歧义示例。
- 主窗框为 720×780 / 480×560 CSS px，迷你框为 280×132 / 240×112。最小迷你压力样例可纵向滚动到末尾说明；100 小时仅测试排版，不代表合法班次。
- “返回主窗口”等按钮为禁用的视觉样例，没有真实窗口行为或设置功能。
- 仅在预览 canvas 展示原始 `moyu_original.gif` 的静态加载帧。**未取消原 GIF 动画需求**；组件提供 illustration slot，D12 再接受控动画，不在 D10 循环播放。

组件使用前导入 `styles/tokens.css` 和 `styles/base.css`，由 `.workday-ui` 包裹，通过 `useTheme(hostRef, appearance)` 或纯 `createThemeController` 设置 host 的三个 data 属性。传入 D02 已校验的 appearance；主题偏好必填，辅助模块不写配置。controller 拒绝非法输入，dispose 恢复旧属性并移除系统监听。海蓝为 CSS 和示例默认，正式保存由 D11/D07 完成。

| 组件 | 输入 / 插槽 |
| --- | --- |
| CountdownCard | state、text、target(kind/date/time)、hint、estimate、warning、compact；illustration/actions 插槽 |
| MetricCard | title、value、unit、description、source、estimated、warning、kind、emptyLabel；kind=salary 自动注明只是计划日期 |
| StatusBadge | 七类 BusinessState 或 estimate，note；清晰文字及语义色 |

全部是展示组件，没有时钟、业务计算、Snapshot 订阅、IPC、配置文件读写或外网资源。text 使用 `HH:MM:SS`（小时可多位）；非法/缺失值显示空状态，真实零值保留。rest 无班次时明确无进度，发薪歧义由调用方传 null/提示，组件不替用户选择周期。D11 从同一 Snapshot 提供最终目标、进度和逐项质量提示。

验证入口：

- `npm run test:d10`：Node + Vue SSR，主题端口与组件真实渲染，不需要浏览器。
- `npm run test:unit`：含 D02–D10 及原逻辑，后台运行。
- `npm run test:d10:visual`：已有 Playwright + 本机 Edge，真正 headless 且 Chromium sandbox 开启；固定本地资源路由，无网络/真实用户 profile。不提供可见模式回退，Edge 不可用就明确失败。
- `npm run build:components`：独立编译到忽略的 `test-results/d10-components/`；截图/JSON在 `test-results/d10-visual/`，SSR输出在 `test-results/d10-ssr/`，均不提交或打包。

Headless 检查不是 Windows 实窗/DPI/屏幕阅读器/性能验收。`test:desktop` 继续只运行原有 hidden/nonfocusable Electron 集成；真实 GUI 门禁及正式产品安全配置保持原样。
