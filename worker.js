const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store"
};

const APK_URL = "https://github.com/kanalnawxo/JIVARA-TV/releases/download/v1.0.2/JIVARA_TV_native_splash.apk";
const DB_KEY = "channels";
const STATS_KEY = "presence_stats";
const CONFIG_KEY = "app_config";
const AD_KEY = "ad_meta";
const BUNDLE_KEY = "app_bundle";
const BUNDLE_META_KEY = "app_bundle_meta";
const BUNDLE_MAX = 2 * 1024 * 1024;
const AD_CHUNK = 5 * 1024 * 1024;           // هەر بەشێکی ڤیدیۆ ٥MB (سنوری KV ٢٥MB ـە)
const AD_MAX_SIZE = 100 * 1024 * 1024;      // سنووری پارێزەر بۆ قەبارە
const AD_MAX_SECONDS = 90;                  // زۆرترین درێژی ڤیدیۆی ڕیکلام: ١:٣٠ خولەک
const adKey = (v, i) => "ad_chunk:" + v + ":" + i;

/*
 * ١٦ گرووپە جێگیرەکەی ئەپ. IDـەکان هەمان IDی ناو APKن.
 * داشبۆرد تەنها ئەمانە دەناسێت؛ گرووپی نوێ دروست ناکرێت.
 */
const FIXED_GROUPS = [
  { id: "local", name: "ناوخۆ", aliases: ["local", "ناوخو", "local-ناوخۆ"] },
  { id: "kurdish", name: "کوردی", aliases: ["kurdish", "kurdistan", "kurd", "کورد", "كوردي"] },
  { id: "arabic", name: "عەرەبی", aliases: ["arabic", "arab", "عربي", "عربى", "عەرەب"] },
  { id: "foreign", name: "بیانی", aliases: ["foreign", "international", "اجنبي", "أجنبي"] },
  { id: "news", name: "هەواڵ", aliases: ["news", "هەوال", "اخبار", "أخبار"] },
  { id: "quran", name: "قورئان", aliases: ["quran", "قوڕئان", "قرآن", "القرآن", "قران"] },
  { id: "kids", name: "منداڵان", aliases: ["kids", "kid", "children", "cartoon", "مندالان", "اطفال", "أطفال"] },
  { id: "sports", name: "وەرزش", aliases: ["sports", "sport", "ورزش", "رياضة", "رياضه", "الرياضة"] },
  { id: "music", name: "موزیک", aliases: ["music", "موسيقى", "موسیقی", "اغاني", "أغاني"] },
  { id: "documentary", name: "دۆکۆمێنتاری", aliases: ["documentary", "documentaries", "docs", "دۆکومێنتاری", "وثائقي", "وثائقية"] },
  { id: "iraq", name: "عێراق", aliases: ["iraq", "iq", "عراق", "العراق", "عیراق", "🇮🇶"] },
  { id: "iran", name: "ئێران", aliases: ["iran", "ir", "ایران", "إيران", "ايران", "ئیران", "🇮🇷"] },
  { id: "turkey", name: "تورکیا", aliases: ["turkey", "türkiye", "turkiye", "tr", "توركيا", "تركيا", "تورکیە", "🇹🇷"] },
  { id: "israel", name: "ئیسرائیل", aliases: ["israel", "il", "اسرائیل", "إسرائيل", "اسرائيل", "ئیسرائیل", "🇮🇱"] },
  { id: "usa", name: "ئەمریکا", aliases: ["usa", "us", "u.s.a", "u.s.", "united states", "united states of america", "america", "american", "امريكا", "أمريكا", "امریکا", "ئەمریکا", "ئەمەریکا", "🇺🇸"] },
  { id: "uk", name: "بەریتانیا", aliases: ["uk", "u.k.", "united kingdom", "britain", "great britain", "british", "england", "بريطانيا", "بریتانیا", "بەریتانیا", "بەریتانیە", "انجلترا", "🇬🇧"] }
];

function matchFixedGroup(label) {
  const key = looseName(label);
  if (!key) return null;
  return FIXED_GROUPS.find(g =>
    g.id === key ||
    looseName(g.name) === key ||
    g.aliases.some(a => looseName(a) === key)
  ) || null;
}
/*
 * ===== بەکارهێنانی کەم و دابەشکراو =====
 * ژمارەی بینەری ئێستا، ئامار و بینینی دراماکان هیچ نووسینێکی KV ناکەن.
 * ئەگەر D1 بەستراوە (Binding بە ناوی DB) لەوێ دەنووسرێن؛ ئەگەر نا، تەنها لە بیرگەی Worker.
 * بەم شێوەیە سنوری نووسینی ڕۆژانەی KV تەنها بۆ داشبۆرد (هاوردەکردن، سڕینەوە، دەستکاری) دەمێنێتەوە.
 */
const PRESENCE_WINDOW_MS = 9 * 60 * 1000;     // ئامێر ئەگەر لە ٩ خولەکی ڕابردوودا پەیوەندی کردبێت چالاکە
const SESSION_GAP_MS = 20 * 60 * 1000;        // دوای ٢٠ خولەک بێ پەیوەندی، کردنەوەی نوێ دەژمێردرێت
const mem = {
  presence: new Map(),
  active: { value: 0, at: 0 },
  cleanupAt: 0,
  sessions: 0,
  schemaReady: false,
  db: { v: null, at: 0 },
  cfg: { v: null, at: 0 },
  views: { v: null, at: 0 },
  legacyViews: new Map(),
  ad: { v: null, at: 0 },
  bundle: { v: undefined, at: 0 },
  ver: { ref: null, v: "" }
};

async function d1(env) {
  if (!env.DB) return null;
  if (!mem.schemaReady) {
    await env.DB.batch([
      env.DB.prepare("CREATE TABLE IF NOT EXISTS presence (id TEXT PRIMARY KEY, ts INTEGER NOT NULL)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS presence_ts ON presence (ts)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS counters (k TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS ad_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)")
    ]);
    mem.schemaReady = true;
  }
  return env.DB;
}

async function countSession(env, now) {
  const db = await d1(env);
  if (!db) { mem.sessions += 1; return; }
  const day = new Date(now).toISOString().slice(0, 10);
  await db.batch([
    db.prepare("INSERT INTO counters (k, n) VALUES ('total', 1) ON CONFLICT(k) DO UPDATE SET n = n + 1"),
    db.prepare("INSERT INTO counters (k, n) VALUES (?1, 1) ON CONFLICT(k) DO UPDATE SET n = n + 1").bind("day:" + day),
    db.prepare("INSERT INTO counters (k, n) VALUES ('lastSeen', ?1) ON CONFLICT(k) DO UPDATE SET n = ?1").bind(now)
  ]);
}

async function touchPresence(env, deviceId) {
  const now = Date.now();
  const db = await d1(env);

  if (!db) {
    const prev = mem.presence.get(deviceId);
    mem.presence.set(deviceId, now);
    if (!prev || now - prev > SESSION_GAP_MS) await countSession(env, now);
    if (!prev) mem.active.value += 1;
    return;
  }

  const row = await db.prepare("SELECT ts FROM presence WHERE id = ?1").bind(deviceId).first();
  if (!row || now - Number(row.ts) > 60000) {
    await db.prepare("INSERT INTO presence (id, ts) VALUES (?1, ?2) ON CONFLICT(id) DO UPDATE SET ts = ?2")
      .bind(deviceId, now).run();
  }
  if (!row || now - Number(row.ts) > SESSION_GAP_MS) await countSession(env, now);
  if (!row) mem.active.value += 1;
}

async function getActive(env) {
  const now = Date.now();
  if (now - mem.active.at < 30000) return mem.active.value;

  let count = 0;
  try {
    const db = await d1(env);
    if (db) {
      const r = await db.prepare("SELECT COUNT(*) AS c FROM presence WHERE ts > ?1").bind(now - PRESENCE_WINDOW_MS).first();
      count = Number(r && r.c) || 0;
      if (now - mem.cleanupAt > 3600000) {
        mem.cleanupAt = now;
        await db.prepare("DELETE FROM presence WHERE ts < ?1").bind(now - 86400000).run();
      }
    } else {
      for (const [id, ts] of mem.presence) {
        if (now - ts > PRESENCE_WINDOW_MS) mem.presence.delete(id); else count++;
      }
    }
  } catch {
    return mem.active.value;
  }
  mem.active = { value: count, at: now };
  return count;
}

async function getViewsMap(env, dramaIds) {
  const now = Date.now();
  if (mem.views.v && now - mem.views.at < 45000) return mem.views.v;

  const map = new Map();
  const db = await d1(env);
  if (db) {
    const res = await db.prepare("SELECT k, n FROM counters WHERE k LIKE 'views:%'").all();
    for (const r of (res.results || [])) map.set(String(r.k).slice(6), Number(r.n) || 0);
  }
  for (const id of dramaIds) {
    if (map.has(id)) continue;
    if (!mem.legacyViews.has(id)) {
      mem.legacyViews.set(id, Number(await env.CHANNELS.get("drama_views_" + id)) || 0);
    }
    map.set(id, mem.legacyViews.get(id));
  }
  mem.views = { v: map, at: now };
  return map;
}

async function addView(env, dramaId) {
  mem.views.at = 0;
  const db = await d1(env);
  if (!db) {
    // بێ D1: وەک پێشوو لە KV (تەنها لە کاتی دەستپێکردنی ئەڵقە)
    const views = (Number(await env.CHANNELS.get("drama_views_" + dramaId)) || 0) + 1;
    await env.CHANNELS.put("drama_views_" + dramaId, String(views));
    mem.legacyViews.set(dramaId, views);
    return views;
  }
  const key = "views:" + dramaId;
  const row = await db.prepare("SELECT n FROM counters WHERE k = ?1").bind(key).first();
  if (row) {
    const r = await db.prepare("UPDATE counters SET n = n + 1 WHERE k = ?1 RETURNING n").bind(key).first();
    return Number(r && r.n) || Number(row.n) + 1;
  }
  const base = Number(await env.CHANNELS.get("drama_views_" + dramaId)) || 0;   // بینینی کۆن یەکجار دەگوازرێتەوە
  await db.prepare("INSERT INTO counters (k, n) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET n = n + 1")
    .bind(key, base + 1).run();
  return base + 1;
}

async function removeViews(env, dramaId) {
  mem.views.at = 0;
  const db = await d1(env);
  if (db) await db.prepare("DELETE FROM counters WHERE k = ?1").bind("views:" + dramaId).run();
  try { await env.CHANNELS.delete("drama_views_" + dramaId); } catch {}
}

async function readConfig(env) {
  let c = {};
  try { c = (await env.CHANNELS.get(CONFIG_KEY, "json")) || {}; } catch {}
  return {
    apkUrl: String(c.apkUrl || ""),
    latestVersionName: String(c.latestVersionName || ""),
    latestVersionCode: Number(c.latestVersionCode) || 0,
    updateMessage: String(c.updateMessage || ""),
    announcement: String(c.announcement || "")
  };
}



function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function html(content) {
  return new Response(content, {
    headers: {
      ...cors,
      "Content-Type": "text/html; charset=utf-8"
    }
  });
}

function uid() {
  return crypto.randomUUID();
}

