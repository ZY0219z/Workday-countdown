# D13 内置托盘图标

moyu-tray.png 是原 assets/image/fish.jpg 第一帧的等比32px透明缩图，不修改原素材、不引入新品牌或图标依赖。仅作为小尺寸通知区域图标，不替代D12 GIF。

Main通过electron-vite的?asset导入，由构建输出到out/main/chunks，现有electron-builder的out/**规则将其纳入app.asar及Portable；运行时不读仓库目录，也不要求用户另行分发文件。图标放在Main源码旁，避免resources公共目录的外部路径语义。实际开发/生产路径和打包静态检查结果见TEST_PLAN D13。
