# GewuZhizaoNew

本地户型墙体识别与校正工作台，作为室内设计平台的第一阶段。

当前流程：**导入户型图 → 粗识别墙体 → 识别门窗 → 保留洞口并整理实墙 → 修改、校核、保存**。

2026-09-09 更新：支持白底双线墙，并恢复粗墙交接处遗漏的局部墙带。窗候选避开已识别的双线墙；无法区分窗、栏杆或设备的边界须确认后才扣墙。六张参考图的对比与已知缺口见 [参考图核对说明](wall-recognition/input/reference-plans/README.md)，结果在 `wall-recognition/output/reference-v2/`。密集尺寸图仍有短隔墙漏检。

## 启动

需要 Python 3.10 或以上。

```powershell
cd wall-recognition
python -m pip install -r requirements.txt
python web_server.py --open-browser
```

Windows 也可以在安装依赖后双击 [start-review.cmd](wall-recognition/start-review.cmd)。本地地址为 [http://127.0.0.1:8765/](http://127.0.0.1:8765/)，保持程序运行即可使用。

## 已实现

- 上传 PNG、JPG、WebP，或使用附带的示例户型图。
- 调用 Python 图像处理程序，提取带独立编号的水平、垂直墙体候选。
- 按平行窗框、墙端及开启弧线提取门窗候选，支持显示切换、定位、确认门/窗、类别待定及排除误报。
- 门窗反过来约束墙体：补齐洞口连接，保留有像素支撑的短墙；延长、补墙后重新扣除洞口，页面和实墙导出保持一致。
- 点选墙段后，按方向、像素数或目标墙直接延长、缩短、补转角、移动、改厚度、删除。
- 框选漏识别区域后直接补墙，支持撤销最近 50 次修改。
- 保存修改后的墙段坐标、底图和操作记录到本机 `wall-recognition/projects/`。

例如：选择 W005，指定“向右、连接到 W004”，点击应用，页面程序直接更新墙段。

## 当前边界

这是早期原型。门窗目前采用几何规则识别，仍有漏检、误检和类别歧义；不能细分全部图例。尺寸单位为像素，尚未校准真实比例。文字输入只解析部分明确的方向、目标编号和像素数。井道/家具分类、三维建模及渲染尚未实现。已保存项目暂未支持从页面重新导入。

最新三步流程结果在 `wall-recognition/output/pipeline-v1/`：26 段粗墙、10 处门窗候选，整理后为 29 段实墙（包含补出的 3 段短墙）。墙体仍需校核；数量不是准确率。`pipeline-comparison.png` 可查看前后对比，`solid-walls.json` 是已扣除洞口的实墙几何。上一版及历史人工校正结果分别保存在 `output/legend-v1/`、`output/review-02/`。

## 测试与说明

```powershell
python -m unittest discover -s wall-recognition -p "test_*.py" -v
```

测试覆盖图像提取、逐段校正、直接修改、保存与撤销的接口流程。更多细节见 [程序说明](wall-recognition/README.md)。

仓库包含示例图及其识别、校正结果。用户在页面中保存的项目、旧反馈记录和运行缓存默认只留本地，不纳入版本管理。