function normGroup(value) {
  return String(value == null ? "" : value)
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

function resolveChannelGroup(channel, groups) {
  const gid = String(channel.groupId || channel.group_id || "").trim();
  if (gid) {
    const exact = groups.find(g => String(g.id || "").trim() === gid);
    if (exact) return exact;
  }

  const sectionId = String(channel.sectionId || "").trim();
  const sectionName = normGroup(channel.section || "");
  const names = [
    channel.group, channel.groupName, channel.group_name,
    channel.groupTitle, channel.group_title
  ].map(normGroup).filter(Boolean);

  for (const name of names) {
    let matches = groups.filter(g => normGroup(g.name) === name);
    if (sectionId) {
      const bySection = matches.filter(g => String(g.sectionId || "").trim() === sectionId);
      if (bySection.length) matches = bySection;
    } else if (sectionName) {
      const bySection = matches.filter(g => normGroup(g.section) === sectionName);
      if (bySection.length) matches = bySection;
    }
    if (matches.length >= 1) return matches[0];
  }
  return null;
}

function normalizeDB(data) {
  const source = Array.isArray(data) ? { channels: data } : (data && typeof data === "object" ? data : {});

  const legacyGroups = Array.isArray(source.groups) ? source.groups : [];
  const fixedIds = new Set(FIXED_GROUPS.map(g => g.id));

  const groups = FIXED_GROUPS.map(g => ({
    id: g.id,
    name: g.name,
    sectionId: "",
    section: "",
    parentId: ""
  }));

  const channels = (Array.isArray(source.channels) ? source.channels : []).map(c => {
    if (!c || typeof c !== "object") return c;

    let match = null;
    const gid = String(c.groupId || "");

    if (fixedIds.has(gid)) match = FIXED_GROUPS.find(g => g.id === gid);

    if (!match && gid) {
      const old = legacyGroups.find(g => String(g.id) === gid);
      if (old) match = matchFixedGroup(old.name);
    }

    if (!match) match = matchFixedGroup(c.group || c.groupName || c.group_name);

    if (match) {
      return { ...c, groupId: match.id, group: match.name, sectionId: "", section: "" };
    }
    return { ...c, groupId: "" };
  });

  return {
    sections: Array.isArray(source.sections) ? source.sections : [],
    groups,
    channels,
    dramas: Array.isArray(source.dramas) ? source.dramas.map(drama => ({
      ...drama,
      episodes: Array.isArray(drama.episodes) ? drama.episodes.map(episode => ({
        ...episode,
        dramaId: String(drama.id || episode.dramaId || "")
      })) : []
    })) : []
  };
}

async function readDB(env) {
  const data = await env.CHANNELS.get(DB_KEY, "json");
  return normalizeDB(data);
}

async function saveDB(env, db) {
  await env.CHANNELS.put(DB_KEY, JSON.stringify(db));
  mem.db.at = 0;
}

async function readDBCached(env) {
  const now = Date.now();
  if (mem.db.v && now - mem.db.at < 20000) return mem.db.v;
  const v = await readDB(env);
  mem.db = { v, at: now };
  return v;
}

/*
 * زانیاری ڕیکلام (ناو، نوسین، وەشان): ئەگەر D1 بەستراوە لەوێ هەڵدەگیرێت چونکە دەستبەجێ لە هەموو شوێنێک
 * نوێ دەبێتەوە. KV تەنها بۆ بەشەکانی ڤیدیۆ بەکاردێت (هەر وەشانێک کلیلی تایبەتی هەیە).
 */
async function readAd(env) {
  try {
    const db = await d1(env);
    if (db) {
      const row = await db.prepare("SELECT v FROM ad_meta WHERE k = 'ad'").first();
      if (row) return JSON.parse(row.v);
      const done = await db.prepare("SELECT v FROM ad_meta WHERE k = 'migrated'").first();
      if (done) return null;
      // یەکجار: ڕیکلامی کۆن لە KV دەگوازرێتەوە بۆ D1
      let legacy = null;
      try { legacy = (await env.CHANNELS.get(AD_KEY, "json")) || null; } catch {}
      const stmts = [db.prepare("INSERT OR IGNORE INTO ad_meta (k, v) VALUES ('migrated', '1')")];
      if (legacy) stmts.push(db.prepare("INSERT OR IGNORE INTO ad_meta (k, v) VALUES ('ad', ?1)").bind(JSON.stringify(legacy)));
      await db.batch(stmts);
      return legacy;
    }
  } catch {}
  try { return (await env.CHANNELS.get(AD_KEY, "json")) || null; } catch { return null; }
}

async function writeAd(env, meta) {
  const db = await d1(env);
  if (db) {
    await db.prepare("INSERT INTO ad_meta (k, v) VALUES ('ad', ?1) ON CONFLICT(k) DO UPDATE SET v = ?1")
      .bind(JSON.stringify(meta)).run();
    await db.prepare("INSERT OR IGNORE INTO ad_meta (k, v) VALUES ('migrated', '1')").run();
  } else {
    await env.CHANNELS.put(AD_KEY, JSON.stringify(meta));
  }
  mem.ad.at = 0;
}

async function removeAd(env) {
  const db = await d1(env);
  if (db) {
    await db.prepare("DELETE FROM ad_meta WHERE k = 'ad'").run();
    await db.prepare("INSERT OR IGNORE INTO ad_meta (k, v) VALUES ('migrated', '1')").run();
  }
  try { await env.CHANNELS.delete(AD_KEY); } catch {}
  mem.ad.at = 0;
}

async function readAdCached(env) {
  const now = Date.now();
  if (mem.ad.at && now - mem.ad.at < 3000) return mem.ad.v;
  const v = await readAd(env);
  mem.ad = { v, at: now };
  return v;
}

function publicAd(meta, origin) {
  if (!meta) return { active: false, title: "", text: "", videoUrl: "" };
  const has = Number(meta.chunks) > 0 && Number(meta.size) > 0;
  return {
    active: has,
    title: String(meta.title || ""),
    text: String(meta.text || ""),
    videoUrl: has ? origin + "/ad/video?v=" + meta.version : "",
    type: String(meta.type || "video/mp4"),
    size: Number(meta.size) || 0,
    duration: Number(meta.duration) || 0,
    version: String(meta.version || "")
  };
}

function dataVersionOf(dbData) {
  if (mem.ver.ref === dbData) return mem.ver.v;
  const dramas = dbData.dramas.map(d => ({
    id: d.id, name: d.name, logo: d.logo, poster: d.poster,
    episodes: (d.episodes || []).map(e => [e.id, e.number, e.name, e.url])
  }));
  const text = JSON.stringify([dbData.sections, dbData.groups, dbData.channels, dramas]);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const v = h.toString(36) + "-" + text.length.toString(36);
  mem.ver = { ref: dbData, v };
  return v;
}

function slimChannels(list) {
  return list.map(c => {
    const o = { id: c.id, name: c.name, url: c.url, logo: c.logo || "", groupId: c.groupId || "", group: c.group || "" };
    if (c.sectionId) { o.sectionId = c.sectionId; o.section = c.section || ""; }
    return o;
  });
}

async function readBundleMetaCached(env) {
  const now = Date.now();
  if (mem.bundle.at && now - mem.bundle.at < 20000) return mem.bundle.v;
  let v = null;
  try { v = (await env.CHANNELS.get(BUNDLE_META_KEY, "json")) || null; } catch {}
  mem.bundle = { v, at: now };
  return v;
}

async function readConfigCached(env) {
  const now = Date.now();
  if (mem.cfg.v && now - mem.cfg.at < 60000) return mem.cfg.v;
  const v = await readConfig(env);
  mem.cfg = { v, at: now };
  return v;
}

/*
 * ADMIN TOKEN:
 * هەمان Secret ـی پێشووی Cloudflare بەکاردەهێنرێت.
 * هیچ کلیلێکی نوێ دروست ناکرێت.
 */
function authorized(request, env) {
  const configured = String(env.ADMIN_TOKEN || "").trim();
  const header = String(request.headers.get("Authorization") || "");
  const supplied = header.replace(/^Bearer\s+/i, "").trim();

  return configured.length > 0 && supplied === configured;
}

function requireAdmin(request, env) {
  if (!authorized(request, env)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  return null;
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function looseName(value) {
  return String(value == null ? "" : value)
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670\u0640\u200C-\u200F]/g, "")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function parseImport(content, defaultGroup = "") {
  const lines = String(content || "").replace(/^\uFEFF/, "").split(/\r?\n/);
  let extGroup = "";
  const result = [];
  let current = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF")) {
      const comma = line.lastIndexOf(",");
      const name = comma >= 0 ? line.slice(comma + 1).trim() : "بێ ناو";

      const logoMatch = line.match(/tvg-logo=["']([^"']*)["']/i);
      const groupMatch = line.match(/group-title=["']([^"']*)["']/i);

      current = {
        id: uid(),
        name: name || "بێ ناو",
        group: groupMatch && groupMatch[1].trim()
          ? groupMatch[1].trim()
          : defaultGroup,
        logo: logoMatch ? logoMatch[1].trim() : "",
        url: "",
        hasGroupTitle: !!(groupMatch && groupMatch[1].trim())
      };
      continue;
    }

    if (/^#EXTGRP:/i.test(line)) {
      extGroup = line.slice(line.indexOf(":") + 1).trim();
      continue;
    }

    if (line.startsWith("#")) continue;

    if (current) {
      if (extGroup && !current.hasGroupTitle) current.group = extGroup;
      delete current.hasGroupTitle;
      extGroup = "";
      current.url = line;
      result.push(current);
      current = null;
      continue;
    }

    if (line.includes("|")) {
      const p = line.split("|");

      if (p.length >= 3) {
        result.push({
          id: uid(),
          name: p[0].trim() || "بێ ناو",
          group: p[1].trim() || defaultGroup,
          url: p[2].trim(),
          logo: (p[3] || "").trim()
        });
      }
      continue;
    }

    if (/^https?:\/\//i.test(line)) {
      result.push({
        id: uid(),
        name: "Channel " + (result.length + 1),
        group: defaultGroup,
        url: line,
        logo: ""
      });
    }
  }

  return result.filter(x => x.url);
}

async function getStats(env) {
  let legacy = {};
  try { legacy = (await env.CHANNELS.get(STATS_KEY, "json")) || {}; } catch {}

  const today = new Date().toISOString().slice(0, 10);
  let total = Number(legacy.total || 0);
  let todayCount = legacy.date === today ? Number(legacy.today || 0) : 0;
  let lastSeen = legacy.lastSeen || "";
  let storage = "memory";

  try {
    const db = await d1(env);
    if (db) {
      storage = "d1";
      const res = await db.prepare("SELECT k, n FROM counters WHERE k IN ('total', 'lastSeen', ?1)").bind("day:" + today).all();
      const m = new Map((res.results || []).map(r => [r.k, Number(r.n) || 0]));
      total += m.get("total") || 0;
      todayCount = m.get("day:" + today) || 0;
      if (m.get("lastSeen")) lastSeen = new Date(m.get("lastSeen")).toISOString();
    } else {
      total += mem.sessions;
      todayCount += mem.sessions;
    }
  } catch {}

  return { total, today: todayCount, date: today, lastSeen, storage };
}


