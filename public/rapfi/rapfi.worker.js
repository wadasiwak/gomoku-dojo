/*! © 2026 wadasiwak. All rights reserved. */
// Rapfi 引擎的 classic Worker 載入 glue（本站自撰，非 Rapfi 程式碼）。
// 放在 public/ 以 classic worker 執行：module worker 沒有 importScripts，
// 而 Rapfi 的 Emscripten glue（MODULARIZE=1）是傳統 script、定義全域 Rapfi factory。
//
// Message protocol（與 src/analysis/rapfi.ts 對接）：
//   → { type: 'load', glueURL }     載入引擎（importScripts＋實例化，抓 wasm/data）
//   → { type: 'command', data }     送一行 Gomocup/Yixin 指令（同步思考，回覆走 stdout）
//   ← { type: 'ready' }             引擎可接指令
//   ← { type: 'stdout' | 'stderr', data }   引擎輸出（逐行）
//   ← { type: 'status', data }      Emscripten setStatus（含 data 檔下載進度 "(x/y)"）
//   ← { type: 'exit', data }        引擎行程結束（exit code）
//   ← { type: 'load-error', data }  載入失敗（訊息字串）

var engineInstance = null

self.onmessage = function (e) {
  var msg = e.data
  if (msg.type === 'command') {
    if (engineInstance) engineInstance.sendCommand(msg.data)
    else self.postMessage({ type: 'load-error', data: 'engine not loaded yet' })
  } else if (msg.type === 'load') {
    var glueURL = msg.glueURL
    var baseURL = glueURL.substring(0, glueURL.lastIndexOf('/') + 1)
    try {
      importScripts(glueURL)
      self['Rapfi']({
        // wasm 與 data 檔都與 glue 同目錄
        locateFile: function (url) {
          return baseURL + url
        },
        onReceiveStdout: function (o) {
          self.postMessage({ type: 'stdout', data: o })
        },
        onReceiveStderr: function (o) {
          self.postMessage({ type: 'stderr', data: o })
        },
        onExit: function (c) {
          self.postMessage({ type: 'exit', data: c })
        },
        setStatus: function (s) {
          self.postMessage({ type: 'status', data: s })
        },
      }).then(
        function (instance) {
          engineInstance = instance
          self.postMessage({ type: 'ready' })
        },
        function (err) {
          self.postMessage({ type: 'load-error', data: String(err && err.message ? err.message : err) })
        },
      )
    } catch (err) {
      self.postMessage({ type: 'load-error', data: String(err && err.message ? err.message : err) })
    }
  }
}
