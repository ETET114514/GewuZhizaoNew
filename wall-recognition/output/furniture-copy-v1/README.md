# 家具复制核查

核查日期：2026-10-12。使用临时目录和随机端口的隔离服务器、自建 400 × 300 px 户型；不读取或修改用户项目。

## 已验证

- 二维选中家具后进入复制放置，虚线副本跟随鼠标，放下前文档不变；Esc、×、切换工具及指针取消不新增对象或历史。
- 点击放置新增独立编号、一条修改记录；原件不变，副本保留占地、自由旋转、框内转向、高度、离地及颜色。检测来源的副本使用人工来源，不伪造识别置信度或预测证据。
- 复制可独立编辑、一次撤销；保存时写入 walls.json 和 furniture.json，打开恢复副本与外观。
- 三维可选中副本并显示相同厘米参数；三维复制按钮返回二维进入放置。
- 底图外释放不新增；贴边放置按完整旋转占地向内限制。模拟请求失败后文档、历史不变，预览清除，按钮恢复。
- 390 × 844 px 窄屏通过复制放置，无页面横向溢出；这是浏览器鼠标/键盘核查，未实测物理触屏设备。正常流程无页面脚本错误。

## 自动检查

- `.venv/Scripts/python.exe -m unittest test_furniture_copy test_furniture_model test_projects -q`：17 项通过。覆盖未标定复制、两种转向及外观保持、独立深拷贝、保留排除对象编号、无效/旋转越界请求的原子性、共享撤销与保存重开。
- `node --test test_furniture_move.mjs test_furniture_models.mjs test_model_geometry.mjs`：30 项通过。覆盖复制预览、旋转占地贴边限制、未标定、不可复制类别及原有家具/三维几何回归。
- `node tools/check_furniture_copy_ui.cjs`：桌面和窄屏操作通过。需要 Node 可加载 Playwright（可设置 NODE_PATH），默认使用已安装 Edge；COPY_TEST_BROWSER 可指定其他 Playwright 浏览器通道。服务器数据保存在系统临时目录，结束后自动清理。

摘要见 [results.json](results.json)，截图：[复制预览](preview.png)、[放置后](placed.png)、[三维副本](model.png)、[窄屏](narrow.png)。

## 边界

本轮只做单件家具复制；三维入口使用二维放置。未标定时保持原像素占地，不推测真实尺寸。待定家具、区域及排除对象不可复制。没有批量复制、吸附、墙体/家具碰撞或通道净距检查。
