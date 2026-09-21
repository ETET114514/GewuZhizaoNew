# Three.js 本地依赖

固定版本：three 0.180.0，MIT 许可，见 THREE-LICENSE.txt。

来源：https://cdn.jsdelivr.net/npm/three@0.180.0/ 。包含 build/three.module.min.js、build/three.core.min.js 和 examples/jsm/controls/OrbitControls.js。

OrbitControls.js 的 `from 'three'` 改为 `from './three.module.min.js'`，便于本地模块加载。运行页面无需外部 CDN。API 参考：https://threejs.org/docs/ 。
