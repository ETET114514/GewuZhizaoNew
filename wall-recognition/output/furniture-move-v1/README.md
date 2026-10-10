# 家具三维拖拽移动首版

核查日期：2026-10-10。

在三维预览上方新增“移动家具”开关。先选中家具，再拖动该家具；移动限制在地面平面，松手自动应用一次位置修改，支持二维同步、撤销及保存重开。按 Esc、指针取消或窗口失焦可取消拖动，提交失败恢复原位。

## 验证

- `node --test test_furniture_move.mjs test_furniture_models.mjs test_model_geometry.mjs`：17 项通过，覆盖旋转后的边界、精度、不合法比例、原有模型和门窗几何。
- `.venv/Scripts/python.exe -m unittest test_furniture_model test_projects -q`：10 项通过，覆盖家具编辑、外观及项目恢复。
- `.venv/Scripts/python.exe -m unittest test_web -q`：12 项通过，覆盖 API、保存和共享撤销。
- `check_furniture_move_ui.cjs`：真实 Edge 浏览器，以自建简单户型及手工床验证实际鼠标拖动、Esc 取消、一次拖动一次提交、无移动不提交、37° 旋转后的边界、撤销、失败恢复、保存重开、桌面和 390 px 窄屏；无页面脚本错误。

测试保存的项目位于本目录 `testdata/projects/`，与用户项目目录隔离；运行浏览器脚本时建议使用测试服务器：

```powershell
.\.venv\Scripts\python.exe -c "from pathlib import Path; from web_server import ReviewServer; ReviewServer(('127.0.0.1',8772),Path('output/furniture-move-v1/testdata/feedback')).serve_forever()"
# 在另一个终端提供 Playwright 的 NODE_PATH 后执行：
node check_furniture_move_ui.cjs
```

结果见 [results.json](results.json)、[桌面截图](desktop.png)、[窄屏截图](mobile.png)。浏览器操作验证了松手提交后的坐标及二维数据一致；未测试墙体碰撞或吸附，因为首版未提供这两项。

## 边界

家具只能在底图范围内移动，尚可穿过墙体或与其他家具重叠。支持移动已知类别的家具/设施；待定区域不生成模型。旋转仍通过数值编辑，尚无旋转操纵杆、二维拖拽、复制或成组操作。工具栏整体改版留待后续。
