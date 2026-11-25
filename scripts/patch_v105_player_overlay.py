from pathlib import Path

root = Path("decoded")
html = root / "assets/index.html"
s = html.read_text(encoding="utf-8")

# Native PlayerView sits above WebView. Use its own controller overlay for
# native movie playback; do not render the HTML controls underneath it.
css = ".player-screen.ep-native .episode-player-controls{position:fixed;left:0;right:0;bottom:0;background:#06121f;padding-top:12px}"
if s.count(css) != 1:
    raise SystemExit("Native controls CSS anchor not unique")
s = s.replace(css, css + ".player-screen.ep-native .episode-player-controls{display:none!important}")

# Native controller remains disabled during normal channel playback and while
# the HTML video path is used. It is enabled only for native movie/drama fallback.
start = "    function startEpisode(channel) {"
if s.count(start) != 1:
    raise SystemExit("startEpisode anchor not unique")
s = s.replace(start, start + """
        try { if (window.AndroidPlayer && AndroidPlayer.setMovieControls) AndroidPlayer.setMovieControls(false); } catch (_) {}
""")
fallback = "        episodeMode = 'native';\n        video = videoA;"
if s.count(fallback) != 1:
    raise SystemExit("native episode fallback anchor not unique")
s = s.replace(fallback, """        episodeMode = 'native';
        try { if (window.AndroidPlayer && AndroidPlayer.setMovieControls) AndroidPlayer.setMovieControls(true); } catch (_) {}
        video = videoA;""")
exit_ep = "    function exitEpisodePlayback() {"
if s.count(exit_ep) != 1:
    raise SystemExit("exitEpisodePlayback anchor not unique")
s = s.replace(exit_ep, exit_ep + """
        try { if (window.AndroidPlayer && AndroidPlayer.setMovieControls) AndroidPlayer.setMovieControls(false); } catch (_) {}
""")
play = "    function playChannel(id) {"
if s.count(play) != 1:
    raise SystemExit("playChannel anchor not unique")
s = s.replace(play, play + """
        try { if (window.AndroidPlayer && AndroidPlayer.setMovieControls) AndroidPlayer.setMovieControls(false); } catch (_) {}
""")

# The native PlayerView consumes taps before WebView can see them. Route its
# click directly to an idempotent JS action instead of synthesizing a DOM click.
tap_anchor = "    function exitFullscreenFromTap(e) {"
if s.count(tap_anchor) != 1:
    raise SystemExit("fullscreen handler anchor not unique")
handler = """    window.handleNativePlayerTap = function() {
        if (episodeMode === 'native') {
            try { if (window.AndroidPlayer && AndroidPlayer.setMovieControls) AndroidPlayer.setMovieControls(true); } catch (_) {}
            return;
        }
        if (episodeMode) {
            setEpisodeControls(true);
            return;
        }
        if (!isPlayerFullscreen()) {
            fullscreen();
            return;
        }
        if (fullscreenBusy)
            return;
        fullscreenBusy = true;
        playerScreen.classList.remove('is-fullscreen');
        document.body.classList.remove('jivara-player-fullscreen');
        requestAnimationFrame(() => {
            fullscreenBusy = false;
            if (currentChannel)
                focusSelectedChannel(currentChannel.id);
        });
        setTimeout(() => { fullscreenBusy = false; }, 180);
    };
"""
s = s.replace(tap_anchor, handler + tap_anchor)
html.write_text(s, encoding="utf-8")

