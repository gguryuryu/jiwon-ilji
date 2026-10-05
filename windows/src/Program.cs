// 지원일지 윈도우 앱: 앱 폴더의 서버(server.mjs)를 켜고, Edge 앱 창 대신 전용 창(WebView2)으로 보여 준다.
// 맥의 지원일지.app(mac/main.swift)과 같은 역할이다. 창을 닫으면 작성 중인 내용을 저장한 뒤 서버도 끈다.
// 빌드는 GitHub Actions(.github/workflows/windows-app.yml)가 하고, 만든 파일은 windows/app/에 올린다.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace JiwonIlji
{
    static class Program
    {
        [STAThread]
        static int Main(string[] args)
        {
            // --smoke=<결과 파일>: GitHub 자동 테스트용. 창을 띄워 화면이 뜨는지 확인하고 스스로 닫는다.
            string smoke = args.FirstOrDefault(arg => arg.StartsWith("--smoke="))?.Substring("--smoke=".Length);
            // --fix-shortcuts: 예전 바로가기만 고치고 끝낸다(자동 테스트용).
            if (args.Contains("--fix-shortcuts")) { Shortcuts.Refresh(); return 0; }
            using (var mutex = new Mutex(true, "local.jiwon-ilji.window", out bool first))
            {
                // 이미 열려 있으면 새 창 대신 그 창을 앞으로 가져온다.
                if (!first && smoke == null) { Native.FocusOtherInstance(); return 0; }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                if (smoke == null) Shortcuts.Refresh();
                var form = new MainForm(smoke);
                Application.Run(form);
                return form.ExitCode;
            }
        }
    }

    sealed class MainForm : Form
    {
        static readonly Color Background = Color.FromArgb(21, 21, 22); // 앱 바탕(--bg)과 같은 색
        // windows/app/jiwon-ilji.exe → 저장소 맨 위(앱 폴더)
        static readonly string Root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", ".."));
        static readonly string DataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "jiwon-ilji");
        static readonly string LogPath = Path.Combine(DataDir, "server.log");
        static readonly string SettingsPath = Path.Combine(DataDir, "window.txt");
        static readonly string Port = string.IsNullOrEmpty(Environment.GetEnvironmentVariable("PORT")) ? "4173" : Environment.GetEnvironmentVariable("PORT");
        static readonly string AppUrl = "http://127.0.0.1:" + Port;

        readonly string smoke;
        readonly WebView2 web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Background };
        CoreWebView2Environment environment;
        MiniForm mini;           // 집중 루프의 작은 타이머 창
        Point? miniLocation;     // 작은 창을 옮겨 둔 자리(다음에도 그 자리에 연다)
        Process server;          // 이 창이 켠 서버(이미 켜져 있던 서버는 건드리지 않는다)
        bool serverReady, quitting, closeNow;
        int restarts;
        double zoom = 1;
        public int ExitCode;

        public MainForm(string smoke)
        {
            this.smoke = smoke;
            Text = "지원일지";
            BackColor = Background;
            // 여러 크기가 든 아이콘 파일을 써야 작업 표시줄·Alt+Tab에서 흐리지 않다.
            try { Icon = new Icon(Path.Combine(Root, "assets", "icon-transparent.ico")); }
            catch { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); }
            MinimumSize = Scale(new Size(720, 520));
            StartPosition = FormStartPosition.Manual;
            RestoreWindow();
            Controls.Add(web);
            Load += async (sender, e) => await StartAsync();
            FormClosing += OnClosing;
        }

        // 창 제목 막대도 앱처럼 어둡게(윈도우 10 20H1 이후 · 11)
        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            Native.DarkTitleBar(Handle, Background);
        }

        static Size Scale(Size size)
        {
            float scale = Native.SystemDpi() / 96f;
            return new Size((int)(size.Width * scale), (int)(size.Height * scale));
        }

        // ---------- 시작 ----------

        async Task StartAsync()
        {
            try
            {
                Directory.CreateDirectory(DataDir);
                environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(DataDir, "webview2"));
                await web.EnsureCoreWebView2Async(environment);
            }
            catch (WebView2RuntimeNotFoundException)
            {
                // 화면 부품(WebView2)이 없는 오래된 윈도우: 예전처럼 브라우저로 연다.
                Fail("이 컴퓨터에 Microsoft Edge WebView2 런타임이 없어요.\nhttps://go.microsoft.com/fwlink/p/?LinkId=2124703 에서 설치한 뒤 다시 켜 주세요.");
                return;
            }
            SetUpWebView();
            web.CoreWebView2.NavigateToString(LoadingHtml);

            // 이미 켜져 있으면(다른 방법으로 켠 서버) 그대로 쓰고, 끌 때도 건드리지 않는다.
            if (!await IsUpAsync())
            {
                string node = FindNode();
                if (node == null) { Fail("Node.js를 찾지 못했어요. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 켜 주세요."); return; }
                if (!await LaunchAndWaitAsync(node)) { Fail("지원일지를 켜지 못했어요.\n\n" + LastLogLines() + "\n\n자세한 내용: " + LogPath); return; }
            }
            serverReady = true;
            web.CoreWebView2.Navigate(AppUrl);
        }

        void SetUpWebView()
        {
            var core = web.CoreWebView2;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;
            core.Settings.IsPasswordAutosaveEnabled = false;
            web.ZoomFactor = zoom;
            web.ZoomFactorChanged += (sender, e) => { zoom = web.ZoomFactor; };

            // 창 제목 = 화면 제목(집중 루프가 돌면 남은 시간이 작업 표시줄에도 보인다)
            core.DocumentTitleChanged += (sender, e) => { if (IsLocal(core.Source)) Text = core.DocumentTitle; };

            // 화면에서 보내는 신호(작은 타이머 창 열기, 저장했음)
            core.WebMessageReceived += (sender, e) => OnWebMessage(e.WebMessageAsJson);

            // 앱 밖의 주소(공고 원문 등)는 평소 쓰는 브라우저로 연다.
            core.NavigationStarting += (sender, e) => { if (!IsLocal(e.Uri)) { e.Cancel = true; OpenOutside(e.Uri); } };
            core.NewWindowRequested += (sender, e) => { e.Handled = true; OpenOutside(e.Uri); };

            // 서버가 늦게 떴거나 잠깐 끊겼을 때는 잠시 뒤 다시 불러온다.
            core.NavigationCompleted += async (sender, e) =>
            {
                if (!serverReady || quitting) return;
                if (!e.IsSuccess && core.Source.StartsWith(AppUrl)) { await Task.Delay(1000); if (!quitting) core.Reload(); return; }
                if (smoke != null && e.IsSuccess && core.Source.StartsWith(AppUrl)) await SmokeAsync();
            };

            // 백업 파일은 '다운로드' 폴더에 저장하고, 다 되면 화면 안에 알린다.
            core.DownloadStarting += (sender, e) =>
            {
                e.Handled = true; // 브라우저 다운로드 창을 띄우지 않는다
                var download = e.DownloadOperation;
                download.StateChanged += (s, a) =>
                {
                    if (download.State == CoreWebView2DownloadState.Completed) Toast("다운로드 폴더에 저장했어요 · " + Path.GetFileName(download.ResultFilePath));
                    else if (download.State == CoreWebView2DownloadState.Interrupted) Toast("파일을 저장하지 못했어요.");
                };
            };

            // Ctrl+F: 지원 현황·경험 정리의 검색칸으로(맥 앱의 ⌘F와 같다).
            _ = core.AddScriptToExecuteOnDocumentCreatedAsync(@"
                addEventListener('keydown', event => {
                  if (!(event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'f')) return;
                  event.preventDefault();
                  const box = document.querySelector('#posting-search, #experience-search');
                  if (box) { box.focus(); box.select(); return; }
                  location.hash = '#/'; setTimeout(() => document.querySelector('#posting-search')?.focus(), 300);
                }, true);");
        }

        // ---------- 작은 타이머 창(집중 루프 → ⧉ 작은 창) ----------
        // 다른 프로그램 위에 늘 떠 있는 작은 창. 작은 창의 pause·break는 본 창 화면이 처리해 기록은 한 곳에서만 바뀐다.

        void OnWebMessage(string json)
        {
            Dictionary<string, object> body;
            try { body = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(json); } catch { return; }
            if (body == null || !body.TryGetValue("type", out var type)) return;
            switch (type as string)
            {
                case "openMini": ShowMini(); break;
                case "saved": mini?.RefreshTimers(); break;
                case "act":
                    if (body.TryGetValue("action", out var action) && body.TryGetValue("id", out var id) && action is string a && id is string i)
                        _ = web.CoreWebView2?.ExecuteScriptAsync("window.jiwonLab && jiwonLab.act(" + Json(a) + ", " + Json(i) + ")");
                    break;
                case "focusMain":
                    if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
                    Activate();
                    break;
                case "size":
                    if (mini != null && body.TryGetValue("height", out var height)) { try { mini.FitHeight(Convert.ToDouble(height)); } catch { /* 숫자가 아니면 무시 */ } }
                    break;
            }
        }

        void ShowMini()
        {
            if (environment == null) return;
            if (mini != null && !mini.IsDisposed) { mini.Show(); return; }
            mini = new MiniForm(environment, AppUrl + "/mini.html", miniLocation, OnWebMessage, IsLocal);
            mini.FormClosed += (sender, e) => { miniLocation = ((Form)sender).Location; mini = null; };
            mini.Show();
        }

        static bool IsLocal(string uri)
        {
            if (string.IsNullOrEmpty(uri) || uri.StartsWith("about:") || uri.StartsWith("data:") || uri.StartsWith("blob:")) return true;
            return Uri.TryCreate(uri, UriKind.Absolute, out var parsed) && (parsed.Host == "127.0.0.1" || parsed.Host == "localhost") && parsed.Port.ToString() == Port;
        }

        static void OpenOutside(string uri)
        {
            if (!Uri.TryCreate(uri, UriKind.Absolute, out var parsed) || (parsed.Scheme != "https" && parsed.Scheme != "http" && parsed.Scheme != "mailto")) return;
            try { Process.Start(new ProcessStartInfo(parsed.AbsoluteUri) { UseShellExecute = true }); } catch { /* 열 수 있는 브라우저가 없으면 조용히 넘어간다 */ }
        }

        void Toast(string message)
        {
            if (web.CoreWebView2 == null) return;
            var json = "\"" + message.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
            _ = web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('jiwon:toast', { detail: " + json + " }))");
        }

        // ---------- 서버 ----------

        static async Task<bool> IsUpAsync()
        {
            try
            {
                var request = WebRequest.CreateHttp(AppUrl + "/api/data");
                request.Proxy = null;
                var response = request.GetResponseAsync();
                if (await Task.WhenAny(response, Task.Delay(1500)) != response) return false;
                using (var result = (HttpWebResponse)await response) return result.StatusCode == HttpStatusCode.OK;
            }
            catch { return false; }
        }

        static string FindNode()
        {
            var folders = (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';').Select(folder => folder.Trim().Trim('"'))
                .Concat(new[] {
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs"),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "nodejs"),
                });
            foreach (var folder in folders.Where(folder => folder.Length > 0))
            {
                try { var path = Path.Combine(folder, "node.exe"); if (File.Exists(path)) return path; } catch { /* 잘못된 PATH 항목은 건너뛴다 */ }
            }
            return null;
        }

        // 서버를 켜고 뜰 때까지 기다린다. 도중에 꺼지면(포트 충돌 등) 바로 실패로 본다.
        async Task<bool> LaunchAndWaitAsync(string node)
        {
            LaunchServer(node);
            for (int i = 0; i < 80; i++)
            {
                await Task.Delay(250);
                if (await IsUpAsync()) return true;
                if (server == null || server.HasExited) return await IsUpAsync();
            }
            return false;
        }

        void LaunchServer(string node)
        {
            var log = new StreamWriter(LogPath, true, new UTF8Encoding(false)) { AutoFlush = true };
            // --exit-when-closed: 이 창이 비정상으로 꺼져도 서버가 혼자 남아 있지 않게 하는 안전장치
            var info = new ProcessStartInfo(node, "server.mjs --exit-when-closed")
            {
                WorkingDirectory = Root,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            var process = new Process { StartInfo = info, EnableRaisingEvents = true };
            DataReceivedEventHandler write = (sender, e) => { if (e.Data != null) lock (log) { try { log.WriteLine(e.Data); } catch { /* 기록 실패는 무시 */ } } };
            process.OutputDataReceived += write;
            process.ErrorDataReceived += write;
            process.Exited += (sender, e) => { if (IsHandleCreated) BeginInvoke(new Action(() => ServerExited(process))); };
            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            server = process;
        }

        // 쓰는 도중에 서버가 꺼지면(잠자기 뒤 등) 다시 켜고 화면을 이어 준다(몇 번 연달아 실패하면 알린다).
        async void ServerExited(Process process)
        {
            if (quitting || !serverReady || process != server) return;
            server = null;
            if (++restarts > 3) { Fail("지원일지 서버가 계속 멈춰요.\n\n" + LastLogLines()); return; }
            if (await IsUpAsync()) return; // 다른 창이 이미 다시 켰다
            string node = FindNode();
            if (node == null || !await LaunchAndWaitAsync(node)) { Fail("지원일지 서버를 다시 켜지 못했어요.\n\n" + LastLogLines()); return; }
            Toast("잠깐 끊겼던 연결을 다시 이었어요.");
        }

        static string LastLogLines()
        {
            try { return string.Join("\n", File.ReadAllLines(LogPath, Encoding.UTF8).Reverse().Take(3).Reverse()); }
            catch { return ""; }
        }

        void Fail(string message)
        {
            ExitCode = 1;
            quitting = true;
            if (smoke != null) File.WriteAllText(smoke, "{\"ok\":false,\"error\":" + Json(message) + "}", Encoding.UTF8);
            else MessageBox.Show(this, message, "지원일지", MessageBoxButtons.OK, MessageBoxIcon.Error);
            closeNow = true;
            StopServer();
            BeginInvoke(new Action(Close));
        }

        static string Json(string text) => "\"" + text.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "") + "\"";

        void StopServer()
        {
            try { if (server != null && !server.HasExited) { server.Kill(); server.WaitForExit(3000); } } catch { /* 이미 꺼졌다 */ }
        }

        // ---------- 닫기: 작성 중인 내용을 저장한 뒤 서버를 끈다 ----------

        async void OnClosing(object sender, FormClosingEventArgs e)
        {
            if (closeNow) { SaveWindow(); return; }
            e.Cancel = true;
            if (quitting) return;
            quitting = true;
            SaveWindow();
            mini?.Close();
            var core = web.CoreWebView2;
            if (core != null && serverReady && core.Source.StartsWith(AppUrl))
            {
                // 페이지를 떠날 때처럼 저장을 밀어 넣고, '저장됨'이 될 때까지 잠깐(최대 3초) 기다린다.
                try
                {
                    await core.ExecuteScriptAsync("window.dispatchEvent(new PageTransitionEvent('pagehide'))");
                    for (int i = 0; i < 15; i++)
                    {
                        await Task.Delay(200);
                        var state = await core.ExecuteScriptAsync("document.querySelector('[data-save-state]')?.textContent || ''");
                        if (state.Contains("저장됨") || state == "\"\"") break;
                    }
                    await Task.Delay(300);
                }
                catch { /* 화면이 이미 닫혔으면 그대로 끈다 */ }
            }
            StopServer();
            closeNow = true;
            Close();
        }

        // ---------- 창 크기·위치·글자 크기 기억 ----------

        void RestoreWindow()
        {
            var work = Screen.PrimaryScreen.WorkingArea;
            var size = Scale(new Size(1320, 880));
            size = new Size(Math.Min(size.Width, work.Width * 9 / 10), Math.Min(size.Height, work.Height * 9 / 10));
            Bounds = new Rectangle(work.Left + (work.Width - size.Width) / 2, work.Top + (work.Height - size.Height) / 2, size.Width, size.Height);
            try
            {
                foreach (var line in File.ReadAllLines(SettingsPath))
                {
                    var parts = line.Split('=');
                    if (parts.Length != 2) continue;
                    if (parts[0] == "bounds")
                    {
                        var n = parts[1].Split(',').Select(int.Parse).ToArray();
                        var saved = new Rectangle(n[0], n[1], n[2], n[3]);
                        // 모니터를 뺐을 때처럼 화면 밖이면 가운데에 연다.
                        if (Screen.AllScreens.Any(screen => screen.WorkingArea.IntersectsWith(saved)) && saved.Width >= 400 && saved.Height >= 300) Bounds = saved;
                    }
                    if (parts[0] == "max" && parts[1] == "1") WindowState = FormWindowState.Maximized;
                    if (parts[0] == "mini")
                    {
                        var m = parts[1].Split(',').Select(int.Parse).ToArray();
                        var point = new Point(m[0], m[1]);
                        if (Screen.AllScreens.Any(screen => screen.WorkingArea.Contains(point))) miniLocation = point;
                    }
                    if (parts[0] == "zoom" && double.TryParse(parts[1], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var value) && value >= .5 && value <= 3) zoom = value;
                }
            }
            catch { /* 처음 켰거나 파일이 깨졌으면 기본값 */ }
        }

        void SaveWindow()
        {
            if (smoke != null) return;
            try
            {
                var bounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
                var lines = new List<string> {
                    $"bounds={bounds.X},{bounds.Y},{bounds.Width},{bounds.Height}",
                    "max=" + (WindowState == FormWindowState.Maximized ? "1" : "0"),
                    "zoom=" + zoom.ToString(System.Globalization.CultureInfo.InvariantCulture),
                };
                var place = mini != null && !mini.IsDisposed ? mini.Location : miniLocation;
                if (place.HasValue) lines.Add($"mini={place.Value.X},{place.Value.Y}");
                File.WriteAllLines(SettingsPath, lines);
            }
            catch { /* 저장 못 해도 다음엔 기본 크기로 연다 */ }
        }

        // ---------- 자동 테스트(--smoke) ----------

        async Task SmokeAsync()
        {
            var core = web.CoreWebView2;
            string result = "null";
            for (int i = 0; i < 40 && result == "null"; i++)
            {
                await Task.Delay(250);
                // 객체를 돌려주면 ExecuteScriptAsync가 그 객체의 JSON을 그대로 준다.
                result = await core.ExecuteScriptAsync(@"document.querySelector('.primary-nav') ? ({
                    ok: true, title: document.title, nav: document.querySelectorAll('.primary-nav [data-view]').length,
                    saved: document.querySelector('[data-save-state]')?.textContent || '' }) : null");
            }
            var text = result == "null" ? "{\"ok\":false,\"error\":\"화면이 뜨지 않았어요\"}" : result;
            // 작은 타이머 창: 화면이 전용 창 통로를 찾는지, 작은 창이 떠서 높이 맞추기 신호(size)를 보내오는지
            string bridge = "false", miniText = "", miniOk = "false", miniSized = "false";
            if (result != "null")
            {
                bridge = await core.ExecuteScriptAsync("!!(window.chrome && window.chrome.webview)");
                ShowMini();
                for (int i = 0; i < 40 && mini != null && !(mini.Loaded && mini.Sized > 0); i++) await Task.Delay(250);
                if (mini != null)
                {
                    miniOk = mini.Loaded ? "true" : "false";
                    miniSized = mini.Sized > 0 ? "true" : "false";
                    miniText = await mini.ScriptAsync("document.querySelector('#timers') ? document.querySelector('#timers').textContent.trim() : ''");
                    mini.Close();
                }
            }
            text = text.Substring(0, text.LastIndexOf('}')) + ",\"windowTitle\":" + Json(Text) + ",\"bridge\":" + bridge + ",\"mini\":" + miniOk + ",\"miniSized\":" + miniSized + ",\"miniText\":" + (string.IsNullOrEmpty(miniText) ? "\"\"" : miniText) + "}";
            File.WriteAllText(smoke, text, Encoding.UTF8);
            if (result == "null") ExitCode = 1;
            Close();
        }

        const string LoadingHtml = @"<html><body style=""margin:0;height:100vh;display:grid;place-items:center;background:#151516;color:rgba(255,255,255,.46);font:14px 'Segoe UI','Malgun Gothic',sans-serif"">
