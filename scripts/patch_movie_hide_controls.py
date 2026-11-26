from pathlib import Path

root = Path("decoded")
html = root / "assets/index.html"
s = html.read_text(encoding="utf-8")

anchor = "    function playChannel(id) {"
if s.count(anchor) != 1:
    raise SystemExit(f"playChannel anchor must occur once; got {s.count(anchor)}")

call = """    function playChannel(id) {
        // Disable native ExoPlayer playback controls for live channels and films.
        // Drama playback uses a separate flow and is not changed by this patch.
        try {
            if (window.AndroidPlayer && typeof AndroidPlayer.setMovieControls === 'function')
                AndroidPlayer.setMovieControls(false);
        } catch (_) {}
"""
s = s.replace(anchor, call)

bridge = root / "smali_classes3/com/jivara/tv/MainActivity$NativeBridge.smali"
b = bridge.read_text(encoding="utf-8")
if "setMovieControls(Z)V" not in b:
    marker = ".method public pause()V"
    if b.count(marker) != 1:
        raise SystemExit("NativeBridge insertion point not unique")
    method = """.method public setMovieControls(Z)V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    iget-object v0, p0, Lcom/jivara/tv/MainActivity$NativeBridge;->this$0:Lcom/jivara/tv/MainActivity;
    new-instance v1, Lcom/jivara/tv/MainActivity$NativeBridge$MovieControls;
    invoke-direct {v1, p0, p1}, Lcom/jivara/tv/MainActivity$NativeBridge$MovieControls;-><init>(Lcom/jivara/tv/MainActivity$NativeBridge;Z)V
    invoke-virtual {v0, v1}, Lcom/jivara/tv/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V
    return-void
.end method

"""
    bridge.write_text(b.replace(marker, method + marker), encoding="utf-8")

runnable = root / "smali_classes3/com/jivara/tv/MainActivity$NativeBridge$MovieControls.smali"
if not runnable.exists():
    runnable.write_text(r""".class Lcom/jivara/tv/MainActivity$NativeBridge$MovieControls;
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
    iput-object p1, p0, Lcom/jivara/tv/MainActivity$NativeBridge$MovieControls;->this$1:Lcom/jivara/tv/MainActivity$NativeBridge;
    iput-boolean p2, p0, Lcom/jivara/tv/MainActivity$NativeBridge$MovieControls;->val$enabled:Z
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V
    return-void
.end method
.method public run()V
    .locals 2
    iget-object v0, p0, Lcom/jivara/tv/MainActivity$NativeBridge$MovieControls;->this$1:Lcom/jivara/tv/MainActivity$NativeBridge;
    iget-object v0, v0, Lcom/jivara/tv/MainActivity$NativeBridge;->this$0:Lcom/jivara/tv/MainActivity;
    invoke-static {v0}, Lcom/jivara/tv/MainActivity;->-$$Nest$fgetplayerView(Lcom/jivara/tv/MainActivity;)Landroidx/media3/ui/PlayerView;
    move-result-object v0
    if-eqz v0, :done
    iget-boolean v1, p0, Lcom/jivara/tv/MainActivity$NativeBridge$MovieControls;->val$enabled:Z
    invoke-virtual {v0, v1}, Landroidx/media3/ui/PlayerView;->setUseController(Z)V
    if-eqz v1, :hide
    invoke-virtual {v0}, Landroidx/media3/ui/PlayerView;->showController()V
    goto :done
:hide
    invoke-virtual {v0}, Landroidx/media3/ui/PlayerView;->hideController()V
:done
    return-void
.end method
""", encoding="utf-8")

html.write_text(s, encoding="utf-8")
print("Disabled native ExoPlayer playback controls for live channels and films.")