base = root / "smali_classes3/com/jivara/tv"
main5 = base / "MainActivity$5.smali"
main5.write_text(r""".class Lcom/jivara/tv/MainActivity$5;
.super Ljava/lang/Object;
.source "MainActivity.java"
.implements Landroid/view/View$OnClickListener;
.annotation system Ldalvik/annotation/EnclosingMethod;
    value = Lcom/jivara/tv/MainActivity;->onCreate(Landroid/os/Bundle;)V
.end annotation
.annotation system Ldalvik/annotation/InnerClass;
    accessFlags = 0x0
    name = null
.end annotation
.field final synthetic this$0:Lcom/jivara/tv/MainActivity;
.method constructor <init>(Lcom/jivara/tv/MainActivity;)V
    .locals 0
    iput-object p1, p0, Lcom/jivara/tv/MainActivity$5;->this$0:Lcom/jivara/tv/MainActivity;
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V
    return-void
.end method
.method public onClick(Landroid/view/View;)V
    .locals 2
    iget-object p1, p0, Lcom/jivara/tv/MainActivity$5;->this$0:Lcom/jivara/tv/MainActivity;
    invoke-static {p1}, Lcom/jivara/tv/MainActivity;->-$$Nest$fgetwebView(Lcom/jivara/tv/MainActivity;)Landroid/webkit/WebView;
    move-result-object p1
    if-eqz p1, :done
    iget-object p1, p0, Lcom/jivara/tv/MainActivity$5;->this$0:Lcom/jivara/tv/MainActivity;
    invoke-static {p1}, Lcom/jivara/tv/MainActivity;->-$$Nest$fgetwebView(Lcom/jivara/tv/MainActivity;)Landroid/webkit/WebView;
    move-result-object p1
    const-string v0, "if(window.handleNativePlayerTap){window.handleNativePlayerTap();}"
    const/4 v1, 0x0
    invoke-virtual {p1, v0, v1}, Landroid/webkit/WebView;->evaluateJavascript(Ljava/lang/String;Landroid/webkit/ValueCallback;)V
:done
    return-void
.end method
""", encoding="utf-8")

bridge = base / "MainActivity$NativeBridge.smali"
b = bridge.read_text(encoding="utf-8")
marker = ".method public pause()V"
if b.count(marker) != 1 or "setMovieControls(Z)V" in b:
    raise SystemExit("NativeBridge insertion point invalid or method already exists")
method = """.method public setMovieControls(Z)V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    iget-object v0, p0, Lcom/jivara/tv/MainActivity$NativeBridge;->this$0:Lcom/jivara/tv/MainActivity;
    new-instance v1, Lcom/jivara/tv/MainActivity$NativeBridge$9;
    invoke-direct {v1, p0, p1}, Lcom/jivara/tv/MainActivity$NativeBridge$9;-><init>(Lcom/jivara/tv/MainActivity$NativeBridge;Z)V
    invoke-virtual {v0, v1}, Lcom/jivara/tv/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V
    return-void
.end method

"""
bridge.write_text(b.replace(marker, method + marker), encoding="utf-8")

runnable = r""".class Lcom/jivara/tv/MainActivity$NativeBridge$9;
.super Ljava/lang/Object;
.source "MainActivity.java"
.implements Ljava/lang/Runnable;
.annotation system Ldalvik/annotation/EnclosingMethod;
    value = Lcom/jivara/tv/MainActivity$NativeBridge;->setMovieControls(Z)V
.end annotation
.annotation system Ldalvik/annotation/InnerClass;
    accessFlags = 0x0
    name = null
.end annotation
.field final synthetic this$1:Lcom/jivara/tv/MainActivity$NativeBridge;
.field final synthetic val$enabled:Z
.method constructor <init>(Lcom/jivara/tv/MainActivity$NativeBridge;Z)V
    .locals 0
    iput-object p1, p0, Lcom/jivara/tv/MainActivity$NativeBridge$9;->this$1:Lcom/jivara/tv/MainActivity$NativeBridge;
    iput-boolean p2, p0, Lcom/jivara/tv/MainActivity$NativeBridge$9;->val$enabled:Z
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V
    return-void
.end method
.method public run()V
    .locals 2
    iget-object v0, p0, Lcom/jivara/tv/MainActivity$NativeBridge$9;->this$1:Lcom/jivara/tv/MainActivity$NativeBridge;
    iget-object v0, v0, Lcom/jivara/tv/MainActivity$NativeBridge;->this$0:Lcom/jivara/tv/MainActivity;
    invoke-static {v0}, Lcom/jivara/tv/MainActivity;->-$$Nest$fgetplayerView(Lcom/jivara/tv/MainActivity;)Landroidx/media3/ui/PlayerView;
    move-result-object v0
    if-eqz v0, :done
    iget-boolean v1, p0, Lcom/jivara/tv/MainActivity$NativeBridge$9;->val$enabled:Z
    invoke-virtual {v0, v1}, Landroidx/media3/ui/PlayerView;->setUseController(Z)V
    if-eqz v1, :hide
    invoke-virtual {v0}, Landroidx/media3/ui/PlayerView;->showController()V
    goto :done
:hide
    invoke-virtual {v0}, Landroidx/media3/ui/PlayerView;->hideController()V
:done
    return-void
.end method
"""
target = base / "MainActivity$NativeBridge$9.smali"
if target.exists():
    raise SystemExit("NativeBridge$9 already exists")
target.write_text(runnable, encoding="utf-8")
print("Added native tap routing and Media3 overlay controls.")
