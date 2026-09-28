// 지원일지 맥 앱: 앱 폴더의 서버(server.mjs)를 켜고, 브라우저 대신 앱 창(WKWebView)으로 보여 준다.
// 창을 닫거나 ⌘Q로 끝내면 작성 중인 내용을 저장한 뒤 서버도 끈다. 빌드는 mac/build.command.
import AppKit
import WebKit

// 앱 폴더 찾기: 앱이 놓인 폴더(저장소 맨 위) → 지난번에 쓴 폴더 → 직접 고르기 순서.
let isAppFolder = { (path: String) in FileManager.default.fileExists(atPath: path + "/server.mjs") }
func findAppDir() -> String? {
  if let path = ProcessInfo.processInfo.environment["JIWON_APP_DIR"], isAppFolder(path) { return path }
  let beside = Bundle.main.bundleURL.deletingLastPathComponent().path
  if isAppFolder(beside) { return beside }
  if let saved = UserDefaults.standard.string(forKey: "appDir"), isAppFolder(saved) { return saved }
  return nil
}
var appDir = ""
// JIWON_TEST=1: 창 없이 서버를 켜고 끄는 것만 확인한다(GitHub 자동 테스트용).
let testMode = ProcessInfo.processInfo.environment["JIWON_TEST"] == "1"
let port = ProcessInfo.processInfo.environment["PORT"] ?? "4173"
let appURL = URL(string: "http://127.0.0.1:\(port)/")!
let background = NSColor(red: 0x19 / 255, green: 0x19 / 255, blue: 0x19 / 255, alpha: 1)

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
  var window: NSWindow!
  var webView: WKWebView!
  var server: Process?
  var quitting = false
  var serverReady = false
  var restarts = 0
  var nodePath = ""
  var downloads: [ObjectIdentifier: URL] = [:]
  let logURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/jiwon-ilji.log")

  // MARK: 시작

  func applicationDidFinishLaunching(_ notification: Notification) {
    if testMode { Task { await runTest() }; return }
    buildMenu()
    buildWindow()
    guard let found = findAppDir() ?? chooseAppDir() else { NSApp.terminate(nil); return }
    appDir = found
    UserDefaults.standard.set(found, forKey: "appDir")
    Task { await start() }
  }

  // 앱을 다른 곳(예: 응용 프로그램 폴더)으로 옮겼으면, 지원일지 폴더를 한 번 골라 달라고 한다.
  func chooseAppDir() -> String? {
    let alert = NSAlert()
    alert.messageText = "지원일지 폴더를 골라 주세요"
    alert.informativeText = "GitHub에서 받은 지원일지 폴더(server.mjs가 있는 폴더)를 한 번 고르면 다음부터는 바로 열립니다."
    alert.addButton(withTitle: "폴더 고르기"); alert.addButton(withTitle: "종료")
    guard alert.runModal() == .alertFirstButtonReturn else { return nil }
    let panel = NSOpenPanel()
    panel.canChooseFiles = false; panel.canChooseDirectories = true; panel.allowsMultipleSelection = false
    while panel.runModal() == .OK, let url = panel.url {
      if isAppFolder(url.path) { return url.path }
      let wrong = NSAlert(); wrong.messageText = "이 폴더에는 지원일지가 없어요"; wrong.informativeText = "server.mjs가 들어 있는 폴더를 골라 주세요."; wrong.runModal()
    }
    return nil
  }

  func runTest() async {
    guard let found = findAppDir() else { print("앱 폴더를 찾지 못했습니다"); exit(1) }
    appDir = found
    guard let node = findNode() else { print("Node.js를 찾지 못했습니다"); exit(1) }
    launchServer(node: node)
    for _ in 0..<50 { try? await Task.sleep(nanoseconds: 200_000_000); if await isUp() { break } }
    guard await isUp() else { print("서버가 뜨지 않았습니다"); server?.terminate(); exit(1) }
    print("ready \(appURL) from \(appDir)")
    server?.terminate(); server?.waitUntilExit()
    print(await isUp() ? "서버가 꺼지지 않았습니다" : "stopped")
    exit(await isUp() ? 1 : 0)
  }

  func start() async {
    // 이미 켜져 있으면(다른 방법으로 켠 서버) 그대로 쓰고, 끌 때도 건드리지 않는다.
    if await isUp() == false {
      guard let node = findNode() else { fail("Node.js를 찾지 못했습니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 열어 주세요."); return }
      nodePath = node
      guard await launchAndWait() else {
        fail("지원일지를 켜지 못했습니다.\n\n\(lastLogLines())\n\n자세한 내용: ~/Library/Logs/jiwon-ilji.log"); return
      }
    }
    serverReady = true
    _ = await MainActor.run { webView.load(URLRequest(url: appURL)) }
  }

  // 서버를 켜고 뜰 때까지 기다린다. 도중에 꺼지면(포트 충돌 등) 바로 실패로 본다.
  func launchAndWait() async -> Bool {
    launchServer(node: nodePath)
    for _ in 0..<60 {
      try? await Task.sleep(nanoseconds: 200_000_000)
      if await isUp() { return true }
      if server?.isRunning == false { return await isUp() }
    }
    return false
  }

  // 쓰는 도중에 서버가 꺼지면 다시 켜고 화면을 이어 준다(몇 번 연달아 실패하면 알린다).
  func serverExited(_ process: Process) {
    guard !quitting, serverReady, process === server else { return }
    server = nil
    restarts += 1
    guard restarts <= 3 else { fail("지원일지 서버가 계속 멈춥니다.\n\n\(lastLogLines())"); return }
    Task {
      guard await launchAndWait() else { fail("지원일지 서버를 다시 켜지 못했습니다.\n\n\(lastLogLines())"); return }
      await MainActor.run { self.toast("잠깐 끊겼던 연결을 다시 이었어요.") }
    }
  }

  func lastLogLines() -> String {
    let text = (try? String(contentsOf: logURL, encoding: .utf8)) ?? ""
    return text.split(separator: "\n").suffix(3).joined(separator: "\n")
  }

  // 화면 안의 알림(토스트)으로 보여 준다.
  func toast(_ message: String) {
    let json = (try? String(data: JSONEncoder().encode(message), encoding: .utf8)) ?? "\"\""
    webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('jiwon:toast', { detail: \(json) }))")
  }

  func isUp() async -> Bool {
    var request = URLRequest(url: appURL.appendingPathComponent("api/data"))
    request.timeoutInterval = 1
    guard let (_, response) = try? await URLSession.shared.data(for: request) else { return false }
    return (response as? HTTPURLResponse)?.statusCode == 200
  }

  func findNode() -> String? {
    for path in ["/opt/homebrew/bin/node", "/usr/local/bin/node"] where FileManager.default.isExecutableFile(atPath: path) { return path }
    let shell = Process()
    shell.executableURL = URL(fileURLWithPath: "/bin/zsh")
    shell.arguments = ["-lc", "command -v node"]
    let pipe = Pipe(); shell.standardOutput = pipe
    try? shell.run(); shell.waitUntilExit()
    let found = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return found.isEmpty ? nil : found
  }

  func launchServer(node: String) {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: node)
    process.arguments = ["server.mjs"]
    process.currentDirectoryURL = URL(fileURLWithPath: appDir)
    process.terminationHandler = { [weak self] exited in DispatchQueue.main.async { self?.serverExited(exited) } }
    if !FileManager.default.fileExists(atPath: logURL.path) { FileManager.default.createFile(atPath: logURL.path, contents: nil) }
    if let log = try? FileHandle(forWritingTo: logURL) { log.seekToEndOfFile(); process.standardOutput = log; process.standardError = log }
    try? process.run()
    server = process
  }

  func fail(_ message: String) {
    DispatchQueue.main.async {
      let alert = NSAlert()
      alert.messageText = "지원일지"
      alert.informativeText = message
      alert.alertStyle = .critical
      alert.runModal()
      NSApp.terminate(nil)
    }
  }

  // MARK: 창과 메뉴

  func buildWindow() {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default()
    webView = WKWebView(frame: .zero, configuration: config)
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.allowsBackForwardNavigationGestures = true
    let savedZoom = UserDefaults.standard.double(forKey: "pageZoom")
    if savedZoom > 0 { webView.pageZoom = savedZoom }
    // 서버가 뜰 때까지 빈 창 대신 '여는 중' 화면을 보여 준다.
    webView.loadHTMLString("""
      <html><body style="margin:0;height:100vh;display:grid;place-items:center;background:#191919;color:rgba(255,255,255,.46);font:14px -apple-system,sans-serif">
      <div style="display:grid;justify-items:center;gap:14px"><div style="width:22px;height:22px;border:2px solid rgba(255,255,255,.12);border-top-color:rgba(255,255,255,.55);border-radius:50%;animation:s .8s linear infinite"></div>지원일지를 여는 중…</div>
      <style>@keyframes s{to{transform:rotate(1turn)}}</style></body></html>
      """, baseURL: nil)
    webView.setValue(false, forKey: "drawsBackground")
    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1320, height: 880), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    window.title = "지원일지"
    window.appearance = NSAppearance(named: .darkAqua)
    window.backgroundColor = background
    window.titlebarAppearsTransparent = true
    window.minSize = NSSize(width: 720, height: 520)
    window.contentView = webView
    window.center()
    window.setFrameAutosaveName("JiwonMainWindow")
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  func buildMenu() {
    let main = NSMenu()
    func submenu(_ title: String, _ items: [NSMenuItem]) { let item = NSMenuItem(); let menu = NSMenu(title: title); items.forEach(menu.addItem); item.submenu = menu; main.addItem(item) }
    func item(_ title: String, _ action: Selector?, _ key: String, _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem { let entry = NSMenuItem(title: title, action: action, keyEquivalent: key); entry.keyEquivalentModifierMask = mods; return entry }
    submenu("지원일지", [item("지원일지 가리기", #selector(NSApplication.hide(_:)), "h"), item("기타 가리기", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]), .separator(), item("지원일지 종료", #selector(NSApplication.terminate(_:)), "q")])
    // 편집 메뉴가 있어야 앱 창 안에서 ⌘C · ⌘V · ⌘Z가 동작한다.
    submenu("편집", [item("실행 취소", Selector(("undo:")), "z"), item("실행 복귀", Selector(("redo:")), "z", [.command, .shift]), .separator(), item("오려두기", #selector(NSText.cut(_:)), "x"), item("복사하기", #selector(NSText.copy(_:)), "c"), item("붙여넣기", #selector(NSText.paste(_:)), "v"), item("전체 선택", #selector(NSText.selectAll(_:)), "a"), .separator(), item("찾기", #selector(focusSearch), "f"), .separator(), item("맞춤법 검사", Selector(("toggleContinuousSpellChecking:")), "")])
    submenu("보기", [item("뒤로", #selector(goBack), "["), item("앞으로", #selector(goForward), "]"), .separator(), item("새로 고침", #selector(reload), "r"), .separator(), item("크게", #selector(zoomIn), "+"), item("작게", #selector(zoomOut), "-"), item("원래 크기", #selector(zoomReset), "0")])
    submenu("윈도우", [item("최소화", #selector(NSWindow.performMiniaturize(_:)), "m"), item("닫기", #selector(NSWindow.performClose(_:)), "w")])
    NSApp.mainMenu = main
  }

  @objc func goBack() { webView.goBack() }
  @objc func goForward() { webView.goForward() }
  @objc func reload() { webView.reload() }
  // 글자 크기는 다음에 열 때도 그대로 쓴다.
  func setZoom(_ value: CGFloat) { webView.pageZoom = value; UserDefaults.standard.set(Double(value), forKey: "pageZoom") }
  @objc func zoomIn() { setZoom(min(webView.pageZoom + 0.1, 2)) }
  @objc func zoomOut() { setZoom(max(webView.pageZoom - 0.1, 0.6)) }
  @objc func zoomReset() { setZoom(1) }

  // ⌘F: 지원 현황·경험 정리의 검색칸으로. 검색칸이 없는 화면이면 지원 현황으로 가서 연다.
  @objc func focusSearch() {
    webView.evaluateJavaScript("""
      (() => { const box = document.querySelector('#posting-search, #experience-search');
        if (box) { box.focus(); box.select(); return true; }
        location.hash = '#/'; setTimeout(() => document.querySelector('#posting-search')?.focus(), 300); return false; })()
      """)
  }

  // MARK: 종료: 작성 중인 내용을 저장한 뒤 서버를 끈다

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    if quitting || server == nil { server?.terminate(); return .terminateNow }
    quitting = true
    // 페이지를 떠날 때처럼 저장을 밀어 넣고, '저장됨'이 될 때까지 잠깐(최대 3초) 기다린다.
    webView.evaluateJavaScript("window.dispatchEvent(new PageTransitionEvent('pagehide')); document.querySelector('[data-save-state]')?.textContent || ''")
    Task {
      for _ in 0..<15 {
        try? await Task.sleep(nanoseconds: 200_000_000)
        let state = (try? await webView.evaluateJavaScript("document.querySelector('[data-save-state]')?.textContent || ''")) as? String ?? ""
        if state.contains("저장됨") || state.isEmpty { break }
      }
      try? await Task.sleep(nanoseconds: 300_000_000)
      server?.terminate()
      server?.waitUntilExit()
      NSApp.reply(toApplicationShouldTerminate: true)
    }
    return .terminateLater
  }

  // MARK: 링크 · 다운로드 · 파일 고르기 · 확인 창

  // 앱 밖의 주소(공고 원문 등)는 평소 쓰는 브라우저로 연다.
  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    if action.shouldPerformDownload { decisionHandler(.download); return }
    guard let url = action.request.url, let scheme = url.scheme else { decisionHandler(.cancel); return }
    // 앱 화면과 '여는 중' 화면만 창 안에서 연다.
    if scheme == "about" || (url.host == "127.0.0.1" && String(url.port ?? 80) == port) { decisionHandler(.allow); return }
    // 공고 원문 같은 바깥 주소는 평소 쓰는 브라우저로.
    if ["http", "https", "mailto"].contains(scheme) { NSWorkspace.shared.open(url); decisionHandler(.cancel); return }
    // 창에 파일을 끌어다 놓는 등(file:, blob: …)으로 앱 화면이 사라지지 않게 막는다.
    decisionHandler(.cancel)
  }

  func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    decisionHandler(response.canShowMIMEType ? .allow : .download)
  }

  // target="_blank" 링크
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url { NSWorkspace.shared.open(url) }
    return nil
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

  // 백업 파일은 '다운로드' 폴더에 저장하고, 다 되면 Finder에서 보여 준다.
  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
    let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
    var target = folder.appendingPathComponent(suggestedFilename)
    let name = (suggestedFilename as NSString).deletingPathExtension; let ext = (suggestedFilename as NSString).pathExtension
    var count = 2
    while FileManager.default.fileExists(atPath: target.path) { target = folder.appendingPathComponent("\(name) (\(count))" + (ext.isEmpty ? "" : ".\(ext)")); count += 1 }
    downloads[ObjectIdentifier(download)] = target
    completionHandler(target)
  }

  // 저장이 끝나면 Finder를 띄우지 않고 화면 안에 알린다.
  func downloadDidFinish(_ download: WKDownload) {
    guard let target = downloads.removeValue(forKey: ObjectIdentifier(download)) else { return }
    toast("다운로드 폴더에 저장했어요: \(target.lastPathComponent)")
  }

  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    downloads.removeValue(forKey: ObjectIdentifier(download))
    toast("파일을 저장하지 못했어요: \(error.localizedDescription)")
  }

  func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    panel.canChooseDirectories = false
    panel.beginSheetModal(for: window) { result in completionHandler(result == .OK ? panel.urls : nil) }
  }

  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
    let alert = NSAlert(); alert.messageText = "지원일지"; alert.informativeText = message
    alert.beginSheetModal(for: window) { _ in completionHandler() }
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let alert = NSAlert(); alert.messageText = "지원일지"; alert.informativeText = message
    alert.addButton(withTitle: "확인"); alert.addButton(withTitle: "취소")
    alert.beginSheetModal(for: window) { result in completionHandler(result == .alertFirstButtonReturn) }
  }

  // 서버가 늦게 떴거나 잠깐 끊겼을 때는 잠시 뒤 다시 불러온다.
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    guard !quitting else { return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { webView.load(URLRequest(url: appURL)) }
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
