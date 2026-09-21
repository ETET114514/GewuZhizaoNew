# 三维白模首版验证（2026-09-21）

已通过 74 项 Python 测试（含 3 项新比例 / 设置 / 保存撤销测试），5 项 Node 三维几何测试，以及 Edge 浏览器流程检查。

浏览器检查覆盖：真实示例识别、未标定时提示、图上拖线输入长度、打开三维、墙体改色、设置与比例保存、无效高度拒绝、撤销、二维改墙后更新三维、俯视和手机布局。无页面脚本异常或手机横向溢出。

- `model-desktop.png`：改为蓝色墙体后的示例透视图。
- `model-top.png`：撤销改色、二维修改墙厚后重新打开的俯视图。
- `model-mobile.png`：390 × 844 手机布局。

截图标定长度是测试输入，用于验证流程，不代表示例户型的真实测量。家具、门框均为简化示意，地面为整图范围矩形底板。候选识别的缺墙或误报仍会出现在模型中。

复现：启动 `python web_server.py --port 8766`，在可用 Node / Playwright 环境运行 `node check_model_ui.cjs`；几何测试为 `node --test test_model_geometry.mjs`。完整 Python 回归使用 `python -m unittest discover -s . -p "test_*.py" -v`。
