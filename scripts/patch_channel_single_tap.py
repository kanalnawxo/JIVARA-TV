from pathlib import Path

root = Path("decoded")
html = root / "assets/index.html"
s = html.read_text(encoding="utf-8")

anchor = "    function exitFullscreenFromTap(e) {"
if s.count(anchor) != 1:
    raise SystemExit(f"Channel fullscreen handler anchor must occur once; got {s.count(anchor)}")

handler = """    // Native PlayerView receives the click before the WebView.
    // Keep this action limited to live channels; movie/drama playback is untouched.
    window.handleNativePlayerTap = function() {
        if (episodeMode)
            return;
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
s = s.replace(anchor, handler + anchor)
html.write_text(s, encoding="utf-8")

base = root / "smali_classes3/com/jivara/tv"
main = base / "MainActivity.smali"
m = main.read_text(encoding="utf-8")
old = "    invoke-virtual {p1, v1}, Landroidx/media3/ui/PlayerView;->setClickable(Z)V"
if m.count(old) != 1:
    raise SystemExit(f"PlayerView clickability anchor must occur once; got {m.count(old)}")
if "MainActivity$5;-><init>" not in m:
    raise SystemExit("Expected existing MainActivity$5 click-listener construction was not found; refusing to guess wiring")
m = m.replace(old, "    const/4 v1, 0x1\n" + old)
main.write_text(m, encoding="utf-8")

listener = base / "MainActivity$5.smali"
listener.write_text(r""".class Lcom/jivara/tv/MainActivity$5;
.super Ljava/lang/Object;
.source "MainActivity.java"

# interfaces
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

print("Applied channel-only fullscreen single-tap patch. Movie/drama code paths were not modified.")
