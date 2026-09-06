// WKWebView runner for check.mjs --webkit: the desktop studio ships WebKit,
// and the lens only drives Chrome. Loads the harness page in the SAME engine
// the app uses, polls until the page has evaluated its assertions, and prints
// one RESULT line. Compiled on demand by check.mjs (swiftc ships with Xcode
// command line tools); the binary is gitignored.
import WebKit
let url = URL(string: CommandLine.arguments[1])!
let timeout = Double(CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "120") ?? 120
let app = NSApplication.shared
app.setActivationPolicy(.accessory)   // no dock icon, never steals focus
// A real window: WebKit suspends requestAnimationFrame in a view that is not
// on screen, and VS Code renders on rAF. Parked at the screen's bottom-right.
let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1400, height: 900), styleMask: [.titled], backing: .buffered, defer: false)
let wv = WKWebView(frame: win.contentView!.bounds)
wv.autoresizingMask = [.width, .height]
win.contentView!.addSubview(wv)
win.title = "arxa-monaco check (webkit)"
win.orderFrontRegardless()
// --script=<file>: instead of the harness page's own assertions, run this JS
// after load (it must return a promise; the resolved value is the RESULT).
// This is how the LIVE studio page gets driven in the engine it ships with.
let scriptArg = CommandLine.arguments.first { $0.hasPrefix("--script=") }
let script = scriptArg.flatMap { try? String(contentsOfFile: String($0.dropFirst(9)), encoding: .utf8) }
let done = script != nil
  ? "typeof window.__result === 'string' ? window.__result : null"
  : "JSON.stringify(window.__spike && Array.isArray(window.__spike.fail) ? { step: __spike.step, fail: __spike.fail, flow: __spike.flow, partErr: __spike.partErr, error: __spike.error, ua: navigator.userAgent } : null)"
var started = false
var ticks = 0
func poll() {
  ticks += 1
  if let js = script, !started, ticks > 12 {   // ~6s settle after load before driving
    started = true
    wv.evaluateJavaScript("void (" + js + ").then((r) => { window.__result = String(r) }, (e) => { window.__result = 'ERR ' + (e && e.stack || e) })") { _, e in
      if let e = e { print("RESULT: ERR eval \(e)"); exit(1) }
    }
  }
  wv.evaluateJavaScript(done) { r, _ in
    if let s = r as? String, s != "null" { print("RESULT: \(s)"); exit(0) }
    if Double(ticks) * 0.5 > timeout {
      wv.evaluateJavaScript("JSON.stringify({ step: window.__spike && __spike.step, error: window.__spike && __spike.error })") { r, _ in
        print("RESULT: timeout \(r ?? "")"); exit(1)
      }
      return
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { poll() }
  }
}
wv.load(URLRequest(url: url))
DispatchQueue.main.asyncAfter(deadline: .now() + 2) { poll() }
app.run()