function adminPage() {
  return `<!DOCTYPE html>
<html lang="ku" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>JIVARA TV Admin</title>

<style>
* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 20px;
  background: #10131c;
  color: #fff;
  font-family: Arial, sans-serif;
  direction: rtl;
}

.container { max-width: 1150px; margin: auto; }

h1, h2, h3 { color: #f3c44e; }

.panel {
  background: #1b2130;
  border: 1px solid #30394c;
  border-radius: 12px;
  padding: 18px;
  margin-bottom: 18px;
}

input, select, textarea {
  width: 100%;
  padding: 12px;
  margin: 7px 0;
  border-radius: 7px;
  border: 1px solid #46516a;
  background: #111827;
  color: white;
  font-size: 15px;
  direction: rtl;
  text-align: right;
}

button {
  border: 0;
  border-radius: 7px;
  padding: 11px 17px;
  margin: 5px;
  background: #e5ad35;
  color: #151515;
  font-weight: bold;
  cursor: pointer;
}

button.danger { background: #d94c4c; color: white; }
button.secondary { background: #3b4964; color: white; }
button:hover { opacity: .88; }

.hidden { display: none !important; }

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.item {
  background: #252d40;
  padding: 12px;
  border-radius: 8px;
  margin: 8px 0;
  overflow-wrap: anywhere;
}

.item strong { color: #f3c44e; }

.small { color: #aab4c7; font-size: 13px; }

#loginPanel {
  max-width: 430px;
  margin: 70px auto;
}

#loginPanel input {
  direction: rtl;
  text-align: right;
}

#message { color: #ff8585; padding: 8px; }

.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-bottom: 15px;
}

.tabs button { background: #303b52; color: white; }
.tabs button.active { background: #e5ad35; color: #111; }

.list { max-height: 70vh; overflow-y: auto; }

label {
  display: block;
  margin-top: 8px;
  color: #d7deeb;
}

.stat {
  font-size: 27px;
  color: #f3c44e;
  font-weight: bold;
}

.group-card {
  background: #202a3c;
  border: 1px solid #46516a;
  border-radius: 10px;
  padding: 15px;
  margin: 0 0 16px 0;
  display: block;
  width: 100%;
}

.group-section-label {
  color: #aab4c7;
  font-size: 12px;
  margin-top: 5px;
}

.group-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.group-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.group-heading strong {
  color: #f3c44e;
  font-size: 17px;
}

.group-channels {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid #46516a;
}

.channel-row {
  background: #151d2b;
  border-radius: 7px;
  padding: 9px;
  margin: 7px 0;
}

.empty-note {
  color: #9caac0;
  font-size: 13px;
  padding: 8px;
}

.delete-group {
  background: #b83232;
  color: white;
}

@media(max-width:600px) {
  body { padding: 10px; }
  .panel { padding: 12px; }
}
  .ad-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 8px 0; }
  .ad-actions button { margin: 0; }
  .ad-badge { padding: 7px 14px; border-radius: 999px; font-weight: 700; font-size: 14px; border: 1px solid transparent; }
  .ad-badge.ok { background: #12351f; color: #7dffa8; border-color: #2f8f55; }
  .ad-badge.none { background: #3a1a1a; color: #ff9a9a; border-color: #8f2f2f; }
  .ad-badge.busy { background: #3a3210; color: #ffe28a; border-color: #8f7a2f; }
</style>
</head>

<body>
<div class="container">

<div id="loginPanel" class="panel">
  <h2>JIVARA TV</h2>
  <h3>چوونەژوورەوەی بەڕێوەبەر</h3>

  <input
    id="token"
    type="password"
    placeholder="ADMIN TOKEN"
    dir="rtl"
    style="direction:rtl;text-align:right"
  >

  <button onclick="login()">چوونەژوورەوە</button>
  <div id="loginMessage"></div>
</div>

<div id="dashboard" class="hidden">

  <h1>JIVARA TV — Dashboard</h1>

  <div class="panel">
    <button class="secondary" onclick="logout()">دەرچوون</button>
    <button class="secondary" onclick="refreshAll()">نوێکردنەوە</button>
  </div>

  <div class="grid">
    <div class="panel">
      <div class="small">کۆی سەردان</div>
      <div class="stat" id="statTotal">0</div>
    </div>
    <div class="panel">
      <div class="small">سەردانی ئەمڕۆ</div>
      <div class="stat" id="statToday">0</div>
    </div>
  </div>

  <div class="tabs">
    <button onclick="showTab('channelsTab',this)" class="active">کەناڵەکان</button>
    <button onclick="showTab('groupsTab',this)">گرووپەکان</button>
    <button onclick="showTab('sectionsTab',this)">بەشەکان</button>
    <button onclick="showTab('dramasTab',this)">دراما و ئەڵقەکان</button>
    <button onclick="showTab('statsTab',this)">ئامار</button>
    <button onclick="showTab('otaTab',this)">نوێکردنەوەی ئەپ (خۆکار)</button>
    <button onclick="showTab('adSetTab',this)">دانانی ڕیکلام</button>
    <button onclick="showTab('adDeleteTab',this)">سڕینەوەی ڕیکلام</button>
    <button onclick="showTab('appTab',this)">ئەپ (APK)</button>
  </div>

  <section id="channelsTab">
    <div class="panel">
      <h2>زیادکردنی کەناڵ</h2>
      <input id="channelName" placeholder="ناوی کەناڵ">
      <input id="channelUrl" placeholder="لینکی کەناڵ">
      <input id="channelLogo" placeholder="لینکی لۆگۆ">
      <select id="channelGroup"></select>
      <button onclick="saveChannel()">زیادکردن / نوێکردنەوە</button>
      <button class="secondary" onclick="clearChannelForm()">پاککردنەوەی خانەکان</button>
      <input id="editingChannel" type="hidden">
    </div>

    <div class="panel">
      <h2>هاوردەکردنی کەناڵ</h2>
      <label>فایلی M3U / M3U8 / TXT</label>
      <input id="importFile" type="file" onchange="showImportFileName()">
      <div id="importFileName" class="small"></div>
      <textarea id="importText" rows="5" placeholder="یان ناوەڕۆکی لیستەکە لێرە پەیست بکە (M3U، یان هەر دێڕێک بەم شێوەیە: ناو|گرووپ|لینک)"></textarea>
      <select id="defaultGroup"></select>
      <label><input type="checkbox" id="forceGroup" style="width:auto"> هەموو کەناڵەکانی ئەم لیستە بنێرە بۆ گرووپی هەڵبژێردراو (گوێ مەدە بە group-title)</label>
      <div class="small">کەناڵ بە ناوی گرووپەکەی (group-title) دەچێتە ناو هەمان گرووپ لە ١٦ گرووپەکەی ئەپ. گرووپی نوێ دروست ناکرێت و کەناڵی دووبارەش زیاد ناکرێت.</div>
      <button onclick="importChannels()">هاوردەکردن</button>
      <div id="importMessage" class="small"></div>
    </div>

    <div class="panel">
      <h2>لیستی کەناڵەکان</h2>
      <input id="channelSearch" placeholder="گەڕان بە ناوی کەناڵ..." oninput="renderChannels()">
      <div id="channelList" class="list"></div>
    </div>
  </section>

  <section id="groupsTab" class="hidden">
    <div class="panel">
      <h2>گرووپەکان (جێگیر)</h2>
      <div class="small">ئەم ١٦ گرووپە هاوتای گرووپە ڕەنگاوڕەنگەکانی ئەپن و جێگیرن: ناوخۆ، کوردی، عەرەبی، بیانی، هەواڵ، قورئان، منداڵان، وەرزش، موزیک، دۆکۆمێنتاری، عێراق، ئێران، تورکیا، ئیسرائیل، ئەمریکا، بەریتانیا. گرووپی نوێ دروست ناکرێت.</div>
    </div>

    <div class="panel">
      <h2>گرووپەکان و کەناڵەکانیان</h2>
      <div id="groupList" class="list"></div>
    </div>
  </section>

  <section id="sectionsTab" class="hidden">
    <div class="panel">
      <h2>بەشەکان</h2>
      <input id="sectionName" placeholder="ناوی بەش">
      <button onclick="saveSection()">زیادکردنی بەش</button>
      <input id="editingSection" type="hidden">
    </div>
    <div class="panel">
      <h2>لیستی بەشەکان</h2>
      <div id="sectionList"></div>
    </div>
  </section>

  <section id="dramasTab" class="hidden">
    <div class="panel">
      <h2>زیادکردنی دراما</h2>
      <input id="dramaName" placeholder="ناوی دراما">
      <input id="dramaLogo" placeholder="لینکی وێنە">
      <textarea id="dramaDescription" placeholder="دەربارەی دراما"></textarea>
      <button onclick="saveDrama()">زیادکردنی دراما</button>
      <input id="editingDrama" type="hidden">
    </div>

    <div class="panel">
      <h2>لیستی دراماکان</h2>
      <div id="dramaList"></div>
    </div>

    <div class="panel">
      <h2>زیادکردنی ئەڵقە</h2>
      <select id="episodeDrama"></select>
      <input id="episodeName" placeholder="ناوی ئەڵقە">
      <input id="episodeNumber" type="number" placeholder="ژمارەی ئەڵقە">
      <input id="episodeUrl" placeholder="لینکی ڤیدیۆ">
      <input id="episodeLogo" placeholder="لینکی وێنە">
      <input id="editingEpisode" type="hidden">
      <button id="saveEpisodeBtn" onclick="saveEpisode()">زیادکردنی ئەڵقە</button>
      <button class="secondary" onclick="clearEpisodeForm()">پاککردنەوەی خانەکان</button>
    </div>

    <div class="panel">
      <h2>ئەڵقەکان</h2>
      <div id="episodeList"></div>
    </div>
  </section>

  <section id="otaTab" class="hidden">
    <div class="panel">
      <h2>نوێکردنەوەی خۆکاری ئەپ</h2>
      <p class="small" id="otaCurrent">-</p>
      <input id="otaFile" type="file" onchange="showOtaFileName()">
      <div id="otaFileName" class="small"></div>
      <div class="ad-actions">
        <button onclick="publishBundle()">بڵاوکردنەوەی نوێکردنەوە</button>
        <button class="danger" onclick="removeBundle()">گەڕانەوە بۆ وەشانی APK</button>
      </div>
      <div class="small" id="otaMessage"></div>
      <p class="small">فایلی <strong>app_bundle.html</strong> هەڵبژێرە و «بڵاوکردنەوە» بکە. هەموو بەکارهێنەران بە خۆکاری نوێ دەبنەوە (کاتی کردنەوەی ئەپ یان لە ماوەی ٣ خولەکدا)، بەبێ سڕینەوە و دابەزاندنەوەی APK. ئەگەر ئەپ لەسەر پەڕەی سەرەکی بێت یەکسەر نوێ دەبێتەوە، ئەگەر نا دوای گەڕانەوە بۆ پەڕەی سەرەکی. ئەگەر وەشانی نوێ بە دروستی نەکرایەوە، ئەپ خۆی دەگەڕێتەوە بۆ وەشانی ناو APK.</p>
      <p class="small">تەنها گۆڕانی ڕووکار و لۆژیکی ئەپ بەم شێوەیە دەگەیەنرێن. گۆڕانی کۆدی ناوەکی (وەک ڕێپێدانەکان یان کردنەوەی VLC) پێویستی بە APKی نوێ هەیە.</p>
    </div>
  </section>

  <section id="adSetTab" class="hidden">
    <div class="panel">
      <h2>دانانی ڕیکلام</h2>
      <p class="small" id="adCurrent">-</p>
      <input id="adTitle" placeholder="ناوی کاڵا یان بابەتی ڕیکلام">
      <textarea id="adText" rows="5" placeholder="باسکردنی کاڵاکە یان بابەتی ڕیکلامەکە (لە سەرەوەی پەڕەی ڕیکلام لە ئەپ نیشان دەدرێت)"></textarea>
      <input id="adFile" type="file" onchange="showAdFileName()">
      <div id="adFileName" class="small"></div>
      <div class="ad-actions"><button onclick="saveAd()">دانانی ڕیکلام</button><span id="adBadge" class="ad-badge none">...</span></div>
      <div class="small" id="adMessage"></div>
      <p class="small">درێژی ڤیدیۆی ڕیکلام دەبێت <strong>١:٣٠ خولەک (٩٠ چرکە) یان کەمتر</strong> بێت. MP4 (H.264 + AAC) باشترین گونجانی هەیە. ڕیکلامی نوێ دەستبەجێ شوێنی کۆنەکە دەگرێتەوە. ئەگەر فایلی نوێ هەڵنەبژێریت، تەنها ناو و باسەکە نوێ دەبنەوە.</p>
    </div>
  </section>

  <section id="adDeleteTab" class="hidden">
    <div class="panel">
      <h2>سڕینەوەی ڕیکلام</h2>
      <p id="adDeleteInfo" class="small">-</p>
      <div class="ad-actions"><button class="danger" onclick="deleteAd()">سڕینەوەی ڕیکلام</button><span id="adBadge2" class="ad-badge none">...</span></div>
      <div class="small" id="adDeleteMessage"></div>
      <p class="small">دوای سڕینەوە، لە ئەپ لە شوێنی ڕیکلامەکە دەنووسرێت: «لێرە ڕیکلامەکەت دابنێ ...»</p>
    </div>
  </section>

  <section id="appTab" class="hidden">
    <div class="panel">
      <h2>بەڕێوەبردنی ئەپ (APK)</h2>
      <p>لینکی دابەزاندنی گشتی: <strong id="appDownloadLink" dir="ltr">-</strong></p>
      <input id="appApkUrl" placeholder="لینکی ڕاستەوخۆی فایلی APK (ئارەزوومەندانە؛ بەتاڵ = لینکی بنەڕەتی)">
      <input id="appVersionName" placeholder="ناوی دوا وەشان، بۆ نموونە 1.0.3">
      <input id="appVersionCode" type="number" min="0" placeholder="ژمارەی دوا وەشان (versionCode)، بۆ نموونە 4">
      <textarea id="appUpdateMessage" rows="2" placeholder="نامەی نوێکردنەوە کە لە ئەپەکەدا نیشان دەدرێت"></textarea>
      <textarea id="appAnnouncement" rows="3" placeholder="ئاگاداری سەرەکی ئەپ (لە لاپەڕەی سەرەکی نیشان دەدرێت؛ بەتاڵ = نامەی بنەڕەتی)"></textarea>
      <button onclick="saveAppConfig()">پاشەکەوتکردن</button>
      <p class="small">ئەگەر ژمارەی وەشان لە وەشانی دابەزێنراوی ئەپ زیاتر بێت، ئەپەکە ئاگاداری نوێکردنەوە نیشان دەدات.</p>
    </div>
  </section>

  <section id="statsTab" class="hidden">
    <div class="panel">
      <h2>ئاماری بەکارهێنان</h2>
      <p>بینەری ئێستا: <span id="statsActive">0</span></p>
      <p class="small" id="statsStorage"></p>
      <p>کۆی سەردان: <span id="statsTotal">0</span></p>
      <p>سەردانی ئەمڕۆ: <span id="statsToday">0</span></p>
      <p>دوایین سەردان: <span id="statsLast">-</span></p>
    </div>
  </section>

</div>
</div>

<script>
let token = "";
let db = {
  sections: [],
  groups: [],
  channels: [],
  dramas: []
};

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + token,
    ...(options.headers || {})
  };

  const response = await fetch(path, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "هەڵەیەک ڕوویدا");
  }

  return data;
}

function message(id, value) {
  document.getElementById(id).textContent = value;
}

async function login() {
  const value = document.getElementById("token").value.trim();

  if (!value) {
    message("loginMessage", "تکایە کلیلی نهێنی بنووسە");
    return;
  }

  token = value;

  try {
    await api("/api/admin/verify", { method: "POST" });

    localStorage.setItem("jivara_admin_token", token);

    document.getElementById("loginPanel").classList.add("hidden");
    document.getElementById("dashboard").classList.remove("hidden");

    message("loginMessage", "");
    await refreshAll();

  } catch (e) {
    token = "";
    message("loginMessage", "کلیلی نهێنی هەڵەیە: " + e.message);
  }
}

function logout() {
  token = "";
  localStorage.removeItem("jivara_admin_token");

  document.getElementById("dashboard").classList.add("hidden");
  document.getElementById("loginPanel").classList.remove("hidden");
  document.getElementById("token").value = "";
}

let otaCurrent = null;

function showOtaFileName() {
  const f = document.getElementById("otaFile").files[0];
  document.getElementById("otaFileName").textContent = f ? "فایلی هەڵبژێردراو: " + f.name + " (" + formatBytes(f.size) + ")" : "";
}

async function loadBundleInfo() {
  try {
    otaCurrent = await api("/api/admin/bundle");
    const el = document.getElementById("otaCurrent");
    el.textContent = otaCurrent && otaCurrent.seq
      ? "نوێکردنەوەی بڵاوکراو: " + new Date(otaCurrent.seq * 1000).toLocaleString() + " — " + formatBytes(otaCurrent.size)
      : "هیچ نوێکردنەوەیەکی خۆکار بڵاو نەکراوەتەوە (ئەپەکان وەشانی ناو APK بەکاردێنن).";
  } catch (e) {}
}

function readFileAsText(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () { resolve(String(reader.result || "")); };
    reader.onerror = function () { reject(new Error("خوێندنەوەی فایلەکە سەرکەوتوو نەبوو")); };
    reader.readAsText(file, "UTF-8");
  });
}

async function publishBundle() {
  const file = document.getElementById("otaFile").files[0];
  if (!file) { alert("فایلی app_bundle.html هەڵبژێرە"); return; }
  if (!confirm("نوێکردنەوەکە بۆ هەموو بەکارهێنەران بڵاو دەکرێتەوە. دڵنیایت؟")) return;
  try {
    message("otaMessage", "بڵاوکردنەوە بەردەوامە...");
    const text = await readFileAsText(file);
    const r = await api("/api/admin/bundle", { method: "PUT", headers: { "Content-Type": "text/html" }, body: text });
    message("otaMessage", "نوێکردنەوە بڵاوکرایەوە ✓ (" + formatBytes(r.size) + ")");
    document.getElementById("otaFile").value = "";
    showOtaFileName();
    await loadBundleInfo();
  } catch (e) {
    message("otaMessage", "✕ " + e.message);
  }
}

async function removeBundle() {
  if (!confirm("نوێکردنەوەی بڵاوکراو دەسڕدرێتەوە و ئەپەکان دەگەڕێنەوە بۆ وەشانی ناو APK. دڵنیایت؟")) return;
  try {
    await api("/api/admin/bundle", { method: "DELETE" });
    message("otaMessage", "سڕایەوە ✓");
    await loadBundleInfo();
  } catch (e) {
    message("otaMessage", "✕ " + e.message);
  }
}

let adCurrent = null;

function formatBytes(n) {
  n = Number(n) || 0;
  if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
  if (n >= 1024) return Math.round(n / 1024) + " KB";
  return n + " B";
}

function showAdFileName() {
  const f = document.getElementById("adFile").files[0];
  document.getElementById("adFileName").textContent = f ? "فایلی هەڵبژێردراو: " + f.name + " (" + formatBytes(f.size) + ")" : "";
}

function setAdBadge(state, text) {
  ["adBadge", "adBadge2"].forEach(function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = "ad-badge " + state;
    el.textContent = text;
  });
}

function refreshAdBadge() {
  if (adCurrent && adCurrent.active) setAdBadge("ok", "✓ ڕیکلام پاشەکەوتکراوە");
  else setAdBadge("none", "✕ ڕیکلام دابەزێنراوە (هیچ ڕیکلامێک نییە)");
}

async function loadAd() {
  try {
    adCurrent = await api("/api/admin/ad");
    document.getElementById("adTitle").value = adCurrent.title || "";
    document.getElementById("adText").value = adCurrent.text || "";
    const info = adCurrent.active
      ? "ڕیکلامی ئێستا: " + (adCurrent.title || "بێ ناو") + " — ڤیدیۆ: " + formatBytes(adCurrent.size) + (adCurrent.duration ? " — " + Math.round(adCurrent.duration) + " چرکە" : "")
      : "هیچ ڕیکلامێک دانەنراوە.";
    document.getElementById("adCurrent").textContent = info;
    document.getElementById("adDeleteInfo").textContent = info;
    refreshAdBadge();
  } catch (e) {}
}

function getVideoDuration(file) {
  return new Promise(function (resolve) {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    let done = false;
    function finish(d) {
      if (done) return;
      done = true;
      try { URL.revokeObjectURL(url); } catch (e) {}
      resolve(d);
    }
    v.preload = "metadata";
    v.onloadedmetadata = function () { finish(Number(v.duration)); };
    v.onerror = function () { finish(NaN); };
    setTimeout(function () { finish(NaN); }, 8000);
    v.src = url;
  });
}

async function saveAd() {
  const file = document.getElementById("adFile").files[0];
  const title = document.getElementById("adTitle").value.trim();
  const text = document.getElementById("adText").value.trim();

  if (!file && !(adCurrent && adCurrent.active)) {
    alert("فایلی ڤیدیۆی ڕیکلامەکە هەڵبژێرە");
    return;
  }

  try {
    if (file) {
      if (file.size > 100 * 1024 * 1024) {
        alert("قەبارەی فایلی ڤیدیۆ زۆر گەورەیە (زۆرترین ١٠٠ MB)");
        return;
      }

      message("adMessage", "پشکنینی درێژی ڤیدیۆ...");
      const duration = await getVideoDuration(file);
      if (isFinite(duration) && duration > 90.5) {
        const sec = Math.round(duration);
        alert("درێژی ڤیدیۆ " + sec + " چرکەیە. ڤیدیۆی ڕیکلام دەبێت ١:٣٠ خولەک (٩٠ چرکە) یان کەمتر بێت.");
        message("adMessage", "ڤیدیۆکە زۆر درێژە: " + sec + " چرکە (زۆرترین ٩٠ چرکە)");
        return;
      }
      if (!isFinite(duration) && !confirm("نەتوانرا درێژی ڤیدیۆ بخوێنرێتەوە. دڵنیایت کە ١:٣٠ خولەک یان کەمترە و بەردەوام بم؟")) {
        return;
      }

      const CH = 5 * 1024 * 1024;
      const total = Math.ceil(file.size / CH);
      const version = String(Date.now());

      try {
        for (let i = 0; i < total; i++) {
          message("adMessage", "بارکردنی ڤیدیۆ: " + Math.round(i / total * 100) + "% (" + (i + 1) + "/" + total + ")");
          setAdBadge("busy", "⏳ بارکردن " + Math.round(i / total * 100) + "%");
          await api("/api/admin/ad/chunk?v=" + version + "&i=" + i, {
            method: "PUT",
            headers: { "Content-Type": "application/octet-stream" },
            body: file.slice(i * CH, (i + 1) * CH)
          });
        }
      } catch (e) {
        try { await api("/api/admin/ad/abort", { method: "POST", body: JSON.stringify({ version: version, chunks: total }) }); } catch (x) {}
        throw e;
      }

      await api("/api/admin/ad/finish", {
        method: "POST",
        body: JSON.stringify({
          version: version, chunks: total, chunkSize: CH, size: file.size,
          type: file.type || "video/mp4", duration: isFinite(duration) ? duration : 0, title: title, text: text
        })
      });
    } else {
      await api("/api/admin/ad", { method: "PUT", body: JSON.stringify({ title: title, text: text }) });
    }

    document.getElementById("adFile").value = "";
    showAdFileName();
    message("adMessage", "ڕیکلام دانرا و پاشەکەوت کرا ✓");
    setAdBadge("ok", "✓ ڕیکلام پاشەکەوت کرا");
    await loadAd();
  } catch (e) {
    message("adMessage", e.message);
    setAdBadge("none", "✕ پاشەکەوت نەکرا");
  }
}

async function deleteAd() {
  if (!adCurrent || (!adCurrent.active && !adCurrent.title && !adCurrent.text)) {
    alert("هیچ ڕیکلامێک نییە بۆ سڕینەوە");
    return;
  }
  if (!confirm("ڕیکلامەکە بە تەواوی دەسڕدرێتەوە. دڵنیایت؟")) return;

  try {
    await api("/api/admin/ad", { method: "DELETE" });
    message("adDeleteMessage", "ڕیکلامەکە سڕایەوە ✓");
    setAdBadge("none", "✕ ڕیکلام دابەزێنرا");
    await loadAd();
  } catch (e) {
    message("adDeleteMessage", e.message);
  }
}

async function loadAppConfig() {
  try {
    const c = await api("/api/admin/app-config");
    document.getElementById("appApkUrl").value = c.apkUrl || "";
    document.getElementById("appVersionName").value = c.latestVersionName || "";
    document.getElementById("appVersionCode").value = c.latestVersionCode || "";
    document.getElementById("appUpdateMessage").value = c.updateMessage || "";
    document.getElementById("appAnnouncement").value = c.announcement || "";
    document.getElementById("appDownloadLink").textContent = location.origin + "/download";
  } catch (e) {}
}

async function saveAppConfig() {
  try {
    await api("/api/admin/app-config", {
      method: "PUT",
      body: JSON.stringify({
        apkUrl: document.getElementById("appApkUrl").value.trim(),
        latestVersionName: document.getElementById("appVersionName").value.trim(),
        latestVersionCode: Number(document.getElementById("appVersionCode").value) || 0,
        updateMessage: document.getElementById("appUpdateMessage").value.trim(),
        announcement: document.getElementById("appAnnouncement").value.trim()
      })
    });
    alert("ڕێکخستنەکانی ئەپ پاشەکەوت کران");
  } catch (e) {
    alert(e.message);
  }
}

async function refreshAll() {
  const results = await Promise.allSettled([
    loadDB(),
    loadStats(),
    loadAppConfig(),
    loadAd(),
    loadBundleInfo()
  ]);

  if (results[0].status === "rejected") {
    alert("هەڵە لە خوێندنەوەی زانیارییەکان: " + results[0].reason.message);
  }
}

async function loadDB() {
  db = await api("/api/admin/data");

  db.sections = db.sections || [];
  db.groups = db.groups || [];
  db.channels = db.channels || [];
  db.dramas = db.dramas || [];

  renderAll();
}

async function loadStats() {
  try {
    const s = await api("/api/admin/stats");

    document.getElementById("statTotal").textContent = s.total || 0;
    document.getElementById("statToday").textContent = s.today || 0;
    document.getElementById("statsActive").textContent = s.active || 0;
    document.getElementById("statsStorage").textContent = s.storage === "d1"
      ? "✓ ئامار و بینەری ئێستا لە D1 هەڵدەگیرێن (بەبێ سنوری نووسینی KV)."
      : "⚠ D1 نەبەستراوە: ژمارەی بینەر تەنخمینکراوە و ئامار لە بیرگەی Worker دەمێنێتەوە. بۆ ژمارەی ورد، D1 بە ناوی DB ببەستەوە.";
    document.getElementById("statsTotal").textContent = s.total || 0;
    document.getElementById("statsToday").textContent = s.today || 0;
    document.getElementById("statsLast").textContent = s.lastSeen || "-";
  } catch {
    document.getElementById("statsLast").textContent = "ئامار بەردەست نییە";
  }
}

function showTab(id, button) {
  document.querySelectorAll("#dashboard section").forEach(x => x.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");

  document.querySelectorAll(".tabs button").forEach(x => x.classList.remove("active"));
  button.classList.add("active");
}

function fillSelect(id, items, includeEmpty = true) {
  const el = document.getElementById(id);
  if (!el) return;

  const old = el.value;

  el.innerHTML = includeEmpty
    ? '<option value="">بێ بەش / دیاری نەکراو</option>'
    : "";

  items.forEach(x => {
    const option = document.createElement("option");
    option.value = x.id;
    option.textContent = x.name;
    el.appendChild(option);
  });

  if ([...el.options].some(x => x.value === old)) {
    el.value = old;
  }
}

function renderAll() {
  fillSelect("channelSection", db.sections);
  fillSelect("defaultGroup", db.groups);
  (function () {
    const a = document.getElementById("channelGroup");
    if (a && a.options.length) a.options[0].textContent = "-- گرووپ هەڵبژێرە --";
    const d = document.getElementById("defaultGroup");
    if (d && d.options.length) d.options[0].textContent = "گرووپی بنەڕەتی بۆ کەناڵی بێ گرووپ (دیاری نەکراو = ناهێنرێن)";
  })();
  fillSelect("groupSection", db.sections);
  fillSelect("channelGroup", db.groups);
  fillSelect("parentGroup", db.groups);
  fillSelect("episodeDrama", db.dramas, false);
  (function () {
    const a = document.getElementById("channelGroup");
    if (a && a.options.length) a.options[0].textContent = "-- گرووپ هەڵبژێرە --";
    const d = document.getElementById("defaultGroup");
    if (d && d.options.length) d.options[0].textContent = "گرووپی بنەڕەتی بۆ کەناڵی بێ گرووپ (دیاری نەکراو = ناهێنرێن)";
  })();

  renderChannels();
  renderGroups();
  renderSections();
  renderDramas();
  renderEpisodes();
}

function normalizeGroupMatch(value) {
  return String(value == null ? "" : value)
    .normalize("NFKC")
    .trim()
    .replace(/\\s+/g, " ")
    .toLocaleLowerCase();
}

function resolveChannelGroup(channel, groups) {
  const channelGroupId = String(
    channel.groupId || channel.group_id || ""
  ).trim();

  if (channelGroupId) {
    const exactGroup = groups.find(group =>
      String(group.id || "").trim() === channelGroupId
    );
    if (exactGroup) return exactGroup;
  }

  const channelSectionId = String(channel.sectionId || "").trim();
  const channelSectionName = normalizeGroupMatch(channel.section || "");
  const possibleNames = [
    channel.group,
    channel.groupName,
    channel.group_name,
    channel.groupTitle,
    channel.group_title
  ].map(normalizeGroupMatch).filter(Boolean);

  for (const channelGroupName of possibleNames) {
    const idMatch = groups.find(group =>
      String(group.id || "").trim() === channelGroupName
    );
    if (idMatch) return idMatch;

    let matches = groups.filter(group =>
      normalizeGroupMatch(group.name) === channelGroupName
    );

    if (channelSectionId) {
      matches = matches.filter(group =>
        String(group.sectionId || "").trim() === channelSectionId
      );
    } else if (channelSectionName) {
      matches = matches.filter(group =>
        normalizeGroupMatch(group.section) === channelSectionName
      );
    }

    if (matches.length === 1) return matches[0];
  }

  return null;
}

function renderChannels() {
  const list = document.getElementById("channelList");
  const search = (document.getElementById("channelSearch").value || "").trim().toLowerCase();
  list.innerHTML = "";

  const groups = db.groups || [];
  const allChannels = db.channels || [];

  // 1) هەموو گرووپەکان دروست دەکرێن (گرووپە تۆمارکراوەکان + گرووپە بە ناو)
  const buckets = new Map();
  groups.forEach(g => {
    buckets.set("id:" + g.id, { key: "id:" + g.id, group: g, name: g.name || "گرووپی بێ ناو", all: [] });
  });

  allChannels.forEach(channel => {
    const resolved = resolveChannelGroup(channel, groups);
    let key, name, extra = null;
    if (resolved) {
      key = "id:" + resolved.id;
    } else {
      const raw = String(channel.group || channel.groupName || channel.group_name || "").trim();
      const norm = normalizeGroupMatch(raw);
      key = "none";
      name = "بێ گرووپ (بۆ ئەپ نانێردرێت)";
      if (!buckets.has(key)) {
        buckets.set(key, { key: key, group: null, name: name, rawName: "__unassigned__", all: [] });
      }
    }
    buckets.get(key).all.push(channel);
  });

  function sectionLabel(bucket) {
    if (bucket.group) {
      const sec = (db.sections || []).find(x => String(x.id) === String(bucket.group.sectionId || ""));
      return sec ? sec.name : (bucket.group.section || "");
    }
    return "";
  }

  function makeChannelRow(channel) {
    const row = document.createElement("div");
    row.className = "channel-row";

    const name = document.createElement("strong");
    name.textContent = channel.name || "بێ ناو";

    const info = document.createElement("div");
    info.className = "small";
    info.textContent = channel.url || "";

    const edit = document.createElement("button");
    edit.textContent = "دەستکاری";
    edit.onclick = () => editChannel(channel.id);

    const del = document.createElement("button");
    del.textContent = "سڕینەوە";
    del.className = "danger";
    del.onclick = () => deleteChannel(channel.id);

    row.append(name, info, edit, del);
    return row;
  }

  // 2) پیشاندان: هەر گرووپێک کارتێکی جیای خۆی
  const ordered = Array.from(buckets.values()).filter(b => b.group || b.all.length);

  ordered.forEach(bucket => {
    const visible = bucket.all.filter(c =>
      !search || String(c.name || "").toLowerCase().includes(search)
    );
    if (search && !visible.length) return;

    const card = document.createElement("div");
    card.className = "group-card";

    const heading = document.createElement("div");
    heading.className = "group-heading";

    const titleBox = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = bucket.name;

    const count = document.createElement("div");
    count.className = "group-section-label";
    const sec = sectionLabel(bucket);
    count.textContent = (sec ? "بەش: " + sec + " — " : "") + "کۆی کەناڵەکان: " + bucket.all.length;
    titleBox.append(title, count);

    const clear = document.createElement("button");
    clear.textContent = "سڕینەوەی هەموو کەناڵەکانی ئەم گرووپە";
    clear.className = "delete-group";
    clear.disabled = bucket.all.length === 0;
    clear.onclick = () => {
      if (bucket.group) {
        deleteGroupChannels(bucket.group.id, bucket.name, bucket.all.length);
      } else {
        deleteGroupChannels("", bucket.name, bucket.all.length, bucket.rawName ? bucket.rawName : "__none__");
      }
    };

    heading.append(titleBox, clear);
    card.appendChild(heading);

    const body = document.createElement("div");
    body.className = "group-channels";

    if (visible.length) {
      visible.forEach(channel => body.appendChild(makeChannelRow(channel)));
    } else {
      const empty = document.createElement("div");
      empty.className = "empty-note";
      empty.textContent = "هیچ کەناڵێک لەم گرووپەدا نییە";
      body.appendChild(empty);
    }

    card.appendChild(body);
    list.appendChild(card);
  });

  if (!list.children.length) {
    const empty = document.createElement("div");
    empty.className = "empty-note";
    empty.textContent = "هیچ کەناڵێک نەدۆزرایەوە";
    list.appendChild(empty);
  }
}


async function saveChannel() {
  const id = document.getElementById("editingChannel").value;

  const data = {
    id: id || undefined,
    name: document.getElementById("channelName").value.trim(),
    url: document.getElementById("channelUrl").value.trim(),
    logo: document.getElementById("channelLogo").value.trim(),
    sectionId: "",
    groupId: document.getElementById("channelGroup").value
  };

  if (!data.name || !data.url) {
    alert("ناوی کەناڵ و لینک پێویستن");
    return;
  }

  try {
    await api("/api/admin/channels", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(data)
    });

    clearChannelForm();
    await loadDB();
  } catch (e) {
    alert(e.message);
  }
}

function editChannel(id) {
  const c = db.channels.find(x => x.id === id);
  if (!c) return;

  document.getElementById("editingChannel").value = c.id;
  document.getElementById("channelName").value = c.name || "";
  document.getElementById("channelUrl").value = c.url || "";
  document.getElementById("channelLogo").value = c.logo || "";
  document.getElementById("channelGroup").value = c.groupId || "";

  showTab("channelsTab", document.querySelector(".tabs button"));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function clearChannelForm() {
  ["editingChannel", "channelName", "channelUrl", "channelLogo"].forEach(id => {
    document.getElementById(id).value = "";
  });
}

async function deleteChannel(id) {
  if (!confirm("ئایا دڵنیایت لە سڕینەوەی ئەم کەناڵە؟")) return;

  try {
    await api("/api/admin/channels?id=" + encodeURIComponent(id), {
      method: "DELETE"
    });
    await loadDB();
  } catch (e) {
    alert(e.message);
  }
}

async function deleteGroupChannels(groupId, groupName, channelCount, nameKey) {
  if (!channelCount) return;
  const confirmed = confirm(
    "ئاگاداری: هەموو کەناڵەکانی ئەم گرووپە بە یەکجار دەسڕدرێنەوە.\\n\\n" +
    "گرووپ: " + (groupName || "بێ ناو") + "\\n" +
    "ژمارەی کەناڵەکان: " + channelCount + "\\n\\n" +
    "خۆی گرووپەکە دەمێنێتەوە. دڵنیایت؟"
  );
  if (!confirmed) return;
  try {
    const query = groupId ? "groupId=" + encodeURIComponent(groupId) : "groupName=" + encodeURIComponent(nameKey || "__none__");
    const result = await api("/api/admin/group-channels?" + query, {
      method: "DELETE"
    });
    await loadDB();
    alert("هەموو کەناڵەکانی گرووپەکە سڕدرانەوە: " + Number(result.deletedChannels || 0));
  } catch (e) {
    alert("سڕینەوە سەرکەوتوو نەبوو: " + e.message);
  }
}

function showImportFileName() {
  const f = document.getElementById("importFile").files[0];
  document.getElementById("importFileName").textContent = f ? "فایلی هەڵبژێردراو: " + f.name : "";
}

function readFileText(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () { resolve(String(reader.result || "")); };
    reader.onerror = function () { reject(new Error("خوێندنەوەی فایلەکە سەرکەوتوو نەبوو")); };
    reader.readAsText(file);
  });
}

async function importChannels() {
  const fileInput = document.getElementById("importFile");
  const file = fileInput.files && fileInput.files[0];
  let content = document.getElementById("importText").value;

  try {
    if (file) content = await readFileText(file);

    if (!content || !content.trim()) {
      alert("فایلێک هەڵبژێرە یان لیستەکە لە خانەی پەیستکردن دابنێ");
      return;
    }

    message("importMessage", "هاوردەکردن بەردەوامە...");

    const result = await api("/api/admin/import", {
      method: "POST",
      body: JSON.stringify({
        content: content,
        defaultGroup: document.getElementById("defaultGroup").value,
        forceGroup: document.getElementById("forceGroup").checked
      })
    });

    const nl = String.fromCharCode(10);
    let text = "زیادکرا: " + result.count + " کەناڵ";
    if (result.duplicates) text += nl + "دووبارە (پێشتر هەبوو): " + result.duplicates;
    if (result.skipped) {
      text += nl + "نەهێنران چونکە گرووپەکەیان نەدۆزرایەوە: " + result.skipped;
      text += nl + "گرووپە نەدۆزراوەکان: " + (result.unmatchedGroups || []).map(function (g) {
        return g.name + " (" + g.count + ")";
      }).join("، ");
    }

    const box = document.getElementById("importMessage");
    box.style.whiteSpace = "pre-line";
    message("importMessage", text);

    fileInput.value = "";
    document.getElementById("importText").value = "";
    document.getElementById("importFileName").textContent = "";
    await loadDB();

  } catch (e) {
    message("importMessage", e.message);
  }
}

function clearGroupForm() {
  document.getElementById("groupName").value = "";
  document.getElementById("editingGroup").value = "";
  document.getElementById("parentGroup").value = "";
}

async function saveGroup() {
  const id = document.getElementById("editingGroup").value;

  const data = {
    id: id || undefined,
    name: document.getElementById("groupName").value.trim(),
    sectionId: document.getElementById("groupSection").value,
    parentId: document.getElementById("parentGroup").value
  };

  if (!data.name) {
    alert("ناوی گرووپ بنووسە");
    return;
  }

  try {
    await api("/api/admin/groups", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(data)
    });

    clearGroupForm();
    await loadDB();

  } catch (e) {
    alert(e.message);
  }
}

/*
 * هەر گرووپێک بە کارتی سەربەخۆ پیشان دەدرێت.
 * ژێرگرووپەکانیش لە لیستی سەرەکی جیاواز دەردەکەون؛
 * کەناڵەکان تەنها لە کارتی گرووپی خۆیان پیشان دەدرێن.
 */
function renderGroups() {
  const list = document.getElementById("groupList");
  list.innerHTML = "";

  const groups = db.groups || [];
  const channels = db.channels || [];

  function groupChannels(group) {
    return channels.filter(channel => {
      const resolved = resolveChannelGroup(channel, groups);
      return !!resolved && String(resolved.id) === String(group.id);
    });
  }

  function makeChannelRow(channel) {
    const row = document.createElement("div");
    row.className = "channel-row";

    const title = document.createElement("strong");
    title.textContent = channel.name || "بێ ناو";

    const info = document.createElement("div");
    info.className = "small";
    info.textContent = channel.url || "";

    const edit = document.createElement("button");
    edit.textContent = "دەستکاری کەناڵ";
    edit.onclick = () => editChannel(channel.id);

    const del = document.createElement("button");
    del.textContent = "سڕینەوە";
    del.className = "danger";
    del.onclick = () => deleteChannel(channel.id);

    row.append(title, info, edit, del);
    return row;
  }

  groups.forEach(group => {
    const ownChannels = groupChannels(group);
    const card = document.createElement("div");
    card.className = "group-card";

    const heading = document.createElement("div");
    heading.className = "group-heading";

    const titleBox = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = group.name || "گرووپی بێ ناو";
    titleBox.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "group-section-label";
    meta.textContent = "گرووپی جێگیر — هاوتای ئەپ";
    titleBox.appendChild(meta);

    const buttons = document.createElement("div");
    buttons.className = "group-actions";

    const clear = document.createElement("button");
    clear.textContent = "سڕینەوەی هەموو کەناڵەکانی ئەم گرووپە";
    clear.className = "delete-group";
    clear.disabled = ownChannels.length === 0;
    clear.onclick = () =>
      deleteGroupChannels(group.id, group.name, ownChannels.length);

    buttons.append(clear);
    heading.append(titleBox, buttons);
    card.appendChild(heading);

    const channelBox = document.createElement("div");
    channelBox.className = "group-channels";

    const channelTitle = document.createElement("div");
    channelTitle.className = "small";
    channelTitle.textContent = "کەناڵەکانی ئەم گرووپە: " + ownChannels.length;
    channelBox.appendChild(channelTitle);

    if (ownChannels.length) {
      ownChannels.forEach(channel => channelBox.appendChild(makeChannelRow(channel)));
    } else {
      const empty = document.createElement("div");
      empty.className = "empty-note";
      empty.textContent = "هیچ کەناڵێک لەم گرووپەدا نییە";
      channelBox.appendChild(empty);
    }

    card.appendChild(channelBox);
    list.appendChild(card);
  });

  if (!groups.length) {
    const empty = document.createElement("div");
    empty.className = "empty-note";
    empty.textContent = "هیچ گرووپێک زیاد نەکراوە";
    list.appendChild(empty);
  }
}


/*
 * پێش سڕینەوە:
 * - تەنها کەناڵەکانی ئەم گرووپە ژماردەکرێن.
 * - ژێرگرووپەکان دەپارێزرێن و سەربەخۆ دەبن.
 * - دڵنیایی لە بەکارهێنەر وەردەگیرێت.
 */
async function deleteGroup(id) {
  const target = db.groups.find(g => String(g.id) === String(id));
  if (!target) {
    alert("گرووپ نەدۆزرایەوە");
    return;
  }

  const affectedChannels = db.channels.filter(c => {
    if (c.groupId) return String(c.groupId) === String(id);
    const sameName = String(c.group || "").trim() === String(target.name || "").trim();
    const sameSection = String(c.sectionId || "") === String(target.sectionId || "");
    const duplicates = db.groups.filter(g =>
      String(g.name || "").trim() === String(target.name || "").trim() &&
      String(g.sectionId || "") === String(target.sectionId || "")
    );
    return !c.groupId && sameName && sameSection && duplicates.length === 1;
  });

  const childrenCount = db.groups.filter(g => String(g.parentId || "") === String(id)).length;
  const confirmed = confirm(
    "ئاگاداری: تەنها ئەم گرووپە و کەناڵەکانی دەسڕدرێنەوە.\\n" +
    "ژێرگرووپەکان ناسڕدرێنەوە و دەبنە گرووپی سەربەخۆ.\\n\\n" +
    "گرووپ: " + (target.name || "بێ ناو") + "\\n" +
    "کەناڵەکان: " + affectedChannels.length + "\\n" +
    "ژێرگرووپە پارێزراوەکان: " + childrenCount + "\\n\\n" +
    "دڵنیایت لە سڕینەوە؟"
  );
  if (!confirmed) return;

  try {
    const result = await api(
      "/api/admin/groups?id=" + encodeURIComponent(id),
      { method: "DELETE" }
    );
    await loadDB();
    alert(
      "سڕینەوە بە سەرکەوتوویی تەواو بوو.\\n" +
      "گرووپ: " + (result.deletedGroups ?? 1) + "\\n" +
      "کەناڵەکان: " + (result.deletedChannels ?? affectedChannels.length) + "\\n" +
      "ژێرگرووپە پارێزراوەکان: " + (result.preservedChildren ?? childrenCount)
    );
  } catch (e) {
    alert("سڕینەوە سەرکەوتوو نەبوو: " + e.message);
  }
}

async function saveSection() {
  const id = document.getElementById("editingSection").value;
  const name = document.getElementById("sectionName").value.trim();

  if (!name) {
    alert("ناوی بەش بنووسە");
    return;
  }

  try {
    await api("/api/admin/sections", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify({ id, name })
    });

    document.getElementById("sectionName").value = "";
    document.getElementById("editingSection").value = "";
    await loadDB();

  } catch (e) {
    alert(e.message);
  }
}

function renderSections() {
  const list = document.getElementById("sectionList");
  list.innerHTML = "";

  db.sections.forEach(s => {
    const div = document.createElement("div");
    div.className = "item";

    const name = document.createElement("strong");
    name.textContent = s.name;

    const edit = document.createElement("button");
    edit.textContent = "دەستکاری";
    edit.onclick = () => {
      document.getElementById("editingSection").value = s.id;
      document.getElementById("sectionName").value = s.name;
    };

    const del = document.createElement("button");
    del.textContent = "سڕینەوە";
    del.className = "danger";
    del.onclick = () => deleteSection(s.id);

    div.append(name, edit, del);
    list.appendChild(div);
  });
}

async function deleteSection(id) {
  if (!confirm("ئەم بەشە و گرووپ و کەناڵە پەیوەندیدارەکانی بسڕدرێنەوە؟")) return;

  try {
    await api("/api/admin/sections?id=" + encodeURIComponent(id), {
      method: "DELETE"
    });
    await loadDB();
  } catch (e) {
    alert(e.message);
  }
}

async function saveDrama() {
  const id = document.getElementById("editingDrama").value;

  const data = {
    id: id || undefined,
    name: document.getElementById("dramaName").value.trim(),
    logo: document.getElementById("dramaLogo").value.trim(),
    description: document.getElementById("dramaDescription").value.trim()
  };

  if (!data.name) {
    alert("ناوی دراما بنووسە");
    return;
  }

  try {
    await api("/api/admin/dramas", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(data)
    });

    document.getElementById("editingDrama").value = "";
    document.getElementById("dramaName").value = "";
    document.getElementById("dramaLogo").value = "";
    document.getElementById("dramaDescription").value = "";

    await loadDB();
  } catch (e) {
    alert(e.message);
  }
}

function renderDramas() {
  const list = document.getElementById("dramaList");
  list.innerHTML = "";

  db.dramas.forEach(d => {
    const div = document.createElement("div");
    div.className = "item";

    const name = document.createElement("strong");
    name.textContent = d.name;

    const meta = document.createElement("div");
    meta.className = "small";
    meta.textContent = "ئەڵقە: " + ((d.episodes || []).length) + " — بینین: " + (d.views || 0);

    const edit = document.createElement("button");
    edit.textContent = "دەستکاری";
    edit.onclick = () => {
      document.getElementById("editingDrama").value = d.id;
      document.getElementById("dramaName").value = d.name || "";
      document.getElementById("dramaLogo").value = d.logo || "";
      document.getElementById("dramaDescription").value = d.description || "";
    };

    const del = document.createElement("button");
    del.textContent = "سڕینەوە";
    del.className = "danger";
    del.onclick = () => deleteDrama(d.id);

    div.append(name, meta, edit, del);
    list.appendChild(div);
  });
}

async function deleteDrama(id) {
  if (!confirm("ئەم دراما و ئەڵقەکانی بسڕدرێنەوە؟")) return;

  try {
    await api("/api/admin/dramas?id=" + encodeURIComponent(id), {
      method: "DELETE"
    });
    await loadDB();
  } catch (e) {
    alert(e.message);
  }
}

async function saveEpisode() {
  const editingId = document.getElementById("editingEpisode").value;
  const data = {
    id: editingId || undefined,
    dramaId: document.getElementById("episodeDrama").value,
    name: document.getElementById("episodeName").value.trim(),
    number: Number(document.getElementById("episodeNumber").value || 1),
    url: document.getElementById("episodeUrl").value.trim(),
    logo: document.getElementById("episodeLogo").value.trim()
  };

  if (!data.dramaId || !data.name || !data.url) {
    alert("دراما، ناوی ئەڵقە و لینک پێویستن");
    return;
  }

  try {
    await api("/api/admin/episodes", {
      method: editingId ? "PUT" : "POST",
      body: JSON.stringify(data)
    });

    clearEpisodeForm();
    await loadDB();
  } catch (e) {
    alert(e.message);
  }
}

function clearEpisodeForm() {
  document.getElementById("editingEpisode").value = "";
  document.getElementById("episodeName").value = "";
  document.getElementById("episodeNumber").value = "";
  document.getElementById("episodeUrl").value = "";
  document.getElementById("episodeLogo").value = "";
  document.getElementById("saveEpisodeBtn").textContent = "زیادکردنی ئەڵقە";
}

function editEpisode(dramaId, episodeId) {
  const drama = db.dramas.find(x => String(x.id) === String(dramaId));
  const episode = drama && (drama.episodes || []).find(x => String(x.id) === String(episodeId));
  if (!drama || !episode || String(episode.dramaId || drama.id) !== String(drama.id)) return;
  document.getElementById("episodeDrama").value = drama.id;
  document.getElementById("editingEpisode").value = episode.id;
  document.getElementById("episodeName").value = episode.name || "";
  document.getElementById("episodeNumber").value = episode.number || 1;
  document.getElementById("episodeUrl").value = episode.url || "";
  document.getElementById("episodeLogo").value = episode.logo || "";
  document.getElementById("saveEpisodeBtn").textContent = "نوێکردنەوەی ئەڵقە";
  document.getElementById("episodeName").focus();
}

function renderEpisodes() {
  const list = document.getElementById("episodeList");
  list.innerHTML = "";

  db.dramas.forEach(d => {
    (d.episodes || []).forEach(ep => {
      const div = document.createElement("div");
      div.className = "item";

      const name = document.createElement("strong");
      name.textContent = d.name + " — " + ep.name;

      const edit = document.createElement("button");
      edit.textContent = "دەستکاری";
      edit.onclick = () => editEpisode(d.id, ep.id);

      const del = document.createElement("button");
      del.textContent = "سڕینەوە";
      del.className = "danger";
      del.onclick = () => deleteEpisode(d.id, ep.id);

      div.append(name, edit, del);
      list.appendChild(div);
    });
  });
}

async function deleteEpisode(dramaId, episodeId) {
  if (!confirm("ئەم ئەڵقەیە بسڕدرێتەوە؟")) return;

  try {
    await api(
      "/api/admin/episodes?id=" + encodeURIComponent(episodeId) +
      "&dramaId=" + encodeURIComponent(dramaId),
      { method: "DELETE" }
    );

    await loadDB();
  } catch (e) {
    alert(e.message);
  }
}

window.addEventListener("load", async () => {
  const saved = localStorage.getItem("jivara_admin_token");

  if (!saved) return;

  token = saved;

  try {
    await api("/api/admin/verify", { method: "POST" });

    document.getElementById("loginPanel").classList.add("hidden");
    document.getElementById("dashboard").classList.remove("hidden");

    await refreshAll();
  } catch {
    token = "";
    localStorage.removeItem("jivara_admin_token");
  }
});
</script>
</body>
</html>`;
}

