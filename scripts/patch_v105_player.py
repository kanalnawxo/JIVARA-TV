from pathlib import Path
import re

root = Path("decoded")
html = root / "assets/index.html"
s = html.read_text(encoding="utf-8")

start = s.index("    function updateEpisodePlayerControls() {")
end = s.index("    if (episodeSeek) {", start)
new_controls = """    function updateEpisodePlayerControls() {
        if (!episodeSeek)
            return;
        const nativePlayback = episodeMode === 'native';
        const duration = nativePlayback ? NaN : Number(video.duration);
        const current = nativePlayback ? NaN : Number(video.currentTime);
        const seekable = Number.isFinite(duration) && duration > 0;
        episodeSeek.disabled = !seekable;
        episodeSeek.max = seekable ? String(Math.floor(duration)) : '100';
        if (!episodeSeek.matches(':active'))
            episodeSeek.value = seekable ? String(Math.min(duration, Math.max(0, current || 0))) : '0';
        episodeCurrentTime.textContent = Number.isFinite(current) ? formatEpisodeTime(current) : '--:--';
        episodeDuration.textContent = seekable ? formatEpisodeTime(duration) : '--:--';
        if (episodePlayPause)
            episodePlayPause.textContent = video.paused ? '▶ بەردەوامکردن' : 'Ⅱ وەستاندن';
    }
    function seekEpisodeBy(delta) {
        if (episodeMode === 'native') {
            try {
                if (window.AndroidPlayer && typeof AndroidPlayer.seekBy === 'function')
                    AndroidPlayer.seekBy(Math.round(delta * 1000));
            }
            catch (_) { }
            updateEpisodePlayerControls();
            return;
        }
        try {
            if (Number.isFinite(video.duration) && video.duration > 0)
                video.currentTime = Math.max(0, Math.min(video.duration, (video.currentTime || 0) + delta));
        }
        catch (_) { }
        updateEpisodePlayerControls();
    }
"""
s = s[:start] + new_controls + s[end:]

# The native PlayerView already forwards its tap into playerScreen.
# Remove the debounce that ignored a legitimate first tap after fullscreen entry.
s, n = re.subn(
    r"        if \(Date\.now\(\) - lastFullscreenEnterAt < 700\)\n            return;\n",
    "", s
)
if n != 1:
    raise SystemExit(f"Fullscreen tap delay guard not found uniquely: {n}")
for literal in (
    "    let lastFullscreenEnterAt = 0;",
    "        if (!expanded)\n            lastFullscreenEnterAt = Date.now();"
):
    if s.count(literal) != 1:
        raise SystemExit("Fullscreen timestamp state not found uniquely")
    s = s.replace(literal, "")
html.write_text(s, encoding="utf-8")

base = root / "smali_classes3/com/jivara/tv"
bridge = base / "MainActivity$NativeBridge.smali"
b = bridge.read_text()
marker = ".method public pause()V"
if b.count(marker) != 1:
    raise SystemExit("NativeBridge pause method insertion point not unique")
method = """.method public seekBy(J)V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    iget-object v0, p0, Lcom/jivara/tv/MainActivity$NativeBridge;->this$0:Lcom/jivara/tv/MainActivity;
    new-instance v1, Lcom/jivara/tv/MainActivity$NativeBridge$8;
    invoke-direct {v1, p0, p1, p2}, Lcom/jivara/tv/MainActivity$NativeBridge$8;-><init>(Lcom/jivara/tv/MainActivity$NativeBridge;J)V
    invoke-virtual {v0, v1}, Lcom/jivara/tv/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V
    return-void
.end method

"""
bridge.write_text(b.replace(marker, method + marker), encoding="utf-8")

runnable = r""".class Lcom/jivara/tv/MainActivity$NativeBridge$8;
.super Ljava/lang/Object;
.source "MainActivity.java"

# interfaces
.implements Ljava/lang/Runnable;

.annotation system Ldalvik/annotation/EnclosingMethod;
    value = Lcom/jivara/tv/MainActivity$NativeBridge;->seekBy(J)V
.end annotation
.annotation system Ldalvik/annotation/InnerClass;
    accessFlags = 0x0
    name = null
.end annotation

.field final synthetic this$1:Lcom/jivara/tv/MainActivity$NativeBridge;
.field final synthetic val$delta:J

.method constructor <init>(Lcom/jivara/tv/MainActivity$NativeBridge;J)V
    .locals 0
    iput-object p1, p0, Lcom/jivara/tv/MainActivity$NativeBridge$8;->this$1:Lcom/jivara/tv/MainActivity$NativeBridge;
    iput-wide p2, p0, Lcom/jivara/tv/MainActivity$NativeBridge$8;->val$delta:J
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V
    return-void
.end method

.method public run()V
    .locals 5
    iget-object v0, p0, Lcom/jivara/tv/MainActivity$NativeBridge$8;->this$1:Lcom/jivara/tv/MainActivity$NativeBridge;
    iget-object v0, v0, Lcom/jivara/tv/MainActivity$NativeBridge;->this$0:Lcom/jivara/tv/MainActivity;
    invoke-static {v0}, Lcom/jivara/tv/MainActivity;->-$$Nest$fgetexoPlayer(Lcom/jivara/tv/MainActivity;)Landroidx/media3/exoplayer/ExoPlayer;
    move-result-object v1
    if-eqz v1, :done
    invoke-interface {v1}, Landroidx/media3/common/Player;->getCurrentPosition()J
    move-result-wide v2
    iget-wide v4, p0, Lcom/jivara/tv/MainActivity$NativeBridge$8;->val$delta:J
    add-long/2addr v2, v4
    const-wide/16 v4, 0x0
    cmp-long v0, v2, v4
    if-gez v0, :seek
    move-wide v2, v4
:seek
    invoke-interface {v1, v2, v3}, Landroidx/media3/common/Player;->seekTo(J)V
:done
    return-void
.end method
"""
target = base / "MainActivity$NativeBridge$8.smali"
if target.exists():
    raise SystemExit("NativeBridge$8 already exists; refusing to overwrite")
target.write_text(runnable, encoding="utf-8")
print("Patched fullscreen single-tap exit and native ExoPlayer movie seek.")
