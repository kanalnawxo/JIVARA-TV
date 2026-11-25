from pathlib import Path

root = Path("decoded")
html = root / "assets/index.html"
s = html.read_text(encoding="utf-8")

# Show the same HTML control bar immediately for both movies and drama.
anchor = "        episodeMode = 'html';\n        video = episodeVideo;"
if s.count(anchor) != 1:
    raise SystemExit(f"HTML episode startup anchor not unique: {s.count(anchor)}")
s = s.replace(anchor, anchor + "\n        setEpisodeControls(true);")

# The preceding overlay patch already enables the Media3 controller here.
anchor = """        episodeMode = 'native';
        try { if (window.AndroidPlayer && AndroidPlayer.setMovieControls) AndroidPlayer.setMovieControls(true); } catch (_) {}
        video = videoA;"""
if s.count(anchor) != 1:
    raise SystemExit(f"Native episode fallback anchor not unique: {s.count(anchor)}")
s = s.replace(anchor, anchor.replace("        video = videoA;", "        setEpisodeControls(true);\n        video = videoA;"))

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