async function handleRequest(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (path === "/" && method === "GET") {
    return json({
      service: "JIVARA TV API",
      status: "online"
    });
  }

  if (path === "/admin" && method === "GET") {
    return html(adminPage());
  }

  if (path === "/download" && method === "GET") {
    const cfg = await readConfig(env);
    return Response.redirect(cfg.apkUrl || APK_URL, 302);
  }

  if (path === "/api/app-config" && method === "GET") {
    const cfg = await readConfig(env);
    return json({ ...cfg, apkUrl: cfg.apkUrl || APK_URL, downloadPage: url.origin + "/download" });
  }

  // یەک داواکاری بۆ هەموو شتێک: داتای ئەپ + بینەری ئێستا (کەمترین بەکارهێنان)
  if (path === "/api/app-data" && method === "GET") {
    const deviceId = String(url.searchParams.get("d") || "");
    const clientVersion = String(url.searchParams.get("v") || "");
    if (/^[a-zA-Z0-9-]{20,80}$/.test(deviceId)) {
      try { await touchPresence(env, deviceId); } catch {}
    }

    const [dbData, cfg, adMeta, bundleMeta] = await Promise.all([readDBCached(env), readConfigCached(env), readAdCached(env), readBundleMetaCached(env)]);
    const views = await getViewsMap(env, dbData.dramas.map(d => String(d.id || "")));
    let active = 0;
    try { active = await getActive(env); } catch {}

    const version = dataVersionOf(dbData);
    const common = {
      dataVersion: version,
      config: { ...cfg, apkUrl: cfg.apkUrl || APK_URL, downloadPage: url.origin + "/download" },
      ad: publicAd(adMeta, url.origin),
      bundle: bundleMeta ? { seq: Number(bundleMeta.seq) || 0, size: Number(bundleMeta.size) || 0 } : null,
      active: Math.max(active, 1)
    };

    // ئەگەر لیستەکان نەگۆڕدرابێن: تەنها وەڵامێکی زۆر بچووک (~١KB) دەنێرین، نەک هەموو لیستەکە
    if (clientVersion && clientVersion === version) {
      const viewsObj = {};
      for (const d of dbData.dramas) viewsObj[String(d.id || "")] = views.get(String(d.id || "")) || 0;
      return json({ unchanged: true, views: viewsObj, ...common });
    }

    const dramas = dbData.dramas.map(drama => ({
      id: String(drama.id || ""),
      name: String(drama.name || ""),
      poster: String(drama.logo || drama.poster || ""),
      views: views.get(String(drama.id || "")) || 0,
      episodes: (drama.episodes || []).map(episode => ({
        ...episode,
        id: String(episode.id || ""),
        dramaId: String(drama.id || episode.dramaId || ""),
        number: Number(episode.number || 1),
        name: String(episode.name || ""),
        url: String(episode.url || "")
      }))
    }));

    return json({
      sections: dbData.sections,
      groups: dbData.groups,
      channels: slimChannels(dbData.channels),
      dramas: { groups: [{ id: "jivara-dramas", name: "دراماکان", dramas }] },
      ...common
    });
  }

  if (path === "/api/app-bundle" && method === "GET") {
    let b = null;
    try { b = await env.CHANNELS.get(BUNDLE_KEY, "json"); } catch {}
    if (!b || !b.html) return json({ error: "نوێکردنەوە نییە" }, 404);
    return json({ seq: Number(b.seq) || 0, html: String(b.html) });
  }

  if (path === "/api/ad" && method === "GET") {
    return json(publicAd(await readAd(env), url.origin));
  }

  // ڤیدیۆی ڕیکلام (پشتگیری Range بۆ پێشخستن)
  if (path === "/ad/video" && (method === "GET" || method === "HEAD")) {
    const meta = await readAdCached(env);
    if (!meta || !(Number(meta.chunks) > 0)) {
      return new Response("Not found", { status: 404, headers: cors });
    }

    const total = Number(meta.size);
    const chunkSize = Number(meta.chunkSize) || AD_CHUNK;
    const chunks = Number(meta.chunks);
    const base = {
      ...cors,
      "Content-Type": String(meta.type || "video/mp4"),
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Expose-Headers": "Content-Range, Accept-Ranges, Content-Length"
    };

    const range = request.headers.get("Range");

    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (m && (m[1] !== "" || m[2] !== "")) {
        let start, end;
        if (m[1] === "") {
          start = Math.max(0, total - Number(m[2]));
          end = total - 1;
        } else {
          start = Number(m[1]);
          end = m[2] === "" ? total - 1 : Math.min(Number(m[2]), total - 1);
        }
        if (start >= total || start > end) {
          return new Response(null, { status: 416, headers: { ...base, "Content-Range": "bytes */" + total } });
        }
        // هەر وەڵامێک تەنها لە یەک بەشی KV دەخوێنێتەوە (کەمترین بەکارهێنان)
        const ci = Math.floor(start / chunkSize);
        end = Math.min(end, (ci + 1) * chunkSize - 1);
        const headers = {
          ...base,
          "Content-Range": "bytes " + start + "-" + end + "/" + total,
          "Content-Length": String(end - start + 1)
        };
        if (method === "HEAD") return new Response(null, { status: 206, headers });
        const buf = await env.CHANNELS.get(adKey(meta.version, ci), "arrayBuffer");
        if (!buf) return new Response("Chunk not ready", { status: 503, headers: { ...cors, "Retry-After": "2" } });
        return new Response(buf.slice(start - ci * chunkSize, end - ci * chunkSize + 1), { status: 206, headers });
      }
    }

    const headers = { ...base, "Content-Length": String(total) };
    if (method === "HEAD") return new Response(null, { status: 200, headers });

    let next = 0;
    const stream = new ReadableStream({
      async pull(controller) {
        if (next >= chunks) { controller.close(); return; }
        const buf = await env.CHANNELS.get(adKey(meta.version, next), "arrayBuffer");
        next++;
        if (!buf) { controller.error(new Error("Missing chunk")); return; }
        controller.enqueue(new Uint8Array(buf));
      }
    });
    return new Response(stream, { status: 200, headers });
  }

  if (path === "/api/presence" && method === "GET") {
    return json({ success: true, active: await getActive(env) });
  }

  if (path === "/api/presence" && method === "POST") {
    const body = await readBody(request);
    const deviceId = String(body.deviceId || "");
    if (/^[a-zA-Z0-9-]{20,80}$/.test(deviceId)) {
      try { await touchPresence(env, deviceId); } catch {}
    }
    return json({ success: true, active: Math.max(await getActive(env), 1) });
  }

  if (path === "/api/admin/verify" && method === "POST") {
    const denied = requireAdmin(request, env);
    if (denied) return denied;
    return json({ success: true });
  }

  if (path === "/api/sections" && method === "GET") {
    const db = await readDB(env);
    return json(db.sections);
  }

  if (path === "/api/groups" && method === "GET") {
    const db = await readDB(env);
    return json(db.groups);
  }

  if (path === "/api/channels" && method === "GET") {
    const db = await readDB(env);
    return json(db.channels);
  }

  if (path === "/api/dramas" && method === "GET") {
    const db = await readDBCached(env);
    const viewsMap = await getViewsMap(env, db.dramas.map(d => String(d.id || "")));
    const dramas = db.dramas.map(drama => ({
      id: String(drama.id || ""),
      name: String(drama.name || ""),
      poster: String(drama.logo || drama.poster || ""),
      views: viewsMap.get(String(drama.id || "")) || 0,
      episodes: (drama.episodes || []).map(episode => ({
        ...episode,
        id: String(episode.id || ""),
        dramaId: String(drama.id || episode.dramaId || ""),
        number: Number(episode.number || 1),
        name: String(episode.name || ""),
        url: String(episode.url || "")
      }))
    }));
    return json({
      groups: [{
        id: "jivara-dramas",
        name: "دراماکان",
        dramas
      }]
    });
  }

  // Public count: one view is recorded whenever a viewer starts an episode.
  if (path.startsWith("/api/dramas/") && path.endsWith("/view") && method === "POST") {
    const dramaId = decodeURIComponent(path.slice("/api/dramas/".length, -"/view".length));
    if (!dramaId) return json({ error: "Drama ID پێویستە" }, 400);
    const dbForView = await readDBCached(env);
    if (!dbForView.dramas.some(d => String(d.id) === dramaId)) {
      return json({ error: "دراما نەدۆزرایەوە" }, 404);
    }
    const views = await addView(env, dramaId);
    return json({ success: true, views });
  }

  if (path.startsWith("/api/admin/")) {
    const denied = requireAdmin(request, env);
    if (denied) return denied;
  }

  if (path === "/api/admin/data" && method === "GET") {
    const dbData = await readDB(env);
    mem.views.at = 0;
    const viewsMap = await getViewsMap(env, dbData.dramas.map(d => String(d.id || "")));
    const dramas = dbData.dramas.map(d => ({ ...d, views: viewsMap.get(String(d.id || "")) || 0 }));
    return json({ ...dbData, dramas });
  }

  if (path === "/api/admin/bundle" && method === "GET") {
    let meta = null;
    try { meta = await env.CHANNELS.get(BUNDLE_META_KEY, "json"); } catch {}
    return json(meta || { seq: 0, size: 0 });
  }

  if (path === "/api/admin/bundle" && method === "PUT") {
    const html = await request.text();
    if (html.length < 50000 || html.length > BUNDLE_MAX) {
      return json({ error: "فایلەکە گونجاو نییە (قەبارە)" }, 400);
    }
    const m = /<meta name="jivara-bundle" content="(\d+)">/.exec(html);
    if (!m || html.indexOf('id="playerScreen"') < 0 || html.indexOf("</html>") < 0) {
      return json({ error: "ئەمە فایلی نوێکردنەوەی ئەپ نییە. فایلی app_bundle.html هەڵبژێرە" }, 400);
    }
    const seq = Number(m[1]);
    let old = null;
    try { old = await env.CHANNELS.get(BUNDLE_META_KEY, "json"); } catch {}
    if (old && seq <= Number(old.seq) && url.searchParams.get("force") !== "1") {
      return json({ error: "ئەم وەشانە نوێتر نییە لەو وەشانەی پێشتر بڵاوکراوەتەوە" }, 409);
    }

    // بەشی دەستپێکردنی ناو APK لە وەشانی داگیراودا پێویست نییە
    const stripped = html.replace(/<!--OTA-LOADER-START-->[\s\S]*?<!--OTA-LOADER-END-->/, "");
    const at = new Date().toISOString();
    await env.CHANNELS.put(BUNDLE_KEY, JSON.stringify({ seq, html: stripped, at }));
    await env.CHANNELS.put(BUNDLE_META_KEY, JSON.stringify({ seq, size: stripped.length, at }));
    mem.bundle.at = 0;
    return json({ success: true, seq, size: stripped.length });
  }

  if (path === "/api/admin/bundle" && method === "DELETE") {
    try { await env.CHANNELS.delete(BUNDLE_KEY); } catch {}
    try { await env.CHANNELS.delete(BUNDLE_META_KEY); } catch {}
    mem.bundle.at = 0;
    return json({ success: true });
  }

  if (path === "/api/admin/ad" && method === "GET") {
    const meta = await readAd(env);
    return json(publicAd(meta, url.origin));
  }

  if (path === "/api/admin/ad/chunk" && method === "PUT") {
    const v = String(url.searchParams.get("v") || "");
    const i = Number(url.searchParams.get("i"));
    if (!/^\d{10,16}$/.test(v) || !Number.isInteger(i) || i < 0 || i > 40) {
      return json({ error: "داواکاری نادروستە" }, 400);
    }
    const buf = await request.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > 6 * 1024 * 1024) {
      return json({ error: "قەبارەی بەشی ڤیدیۆ نادروستە" }, 400);
    }
    await env.CHANNELS.put(adKey(v, i), buf);
    return json({ success: true });
  }

  if (path === "/api/admin/ad/abort" && method === "POST") {
    const body = await readBody(request);
    const v = String(body.version || "");
    const n = Math.min(Number(body.chunks) || 0, 41);
    if (/^\d{10,16}$/.test(v)) {
      for (let i = 0; i < n; i++) { try { await env.CHANNELS.delete(adKey(v, i)); } catch {} }
    }
    return json({ success: true });
  }

  if (path === "/api/admin/ad/finish" && method === "POST") {
    const body = await readBody(request);
    const version = String(body.version || "");
    const chunks = Math.floor(Number(body.chunks) || 0);
    const size = Math.floor(Number(body.size) || 0);
    const chunkSize = Math.floor(Number(body.chunkSize) || AD_CHUNK);
    const duration = Number(body.duration) || 0;

    if (duration > AD_MAX_SECONDS + 1) {
      // بەشە بارکراوەکان دەسڕدرێنەوە تا شتی بێ سوود نەمێنێتەوە
      if (/^\d{10,16}$/.test(version)) {
        for (let i = 0; i < Math.min(chunks, 41); i++) { try { await env.CHANNELS.delete(adKey(version, i)); } catch {} }
      }
      return json({ error: "درێژی ڤیدیۆی ڕیکلام دەبێت ١:٣٠ خولەک (٩٠ چرکە) یان کەمتر بێت" }, 400);
    }

    if (!/^\d{10,16}$/.test(version) || chunks < 1 || chunks > 41 ||
        size < 1 || size > AD_MAX_SIZE || chunkSize < 65536 || chunkSize > 6 * 1024 * 1024 ||
        Math.ceil(size / chunkSize) !== chunks) {
      return json({ error: "زانیاری ڤیدیۆ نادروستە" }, 400);
    }

    const last = await env.CHANNELS.get(adKey(version, chunks - 1), "arrayBuffer");
    if (!last) return json({ error: "بەشەکانی ڤیدیۆ تەواو بار نەکراون" }, 400);

    const old = await readAd(env);
    const type = String(body.type || "");
    const meta = {
      title: String(body.title || "").trim().slice(0, 160),
      text: String(body.text || "").trim().slice(0, 4000),
      version,
      chunks,
      chunkSize,
      size,
      duration: Math.round(duration * 10) / 10,
      type: type.startsWith("video/") ? type : "video/mp4",
      updatedAt: new Date().toISOString()
    };
    await writeAd(env, meta);

    if (old && old.version && old.version !== version) {
      for (let i = 0; i < Number(old.chunks || 0); i++) {
        try { await env.CHANNELS.delete(adKey(old.version, i)); } catch {}
      }
    }
    return json({ success: true, ad: publicAd(meta, url.origin) });
  }

  if (path === "/api/admin/ad" && method === "PUT") {
    const body = await readBody(request);
    const old = (await readAd(env)) || {};
    const meta = {
      ...old,
      title: String(body.title || "").trim().slice(0, 160),
      text: String(body.text || "").trim().slice(0, 4000),
      updatedAt: new Date().toISOString()
    };
    await writeAd(env, meta);
    return json({ success: true, ad: publicAd(meta, url.origin) });
  }

  if (path === "/api/admin/ad" && method === "DELETE") {
    const old = await readAd(env);
    if (old && old.version) {
      for (let i = 0; i < Number(old.chunks || 0); i++) {
        try { await env.CHANNELS.delete(adKey(old.version, i)); } catch {}
      }
    }
    await removeAd(env);
    return json({ success: true });
  }

  if (path === "/api/admin/app-config" && method === "GET") {
    return json(await readConfig(env));
  }

  if (path === "/api/admin/app-config" && method === "PUT") {
    const body = await readBody(request);
    const apkUrl = String(body.apkUrl || "").trim();
    if (apkUrl && !/^https?:\/\//i.test(apkUrl)) {
      return json({ error: "لینکی APK دەبێت بە http:// یان https:// دەست پێ بکات" }, 400);
    }
    const cfg = {
      apkUrl,
      latestVersionName: String(body.latestVersionName || "").trim().slice(0, 40),
      latestVersionCode: Math.max(0, Math.floor(Number(body.latestVersionCode) || 0)),
      updateMessage: String(body.updateMessage || "").trim().slice(0, 500),
      announcement: String(body.announcement || "").trim().slice(0, 600)
    };
    await env.CHANNELS.put(CONFIG_KEY, JSON.stringify(cfg));
    mem.cfg.at = 0;
    return json({ success: true, config: cfg });
  }

  if (path === "/api/admin/stats" && method === "GET") {
    const stats = await getStats(env);
    return json({ ...stats, active: await getActive(env) });
  }

  if (path === "/api/admin/channels" && method === "POST") {
    const body = await readBody(request);
    const db = await readDB(env);

    if (!body.name || !body.url) {
      return json({ error: "ناو و لینک پێویستن" }, 400);
    }

    const group = db.groups.find(x => x.id === body.groupId);
    if (!group) {
      return json({ error: "گرووپێک لە ١٦ گرووپەکەی ئەپ هەڵبژێرە" }, 400);
    }

    db.channels.push({
      id: uid(),
      name: String(body.name),
      url: String(body.url),
      logo: String(body.logo || ""),
      sectionId: "",
      section: "",
      groupId: group.id,
      group: group.name
    });

    await saveDB(env, db);
    return json({ success: true });
  }

  if (path === "/api/admin/channels" && method === "PUT") {
    const body = await readBody(request);
    const db = await readDB(env);
    const channel = db.channels.find(x => x.id === body.id);

    if (!channel) return json({ error: "کەناڵ نەدۆزرایەوە" }, 404);

    const group = db.groups.find(x => x.id === body.groupId);
    if (!group) {
      return json({ error: "گرووپێک لە ١٦ گرووپەکەی ئەپ هەڵبژێرە" }, 400);
    }

    Object.assign(channel, {
      name: String(body.name || channel.name),
      url: String(body.url || channel.url),
      logo: String(body.logo || ""),
      sectionId: "",
      section: "",
      groupId: group.id,
      group: group.name
    });

    await saveDB(env, db);
    return json({ success: true });
  }

  if (path === "/api/admin/channels" && method === "DELETE") {
    const id = url.searchParams.get("id");
    const db = await readDB(env);
    const before = db.channels.length;

    db.channels = db.channels.filter(x => x.id !== id);

    if (before === db.channels.length) {
      return json({ error: "کەناڵ نەدۆزرایەوە" }, 404);
    }

    await saveDB(env, db);
    return json({ success: true });
  }

  if (path === "/api/admin/group-channels" && method === "DELETE") {
    const groupId = url.searchParams.get("groupId") || "";
    const groupName = url.searchParams.get("groupName") || "";
    if (!groupId && !groupName) {
      return json({ error: "Group ID یان ناوی گرووپ پێویستە" }, 400);
    }

    const db = await readDB(env);
    const before = db.channels.length;

    if (groupId) {
      const target = db.groups.find(g => String(g.id) === String(groupId));
      if (!target) return json({ error: "گرووپ نەدۆزرایەوە" }, 404);

      db.channels = db.channels.filter(channel => {
        const resolved = resolveChannelGroup(channel, db.groups);
        return !resolved || String(resolved.id) !== String(groupId);
      });
    } else {
      // گرووپی بێ تۆمار: تەنها بە ناو (یان بێ ناو) دەسڕدرێتەوە
      if (groupName === "__unassigned__") {
        db.channels = db.channels.filter(channel => !!resolveChannelGroup(channel, db.groups));
      } else {
        const wanted = groupName === "__none__" ? "" : normGroup(groupName);
        db.channels = db.channels.filter(channel => {
          if (resolveChannelGroup(channel, db.groups)) return true;
          return normGroup(channel.group || channel.groupName || "") !== wanted;
        });
      }
    }

    const deletedChannels = before - db.channels.length;
    if (deletedChannels) await saveDB(env, db);

    return json({ success: true, deletedChannels, groupPreserved: true });
  }


  /*
   * هاوردەکردن:
   * تەنها بۆ ١٦ گرووپە جێگیرەکەی ئەپ. ناوی گرووپی هەر کەناڵێک (group-title) بە ناوی
   * گرووپەکان دەدۆزرێتەوە. هیچ گرووپێکی نوێ دروست ناکرێت و کەناڵی بێ گرووپی هاوتا
   * ناهێنرێن (لە ئەنجامەکەدا نیشان دەدرێن). لینکی دووبارە لە هەمان گرووپدا زیاد ناکرێت.
   */
  if (path === "/api/admin/import" && method === "POST") {
    const body = await readBody(request);
    const db = await readDB(env);

    const defaultGroup = FIXED_GROUPS.find(g => g.id === String(body.defaultGroup || "")) ||
      matchFixedGroup(body.defaultGroup);
    const force = !!body.forceGroup;

    if (force && !defaultGroup) {
      return json({ error: "بۆ ناردنی هەموو کەناڵەکان بۆ یەک گرووپ، گرووپەکە هەڵبژێرە" }, 400);
    }

    const imported = parseImport(body.content, defaultGroup ? defaultGroup.name : "");

    const existing = new Set(db.channels.map(c =>
      String(c.groupId || "") + "|" + String(c.url || "").trim()
    ));

    const accepted = [];
    const unmatched = new Map();
    let duplicates = 0;

    for (const c of imported) {
      const label = String(c.group || "").trim();
      const group = force ? defaultGroup : matchFixedGroup(label);

      if (!group) {
        const key = label || "(بێ گرووپ)";
        unmatched.set(key, (unmatched.get(key) || 0) + 1);
        continue;
      }

      const dupKey = group.id + "|" + String(c.url || "").trim();
      if (existing.has(dupKey)) {
        duplicates++;
        continue;
      }
      existing.add(dupKey);

      c.group = group.name;
      c.groupId = group.id;
      c.sectionId = "";
      c.section = "";
      accepted.push(c);
    }

    if (accepted.length) {
      db.channels.push(...accepted);
      await saveDB(env, db);
    }

    return json({
      success: true,
      count: accepted.length,
      duplicates,
      skipped: imported.length - accepted.length - duplicates,
      unmatchedGroups: [...unmatched.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((x, y) => y.count - x.count)
        .slice(0, 40)
    });
  }

  if (path === "/api/admin/groups" && method !== "GET") {
    return json({ error: "گرووپەکان جێگیرن (١٦ گرووپی ئەپ) و ناتوانرێن زیاد، دەستکاری یان بسڕدرێنەوە" }, 403);
  }

  if (path === "/api/admin/groups" && method === "POST") {
    const body = await readBody(request);
    const db = await readDB(env);

    if (!body.name) return json({ error: "ناوی گرووپ پێویستە" }, 400);

    const section = db.sections.find(x => x.id === body.sectionId);

    db.groups.push({
      id: uid(),
      name: String(body.name),
      sectionId: body.sectionId || "",
      section: section ? section.name : "",
      parentId: body.parentId || ""
    });

    await saveDB(env, db);
    return json({ success: true });
  }

  if (path === "/api/admin/groups" && method === "PUT") {
    const body = await readBody(request);
    const db = await readDB(env);
    const group = db.groups.find(x => x.id === body.id);

    if (!group) return json({ error: "گرووپ نەدۆزرایەوە" }, 404);

    const section = db.sections.find(x => x.id === body.sectionId);

    Object.assign(group, {
      name: String(body.name || group.name),
      sectionId: body.sectionId || "",
      section: section ? section.name : "",
      parentId: body.parentId || ""
    });

    await saveDB(env, db);
    return json({ success: true });
  }

  /*
   * سڕینەوەی تەنها یەک گرووپ:
   * ژێرگرووپەکان دەپارێزرێن و parentId ـیان پاک دەکرێتەوە.
   * کەناڵەکان بە groupId دەناسێنرێن؛ بۆ داتای کۆنیش ناو + sectionId.
   */
  if (path === "/api/admin/groups" && method === "DELETE") {
    const id = url.searchParams.get("id");
    if (!id) return json({ error: "Group ID پێویستە" }, 400);

    const db = await readDB(env);
    const target = db.groups.find(g => String(g.id) === String(id));
    if (!target) return json({ error: "گرووپ نەدۆزرایەوە" }, 404);

    const duplicateGroups = db.groups.filter(g =>
      String(g.name || "").trim() === String(target.name || "").trim() &&
      String(g.sectionId || "") === String(target.sectionId || "")
    );
    const canMatchLegacy = duplicateGroups.length === 1;
    const beforeChannels = db.channels.length;

    db.channels = db.channels.filter(channel => {
      if (channel.groupId) return String(channel.groupId) !== String(id);
      if (!canMatchLegacy) return true;
      return !(
        String(channel.group || "").trim() === String(target.name || "").trim() &&
        String(channel.sectionId || "") === String(target.sectionId || "")
      );
    });

    let preservedChildren = 0;
    for (const group of db.groups) {
      if (String(group.parentId || "") === String(id)) {
        group.parentId = "";
        preservedChildren++;
      }
    }

    db.groups = db.groups.filter(g => String(g.id) !== String(id));
    const deletedChannels = beforeChannels - db.channels.length;

    await saveDB(env, db);
    return json({
      success: true,
      deletedGroups: 1,
      deletedChannels,
      preservedChildren
    });
  }

  if (path === "/api/admin/sections" && method === "POST") {
    const body = await readBody(request);
    const db = await readDB(env);

    if (!body.name) return json({ error: "ناوی بەش پێویستە" }, 400);

    db.sections.push({
      id: uid(),
      name: String(body.name)
    });

    await saveDB(env, db);
    return json({ success: true });
  }

  if (path === "/api/admin/sections" && method === "PUT") {
    const body = await readBody(request);
    const db = await readDB(env);
    const section = db.sections.find(x => x.id === body.id);

    if (!section) return json({ error: "بەش نەدۆزرایەوە" }, 404);

    section.name = String(body.name || section.name);

    for (const g of db.groups) {
      if (g.sectionId === section.id) g.section = section.name;
    }

    for (const c of db.channels) {
      if (c.sectionId === section.id) c.section = section.name;
    }

    await saveDB(env, db);
    return json({ success: true });
  }

  if (path === "/api/admin/sections" && method === "DELETE") {
    const id = url.searchParams.get("id");
    const db = await readDB(env);

    db.sections = db.sections.filter(x => x.id !== id);
    db.groups = db.groups.filter(x => x.sectionId !== id);
    db.channels = db.channels.filter(x => x.sectionId !== id);

    await saveDB(env, db);
    return json({ success: true });
  }

  if (path === "/api/admin/dramas" && method === "POST") {
    const body = await readBody(request);
    const db = await readDB(env);

    if (!body.name) return json({ error: "ناوی دراما پێویستە" }, 400);

    db.dramas.push({
      id: uid(),
      name: String(body.name),
      logo: String(body.logo || ""),
      description: String(body.description || ""),
      episodes: []
    });

    await saveDB(env, db);
    return json({ success: true });
  }

  if (path === "/api/admin/dramas" && method === "PUT") {
    const body = await readBody(request);
    const db = await readDB(env);
    const drama = db.dramas.find(x => x.id === body.id);

    if (!drama) return json({ error: "دراما نەدۆزرایەوە" }, 404);

    drama.name = String(body.name || drama.name);
    drama.logo = String(body.logo || "");
    drama.description = String(body.description || "");

    await saveDB(env, db);
    return json({ success: true });
  }

  if (path === "/api/admin/dramas" && method === "DELETE") {
    const id = url.searchParams.get("id");
    const db = await readDB(env);

    db.dramas = db.dramas.filter(x => x.id !== id);

    await saveDB(env, db);
    try { await removeViews(env, String(id || "")); } catch {}
    return json({ success: true });
  }

  if (path === "/api/admin/episodes" && method === "POST") {
    const body = await readBody(request);
    const db = await readDB(env);

    const drama = db.dramas.find(x => x.id === body.dramaId);
    if (!drama) return json({ error: "دراما نەدۆزرایەوە" }, 404);

    if (!body.name || !body.url) {
      return json({ error: "ناوی ئەڵقە و لینک پێویستن" }, 400);
    }

    if (!Array.isArray(drama.episodes)) drama.episodes = [];

    drama.episodes.push({
      id: uid(),
      dramaId: String(drama.id),
      name: String(body.name),
      number: Number(body.number || 1),
      url: String(body.url),
      logo: String(body.logo || "")
    });

    await saveDB(env, db);
    return json({ success: true });
  }

  if (path === "/api/admin/episodes" && method === "PUT") {
    const body = await readBody(request);
    const db = await readDB(env);
    const drama = db.dramas.find(x => String(x.id) === String(body.dramaId || ""));
    if (!drama) return json({ error: "دراما نەدۆزرایەوە" }, 404);

    const episode = (drama.episodes || []).find(x => String(x.id) === String(body.id || ""));
    if (!episode || String(episode.dramaId || drama.id) !== String(drama.id)) {
      return json({ error: "ئەڵقە لەو درامایەدا نەدۆزرایەوە" }, 404);
    }
    if (!body.name || !body.url) {
      return json({ error: "ناوی ئەڵقە و لینک پێویستن" }, 400);
    }

    Object.assign(episode, {
      dramaId: String(drama.id),
      name: String(body.name),
      number: Math.max(1, Number(body.number) || 1),
      url: String(body.url),
      logo: String(body.logo || "")
    });

    await saveDB(env, db);
    return json({ success: true });
  }

  if (path === "/api/admin/episodes" && method === "DELETE") {
    const dramaId = url.searchParams.get("dramaId");
    const episodeId = url.searchParams.get("id");

    const db = await readDB(env);
    const drama = db.dramas.find(x => x.id === dramaId);

    if (!drama) return json({ error: "دراما نەدۆزرایەوە" }, 404);

    const before = (drama.episodes || []).length;
    drama.episodes = (drama.episodes || []).filter(x => x.id !== episodeId);
    if (drama.episodes.length === before) {
      return json({ error: "ئەڵقە نەدۆزرایەوە" }, 404);
    }

    await saveDB(env, db);
    return json({ success: true });
  }

  return json({ error: "Not Found" }, 404);
}

export default {
  async fetch(request, env) {
    try {
      if (!env.CHANNELS) {
        return json({
          error: "KV binding CHANNELS is missing"
        }, 500);
      }

      return await handleRequest(request, env);

    } catch (error) {
      return json({
        success: false,
        error: error.message || "Internal Server Error"
      }, 500);
    }
  }
};