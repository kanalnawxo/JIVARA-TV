package com.jivara.tv;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import org.json.JSONObject;

import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;

public class MainActivity extends Activity {
    private FrameLayout root;
    private WebView webView;
    private PlayerView playerView;
    private ExoPlayer exoPlayer;
    private float density;
    private boolean muted = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Keep the TV display awake while JIVARA TV is in the foreground.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        density = getResources().getDisplayMetrics().density;

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(2, 11, 22));
        setContentView(root);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.TRANSPARENT);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setAllowFileAccess(true);
        ws.setAllowContentAccess(true);
        ws.setAllowUniversalAccessFromFileURLs(true);
        ws.setLoadsImagesAutomatically(true);
        ws.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        webView.addJavascriptInterface(new NativeBridge(), "AndroidPlayer");
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                installNativePlaybackBridge();
                view.requestFocus();
            }
        });
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        exoPlayer = new ExoPlayer.Builder(this)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(
                        new DefaultHttpDataSource.Factory()
                                .setUserAgent("JIVARA-TV/1.0 Android Media3")
                                .setAllowCrossProtocolRedirects(true)))
                .build();

        playerView = (PlayerView) LayoutInflater.from(this).inflate(R.layout.native_player_view, root, false);
        playerView.setUseController(false);
        playerView.setPlayer(exoPlayer);
        playerView.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
        playerView.setShutterBackgroundColor(Color.BLACK);
        playerView.setFocusable(false);
        playerView.setFocusableInTouchMode(false);
        playerView.setClickable(true);
        playerView.setVisibility(View.GONE);
        playerView.setOnClickListener(v -> webView.evaluateJavascript(
                "document.getElementById('playerScreen')?.dispatchEvent(new MouseEvent('click',{bubbles:true}))",
                null));
        root.addView(playerView, new FrameLayout.LayoutParams(1, 1));

        exoPlayer.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_READY) {
                    webView.evaluateJavascript(
                            "document.getElementById('idle').style.display='none';"
                            + "document.getElementById('video').dispatchEvent(new Event('playing'));", null);
                }
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                final String detail = error.errorCodeName + ": " + String.valueOf(error.getMessage());
                webView.evaluateJavascript(
                        "document.getElementById('idle').style.display='flex';"
                        + "document.getElementById('video').dispatchEvent(new Event('error'));"
                        + "if(window.toast)toast('هەڵەی پلەیەر: ' + " + JSONObject.quote(detail) + ");", null);
            }
        });

        webView.loadUrl("file:///android_asset/index.html");
    }

    private void installNativePlaybackBridge() {
        String js = "(function(){"
                + "const v=document.getElementById('video');"
                + "if(!v||v.dataset.nativeBridgeReady)return;v.dataset.nativeBridgeReady='1';"
                + "let source='';let muted=false;"
                + "Object.defineProperty(v,'src',{configurable:true,get:function(){return source;},set:function(u){source=String(u||'');if(source&&window.AndroidPlayer)AndroidPlayer.play(source);}});"
                + "v.play=function(){if(window.AndroidPlayer)AndroidPlayer.resume();return Promise.resolve();};"
                + "v.pause=function(){if(window.AndroidPlayer)AndroidPlayer.pause();};"
                + "v.load=function(){};"
                + "Object.defineProperty(v,'paused',{configurable:true,get:function(){return !window.AndroidPlayer||!AndroidPlayer.isPlaying();}});"
                + "Object.defineProperty(v,'muted',{configurable:true,get:function(){return muted;},set:function(x){muted=!!x;if(window.AndroidPlayer)AndroidPlayer.setMuted(muted);}});"
                + "['Hls','mpegts','dashjs'].forEach(function(k){try{Object.defineProperty(window,k,{configurable:false,get:function(){return undefined;},set:function(x){}});}catch(e){}});"
                + "const p=document.getElementById('playerScreen');"
                + "const update=function(){if(!p||!window.AndroidPlayer)return;const r=p.getBoundingClientRect();AndroidPlayer.updateBounds(r.left,r.top,r.width,r.height);};"
                + "if(p){new ResizeObserver(update).observe(p);new MutationObserver(update).observe(p,{attributes:true,attributeFilter:['class','style']});}"
                + "window.addEventListener('resize',update);window.addEventListener('scroll',update,true);"
                + "update();setTimeout(update,250);setTimeout(update,1000);"
                + "})();";
        webView.evaluateJavascript(js, null);
    }

    private void playStream(String url) {
        if (url == null || url.trim().isEmpty()) return;
        try {
            String clean = url.trim();
            MediaItem.Builder item = new MediaItem.Builder().setUri(Uri.parse(clean));
            String lower = clean.toLowerCase();
            if (lower.contains(".m3u8")) {
                item.setMimeType(MimeTypes.APPLICATION_M3U8);
            } else if (lower.contains(".mpd")) {
                item.setMimeType(MimeTypes.APPLICATION_MPD);
            } else if (lower.matches(".*\\.(ts|m2ts)(?:[?#].*)?$")
                    || lower.matches(".*/(live|movie|series)/[^/?]+/[^/?]+/\\d+(?:\\?.*)?$")
                    || lower.matches(".*[?&](stream|channel|id)=\\d+(?:&.*)?$")) {
                // Xtream-style numeric stream IDs commonly serve MPEG-TS without a .ts suffix.
                item.setMimeType(MimeTypes.VIDEO_MP2T);
            }
            exoPlayer.setMediaItem(item.build());
            exoPlayer.prepare();
            exoPlayer.setPlayWhenReady(true);
            playerView.setVisibility(View.VISIBLE);
        } catch (Exception e) {
            Toast.makeText(this, "نەتوانرا لینکەکە بخوێندرێتەوە", Toast.LENGTH_SHORT).show();
        }
    }

    private void stopStream() {
        if (exoPlayer != null) {
            exoPlayer.setPlayWhenReady(false);
            exoPlayer.stop();
            exoPlayer.clearMediaItems();
        }
        if (playerView != null) playerView.setVisibility(View.GONE);
    }

    private void updatePlayerBounds(double x, double y, double w, double h) {
        if (playerView == null || root == null) return;
        runOnUiThread(() -> {
            int left = Math.max(0, (int) Math.round(x * density));
            int top = Math.max(0, (int) Math.round(y * density));
            int width = Math.max(1, (int) Math.round(w * density));
            int height = Math.max(1, (int) Math.round(h * density));
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(width, height);
            lp.leftMargin = left;
            lp.topMargin = top;
            playerView.setLayoutParams(lp);
        });
    }

    private void setKeyboardMode(boolean visible) {
        runOnUiThread(() -> {
            if (visible) {
                getWindow().getDecorView().setSystemUiVisibility(0);
                getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
            } else {
                getWindow().getDecorView().setSystemUiVisibility(
                        View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
            }
        });
    }

    private class NativeBridge {
        @JavascriptInterface public void setKeyboardMode(boolean visible) { MainActivity.this.setKeyboardMode(visible); }
        @JavascriptInterface public void play(String url) { runOnUiThread(() -> playStream(url)); }
        @JavascriptInterface public void pause() { runOnUiThread(() -> { if (exoPlayer != null) exoPlayer.pause(); }); }
        @JavascriptInterface public void stop() { runOnUiThread(() -> stopStream()); }
        @JavascriptInterface public void resume() { runOnUiThread(() -> { if (exoPlayer != null) exoPlayer.play(); }); }
        @JavascriptInterface public boolean isPlaying() { return exoPlayer != null && exoPlayer.isPlaying(); }
        @JavascriptInterface public void setMuted(boolean value) {
            muted = value;
            runOnUiThread(() -> { if (exoPlayer != null) exoPlayer.setVolume(value ? 0f : 1f); });
        }
        @JavascriptInterface public void updateBounds(double x, double y, double w, double h) {
            updatePlayerBounds(x, y, w, h);
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        // Forward BOTH key-down and key-up events to the WebView.
        // The HTML remote handler uses keyup to complete OK/select actions;
        // dropping ACTION_UP leaves the remote focus and channel selection unstable.
        if (webView != null && (event.getAction() == KeyEvent.ACTION_DOWN
                || event.getAction() == KeyEvent.ACTION_UP)) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && !webView.hasFocus()) {
                webView.requestFocus();
            }
            if (webView.dispatchKeyEvent(event)) {
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    public void onBackPressed() {
        if (webView != null) {
            webView.evaluateJavascript(
                    "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));", null);
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        // Never leave live TV audio running when the app is backgrounded.
        stopStream();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.destroy();
            webView = null;
        }
        if (exoPlayer != null) {
            exoPlayer.release();
            exoPlayer = null;
        }
        super.onDestroy();
    }
}
