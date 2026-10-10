# 家具即时移动与厘米输入

核查日期：2026-10-10。

选中家具后，方向按钮点按一步，按住连续移动；每步默认 10 cm，可输入 0.1～100 cm。移动按底图坐标进行（X 向右、Y 向下），无需开启拖拽模式。按下即预览三维位置，松手提交一次修改；Esc、指针取消或窗口失焦恢复原位。沿用旋转占地的底图边界限制。

家具中心、横纵占地、高度和离地输入均为 cm。API 和保存格式继续使用既有 mm / 像素表示，不改变实际尺寸或项目格式。显示最多三位小数，未改动的字段保留原始精度，避免贴边家具因显示取舍小数而越界。尺寸字段可填写小数；数值预览只重建选中家具，方向移动仅改变其位置，不重建墙体、门窗和地面。

## 验证结果

- `node check_furniture_nudge_ui.cjs`：真实 Edge 浏览器，截图验证松手前家具已经移动且没有 API 提交；覆盖单次点按、长按重复、一次长按一次提交、Esc 取消及计时器停止、键盘 Enter、1.5 cm 自定义步长、无效步长、123.4 cm → 1234 mm 高度、210.25 cm 精确占地、外观保留、撤销、保存重开和窄屏布局。
- `node check_furniture_move_ui.cjs`：原拖拽流程通过；增加旋转贴边家具显示为 cm 后，修改高度仍保留精确占地的核查。
- `node --test test_furniture_move.mjs test_furniture_models.mjs test_model_geometry.mjs`：17 项通过。
- 两套浏览器核查均无页面脚本错误。测试项目保存在 `output/furniture-move-v1/testdata/projects/`，与用户项目目录隔离；运行方法见 [测试服务器说明](../furniture-move-v1/README.md)。

查看 [results.json](results.json)、[桌面截图](desktop.png)、[窄屏截图](mobile.png)。尚无靠墙吸附和碰撞检测，方向键按底图轴线移动，不随相机旋转改变方向。
