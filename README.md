# GewuZhizaoNew

本地户型墙体识别与校正工作台，作为室内设计平台的第一阶段。

当前流程：**导入户型图 → 自动识别墙段 → 页面直接修改 → 撤销或保存项目**。

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
- 点选墙段后，按方向、像素数或目标墙直接延长、缩短、补转角、移动、改厚度、删除。
- 框选漏识别区域后直接补墙，支持撤销最近 50 次修改。
- 保存修改后的墙段坐标、底图和操作记录到本机 `wall-recognition/projects/`。

例如：选择 W005，指定“向右、连接到 W004”，点击应用，页面程序直接更新墙段。

## 当前边界

这是早期原型。识别结果会漏检或误检，尺寸单位为像素，尚未校准真实比例。文字输入只解析部分明确的方向、目标编号和像素数；缺少必要参数时会提示补充。自动门窗分类、三维建模、家具及渲染尚未实现。已保存项目暂未支持从页面重新导入。

## 测试与说明

```powershell
python -m unittest discover -s wall-recognition -p "test_*.py" -v
```

测试覆盖图像提取、逐段校正、直接修改、保存与撤销的接口流程。更多细节见 [程序说明](wall-recognition/README.md)。

仓库包含示例图及其识别、校正结果。用户在页面中保存的项目、旧反馈记录和运行缓存默认只留本地，不纳入版本管理。
