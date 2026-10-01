// 지원일지 윈도우 앱: 앱 폴더의 서버(server.mjs)를 켜고, Edge 앱 창 대신 전용 창(WebView2)으로 보여 준다.
// 맥의 지원일지.app(mac/main.swift)과 같은 역할이다. 창을 닫으면 작성 중인 내용을 저장한 뒤 서버도 끈다.
// 빌드는 GitHub Actions(.github/workflows/windows-app.yml)가 하고, 만든 파일은 windows/app/에 올린다.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
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
            using (var mutex = new Mutex(true, "local.jiwon-ilji.window", out bool first))
            {
                // 이미 열려 있으면 새 창 대신 그 창을 앞으로 가져온다.
                if (!first && smoke == null) { Native.FocusOtherInstance(); return 0; }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
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
                var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(DataDir, "webview2"));
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
                File.WriteAllLines(SettingsPath, new[] {
                    $"bounds={bounds.X},{bounds.Y},{bounds.Width},{bounds.Height}",
                    "max=" + (WindowState == FormWindowState.Maximized ? "1" : "0"),
                    "zoom=" + zoom.ToString(System.Globalization.CultureInfo.InvariantCulture),
                });
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
            text = text.Substring(0, text.LastIndexOf('}')) + ",\"windowTitle\":" + Json(Text) + "}";
            File.WriteAllText(smoke, text, Encoding.UTF8);
            if (result == "null") ExitCode = 1;
            Close();
        }

        const string LoadingHtml = @"<html><body style=""margin:0;height:100vh;display:grid;place-items:center;background:#151516;color:rgba(255,255,255,.46);font:14px 'Segoe UI','Malgun Gothic',sans-serif"">
<div style=""display:grid;justify-items:center;gap:14px""><div style=""width:22px;height:22px;border:2px solid rgba(255,255,255,.12);border-top-color:rgba(255,255,255,.55);border-radius:50%;animation:s .8s linear infinite""></div>지원일지를 여는 중…</div>
<style>@keyframes s{to{transform:rotate(1turn)}}</style></body></html>";
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
