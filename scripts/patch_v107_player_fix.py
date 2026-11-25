from pathlib import Path
import re

root = Path("decoded")
html = root / "assets/index.html"
s = html.read_text(encoding="utf-8")

# Movie and drama share startEpisode(). There are two HTML-mode assignments:
# one for the VLC fallback path and one for the normal HTML-video path.
# Enable controls on the normal path (the last occurrence).
matches = list(re.finditer(r"episodeMode = 'html';\s*\n\s*video = episodeVideo;", s))
if len(matches) < 1:
    raise SystemExit("HTML episode startup anchor not found")
m = matches[-1]
s = s[:m.end()] + "\n        setEpisodeControls(true);" + s[m.end():]

# The overlay patch enables Media3 controls during native fallback. Also keep
# the episode controls state active when that fallback is selected.
native = re.search(r"(episodeMode = 'native';[\s\S]*?)(\n\s*video = videoA;)", s)
if not native:
    raise SystemExit("Native episode fallback anchor not found")
if "setEpisodeControls(true)" not in native.group(1):
    s = s[:native.start(2)] + "\n        setEpisodeControls(true);" + s[native.start(2):]

html.write_text(s, encoding="utf-8")

# Root cause of channel tap failure: PlayerView had a click listener but was
# explicitly non-clickable, so Android never delivered taps to MainActivity$5.
main = root / "smali_classes3/com/jivara/tv/MainActivity.smali"
m = main.read_text(encoding="utf-8")
old = "    invoke-virtual {p1, v1}, Landroidx/media3/ui/PlayerView;->setClickable(Z)V"
new = "    const/4 v1, 0x1\n" + old
if m.count(old) != 1:
    raise SystemExit(f"PlayerView setClickable anchor not unique: {m.count(old)}")
main.write_text(m.replace(old, new), encoding="utf-8")

print("Fixed PlayerView tap delivery and made movie/drama controls visible at playback start and native fallback.")
