/*! © 2026 wadasiwak. All rights reserved. */
// Rapfi 多執行緒版的 classic Worker 載入 glue（本站自撰，非 Rapfi 程式碼）。
// 與 rapfi.worker.js 同一套 message protocol（見該檔檔頭），差別：
//   1. Emscripten pthread 以 `new Worker(self.location.href, {name:'em-pthread'})` 開子緒，
//      也就是「再載一次本檔」→ 偵測到 em-pthread 就同步 importScripts glue
//      （glue 尾巴會自動以 pthread 模式啟動），不可走 onmessage 載入流程。
//   2. 權重包 .data 與單執行緒版逐位元組相同 → locateFile 導到同一份（共用 40MB 快取）。
//   3. sendCommand 為非同步（指令進 stdin 佇列由引擎 pthread 讀），一次只送一條指令；
//      INFO THREAD_NUM 要在 START 之前送（START 後立刻改執行緒數會死鎖）。
// 需要 crossOriginIsolated（SharedArrayBuffer）；由 src/analysis/rapfi.ts 判斷後才選用本檔。
var GLUE = 'rapfi-multi-simd128.js'

if (self.name === 'em-pthread') {
  importScripts(new URL(GLUE, self.location.href).href)
} else {
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
          locateFile: function (url) {
            if (url.endsWith('.data')) return baseURL + 'rapfi-single-simd128.data'
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
}
