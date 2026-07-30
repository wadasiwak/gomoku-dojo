# Rapfi WebAssembly 分析引擎（GPL-3.0）

本目錄內的 WebAssembly 引擎編譯自 **Rapfi**（Gomocup 冠軍級五子棋/連珠引擎），
著作權屬 Rapfi developers（dhbloo 等，見上游 AUTHORS），依 **GPL-3.0** 授權散布
（全文見本目錄 `LICENSE`）。本站僅以未修改的獨立 Web Worker 形式載入作為分析引擎，
與本站自身程式碼（另行授權）以行程邊界隔離。

## 來源與版本

- 原始碼：https://github.com/dhbloo/rapfi
  - commit `3c94c2a976f24a0dd1c5517623e9ab6fffe66bd7`（2026-07-23，引擎版本 0.43.02）
- NNUE 權重：https://github.com/dhbloo/rapfi-networks
  - commit `e32ad77a5364363b3e3a02b3f9e8610ade19ea98`（mix9svq 系列＋classical）
- **原始碼與權重皆未做任何修改**，僅照上游 README「Build for WebAssembly」章節編譯。

## 編譯方式（重取/重編 SOP）

```bash
git clone https://github.com/dhbloo/rapfi && cd rapfi
git checkout 3c94c2a976f24a0dd1c5517623e9ab6fffe66bd7
git submodule update --init --depth 1 Networks   # 權重（~40MB）
# emsdk 6.0.5（emcc 6.0.5）＋ cmake
mkdir -p Rapfi/build/wasm-single-simd128 && cd Rapfi/build/wasm-single-simd128
emcmake cmake ../.. -DCMAKE_BUILD_TYPE=Release \
  -DNO_COMMAND_MODULES=ON -DNO_MULTI_THREADING=ON \
  -DUSE_WASM_SIMD=ON -DUSE_WASM_SIMD_RELAXED=OFF
emmake cmake --build . -j8
# 產物：rapfi-single-simd128.{js,wasm,data} → 覆蓋本目錄同名檔
```

**為何選單執行緒（-single）版**：多執行緒版需要 SharedArrayBuffer，瀏覽器要求
COOP/COEP response header；GitHub Pages 是純靜態託管無法設 header，故只能用
單執行緒＋SIMD 版（SIMD 不需任何 header）。

## 檔案清單

| 檔案 | 大小 | 說明 |
| --- | --- | --- |
| `rapfi-single-simd128.js` | 39 KB | Emscripten JS glue（MODULARIZE，全域 `Rapfi` factory） |
| `rapfi-single-simd128.wasm` | 1.2 MB | 引擎本體（wasm32 + SIMD128，單執行緒） |
| `rapfi-single-simd128.data` | 40.3 MB | Emscripten 預載檔案包：NNUE 權重（freestyle/standard/renju 黑白，各 ~10MB lz4）＋ config.toml |
| `rapfi.worker.js` | — | 本站自撰的 Worker 載入 glue（非 Rapfi 程式碼） |
| `LICENSE` | — | GPL-3.0 全文（上游 Copying.txt） |

## 站內致謝文字

分析引擎 Rapfi © dhbloo，GPL-3.0，原始碼 github.com/dhbloo/rapfi
