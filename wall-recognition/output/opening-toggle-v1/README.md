# 门窗开合核查

核查日期：2026-10-13。临时项目目录、随机端口隔离服务器；测试未改动用户方案。

## 已验证

- 二维和三维右侧统一为“门窗开合”。单件一个状态按钮，批量一个范围选择和两个动作按钮；保留调整方向与转轴入口。
- 单件关闭后显示打开门/窗；任何非零角度显示关闭门/窗，半开 25° 可一键关闭到 0°。固定玻璃不可开合。
- 批量所有门窗、所有门、所有窗分别统一打开/关闭；混合状态不逐件反转。范围在二维/三维同步，三维单件选择保持有效。
- 打开沿用门 90°、窗 45°、窗宽预设与方向规则。关闭仅将角度归零，保留类型、铰链、转轴、轴位、方向模式及房间归属，即使室内侧不明也可关闭。
- 未标定可操作；关闭不补写旧对象的开启参数。固定玻璃、已排除及需确认候选保持原样。
- 批量一次历史、一次撤销；重复执行已达目标状态不增加历史。打开和关闭均验证保存重开。
- 打开和关闭网络失败后，文档及历史保持原样，按钮恢复可用。未应用修改时，单件、批量与范围选择禁用。
- 390 × 844 px 窄屏可打开、关闭，无横向溢出；浏览器无脚本错误。

## 自动检查

- `.venv/Scripts/python.exe -m unittest test_opening_quick test_opening_direction test_window_preset test_opening_operation test_projects test_entry_door -q`：26 项通过。
- `node --test test_*.mjs`：68 项通过。
- `node tools/check_opening_quick_ui.cjs`：桌面、三维、窄屏开合核查通过。
- `node tools/check_opening_pivot_ui.cjs`：房间归属、向内/向外、手动转轴、方向预览及保存重开回归通过。

浏览器需 Playwright 和已安装 Edge；可用 `NODE_PATH` 指向本机捆绑依赖。结果见 [results.json](results.json)，截图：[二维](desktop.png)、[三维](model.png)、[窄屏](narrow.png)。

API 保留 `/api/open-openings` 兼容原调用，增加 `action: open | close`，省略 action 仍为打开。关闭不改变墙体洞口；目前仍为示意模型，无碰撞检测。
