# 墙体交接齐平核查

核查日期：2026-10-13。默认开启 `flush_wall_joints`；旧方案未设置时也采用默认值，显式关闭随项目保存。

当前方案中的 W004 起端 181→187 px、W005 起端 259→264 px 对齐相邻墙的外侧面；另外三处 0.5 / 2 / 1 px 的短尾端收齐。只调整生成的三维墙端，不修改原始墙段、门窗和家具。

规则：垂直交接、邻墙有实体支撑、突出长度不超过两墙较小厚度；连续共线墙段、较长伸出、自由端、门窗与待确认缺口保留。不是统一墙厚或网格布尔合并。

- `node --test test_*.mjs`：74 项通过，包括原图两处端点、镜像、横竖方向、重新标定、洞口上下墙保留、关闭预设及不修改源数据。
- `.venv/Scripts/python.exe -m unittest test_model_settings test_projects test_opening_quick test_opening_edit -q`：22 项通过，包括布尔校验、保存和撤销。

浏览器核查脚本：`tools/check_wall_joints_ui.cjs`。随机端口与临时项目目录隔离；可通过 `WALL_JOINT_PROJECT` 读取已保存方案副本进行核查，不修改原版本。对比截图：[原形](before.png)、[齐平](after.png)。

实际方案副本的桌面/窄屏浏览器核查通过：默认勾选、即时预览、取消、关闭、一次撤销、保存重开及原墙段/洞口/家具保留；无页面脚本错误。结果见 [results.json](results.json)。当前用户页面已恢复原方案并打开启用齐平的三维视图，见 [当前页面](current.jpg)。
