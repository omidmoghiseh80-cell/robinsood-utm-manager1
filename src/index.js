const PATHS = {
  USERS: "data/auth/users.json",
  DEFINITIONS: "data/definitions.json",
  INDEX: "data/record-index.json",
  RECORDS: "data/records",
  XLSX: "exports/utm_history.xlsx"
};

const PERMISSIONS = {
  owner: ["*"],
  marketing: ["utm.create", "utm.view", "utm.export", "definitions.create"],
  technical: ["utm.create", "utm.view", "utm.export", "definitions.create"]
};

const DEF_TYPES = new Set(["campaigns", "sources", "mediums", "contentTypes", "creatives", "audiences"]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    try {
      return await apiRouter(request, env, url);
    } catch (err) {
      if (err?.httpStatus) return json({ error: err.message }, err.httpStatus);
      console.error("Unhandled API error", err);
      return json({ error: "خطای داخلی سرویس." }, 500);
    }
  }
};

async function apiRouter(request, env, url) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  if (url.pathname === "/api/bootstrap-status" && request.method === "GET") {
    const usersFile = await ghReadJson(env, PATHS.USERS, true);
    return json({ needsSetup: !usersFile });
  }

  if (url.pathname === "/api/bootstrap" && request.method === "POST") {
    const existing = await ghReadJson(env, PATHS.USERS, true);
    if (existing) return json({ error: "راه‌اندازی قبلاً انجام شده است." }, 409);

    const body = await requestJson(request);
    if (!(await secureTextEqual(String(body.bootstrapSecret || ""), String(env.BOOTSTRAP_SECRET || "")))) {
      return json({ error: "Bootstrap Secret نادرست است." }, 401);
    }

    const supplied = Array.isArray(body.users) ? body.users : [];
    if (supplied.length !== 3) return json({ error: "دقیقاً سه کاربر باید تعریف شوند." }, 400);

    const roles = new Set(supplied.map(u => u.role));
    if (!roles.has("owner") || !roles.has("marketing") || !roles.has("technical")) {
      return json({ error: "Roleهای owner، marketing و technical لازم هستند." }, 400);
    }

    const usernames = new Set();
    const users = [];
    for (const u of supplied) {
      const username = normalizeUsername(u.username);
      const name = cleanText(u.name, 80);
      const password = String(u.password || "");
      if (!username || !name || password.length < 10) {
        return json({ error: "برای هر کاربر نام، Username معتبر و رمز حداقل ۱۰ کاراکتری لازم است." }, 400);
      }
      if (usernames.has(username)) return json({ error: "Username تکراری است." }, 400);
      usernames.add(username);

      const pass = await hashPassword(password);
      users.push({
        username,
        name,
        role: u.role,
        active: true,
        password: pass,
        createdAt: nowIso(),
        createdBy: "bootstrap"
      });
    }

    const payload = { schemaVersion: 1, users };
    await ghWriteJson(env, PATHS.USERS, payload, null, "Initialize UTM Manager users");
    return json({ ok: true });
  }

  if (url.pathname === "/api/login" && request.method === "POST") {
    const body = await requestJson(request);
    const username = normalizeUsername(body.username);
    const password = String(body.password || "");
    const usersFile = await ghReadJson(env, PATHS.USERS, true);
    if (!usersFile) return json({ error: "سیستم هنوز راه‌اندازی نشده است." }, 409);

    const user = (usersFile.json.users || []).find(u => u.username === username && u.active);
    const valid = user ? await verifyPassword(password, user.password) : false;
    if (!valid) return json({ error: "نام کاربری یا رمز عبور صحیح نیست." }, 401);

    const token = await signSession(env, {
      sub: user.username,
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12
    });

    return json({
      token,
      user: publicUser(user)
    });
  }

  const auth = await authenticate(request, env);
  if (!auth.ok) return auth.response;
  const user = auth.user;

  if (url.pathname === "/api/me" && request.method === "GET") {
    return json({ user: publicUser(user) });
  }

  if (url.pathname === "/api/state" && request.method === "GET") {
    requirePermission(user, "utm.view");
    const [defsFile, indexFile] = await Promise.all([
      ghReadJson(env, PATHS.DEFINITIONS),
      ghReadJson(env, PATHS.INDEX)
    ]);
    const records = await loadAllRecords(env, indexFile.json);
    const payload = {
      me: publicUser(user),
      definitions: defsFile.json,
      records: user.role === "owner" ? records : records.filter(r => r.status !== "deleted")
    };
    if (user.role === "owner") {
      const usersFile = await ghReadJson(env, PATHS.USERS);
      payload.users = (usersFile.json.users || []).map(publicUser);
    }
    return json(payload);
  }

  if (url.pathname === "/api/utm" && request.method === "POST") {
    requirePermission(user, "utm.create");
    const body = await requestJson(request);
    const defsFile = await ghReadJson(env, PATHS.DEFINITIONS);
    const defs = defsFile.json;

    const campaign = findActive(defs.campaigns, body.campaignId);
    const source = findActive(defs.sources, body.sourceId);
    const medium = findActive(defs.mediums, body.mediumId);
    const creative = findActive(defs.creatives, body.creativeId);
    const audience = body.audienceId ? findActive(defs.audiences, body.audienceId) : null;

    if (!campaign || !source || !medium || !creative || (body.audienceId && !audience)) {
      return json({ error: "یکی از گزینه‌های انتخاب‌شده معتبر یا فعال نیست." }, 400);
    }

    let destination;
    try {
      destination = new URL(String(body.destinationUrl || "").trim());
      if (!["http:", "https:"].includes(destination.protocol)) throw new Error("bad scheme");
    } catch {
      return json({ error: "Destination URL معتبر نیست." }, 400);
    }

    const final = new URL(destination.toString());
    final.searchParams.set("utm_source", source.value);
    final.searchParams.set("utm_medium", medium.value);
    final.searchParams.set("utm_campaign", campaign.value);
    final.searchParams.set("utm_content", creative.value);
    if (audience) final.searchParams.set("utm_term", audience.value);
    else final.searchParams.delete("utm_term");

    const createdAt = nowIso();
    const month = createdAt.slice(0, 7);
    const record = {
      id: makeId("UTM"),
      campaign: snapshot(campaign),
      source: snapshot(source),
      medium: snapshot(medium),
      creative: snapshot(creative),
      audience: snapshot(audience),
      destinationUrl: destination.toString(),
      finalUrl: final.toString(),
      placement: cleanText(body.placement, 250),
      publishDate: cleanDate(body.publishDate),
      notes: cleanText(body.notes, 500),
      createdBy: { username: user.username, name: user.name, role: user.role },
      createdAt,
      status: "active",
      archivedAt: null,
      archivedBy: null,
      deletedAt: null,
      deletedBy: null
    };

    await ghMutateJson(
      env,
      `${PATHS.RECORDS}/${month}.json`,
      list => {
        list = Array.isArray(list) ? list : [];
        list.push(record);
        return list;
      },
      `Create ${record.id} by ${user.username}`,
      []
    );

    const indexFile = await ghReadJson(env, PATHS.INDEX);
    if (!(indexFile.json.months || []).includes(month)) {
      await ghMutateJson(
        env,
        PATHS.INDEX,
        data => {
          data ||= { schemaVersion: 1, months: [] };
          data.months ||= [];
          if (!data.months.includes(month)) data.months.push(month);
          data.months.sort();
          return data;
        },
        `Register UTM month ${month}`,
        { schemaVersion: 1, months: [] }
      );
    }

    return json({ record }, 201);
  }

  const defCreateMatch = url.pathname.match(/^\/api\/definitions\/([^/]+)$/);
  if (defCreateMatch && request.method === "POST") {
    requirePermission(user, "definitions.create");
    const type = defCreateMatch[1];
    if (!DEF_TYPES.has(type)) return json({ error: "نوع تعریف نامعتبر است." }, 404);
    const body = await requestJson(request);

    let created;
    await ghMutateJson(
      env,
      PATHS.DEFINITIONS,
      defs => {
        defs[type] ||= [];
        created = buildDefinition(type, body, user, defs);
        if (defs[type].some(x => x.status !== "deleted" && x.value === created.value)) {
          throw httpError(409, "این مقدار قبلاً وجود دارد.");
        }
        defs[type].push(created);
        return defs;
      },
      `Add ${type} by ${user.username}`
    );

    return json({ item: created }, 201);
  }

  const defStatusMatch = url.pathname.match(/^\/api\/definitions\/([^/]+)\/([^/]+)\/status$/);
  if (defStatusMatch && request.method === "POST") {
    requireRole(user, "owner");
    const type = defStatusMatch[1];
    const id = defStatusMatch[2];
    if (!DEF_TYPES.has(type)) return json({ error: "نوع تعریف نامعتبر است." }, 404);
    const body = await requestJson(request);
    const status = body.status;
    if (!["archived", "deleted"].includes(status)) return json({ error: "Status نامعتبر است." }, 400);

    await ghMutateJson(
      env,
      PATHS.DEFINITIONS,
      defs => {
        const item = (defs[type] || []).find(x => x.id === id);
        if (!item) throw httpError(404, "مورد پیدا نشد.");
        item.status = status;
        item[status === "archived" ? "archivedAt" : "deletedAt"] = nowIso();
        item[status === "archived" ? "archivedBy" : "deletedBy"] = user.username;
        return defs;
      },
      `${status} ${type}/${id} by ${user.username}`
    );

    return json({ ok: true });
  }

  const recordStatusMatch = url.pathname.match(/^\/api\/records\/([^/]+)\/status$/);
  if (recordStatusMatch && request.method === "POST") {
    requireRole(user, "owner");
    const id = recordStatusMatch[1];
    const body = await requestJson(request);
    const status = body.status;
    if (!["archived", "deleted"].includes(status)) return json({ error: "Status نامعتبر است." }, 400);

    const indexFile = await ghReadJson(env, PATHS.INDEX);
    const months = [...(indexFile.json.months || [])].reverse();
    let changed = false;

    for (const month of months) {
      const path = `${PATHS.RECORDS}/${month}.json`;
      const file = await ghReadJson(env, path, true);
      if (!file || !Array.isArray(file.json)) continue;
      const hit = file.json.find(x => x.id === id);
      if (!hit) continue;

      await ghMutateJson(
        env,
        path,
        list => {
          const rec = list.find(x => x.id === id);
          rec.status = status;
          rec[status === "archived" ? "archivedAt" : "deletedAt"] = nowIso();
          rec[status === "archived" ? "archivedBy" : "deletedBy"] = user.username;
          return list;
        },
        `${status} ${id} by ${user.username}`
      );
      changed = true;
      break;
    }

    if (!changed) return json({ error: "رکورد پیدا نشد." }, 404);
    return json({ ok: true });
  }

  if (url.pathname === "/api/export/csv" && request.method === "GET") {
    requirePermission(user, "utm.export");
    const indexFile = await ghReadJson(env, PATHS.INDEX);
    let records = await loadAllRecords(env, indexFile.json);
    if (user.role !== "owner") records = records.filter(r => r.status !== "deleted");
    const body = toCsv(records);
    return new Response("\uFEFF" + body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="robinsood_utm_${today()}.csv"`,
        "Cache-Control": "no-store"
      }
    });
  }

  if (url.pathname === "/api/export/xlsx" && request.method === "GET") {
    requirePermission(user, "utm.export");
    const raw = await ghReadRaw(env, PATHS.XLSX, true);
    if (!raw) return json({ error: "فایل Excel هنوز ساخته نشده است." }, 404);
    return new Response(raw, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="robinsood_utm_history.xlsx"',
        "Cache-Control": "no-store"
      }
    });
  }

  if (url.pathname === "/api/users" && request.method === "POST") {
    requireRole(user, "owner");
    const body = await requestJson(request);
    const username = normalizeUsername(body.username);
    const name = cleanText(body.name, 80);
    const role = body.role;
    const password = String(body.password || "");
    if (!username || !name || !["owner", "marketing", "technical"].includes(role) || password.length < 10) {
      return json({ error: "اطلاعات کاربر کامل یا معتبر نیست." }, 400);
    }
    const pass = await hashPassword(password);

    await ghMutateJson(
      env,
      PATHS.USERS,
      data => {
        if ((data.users || []).some(x => x.username === username)) throw httpError(409, "Username قبلاً وجود دارد.");
        data.users.push({
          username, name, role, active: true, password: pass,
          createdAt: nowIso(), createdBy: user.username
        });
        return data;
      },
      `Add app user ${username} by ${user.username}`
    );
    return json({ ok: true }, 201);
  }

  const userToggleMatch = url.pathname.match(/^\/api\/users\/([^/]+)\/toggle$/);
  if (userToggleMatch && request.method === "POST") {
    requireRole(user, "owner");
    const username = normalizeUsername(userToggleMatch[1]);
    if (username === user.username) return json({ error: "نمی‌توانی حساب فعلی خودت را غیرفعال کنی." }, 400);

    await ghMutateJson(
      env,
      PATHS.USERS,
      data => {
        const target = (data.users || []).find(x => x.username === username);
        if (!target) throw httpError(404, "کاربر پیدا نشد.");
        target.active = !target.active;
        target.updatedAt = nowIso();
        target.updatedBy = user.username;
        return data;
      },
      `Toggle app user ${username} by ${user.username}`
    );
    return json({ ok: true });
  }

  const userPasswordMatch = url.pathname.match(/^\/api\/users\/([^/]+)\/password$/);
  if (userPasswordMatch && request.method === "POST") {
    requireRole(user, "owner");
    const username = normalizeUsername(userPasswordMatch[1]);
    const body = await requestJson(request);
    const password = String(body.password || "");
    if (password.length < 10) return json({ error: "رمز جدید باید حداقل ۱۰ کاراکتر باشد." }, 400);
    const pass = await hashPassword(password);

    await ghMutateJson(
      env,
      PATHS.USERS,
      data => {
        const target = (data.users || []).find(x => x.username === username);
        if (!target) throw httpError(404, "کاربر پیدا نشد.");
        target.password = pass;
        target.updatedAt = nowIso();
        target.updatedBy = user.username;
        return data;
      },
      `Reset password for ${username} by ${user.username}`
    );
    return json({ ok: true });
  }

  return json({ error: "مسیر API پیدا نشد." }, 404);
}

async function authenticate(request, env) {
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Bearer ")) return { ok: false, response: json({ error: "نیاز به ورود دارید." }, 401) };
  const token = header.slice(7).trim();
  const payload = await verifySession(env, token);
  if (!payload) return { ok: false, response: json({ error: "Session معتبر نیست یا منقضی شده است." }, 401) };

  const usersFile = await ghReadJson(env, PATHS.USERS, true);
  const user = usersFile?.json?.users?.find(u => u.username === payload.sub && u.active);
  if (!user) return { ok: false, response: json({ error: "حساب کاربری فعال نیست." }, 401) };
  return { ok: true, user };
}

function requireRole(user, role) {
  if (user.role !== role) throw httpError(403, "دسترسی کافی ندارید.");
}

function requirePermission(user, permission) {
  const list = PERMISSIONS[user.role] || [];
  if (!list.includes("*") && !list.includes(permission)) throw httpError(403, "دسترسی کافی ندارید.");
}

function buildDefinition(type, body, user, defs) {
  const createdAt = nowIso();
  if (type === "campaigns") {
    const displayName = cleanText(body.displayName, 120);
    const product = norm(body.product);
    const objective = norm(body.objective);
    const period = norm(body.period);
    const year = norm(body.year);
    if (!displayName || !product || !objective || !period || !year) throw httpError(400, "فیلدهای کمپین کامل نیست.");
    return {
      id: makeId("CMP"),
      displayName,
      value: [product, objective, period, year].join("_"),
      product, objective, period, year,
      startDate: cleanDate(body.startDate),
      endDate: cleanDate(body.endDate),
      status: "active",
      createdBy: user.username,
      createdAt
    };
  }

  if (type === "creatives") {
    const displayName = cleanText(body.displayName, 120);
    const contentType = findActive(defs.contentTypes, body.contentTypeId);
    const version = norm(body.version || "v1") || "v1";
    if (!displayName || !contentType) throw httpError(400, "نام و نوع Creative لازم است.");
    const id = makeId("CR");
    return {
      id,
      displayName,
      value: `${contentType.value}_${id.replace(/-/g, "_").toLowerCase()}_${version}`,
      contentTypeId: contentType.id,
      version,
      notes: cleanText(body.notes, 300),
      status: "active",
      createdBy: user.username,
      createdAt
    };
  }

  const displayName = cleanText(body.displayName, 100);
  const value = norm(body.value || displayName);
  if (!displayName || !value) throw httpError(400, "نام و مقدار معتبر لازم است.");

  const prefix = type === "sources" ? "SRC" :
    type === "mediums" ? "MED" :
    type === "contentTypes" ? "CT" : "AUD";

  return {
    id: makeId(prefix),
    displayName,
    value,
    status: "active",
    createdBy: user.username,
    createdAt
  };
}

async function loadAllRecords(env, index) {
  const months = index?.months || [];
  const files = await Promise.all(months.map(month => ghReadJson(env, `${PATHS.RECORDS}/${month}.json`, true)));
  return files
    .filter(Boolean)
    .flatMap(f => Array.isArray(f.json) ? f.json : [])
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

async function ghRequest(env, path, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}${path}`, {
    ...options,
    headers: {
      "Accept": options.accept || "application/vnd.github+json",
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "RobinSood-UTM-Manager",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const data = await response.json();
      message = data.message || message;
    } catch {}
    const error = new Error(`GitHub ${response.status}: ${message}`);
    error.status = response.status;
    throw error;
  }
  return response;
}

async function ghReadJson(env, path, allow404 = false) {
  try {
    const res = await ghRequest(env, `/contents/${path}?ref=${encodeURIComponent(env.GITHUB_BRANCH || "main")}`);
    const data = await res.json();
    return { sha: data.sha, json: JSON.parse(decodeBase64Utf8(data.content || "")) };
  } catch (err) {
    if (allow404 && err.status === 404) return null;
    throw err;
  }
}

async function ghReadRaw(env, path, allow404 = false) {
  try {
    const res = await ghRequest(env, `/contents/${path}?ref=${encodeURIComponent(env.GITHUB_BRANCH || "main")}`, {
      accept: "application/vnd.github.raw"
    });
    return await res.arrayBuffer();
  } catch (err) {
    if (allow404 && err.status === 404) return null;
    throw err;
  }
}

async function ghWriteJson(env, path, obj, sha, message) {
  const body = {
    message,
    content: encodeBase64Utf8(JSON.stringify(obj, null, 2) + "\n"),
    branch: env.GITHUB_BRANCH || "main"
  };
  if (sha) body.sha = sha;

  const res = await ghRequest(env, `/contents/${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function ghMutateJson(env, path, mutator, message, missingDefault = null, attempts = 5) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const current = await ghReadJson(env, path, true);
      const base = current ? structuredClone(current.json) : structuredClone(missingDefault);
      const next = await mutator(base);
      await ghWriteJson(env, path, next, current?.sha || null, message);
      return next;
    } catch (err) {
      last = err;
      if (![409, 422].includes(err.status) || i === attempts - 1) throw err;
      await sleep(250 * (i + 1));
    }
  }
  throw last;
}

async function requestJson(request) {
  try {
    return await request.json();
  } catch {
    throw httpError(400, "بدنه درخواست JSON معتبر نیست.");
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function httpError(status, message) {
  const error = new Error(message);
  error.httpStatus = status;
  return error;
}

function publicUser(user) {
  return {
    username: user.username,
    name: user.name,
    role: user.role,
    active: !!user.active
  };
}

function findActive(list, id) {
  return (list || []).find(x => x.id === id && x.status === "active") || null;
}

function snapshot(item) {
  return item ? { id: item.id, displayName: item.displayName, value: item.value } : null;
}

function cleanText(value, max = 200) {
  return String(value || "").trim().slice(0, max);
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 50);
}

function norm(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, 100);
}

function cleanDate(value) {
  const s = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function nowIso() {
  return new Date().toISOString();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function makeId(prefix) {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  const stamp = `${String(d.getUTCFullYear()).slice(-2)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const hex = [...bytes].map(x => x.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `${prefix}-${stamp}-${hex}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function encodeBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function decodeBase64Utf8(value) {
  const binary = atob(String(value).replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function bytesToB64Url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64UrlToBytes(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(base64);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 100000;
  const keyMaterial = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial, 256
  );
  return {
    algorithm: "PBKDF2-SHA256",
    iterations,
    salt: bytesToB64Url(salt),
    hash: bytesToB64Url(new Uint8Array(bits))
  };
}

async function verifyPassword(password, stored) {
  if (!stored || stored.algorithm !== "PBKDF2-SHA256") return false;
  const keyMaterial = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: b64UrlToBytes(stored.salt),
      iterations: stored.iterations,
      hash: "SHA-256"
    },
    keyMaterial, 256
  );
  return bytesEqual(new Uint8Array(bits), b64UrlToBytes(stored.hash));
}

async function signSession(env, payload) {
  const header = bytesToB64Url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = bytesToB64Url(new TextEncoder().encode(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000) })));
  const input = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input));
  return `${input}.${bytesToB64Url(new Uint8Array(sig))}`;
}

async function verifySession(env, token) {
  try {
    const [header, body, sig] = token.split(".");
    if (!header || !body || !sig) return null;
    const input = `${header}.${body}`;
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );
    const valid = await crypto.subtle.verify("HMAC", key, b64UrlToBytes(sig), new TextEncoder().encode(input));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64UrlToBytes(body)));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a[i] ^ b[i];
  return result === 0;
}

async function secureTextEqual(a, b) {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(a)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(b))
  ]);
  return bytesEqual(new Uint8Array(ha), new Uint8Array(hb));
}

function csvCell(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(records) {
  const headers = [
    "UTM ID","Campaign ID","Campaign Name","utm_campaign","Source","utm_source","Medium","utm_medium",
    "Creative ID","Creative Name","utm_content","Audience","utm_term","Destination URL","Final URL",
    "Placement","Publish Date","Created By","Username","Created At","Status","Notes"
  ];
  const rows = records.map(r => [
    r.id,
    r.campaign?.id, r.campaign?.displayName, r.campaign?.value,
    r.source?.displayName, r.source?.value,
    r.medium?.displayName, r.medium?.value,
    r.creative?.id, r.creative?.displayName, r.creative?.value,
    r.audience?.displayName, r.audience?.value,
    r.destinationUrl, r.finalUrl, r.placement, r.publishDate,
    r.createdBy?.name, r.createdBy?.username, r.createdAt, r.status, r.notes
  ]);
  return [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n");
}

