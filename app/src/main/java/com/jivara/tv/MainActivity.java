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
import android.widget.ImageView;
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
        // The native video surface must never become a focus target on TV remotes.
        playerView.setDescendantFocusability(ViewGroup.FOCUS_BLOCK_DESCENDANTS);
        playerView.setClickable(true);
        playerView.setVisibility(View.GONE);
        playerView.setOnClickListener(v -> webView.evaluateJavascript(
                "document.getElementById('playerScreen')?.dispatchEvent(new MouseEvent('click',{bubbles:true}))",
                null));
        root.addView(playerView, new FrameLayout.LayoutParams(1, 1));

        // Show the repository's JK_TV_APK logo as a centered startup splash.
        ImageView splashLogo = new ImageView(this);
        splashLogo.setImageResource(R.drawable.jk_tv_apk);
        splashLogo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        splashLogo.setBackgroundColor(Color.BLACK);
        splashLogo.setPadding(
                (int) (24 * density), (int) (24 * density),
                (int) (24 * density), (int) (24 * density));
        root.addView(splashLogo, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        splashLogo.bringToFront();
        splashLogo.postDelayed(() -> {
            if (splashLogo.getParent() == root) {
                root.removeView(splashLogo);
            }
            if (webView != null) webView.requestFocus();
        }, 3000);

        exoPlayer.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_READY) {
                    // Update playback UI only. Never move native or DOM focus
                    // when the stream starts; DPAD input controls focus.
                    webView.evaluateJavascript(
                            "document.getElementById('idle').style.display='none';"
                            + "document.getElementById('video').dispatchEvent(new Event('playing'));", null);
                }
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                final String detail = String.valueOf(error.getMessage());
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
            // Preserve the existing WebView/DOM focus on the selected channel.
            // Clearing WebView focus here makes Android TV move to the first
            // focusable sidebar button when native playback starts.
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
        if (playerView != null) {
            playerView.setVisibility(View.GONE);
            playerView.clearFocus();
        }
        // Do not request directional focus on the WebView here.
        // stopStream() is also called immediately before every new channel starts;
        // FOCUS_DOWN moves Android TV focus to another control (often the sidebar).
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
        // Handle Android TV's physical OK/Select key at the native Activity level.
        // Several TV WebView builds move DOM focus for DPAD but swallow the
        // corresponding Enter key before JavaScript can activate the focused item.
        final int code = event.getKeyCode();
        final boolean isSelect = code == KeyEvent.KEYCODE_DPAD_CENTER
                || code == KeyEvent.KEYCODE_ENTER
                || code == KeyEvent.KEYCODE_NUMPAD_ENTER
                || code == KeyEvent.KEYCODE_BUTTON_A;
        if (webView != null && isSelect) {
            if (event.getAction() == KeyEvent.ACTION_UP) {
                webView.evaluateJavascript(
                        "if(window.__jivaraNativeActivateFocused){window.__jivaraNativeActivateFocused();}",
                        null);
            }
            // Consume both phases so WebView cannot double-activate the same item.
            return true;
        }
        // Route TV directional keys directly into the WebView document.
        // Some Android TV WebView builds keep native focus on the WebView itself,
        // so DOM focus never receives DPAD unless we forward the key explicitly.
        final String remoteKey;
        switch (code) {
            case KeyEvent.KEYCODE_DPAD_UP: remoteKey = "ArrowUp"; break;
            case KeyEvent.KEYCODE_DPAD_DOWN: remoteKey = "ArrowDown"; break;
            case KeyEvent.KEYCODE_DPAD_LEFT: remoteKey = "ArrowLeft"; break;
            case KeyEvent.KEYCODE_DPAD_RIGHT: remoteKey = "ArrowRight"; break;
            default: remoteKey = null; break;
        }
        if (webView != null && remoteKey != null) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                String js = "document.dispatchEvent(new KeyboardEvent('keydown',{key:"
                        + JSONObject.quote(remoteKey)
                        + ",bubbles:true,cancelable:true}));";
                webView.evaluateJavascript(js, null);
            }
            return true;
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