<div style=""display:grid;justify-items:center;gap:14px""><div style=""width:22px;height:22px;border:2px solid rgba(255,255,255,.12);border-top-color:rgba(255,255,255,.55);border-radius:50%;animation:s .8s linear infinite""></div>지원일지를 여는 중…</div>
<style>@keyframes s{to{transform:rotate(1turn)}}</style></body></html>";
    }

    // 집중 루프의 작은 타이머 창: 늘 맨 위, 작업 표시줄에는 안 나오고, 제목 막대를 끌어 옮긴다.
    // 화면은 앱 서버의 mini.html(맥 앱과 같은 화면)이고, 본 창과 같은 WebView2 환경을 써서 화면 밝기 설정도 같다.
    sealed class MiniForm : Form
    {
        static readonly Color Background = Color.FromArgb(29, 29, 32);
        readonly WebView2 web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Background };
        public bool Loaded;
        public int Sized;

        public MiniForm(CoreWebView2Environment environment, string url, Point? location, Action<string> onMessage, Func<string, bool> isLocal)
        {
            Text = "집중 루프";
            BackColor = Background;
            FormBorderStyle = FormBorderStyle.FixedToolWindow;
            MaximizeBox = false; MinimizeBox = false;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            ClientSize = new Size(Px(320), Px(76));
            var work = Screen.PrimaryScreen.WorkingArea;
            Location = location ?? new Point(work.Right - Width - Px(24), work.Top + Px(24));
            Controls.Add(web);
            Load += async (sender, e) =>
            {
                await web.EnsureCoreWebView2Async(environment);
                var core = web.CoreWebView2;
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.AreDevToolsEnabled = false;
                core.Settings.AreDefaultContextMenusEnabled = false;
                core.Settings.IsZoomControlEnabled = false;
                core.WebMessageReceived += (s, a) => onMessage(a.WebMessageAsJson);
                core.NavigationStarting += (s, a) => { if (!isLocal(a.Uri)) a.Cancel = true; };
                core.NewWindowRequested += (s, a) => a.Handled = true;
                core.NavigationCompleted += async (s, a) =>
                {
                    Loaded = a.IsSuccess;
                    if (!a.IsSuccess && !IsDisposed) { await Task.Delay(1000); if (!IsDisposed) core.Navigate(url); }
                };
                core.Navigate(url);
            };
        }

        // 띄울 때 지금 쓰던 프로그램에서 포커스를 빼앗지 않는다.
        protected override bool ShowWithoutActivation => true;

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            Native.DarkTitleBar(Handle, Background);
        }

        static int Px(int value) => (int)Math.Round(value * Native.SystemDpi() / 96f);

        public void RefreshTimers() => _ = web.CoreWebView2?.ExecuteScriptAsync("window.miniRefresh && miniRefresh()");

        // 타이머 수에 맞춰 높이만 바꾼다(화면 높이는 CSS 픽셀로 온다).
        public void FitHeight(double cssHeight)
        {
            int height = (int)Math.Ceiling(Math.Max(40, Math.Min(260, cssHeight)) * Native.SystemDpi() / 96.0);
            if (ClientSize.Height != height) ClientSize = new Size(ClientSize.Width, height);
            Sized++;
        }

        public async Task<string> ScriptAsync(string script) => web.CoreWebView2 == null ? "\"\"" : await web.CoreWebView2.ExecuteScriptAsync(script);
    }

    // 예전 바로가기(Edge 앱 창 실행기 · 예전 아이콘 파일)를 이 창으로 바꾼다. 아이콘은 이 프로그램 안의 것을 써서
    // 윈도우가 기억해 둔 예전(흰색) 아이콘 대신 새 아이콘이 보이게 한다. windows-app.bat을 다시 실행하지 않아도 된다.
    static class Shortcuts
    {
        [ComImport, Guid("00021401-0000-0000-C000-000000000046")] class ShellLink { }

        [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
        interface IShellLinkW
        {
            void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int size, IntPtr data, int flags);
            void GetIDList(out IntPtr list);
            void SetIDList(IntPtr list);
            void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder name, int size);
            void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string name);
            void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder dir, int size);
            void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string dir);
            void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder args, int size);
            void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string args);
            void GetHotkey(out short key);
            void SetHotkey(short key);
            void GetShowCmd(out int command);
            void SetShowCmd(int command);
            void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int size, out int index);
            void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
            void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, int reserved);
            void Resolve(IntPtr hwnd, int flags);
            void SetPath([MarshalAs(UnmanagedType.LPWStr)] string file);
        }

        [DllImport("shell32.dll")] static extern void SHChangeNotify(int eventId, int flags, IntPtr item1, IntPtr item2);

        public static void Refresh()
        {
            try
            {
                string exe = Application.ExecutablePath;
                string root = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(exe), "..", ".."));
                string launcher = Path.Combine(root, "assets", "launch-windows.vbs");
                bool changed = false;
                foreach (var folder in new[] { Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), Environment.GetFolderPath(Environment.SpecialFolder.Programs) })
                {
                    string path = Path.Combine(folder, "지원일지.lnk");
                    if (!File.Exists(path)) continue;
                    var link = (IShellLinkW)new ShellLink();
                    ((IPersistFile)link).Load(path, 0);
                    var target = new StringBuilder(1024); link.GetPath(target, target.Capacity, IntPtr.Zero, 0);
                    var args = new StringBuilder(1024); link.GetArguments(args, args.Capacity);
                    var icon = new StringBuilder(1024); link.GetIconLocation(icon, icon.Capacity, out _);
                    // 이 앱 폴더의 바로가기만 고친다(다른 곳에 받아 둔 지원일지 바로가기는 건드리지 않는다).
                    bool ours = string.Equals(target.ToString(), exe, StringComparison.OrdinalIgnoreCase) || args.ToString().IndexOf(launcher, StringComparison.OrdinalIgnoreCase) >= 0;
                    if (!ours || (string.Equals(target.ToString(), exe, StringComparison.OrdinalIgnoreCase) && string.Equals(icon.ToString(), exe, StringComparison.OrdinalIgnoreCase))) continue;
                    link.SetPath(exe);
                    link.SetArguments("");
                    link.SetWorkingDirectory(root);
                    link.SetIconLocation(exe, 0);
                    ((IPersistFile)link).Save(path, true);
                    changed = true;
                }
                if (changed) SHChangeNotify(0x08000000, 0, IntPtr.Zero, IntPtr.Zero); // 아이콘을 다시 그리게 알린다
            }
            catch { /* 바로가기를 못 고쳐도 앱은 그대로 연다 */ }
        }
    }

    static class Native
    {
        [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
        [DllImport("user32.dll")] static extern uint GetDpiForSystem();
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int command);
        [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);

        public static void DarkTitleBar(IntPtr hwnd, Color color)
        {
            try
            {
                int on = 1;
                if (DwmSetWindowAttribute(hwnd, 20, ref on, 4) != 0) DwmSetWindowAttribute(hwnd, 19, ref on, 4); // 다크 모드(옛 윈도우 10은 19번)
                int caption = color.R | color.G << 8 | color.B << 16;
                DwmSetWindowAttribute(hwnd, 35, ref caption, 4); // 윈도우 11: 제목 막대 색을 앱 바탕과 같게
            }
            catch { /* 지원하지 않는 윈도우면 기본 제목 막대 */ }
        }

        public static uint SystemDpi()
        {
            try { return GetDpiForSystem(); } catch { return 96; }
        }

        public static void FocusOtherInstance()
        {
            var current = Process.GetCurrentProcess();
            foreach (var other in Process.GetProcessesByName(current.ProcessName).Where(process => process.Id != current.Id))
            {
                var handle = other.MainWindowHandle;
                if (handle == IntPtr.Zero) continue;
                if (IsIconic(handle)) ShowWindow(handle, 9); // 최소화돼 있으면 되살린다
                SetForegroundWindow(handle);
                return;
            }
        }
    }
}
