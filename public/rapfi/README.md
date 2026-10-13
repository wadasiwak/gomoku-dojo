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

## 多執行緒版（rapfi-multi-simd128）

與單執行緒版**同一份原始碼與權重**（rapfi `3c94c2a976f24a0dd1c5517623e9ab6fffe66bd7`、
rapfi-networks `e32ad77a5364363b3e3a02b3f9e8610ade19ea98`，皆未修改），差別只在**不加**
`-DNO_MULTI_THREADING=ON`（上游 CMake 因此改加 `-pthread -s PROXY_TO_PTHREAD=1`，輸出名 `rapfi-multi-simd128`）。

- 工具鏈：emsdk 6.0.5（`emcc 6.0.5 (1db513782be24469589d7cb8a1f1834e9a33f271)`）＋ cmake（Homebrew）
- 編譯日期：2026-10-13（macOS arm64）

```bash
# 前置同上（clone + checkout + submodule Networks）
source ~/emsdk/emsdk_env.sh
mkdir -p Rapfi/build/wasm-multi-simd128 && cd Rapfi/build/wasm-multi-simd128
emcmake cmake ../.. -DCMAKE_BUILD_TYPE=Release \
  -DNO_COMMAND_MODULES=ON \
  -DUSE_WASM_SIMD=ON -DUSE_WASM_SIMD_RELAXED=OFF   # relaxed SIMD 關閉：Safari 不支援
emmake cmake --build . -j8
# 產物：rapfi-multi-simd128.{js,wasm,data}；只取 .js/.wasm 放本目錄
```

| 檔案 | 大小 | sha256 |
| --- | --- | --- |
| `rapfi-multi-simd128.js` | 45,948 B（45 KB） | `04367227b6059d55c13285753f2eb2afdb9ae2abeb06d562fdbe3118c2e208fb` |
| `rapfi-multi-simd128.wasm` | 1,204,585 B（1.2 MB） | `61bbe571e91befce8ccca562a927e76a6eb22c6fb8fc2a397cc5823001e7f12d` |
| （`rapfi-multi-simd128.data`） | 40,336,823 B | `09a8a7c9f4cfbb17690420f0560ebefd947ba876a875bbe37000c49ffa4ae339`＝與 `rapfi-single-simd128.data` **逐位元組相同 → 不另放** |

**共用 .data**：glue 以 `Module.locateFile("rapfi-multi-simd128.data", "")` 取權重包 URL，
在 locateFile 把 `.data` 結尾導到 `rapfi-single-simd128.data` 即可（node 與瀏覽器皆實測可用），
兩版共用一份 40 MB、瀏覽器快取也共用。

**需要 crossOriginIsolated**（SharedArrayBuffer）。GitHub Pages 不能設 header →
以 `public/coi-serviceworker.js`（gzuidhof/coi-serviceworker v0.1.7，MIT，未修改，
sha256 `e97bbac6017322d48aa54a5bc7ce473c725a4b7376ff245002e0ba71c3dcdd7e`）由 Service Worker 補上 COOP/COEP。
非 isolated 環境一律退回單執行緒版。

**pthread 子 Worker 載入**：glue 在 classic worker 內以 `new Worker(self.location.href, {name:'em-pthread'})`
開 pthread（emcc 6 已無 `mainScriptUrlOrBlob`），也就是「重新載入 worker 腳本本身」。
worker 腳本開頭須判斷 `self.name === 'em-pthread'` 時同步 `importScripts(glue)`（glue 尾端會自動呼叫 `Rapfi()` 進入 pthread 模式），
不可走一般的 onmessage 載入流程。

**實測加速**（同一 14 手中盤局面、TIMEOUT_TURN 3000、每輪前 YXHASHCLEAR；Apple Silicon 12 核）：

| 環境 | THREAD_NUM 1 | THREAD_NUM 4 | THREAD_NUM 8 |
| --- | --- | --- | --- |
| node 26（`scripts/rapfi-smoke-multi.mjs`，三次） | 167–173 K nodes/s | 643–689 K nodes/s（**3.9–4.1×**） | — |
| Chrome（COOP/COEP header） | 162–165 K/s，depth 16 | 607–664 K/s（**≈3.8–4.0×**），depth 18–20 | 1,396 K/s（≈8.6×） |
| Chrome（coi-serviceworker） | 159–164 K/s | 598–731 K/s | — |

單執行緒版同局面 162–175 K/s，與多執行緒版 THREAD_NUM 1 相當（多執行緒 build 本身無明顯額外開銷）。
Lazy SMP 下「深度」不是乾淨的比較指標，以 nodes/s 為準。

**已知注意事項**：
- `INFO THREAD_NUM n` 要在 `START` **之前**送；`START` 後立刻改執行緒數會死鎖（node／Chrome 皆重現，START 後等 ≥50 ms 或先跑過一次搜尋則正常）。
- 多執行緒版 `sendCommand` 是非同步（指令丟進 stdin 佇列、pthread 讀），一次 sendCommand 只能是**一條**協定指令；多送一次空的會讓引擎讀到 EOF 而 `emscripten_force_exit` 結束。
- coi-serviceworker 首次造訪會自動 reload 一次；v0.1.7 在 `updatefound` 就 reload，SW 常尚未接管 → 實測 4 次中 3 次第二次載入仍非 isolated（要第三次才成功）。用 `window.coi.doReload` 改成等 `controllerchange` 再 reload 後，約 45 次 headless Chrome 實測中所有完成的跑次都在第二次載入即 isolated、引擎正常出手；另有 2 次 renderer 崩潰（Target crashed，原因未查明；同測試改用真 header 伺服器 10/10 無崩潰）。
- COEP require-corp 會擋無 CORP header 的跨域 no-cors 資源（實測 `gc.zgo.at/count.js` 被擋，加 `crossorigin="anonymous"` 即可，該站有 `access-control-allow-origin: *`）。
