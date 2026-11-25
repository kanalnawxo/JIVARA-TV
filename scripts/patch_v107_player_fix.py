from pathlib import Path

root = Path("decoded")
html = root / "assets/index.html"
s = html.read_text(encoding="utf-8")

# Start movie and drama playback with the same visible, working HTML control
# bar. This is called only after episodeMode is initialized.
anchor = "        episodeMode = 'html';\n        video = episodeVideo;"
if s.count(anchor) != 1:
    raise SystemExit(f"HTML episode startup anchor not unique: {s.count(anchor)}")
s = s.replace(anchor, anchor + "\n        setEpisodeControls(true);")

# If HTML playback must fall back to native ExoPlayer, explicitly show its
# native controller and keep the episode controls state active.
anchor = "        episodeMode = 'native';\n        video = videoA;"
if s.count(anchor) != 1:
    raise SystemExit(f"Native episode fallback anchor not unique: {s.count(anchor)}")
s = s.replace(anchor, """        episodeMode = 'native';
        try { if (window.AndroidPlayer && AndroidPlayer.setMovieControls) AndroidPlayer.setMovieControls(true); } catch (_) {}
        setEpisodeControls(true);
        video = videoA;""")

html.write_text(s, encoding="utf-8")

# Root cause of the channel tap failure: MainActivity created a click listener
# but explicitly made PlayerView non-clickable. Therefore Android never
# delivered the tap to MainActivity$5. Make the view clickable.
main = root / "smali_classes3/com/jivara/tv/MainActivity.smali"
m = main.read_text(encoding="utf-8")
old = """    invoke-virtual {p1, v1}, Landroidx/media3/ui/PlayerView;->setClickable(Z)V"""
new = """    const/4 v1, 0x1
    invoke-virtual {p1, v1}, Landroidx/media3/ui/PlayerView;->setClickable(Z)V"""
if m.count(old) != 1:
    raise SystemExit(f"PlayerView setClickable anchor not unique: {m.count(old)}")
main.write_text(m.replace(old, new), encoding="utf-8")

print("Fixed PlayerView tap delivery and made movie/drama controls visible at playback start and native fallback.")
