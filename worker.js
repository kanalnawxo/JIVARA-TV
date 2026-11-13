const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store"
};

const APK_URL = "https://github.com/kanalnawxo/JIVARA-TV/releases/download/v1.0.2/JIVARA_TV_native_splash.apk";
const DB_KEY = "channels";
const STATS_KEY = "presence_stats";
const PRESENCE_PREFIX = "presence_device_";
const PRESENCE_TTL = 360;          // چرکە: ئامێر دوای ٦ خولەک بێ پەیوەندی بە چالاک نابژمێردرێت
let activeCache = { value: 0, at: 0 };

async function countActive(env, maxAgeMs = 30000) {
  const now = Date.now();
  if (now - activeCache.at < maxAgeMs) return activeCache.value;
  let count = 0;
  let cursor;
  try {
    do {
      const page = await env.CHANNELS.list({ prefix: PRESENCE_PREFIX, cursor });
      count += page.keys.length;
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    activeCache = { value: count, at: now };
  } catch {
    return activeCache.value;
  }
  return count;
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
  if (Array.isArray(data)) {
    return { sections: [], groups: [], channels: data, dramas: [] };
  }

  if (!data || typeof data !== "object") data = {};

  return {
    sections: Array.isArray(data.sections) ? data.sections : [],
    groups: Array.isArray(data.groups) ? data.groups : [],
    channels: Array.isArray(data.channels) ? data.channels : [],
    dramas: Array.isArray(data.dramas) ? data.dramas.map(drama => ({
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

function parseImport(content, defaultGroup = "کوردی") {
  // TXT ـی هەڵگیراو بە UTF-16/BOM و CRLF ـیش بە دروستی بخوێنەوە.
  const normalizedContent = String(content || "")
    .replace(/^\uFEFF/, "")
    .replace(/\u0000/g, "");
  const lines = normalizedContent.split(/\r\n|\n|\r/);
  const result = [];
  let current = null;

  for (const raw of lines) {
    const line = raw.replace(/^\uFEFF/, "").trim();
    if (!line) continue;

    if (/^#EXTINF\b/i.test(line)) {
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
        url: ""
      };
      continue;
    }

    if (line.startsWith("#")) continue;

    if (current) {
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

async function updatePresence(env) {
  try {
    const old = await env.CHANNELS.get(STATS_KEY, "json") || {};
    const today = new Date().toISOString().slice(0, 10);

    const stats = {
      total: Number(old.total || 0) + 1,
      today: Number(old.today || 0),
      date: old.date || today,
      lastSeen: new Date().toISOString()
    };

    if (stats.date !== today) {
      stats.today = 1;
      stats.date = today;
    } else {
      stats.today += 1;
    }

    await env.CHANNELS.put(STATS_KEY, JSON.stringify(stats));
    return stats;
  } catch {
    return null;
  }
}

async function getStats(env) {
  try {
    return await env.CHANNELS.get(STATS_KEY, "json") || {
      total: 0,
      today: 0,
      date: "",
      lastSeen: ""
    };
  } catch {
    return {
      total: 0,
      today: 0,
      date: "",
      lastSeen: "",
      unavailable: true
    };
  }
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
    <button data-tab="true" onclick="showTab('channelsTab',this)" class="active">کەناڵەکان</button>
    <button data-tab="true" onclick="showTab('groupsTab',this)">گرووپەکان</button>
    <button data-tab="true" onclick="showTab('sectionsTab',this)">بەشەکان</button>
    <button data-tab="true" onclick="showTab('dramasTab',this)">دراما و ئەڵقەکان</button>
    <button data-tab="true" onclick="showTab('statsTab',this)">ئامار</button>
    <button type="button" class="secondary" onclick="addGroupFromTabs()">＋ زیادکردنی گرووپ</button>
    <input id="deleteGroupName" type="text" placeholder="ناوی گرووپ بۆ سڕینەوە" aria-label="ناوی گرووپ بۆ سڕینەوە" style="width:220px;max-width:100%;margin:5px">
    <button type="button" class="danger" onclick="deleteGroupByName()">− سڕینەوەی گرووپ</button>
  </div>

  <section id="channelsTab">
    <div class="panel">
      <h2>زیادکردنی کەناڵ</h2>
      <input id="channelName" placeholder="ناوی کەناڵ">
      <input id="channelUrl" placeholder="لینکی کەناڵ">
      <input id="channelLogo" placeholder="لینکی لۆگۆ">
      <select id="channelSection"></select>
      <select id="channelGroup"></select>
      <button onclick="saveChannel()">زیادکردن / نوێکردنەوە</button>
      <button class="secondary" onclick="clearChannelForm()">پاککردنەوەی خانەکان</button>
      <input id="editingChannel" type="hidden">
    </div>

    <div class="panel">
      <h2>هاوردەکردنی کەناڵ</h2>
      <label>فایلی M3U / M3U8 / TXT</label>
      <input id="importFile" type="file" accept=".m3u,.m3u8,.txt" style="display:none" onchange="showSelectedImportFile()">
      <button type="button" onclick="document.getElementById('importFile').click()">📁 هەڵبژاردنی فایل</button>
      <div id="selectedImportFile" class="small">هیچ فایلێک هەڵنەبژێردراوە</div>
      <input id="defaultGroup" placeholder="گرووپی بنەڕەتی">
      <select id="importSection"></select>
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
      <h2>بەڕێوەبردنی گرووپەکان</h2>
      <input id="groupName" placeholder="ناوی گرووپ">
      <select id="groupSection"></select>
      <select id="parentGroup"></select>
      <button onclick="saveGroup()">زیادکردنی گرووپ</button>
      <button class="secondary" onclick="clearGroupForm()">پاککردنەوە</button>
      <input id="editingGroup" type="hidden">
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

  <section id="statsTab" class="hidden">
    <div class="panel">
      <h2>ئاماری بەکارهێنان</h2>
      <p>کۆی سەردان: <span id="statsTotal">0</span></p>
      <p>سەردانی ئەمڕۆ: <span id="statsToday">0</span></p>
      <p>دوایین سەردان: <span id="statsLast">-</span></p>
    </div>
  </section>

</div>
</div>

<script>
let token = "";
let selectedImportFile = null;
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

async function refreshAll() {
  const results = await Promise.allSettled([
    loadDB(),
    loadStats()
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

  document.querySelectorAll(".tabs button[data-tab='true']").forEach(x => x.classList.remove("active"));
  button.classList.add("active");
}

async function addGroupFromTabs() {
  const name = prompt("ناوی گرووپی نوێ بنووسە:");
  if (name === null) return;
  const cleanName = name.trim();
  if (!cleanName) {
    alert("ناوی گرووپ پێویستە");
    return;
  }

  try {
    await api("/api/admin/groups", {
      method: "POST",
      body: JSON.stringify({ name: cleanName, sectionId: "", parentId: "" })
    });
    await loadDB();
    alert("گرووپ بە سەرکەوتوویی زیادکرا");
  } catch (e) {
    alert("زیادکردنی گرووپ سەرکەوتوو نەبوو: " + e.message);
  }
}

async function deleteGroupByName() {
  const input = document.getElementById("deleteGroupName");
  const typedName = String(input && input.value || "").trim();

  if (!typedName) {
    alert("تکایە ناوی ئەو گرووپە بنووسە کە دەتەوێت بیسڕیتەوە");
    if (input) input.focus();
    return;
  }

  const wanted = normalizeGroupMatch(typedName);
  const matches = (db.groups || []).filter(group =>
    normalizeGroupMatch(group.name || "") === wanted
  );

  if (!matches.length) {
    alert("گرووپێک بەو ناوە نەدۆزرایەوە. ناوی گرووپەکە بە وردی بپشکنە.");
    return;
  }

  if (matches.length > 1) {
    alert("زیاتر لە یەک گرووپ بەو ناوە هەیە. تکایە ناوی گرووپەکان لە بەشی گرووپەکان جیا بکەرەوە، پاشان هەوڵ بدەرەوە.");
    return;
  }

  const target = matches[0];
  if (isProtectedBuiltinGroup(target)) {
    alert("گرووپی بنەڕەتی ناتوانرێت بسڕدرێتەوە");
    return;
  }

  await deleteGroup(target.id);
  if (input) input.value = "";
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
  fillSelect("importSection", db.sections);
  fillSelect("groupSection", db.sections);
  fillSelect("channelGroup", db.groups);
  fillSelect("parentGroup", db.groups);
  fillSelect("episodeDrama", db.dramas, false);

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
      key = norm ? "name:" + norm : "none";
      name = raw || "بێ گرووپ";
      if (!buckets.has(key)) {
        buckets.set(key, { key: key, group: null, name: name, rawName: raw, all: [] });
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
    sectionId: document.getElementById("channelSection").value,
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
  document.getElementById("channelSection").value = c.sectionId || "";
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

function showSelectedImportFile() {
  const input = document.getElementById("importFile");
  const display = document.getElementById("selectedImportFile");
  selectedImportFile = input && input.files && input.files.length ? input.files[0] : null;
  if (display) {
    display.textContent = selectedImportFile
      ? "فایلی هەڵبژێردراو: " + selectedImportFile.name
      : "هیچ فایلێک هەڵنەبژێردراوە";
  }
}

async function importChannels() {
  const input = document.getElementById("importFile");
  const file = selectedImportFile || (input && input.files && input.files.length ? input.files[0] : null);

  if (!file) {
    alert("فایلێک هەڵبژێرە");
    return;
  }

  try {
    // دیاریکردنی UTF-8 و UTF-16 بەپێی BOM ـی فایل.
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let encoding = "utf-8";
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) encoding = "utf-16le";
    else if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) encoding = "utf-16be";
    const content = new TextDecoder(encoding).decode(buffer).replace(/^\\uFEFF/, "");

    const result = await api("/api/admin/import", {
      method: "POST",
      body: JSON.stringify({
        content,
        defaultGroup: document.getElementById("defaultGroup").value.trim() || "کوردی",
        sectionId: document.getElementById("importSection").value
      })
    });

    const missingGroups = Object.entries(result.skippedGroups || {})
      .map(([name, count]) => name + " (" + count + ")").join("، ");
    let importSummary = "زیادکرا: " + Number(result.count || 0) + " کەناڵ";
    if (result.skipped) importSummary += "؛ هاوردە نەکرا: " + result.skipped + (missingGroups ? "؛ گرووپی نەدۆزراوە: " + missingGroups : "");
    else importSummary = "بە سەرکەوتوویی " + result.count + " کەناڵ زیادکرا";
    message("importMessage", importSummary);
    document.getElementById("importFile").value = "";
    selectedImportFile = null;
    const selectedFileLabel = document.getElementById("selectedImportFile");
    if (selectedFileLabel) selectedFileLabel.textContent = "";
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
function isProtectedBuiltinGroup(group) {
  const id = String(group && group.id || "").trim().toLowerCase();
  return id === "local" || id === "kurdish";
}

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

    const section = (db.sections || []).find(x =>
      String(x.id) === String(group.sectionId || "")
    );
    const meta = document.createElement("div");
    meta.className = "group-section-label";
    const parent = groups.find(x =>
      String(x.id) === String(group.parentId || "")
    );
    meta.textContent = "بەش: " +
      (section ? section.name : (group.section || "دیاری نەکراو")) +
      (parent ? " | ژێرگرووپی: " + parent.name : " | گرووپی سەرەکی");
    titleBox.appendChild(meta);

    const buttons = document.createElement("div");
    buttons.className = "group-actions";

    const clear = document.createElement("button");
    clear.textContent = "سڕینەوەی هەموو کەناڵەکانی ئەم گرووپە";
    clear.className = "delete-group";
    clear.disabled = ownChannels.length === 0;
    clear.onclick = () =>
      deleteGroupChannels(group.id, group.name, ownChannels.length);

    const edit = document.createElement("button");
    edit.textContent = "دەستکاری گرووپ";
    edit.onclick = () => {
      document.getElementById("editingGroup").value = group.id;
      document.getElementById("groupName").value = group.name || "";
      document.getElementById("groupSection").value = group.sectionId || "";
      document.getElementById("parentGroup").value = group.parentId || "";
      window.scrollTo({ top: 0, behavior: "smooth" });
    };

    const del = document.createElement("button");
    del.textContent = isProtectedBuiltinGroup(group)
      ? "گرووپی بنەڕەتی (پارێزراوە)"
      : "سڕینەوەی ئەم گرووپە";
    del.className = "delete-group";
    del.disabled = isProtectedBuiltinGroup(group);
    del.title = del.disabled ? "گرووپی بنەڕەتی ناسڕدرێتەوە" : "سڕینەوەی گرووپ و کەناڵەکانی";
    del.onclick = () => deleteGroup(group.id);

    buttons.append(clear, edit, del);
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
  if (isProtectedBuiltinGroup(target)) {
    alert("گرووپی بنەڕەتی ناتوانرێت بسڕدرێتەوە");
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

    div.append(name, edit, del);
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
    return Response.redirect(APK_URL, 302);
  }

  if (path === "/api/presence" && method === "GET") {
    return json({ success: true, active: await countActive(env) });
  }

  if (path === "/api/presence" && method === "POST") {
    const body = await readBody(request);
    const deviceId = String(body.deviceId || "");
    let active = await countActive(env);

    if (/^[a-zA-Z0-9-]{20,80}$/.test(deviceId)) {
      const key = PRESENCE_PREFIX + deviceId;
      const existing = await env.CHANNELS.get(key);
      const fresh = existing && Date.now() - Number(existing) < 60000;

      if (!fresh) {
        await env.CHANNELS.put(key, String(Date.now()), { expirationTtl: PRESENCE_TTL });
      }

      if (!existing) {
        // کردنەوەی نوێی ئەپ: تەنها جارێک بۆ هەر session دەژمێردرێت
        await updatePresence(env);
        active += 1;
        activeCache = { value: active, at: activeCache.at || Date.now() };
      }
    }

    return json({ success: true, active: Math.max(active, 1) });
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
    const db = await readDB(env);
    const dramas = await Promise.all(db.dramas.map(async drama => ({
      id: String(drama.id || ""),
      name: String(drama.name || ""),
      poster: String(drama.logo || drama.poster || ""),
      views: Number(await env.CHANNELS.get("drama_views_" + String(drama.id || ""))) || 0,
      episodes: (drama.episodes || []).map(episode => ({
        ...episode,
        id: String(episode.id || ""),
        dramaId: String(drama.id || episode.dramaId || ""),
        number: Number(episode.number || 1),
        name: String(episode.name || ""),
        url: String(episode.url || "")
      }))
    })));
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
    const dbForView = await readDB(env);
    if (!dbForView.dramas.some(d => String(d.id) === dramaId)) {
      return json({ error: "دراما نەدۆزرایەوە" }, 404);
    }
    const key = "drama_views_" + dramaId;
    const current = Number(await env.CHANNELS.get(key)) || 0;
    const views = current + 1;
    await env.CHANNELS.put(key, String(views));
    return json({ success: true, views });
  }

  if (path.startsWith("/api/admin/")) {
    const denied = requireAdmin(request, env);
    if (denied) return denied;
  }

  if (path === "/api/admin/data" && method === "GET") {
    return json(await readDB(env));
  }

  if (path === "/api/admin/stats" && method === "GET") {
    const stats = await getStats(env);
    return json({ ...stats, active: await countActive(env) });
  }

  if (path === "/api/admin/channels" && method === "POST") {
    const body = await readBody(request);
    const db = await readDB(env);

    if (!body.name || !body.url) {
      return json({ error: "ناو و لینک پێویستن" }, 400);
    }

    const section = db.sections.find(x => x.id === body.sectionId);
    const group = db.groups.find(x => x.id === body.groupId);

    db.channels.push({
      id: uid(),
      name: String(body.name),
      url: String(body.url),
      logo: String(body.logo || ""),
      sectionId: body.sectionId || "",
      section: section ? section.name : "",
      groupId: body.groupId || "",
      group: group ? group.name : (body.group || "")
    });

    await saveDB(env, db);
    return json({ success: true });
  }

  if (path === "/api/admin/channels" && method === "PUT") {
    const body = await readBody(request);
    const db = await readDB(env);
    const channel = db.channels.find(x => x.id === body.id);

    if (!channel) return json({ error: "کەناڵ نەدۆزرایەوە" }, 404);

    const section = db.sections.find(x => x.id === body.sectionId);
    const group = db.groups.find(x => x.id === body.groupId);

    Object.assign(channel, {
      name: String(body.name || channel.name),
      url: String(body.url || channel.url),
      logo: String(body.logo || ""),
      sectionId: body.sectionId || "",
      section: section ? section.name : "",
      groupId: body.groupId || "",
      group: group ? group.name : ""
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
      const wanted = groupName === "__none__" ? "" : normGroup(groupName);
      db.channels = db.channels.filter(channel => {
        if (resolveChannelGroup(channel, db.groups)) return true;
        return normGroup(channel.group || channel.groupName || "") !== wanted;
      });
    }

    const deletedChannels = before - db.channels.length;
    if (deletedChannels) await saveDB(env, db);

    return json({ success: true, deletedChannels, groupPreserved: true });
  }


  /*
   * هاوردەکردن:
   * هیچ گرووپێکی نوێ دروست ناکرێت.
   * تەنها کەناڵی ئەو گرووپانە زیاد دەکرێت کە پێشتر
   * بە هەمان ناو لە db.groups هەن؛ ناوی گرووپ بە تەنها
   * پێوەرە و sectionId نابێتە هۆی دروستکردنی گرووپی دووبارە.
   */
  if (path === "/api/admin/import" && method === "POST") {
    const body = await readBody(request);
    const db = await readDB(env);

    const parsed = parseImport(body.content, body.defaultGroup || "کوردی");
    const sectionId = body.sectionId || "";
    const imported = [];
    let skipped = 0;
    const skippedGroups = {};

    for (const c of parsed) {
      // ناوی بەتاڵ لە فایلدا بە گرووپی بنەڕەتیی هەڵبژێردراو دەگۆڕدرێت.
      const groupName = String(c.group || body.defaultGroup || "کوردی").trim() || "کوردی";
      const wantedName = normGroup(groupName);

      // هەندێک playlist ناوی LOCAL بە "ناوخۆ" دەنووسێت؛
      // گرووپی پێشتر ئامادەکراو بە ID یان ناوی هاوتا بدۆزرێتەوە.
      const aliases = new Set([wantedName]);
      if (wantedName === normGroup("ناوخۆ")) aliases.add("local");
      if (wantedName === "local") aliases.add(normGroup("ناوخۆ"));

      const sameNameGroups = db.groups.filter(x =>
        aliases.has(normGroup(x.name || "")) ||
        aliases.has(normGroup(x.id || ""))
      );

      // ئەگەر چەند گرووپێکی هاوناو هەبن، ئەوەی بەشی هاوردەکردنەکەیە پێشترە.
      const group =
        sameNameGroups.find(x => String(x.sectionId || "") === sectionId) ||
        sameNameGroups[0];

      // گرووپی هاوتا نەدۆزرایەوە: کەناڵەکە زیاد ناکرێت و گرووپیش دروست ناکرێت.
      if (!group) {
        skipped++;
        skippedGroups[groupName] = (skippedGroups[groupName] || 0) + 1;
        continue;
      }

      c.group = group.name;
      c.sectionId = String(group.sectionId || "");
      c.section = String(group.section || "");
      c.groupId = group.id;
      imported.push(c);
    }

    if (imported.length) {
      db.channels.push(...imported);
      await saveDB(env, db);
    }

    return json({
      success: true,
      count: imported.length,
      skipped,
      skippedGroups,
      parsed: parsed.length,
      groupsCreated: 0
    });
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

    const protectedId = String(target.id || "").trim().toLowerCase();
    if (protectedId === "local" || protectedId === "kurdish") {
      return json({ error: "گرووپی بنەڕەتی ناتوانرێت بسڕدرێتەوە" }, 403);
    }

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
