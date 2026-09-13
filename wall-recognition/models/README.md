# Local furniture model

The app uses `floorcad-nano.onnx` (1280 square, opset 17) through ONNX Runtime CPU. No image leaves this computer. Torch and Ultralytics are only needed to reproduce the export, not to run the app.

Source: [mudasir13cs/floorcad-yolov8n-detect](https://huggingface.co/mudasir13cs/floorcad-yolov8n-detect). The pinned revision and both checksums are recorded in `floorcad-nano-source.json`. The author labels the weights **AGPL-3.0**; the training source is FloorPlanCAD, whose source terms must also be checked for redistribution/commercial use. This integration is a local prototype, not a commercial license clearance.

For a fresh installation, install `requirements.txt` for the application. To build weights in a separate environment:

```powershell
python -m venv --system-site-packages .venv
.venv/Scripts/python.exe -m pip install torch==2.9.1 torchvision==0.24.1 --index-url https://download.pytorch.org/whl/cpu
.venv/Scripts/python.exe -m pip install ultralytics==8.3.240 onnx==1.19.1
.venv/Scripts/python.exe tools/setup_furniture_model.py
```

The setup verifies the checkpoint SHA256 and restricts deserialization to installed Torch/Ultralytics neural-network classes. Model files are ignored by Git. A missing model/runtime produces an explicit document limitation and falls back to templates.

Light line drawings are thresholded at 215 and converted to bright strokes on black. Bed, sofa, chair, table and generic cabinet categories are enabled. Bathroom v2 additionally verifies candidates using agreement between binary and continuous inverted views, enclosed bowl contours and proximity to a verified toilet. It outputs toilet, vanity and unconfirmed wet_area candidates, retaining raw labels and verification evidence. It does not globally remap the incorrect fixture taxonomy. Cabinet function and orientation are not inferred. Every prediction remains unreviewed and retains its original model class. These scores are not calibrated probabilities. Template overlaps take precedence without comparing unlike scores.

The Architect model was evaluated but is not enabled: it produced poor results on these drawings. Its experimental checkpoint is CC-BY-NC-4.0, source [SamirShabani/Architect](https://huggingface.co/SamirShabani/Architect); SHA256 `f13d78e2065b758b81a43ca5b0ce7bed328760e12cc825fe82309e14074c6583`.
