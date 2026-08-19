(() => {
"use strict";

const S = {
  token: "",
  me: null,
  defs: null,
  records: [],
  users: [],
  view: "create",
  defType: "campaigns",
  page: 1,
  pageSize: 25
};

const $ = id => document.getElementById(id);
const $$ = (q, r=document) => [...r.querySelectorAll(q)];
const esc = s => String(s ?? "").replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const roleName = r => ({owner:"Owner",marketing:"Marketing",technical:"Technical"}[r] || r);
const localDay = () => {
  const d = new Date(), offset = d.getTimezoneOffset();
  return new Date(d - offset * 60000).toISOString().slice(0,10);
};

function toast(message, type="good") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
function loading(value){ document.body.classList.toggle("loading", !!value); }
function isOwner(){ return S.me?.role === "owner"; }
function canCreateDefinitions(){ return !!S.me; }

async function api(path, options={}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData) && options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  if (S.token) headers.Authorization = `Bearer ${S.token}`;
  const response = await fetch(path, { ...options, headers });
  if (response.status === 401 && path !== "/api/login") {
    clearSession();
    showLogin();
    throw new Error("Session منقضی شده؛ دوباره وارد شو.");
  }
  if (!response.ok) {
    let message = response.statusText;
    try {
      const data = await response.json();
      message = data.error || message;
    } catch {}
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }
  const type = response.headers.get("content-type") || "";
  if (type.includes("application/json")) return response.json();
  return response;
}

async function boot() {
  loading(true);
  try {
    const status = await api("/api/bootstrap-status");
    if (status.needsSetup) {
      $("setupScreen").classList.remove("hidden");
      $("loginScreen").classList.add("hidden");
      return;
    }
    const saved = localStorage.getItem("utm_session") || sessionStorage.getItem("utm_session");
    if (saved) {
      S.token = saved;
      try {
        const me = await api("/api/me");
        S.me = me.user;
        await enterApp();
        return;
      } catch {}
    }
    showLogin();
  } catch (e) {
    $("loginScreen").classList.remove("hidden");
    $("loginError").textContent = `خطا در اتصال به سرویس: ${e.message}`;
    $("loginError").classList.remove("hidden");
  } finally {
    loading(false);
  }
}

async function setup() {
  const users = [
    {
      role:"owner",
      name:$("ownerName").value.trim(),
      username:$("ownerUsername").value.trim(),
      password:$("ownerPassword").value
    },
    {
      role:"marketing",
      name:$("marketingName").value.trim(),
      username:$("marketingUsername").value.trim(),
      password:$("marketingPassword").value
    },
    {
      role:"technical",
      name:$("technicalName").value.trim(),
      username:$("technicalUsername").value.trim(),
      password:$("technicalPassword").value
    }
  ];
  if (users.some(u => !u.name || !u.username || u.password.length < 10)) {
    return setupFail("برای هر سه کاربر نام، نام کاربری و رمز حداقل ۱۰ کاراکتری لازم است.");
  }
  loading(true);
  try {
    await api("/api/bootstrap", {
      method:"POST",
      body:JSON.stringify({
        bootstrapSecret:$("bootstrapSecret").value,
        users
      })
    });
    toast("راه‌اندازی انجام شد. حالا وارد پنل شو.");
    $("setupScreen").classList.add("hidden");
    showLogin();
    $("usernameInput").value = users[0].username;
  } catch (e) {
    setupFail(e.message);
  } finally {
    loading(false);
  }
}
function setupFail(message){
  $("setupError").textContent = message;
  $("setupError").classList.remove("hidden");
}
function showLogin() {
  $("app").classList.add("hidden");
  $("setupScreen").classList.add("hidden");
  $("loginScreen").classList.remove("hidden");
}
async function login() {
  const username = $("usernameInput").value.trim();
  const password = $("passwordInput").value;
  if (!username || !password) return loginFail("نام کاربری و رمز عبور را وارد کن.");
  loading(true);
  try {
    const data = await api("/api/login", {
      method:"POST",
      body:JSON.stringify({username,password})
    });
    S.token = data.token;
    S.me = data.user;
    if ($("rememberSession").checked) localStorage.setItem("utm_session", S.token);
    else sessionStorage.setItem("utm_session", S.token);
    $("loginScreen").classList.add("hidden");
    await enterApp();
  } catch (e) {
    loginFail(e.message);
  } finally {
    loading(false);
  }
}
function loginFail(message) {
  $("loginError").textContent = message;
  $("loginError").classList.remove("hidden");
}
function clearSession() {
  localStorage.removeItem("utm_session");
  sessionStorage.removeItem("utm_session");
  S.token = "";
  S.me = null;
}
function logout() {
  clearSession();
  location.reload();
}

async function enterApp() {
  $("loginScreen").classList.add("hidden");
  $("setupScreen").classList.add("hidden");
  $("app").classList.remove("hidden");
  $("userName").textContent = S.me.name;
  $("userRole").textContent = roleName(S.me.role);
  $("avatar").textContent = (S.me.name || S.me.username).slice(0,1);
  $$(".owner-only").forEach(el => el.classList.toggle("hidden", !isOwner()));
  $("publishDate").value = localDay();
  await refresh();
  show("create");
}

async function refresh() {
  loading(true);
  try {
    const data = await api("/api/state");
    S.me = data.me;
    S.defs = data.definitions;
    S.records = data.records || [];
    S.users = data.users || [];
    fillBuilder();
    fillFilters();
    renderHistory();
    renderDefs();
    renderUsers();
    enhanceDateInputs();
  } catch (e) {
    toast(e.message, "bad");
  } finally {
    loading(false);
  }
}

const META = {
  create:["ساخت UTM","لینک کمپین را استاندارد بساز و ذخیره کن."],
  history:["تاریخچه","تمام لینک‌های ثبت‌شده و وضعیت آن‌ها."],
  definitions:["تعاریف","مدیریت Campaign، Source، Medium، Creative و Audience."],
  exports:["خروجی","داده‌های کمپین را برای تحلیل دریافت کن."],
  users:["کاربران","مدیریت حساب‌های داخلی پنل."]
};
function show(view) {
  if (view === "users" && !isOwner()) return;
  S.view = view;
  $$(".view").forEach(el => el.classList.remove("active"));
  $(`view-${view}`).classList.add("active");
  $$(".nav").forEach(el => el.classList.toggle("active", el.dataset.view === view));
  $("pageTitle").textContent = META[view][0];
  $("pageSubtitle").textContent = META[view][1];
  $("sidebar").classList.remove("open");
  if (view === "history") renderHistory();
  if (view === "definitions") renderDefs();
  if (view === "users") renderUsers();
  requestAnimationFrame(enhanceDateInputs);
}

function def(type, id) {
  return (S.defs?.[type] || []).find(x => x.id === id);
}
function active(type) {
  return (S.defs?.[type] || []).filter(x => x.status === "active");
}
function fillSelect(id, type, label, optional=false) {
  const select = $(id), previous = select.value;
  select.innerHTML = `<option value="">${esc(optional ? label : `${label} را انتخاب کنید`)}</option>` +
    active(type).map(x => `<option value="${esc(x.id)}">${esc(x.displayName)} — ${esc(x.value)}</option>`).join("");
  if ([...select.options].some(o => o.value === previous)) select.value = previous;
}
function fillBuilder() {
  fillSelect("campaign","campaigns","کمپین");
  fillSelect("source","sources","Source");
  fillSelect("medium","mediums","Medium");
  fillSelect("creative","creatives","Creative");
  fillSelect("audience","audiences","بدون Audience",true);
  $$(".plus").forEach(btn => btn.classList.toggle("hidden", !canCreateDefinitions()));
  preview();
}
function fillFilters() {
  [
    ["filterCampaign","campaigns","همه کمپین‌ها"],
    ["filterSource","sources","همه Sourceها"],
    ["filterMedium","mediums","همه Mediumها"]
  ].forEach(([id,type,label]) => {
    const select = $(id), previous = select.value;
    select.innerHTML = `<option value="">${label}</option>` +
      (S.defs?.[type] || []).filter(x => x.status !== "deleted").map(x => `<option value="${esc(x.id)}">${esc(x.displayName)}</option>`).join("");
    if ([...select.options].some(o => o.value === previous)) select.value = previous;
  });
  if (!isOwner()) {
    const deleted = $(`#filterStatus option[value="deleted"]`);
    if (deleted) deleted.remove();
  }
}

function buildPreviewUrl() {
  const destination = $("destination").value.trim();
  if (!destination) return "";
  try {
    const url = new URL(destination);
    const campaign = def("campaigns",$("campaign").value);
    const source = def("sources",$("source").value);
    const medium = def("mediums",$("medium").value);
    const creative = def("creatives",$("creative").value);
    const audience = def("audiences",$("audience").value);
    if (source) url.searchParams.set("utm_source", source.value);
    if (medium) url.searchParams.set("utm_medium", medium.value);
    if (campaign) url.searchParams.set("utm_campaign", campaign.value);
    if (creative) url.searchParams.set("utm_content", creative.value);
    if (audience) url.searchParams.set("utm_term", audience.value);
    else url.searchParams.delete("utm_term");
    return url.toString();
  } catch {
    return "";
  }
}
function preview() {
  const campaign = def("campaigns",$("campaign").value);
  const source = def("sources",$("source").value);
  const medium = def("mediums",$("medium").value);
  const creative = def("creatives",$("creative").value);
  const audience = def("audiences",$("audience").value);
  $("pvCampaign").textContent = campaign?.value || "—";
  $("pvSource").textContent = source?.value || "—";
  $("pvMedium").textContent = medium?.value || "—";
  $("pvContent").textContent = creative?.value || "—";
  $("pvTerm").textContent = audience?.value || "—";
  $("pvUrl").textContent = buildPreviewUrl() || "لینک مقصد را وارد کنید...";
}

async function createUtm(event) {
  event.preventDefault();
  const payload = {
    campaignId:$("campaign").value,
    sourceId:$("source").value,
    mediumId:$("medium").value,
    creativeId:$("creative").value,
    audienceId:$("audience").value || null,
    destinationUrl:$("destination").value.trim(),
    placement:$("placement").value.trim(),
    publishDate:$("publishDate").value || null,
    notes:$("notes").value.trim()
  };
  if (!payload.campaignId || !payload.sourceId || !payload.mediumId || !payload.creativeId || !payload.destinationUrl) {
    return toast("فیلدهای اجباری را کامل کن.", "bad");
  }
  loading(true);
  try {
    const data = await api("/api/utm", {method:"POST", body:JSON.stringify(payload)});
    S.records.unshift(data.record);
    renderHistory();
    createdModal(data.record);
    $("utmForm").reset();
    $("publishDate").value = localDay();
    fillBuilder();
  } catch (e) {
    toast(e.message, "bad");
  } finally {
    loading(false);
  }
}
function createdModal(record) {
  modal("لینک ساخته شد",
    `<div class="identity">شناسه: <b>${esc(record.id)}</b></div>
     <div class="modal-url">${esc(record.finalUrl)}</div>
     <p class="tiny muted">این UTM از این لحظه قابل ویرایش نیست.</p>`,
    [
      ["کپی لینک","primary",async()=>{await navigator.clipboard.writeText(record.finalUrl);toast("لینک کپی شد.")}],
      ["تاریخچه","secondary",()=>{closeModal();show("history")}]
    ]
  );
}

function filtered() {
  let rows = [...S.records];
  const q = $("search").value.trim().toLowerCase();
  const campaign = $("filterCampaign").value;
  const source = $("filterSource").value;
  const medium = $("filterMedium").value;
  const status = $("filterStatus").value;
  const from = $("fromDate").value;
  const to = $("toDate").value;

  if (q) rows = rows.filter(r => [
    r.id,r.campaign?.displayName,r.campaign?.value,r.source?.value,r.medium?.value,
    r.creative?.displayName,r.placement,r.destinationUrl,r.finalUrl,
    r.createdBy?.name,r.createdBy?.username
  ].some(v => String(v || "").toLowerCase().includes(q)));
  if (campaign) rows = rows.filter(r => r.campaign?.id === campaign);
  if (source) rows = rows.filter(r => r.source?.id === source);
  if (medium) rows = rows.filter(r => r.medium?.id === medium);
  if (status) rows = rows.filter(r => r.status === status);
  if (from) rows = rows.filter(r => String(r.createdAt || "").slice(0,10) >= from);
  if (to) rows = rows.filter(r => String(r.createdAt || "").slice(0,10) <= to);

  return rows.sort((a,b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}
function badge(status) {
  return `<span class="status ${esc(status)}">${esc(status)}</span>`;
}
function renderHistory() {
  const rows = filtered();
  const pages = Math.max(1, Math.ceil(rows.length / S.pageSize));
  S.page = Math.min(S.page, pages);
  const start = (S.page - 1) * S.pageSize;
  const pageRows = rows.slice(start, start + S.pageSize);

  $("historyBody").innerHTML = pageRows.length ?
    pageRows.map(r => `<tr data-id="${esc(r.id)}">
      <td class="ltr">${esc(r.id)}</td>
      <td>${esc(r.campaign?.displayName || "—")}</td>
      <td class="ltr">${esc(r.source?.value || "—")}</td>
      <td class="ltr">${esc(r.medium?.value || "—")}</td>
      <td>${esc(r.creative?.displayName || "—")}</td>
      <td>${esc(r.createdBy?.name || r.createdBy?.username || "—")}</td>
      <td class="ltr">${esc(String(r.createdAt || "").replace("T"," ").slice(0,16))}</td>
      <td>${badge(r.status)}</td>
    </tr>`).join("") :
    `<tr><td colspan="8"><div class="empty">رکوردی وجود ندارد.</div></td></tr>`;

  $$(`#historyBody tr[data-id]`).forEach(tr => tr.onclick = () => detailRecord(tr.dataset.id));
  $("pageInfo").textContent = `${S.page} / ${pages} — ${rows.length} رکورد`;
  $("prevPage").disabled = S.page <= 1;
  $("nextPage").disabled = S.page >= pages;
}
function detailRecord(id) {
  const r = S.records.find(x => x.id === id);
  if (!r) return;
  const actions = [
    ["کپی لینک","primary",async()=>{await navigator.clipboard.writeText(r.finalUrl);toast("لینک کپی شد.")}]
  ];
  if (isOwner() && r.status === "active") actions.push(["آرشیو","secondary",()=>changeRecordStatus(r,"archived")]);
  if (isOwner() && r.status !== "deleted") actions.push(["حذف احتیاطی","danger",()=>deleteRecordConfirm(r)]);

  modal(`جزئیات ${r.id}`, `<dl class="details">
    <dt>Campaign</dt><dd>${esc(r.campaign?.value || "—")}</dd>
    <dt>Source</dt><dd>${esc(r.source?.value || "—")}</dd>
    <dt>Medium</dt><dd>${esc(r.medium?.value || "—")}</dd>
    <dt>Content</dt><dd>${esc(r.creative?.value || "—")}</dd>
    <dt>Term</dt><dd>${esc(r.audience?.value || "—")}</dd>
    <dt>Placement</dt><dd>${esc(r.placement || "—")}</dd>
    <dt>Publish Date</dt><dd>${esc(r.publishDate || "—")}</dd>
    <dt>Created By</dt><dd>${esc(r.createdBy?.name || r.createdBy?.username || "—")}</dd>
    <dt>Status</dt><dd>${esc(r.status)}</dd>
    <dt>Destination</dt><dd>${esc(r.destinationUrl)}</dd>
  </dl>
  <div class="modal-url" style="margin-top:15px">${esc(r.finalUrl)}</div>
  ${r.notes ? `<p class="tiny muted">یادداشت: ${esc(r.notes)}</p>` : ""}`, actions);
}
async function changeRecordStatus(record, status) {
  loading(true);
  try {
    await api(`/api/records/${encodeURIComponent(record.id)}/status`, {
      method:"POST",
      body:JSON.stringify({status})
    });
    closeModal();
    await refresh();
    toast("وضعیت رکورد بروزرسانی شد.");
  } catch (e) {
    toast(e.message, "bad");
  } finally {
    loading(false);
  }
}
function deleteRecordConfirm(record) {
  modal("تأیید حذف احتیاطی",
    `<p class="tiny">رکورد پاک فیزیکی نمی‌شود؛ فقط به وضعیت Deleted می‌رود و سابقه آن باقی می‌ماند.</p>
     <label class="field"><span>برای تأیید شناسه را وارد کن</span><input id="deleteId" class="ltr" placeholder="${esc(record.id)}"></label>`,
    [
      ["لغو","ghost",closeModal],
      ["تأیید حذف","danger",()=> {
        if ($("deleteId").value.trim() !== record.id) return toast("شناسه صحیح نیست.","bad");
        changeRecordStatus(record,"deleted");
      }]
    ]
  );
}

const DEF_NAMES = {
  campaigns:"کمپین",
  sources:"Source",
  mediums:"Medium",
  contentTypes:"نوع محتوا",
  creatives:"Creative",
  audiences:"Audience"
};
function renderDefs() {
  if (!S.defs) return;
  $$("#tabs .tab").forEach(tab => tab.classList.toggle("active", tab.dataset.def === S.defType));
  const list = (S.defs[S.defType] || []).filter(x => isOwner() || x.status !== "deleted");
  $("defCount").textContent = `${list.length} مورد`;
  $("addDefBtn").classList.toggle("hidden", !canCreateDefinitions());

  $("defList").innerHTML = list.length ? list.map(x => `
    <div class="def-item">
      <div class="def-main">
        <span class="dot ${x.status}"></span>
        <div><b>${esc(x.displayName)}</b><code>${esc(x.value || x.id)}</code></div>
      </div>
      <div class="def-actions">
        ${isOwner() && x.status === "active" ? `<button class="btn ghost small" data-def-act="archive" data-id="${esc(x.id)}">آرشیو</button>` : ""}
        ${isOwner() && x.status !== "deleted" ? `<button class="btn danger small" data-def-act="delete" data-id="${esc(x.id)}">حذف</button>` : ""}
        ${x.status !== "active" ? badge(x.status) : ""}
      </div>
    </div>`).join("") : `<div class="empty">هنوز موردی ثبت نشده است.</div>`;

  $$("[data-def-act]").forEach(btn => btn.onclick = () => {
    changeDefinitionStatus(S.defType, btn.dataset.id, btn.dataset.defAct === "archive" ? "archived" : "deleted");
  });
}
async function changeDefinitionStatus(type, id, status) {
  if (!isOwner()) return;
  if (status === "deleted" && !confirm("این مورد به وضعیت Deleted منتقل شود؟")) return;
  loading(true);
  try {
    await api(`/api/definitions/${encodeURIComponent(type)}/${encodeURIComponent(id)}/status`, {
      method:"POST",
      body:JSON.stringify({status})
    });
    await refresh();
    renderDefs();
    toast("وضعیت بروزرسانی شد.");
  } catch (e) {
    toast(e.message, "bad");
  } finally {
    loading(false);
  }
}

function addDefinition(type, onSave) {
  if (!canCreateDefinitions()) return toast("دسترسی افزودن مورد جدید نداری.","bad");
  if (type === "campaigns") return campaignModal(onSave);
  if (type === "creatives") return creativeModal(onSave);

  const label = DEF_NAMES[type] || "مورد";
  modal(`افزودن ${label}`,
    `<div class="modal-form">
      <label class="field"><span>نام نمایشی *</span><input id="defName"></label>
      <label class="field"><span>مقدار استاندارد UTM *</span><input id="defValue" class="ltr" placeholder="lowercase_value"></label>
      <p class="tiny muted">مقدار استاندارد با حروف انگلیسی، عدد، _ و - ثبت می‌شود.</p>
    </div>`,
    [
      ["لغو","ghost",closeModal],
      ["ثبت","primary",async()=>{
        const payload = {displayName:$("defName").value.trim(), value:$("defValue").value.trim()};
        await saveDefinition(type,payload,onSave);
      }]
    ]
  );
}
function campaignModal(onSave) {
  modal("ایجاد کمپین جدید",
    `<div class="modal-form">
      <label class="field"><span>عنوان نمایشی کمپین *</span><input id="campName" placeholder="کمپین جذب فول‌فاند پرو شهریور"></label>
      <div class="grid two">
        <label class="field"><span>Product *</span><input id="campProduct" class="ltr" placeholder="fullfund_pro"></label>
        <label class="field"><span>Objective *</span><input id="campObjective" class="ltr" placeholder="acquisition"></label>
        <label class="field"><span>Period *</span><input id="campPeriod" class="ltr" placeholder="shahrivar"></label>
        <label class="field"><span>Year *</span><input id="campYear" class="ltr" placeholder="1405"></label>
      </div>
      <label class="field"><span>پیش‌نمایش ساختار Campaign</span><input id="campPreview" class="ltr" readonly></label>
      <div class="grid two">
        <label class="field date-field"><span>شروع</span><input id="campStart" type="date"></label>
        <label class="field date-field"><span>پایان</span><input id="campEnd" type="date"></label>
      </div>
    </div>`,
    [
      ["لغو","ghost",closeModal],
      ["ایجاد کمپین","primary",async()=>{
        await saveDefinition("campaigns",{
          displayName:$("campName").value.trim(),
          product:$("campProduct").value.trim(),
          objective:$("campObjective").value.trim(),
          period:$("campPeriod").value.trim(),
          year:$("campYear").value.trim(),
          startDate:$("campStart").value || null,
          endDate:$("campEnd").value || null
        },onSave);
      }]
    ]
  );
  const update = () => {
    const norm = s => String(s||"").trim().toLowerCase().replace(/[^a-z0-9_-]+/g,"_").replace(/^_+|_+$/g,"");
    $("campPreview").value = [
      norm($("campProduct").value),norm($("campObjective").value),norm($("campPeriod").value),norm($("campYear").value)
    ].filter(Boolean).join("_");
  };
  ["campProduct","campObjective","campPeriod","campYear"].forEach(id => $(id).oninput = update);
  update();
  requestAnimationFrame(enhanceDateInputs);
}
function creativeModal(onSave) {
  const types = active("contentTypes");
  if (!types.length) return toast("اول نوع محتوا تعریف کن.","bad");
  modal("ایجاد Creative جدید",
    `<div class="modal-form">
      <label class="field"><span>نام Creative *</span><input id="crName" placeholder="بنر اعتبار قانونی رابین‌سود"></label>
      <div class="grid two">
        <label class="field"><span>نوع محتوا *</span><select id="crType">${types.map(x=>`<option value="${esc(x.id)}">${esc(x.displayName)}</option>`).join("")}</select></label>
        <label class="field"><span>Version</span><input id="crVersion" class="ltr" value="v1"></label>
      </div>
      <label class="field"><span>یادداشت</span><input id="crNotes"></label>
      <p class="tiny muted">utm_content به‌صورت خودکار ساخته می‌شود.</p>
    </div>`,
    [
      ["لغو","ghost",closeModal],
      ["ایجاد Creative","primary",async()=>{
        await saveDefinition("creatives",{
          displayName:$("crName").value.trim(),
          contentTypeId:$("crType").value,
          version:$("crVersion").value.trim() || "v1",
          notes:$("crNotes").value.trim()
        },onSave);
      }]
    ]
  );
}
async function saveDefinition(type, payload, onSave) {
  loading(true);
  try {
    const data = await api(`/api/definitions/${encodeURIComponent(type)}`, {
      method:"POST",
      body:JSON.stringify(payload)
    });
    closeModal();
    await refresh();
    if (onSave) onSave(data.item);
    toast("مورد جدید اضافه شد.");
  } catch (e) {
    toast(e.message,"bad");
  } finally {
    loading(false);
  }
}

function csvCell(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
}
function filteredCsv() {
  const headers = ["UTM ID","Campaign","utm_campaign","Source","utm_source","Medium","utm_medium","Creative","utm_content","Audience","utm_term","Destination URL","Final URL","Placement","Publish Date","Created By","Username","Created At","Status","Notes"];
  const rows = filtered().map(r => [
    r.id,r.campaign?.displayName,r.campaign?.value,r.source?.displayName,r.source?.value,
    r.medium?.displayName,r.medium?.value,r.creative?.displayName,r.creative?.value,
    r.audience?.displayName,r.audience?.value,r.destinationUrl,r.finalUrl,r.placement,
    r.publishDate,r.createdBy?.name,r.createdBy?.username,r.createdAt,r.status,r.notes
  ]);
  return "\uFEFF" + [headers,...rows].map(row=>row.map(csvCell).join(",")).join("\r\n");
}
function downloadText(text, filename) {
  const blob = new Blob([text], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;a.download = filename;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}
async function downloadServerFile(path, filename) {
  loading(true);
  try {
    const response = await fetch(path, {headers:{Authorization:`Bearer ${S.token}`}});
    if (!response.ok) {
      let msg = "دانلود انجام نشد.";
      try { msg = (await response.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;a.download = filename;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  } catch (e) {
    toast(e.message,"bad");
  } finally {
    loading(false);
  }
}

function renderUsers() {
  if (!isOwner()) return;
  $("usersList").innerHTML = S.users.length ? S.users.map(u => `
    <div class="def-item">
      <div class="def-main">
        <span class="dot ${u.active ? "active" : "archived"}"></span>
        <div><b>${esc(u.name)} — ${esc(roleName(u.role))}</b><code>${esc(u.username)}</code></div>
      </div>
      <div class="def-actions">
        <button class="btn secondary small" data-user-pass="${esc(u.username)}">تغییر رمز</button>
        ${u.username !== S.me.username ? `<button class="btn ${u.active ? "danger" : "secondary"} small" data-user-toggle="${esc(u.username)}">${u.active ? "غیرفعال" : "فعال"}</button>` : ""}
      </div>
    </div>
  `).join("") : `<div class="empty">کاربری وجود ندارد.</div>`;

  $$("[data-user-toggle]").forEach(btn => btn.onclick = () => toggleUser(btn.dataset.userToggle));
  $$("[data-user-pass]").forEach(btn => btn.onclick = () => resetPasswordModal(btn.dataset.userPass));
}
function addUserModal() {
  modal("افزودن کاربر",
    `<div class="modal-form">
      <label class="field"><span>نام نمایشی</span><input id="newUserName"></label>
      <label class="field"><span>نام کاربری</span><input id="newUsername" class="ltr"></label>
      <label class="field"><span>Role</span><select id="newUserRole"><option value="marketing">Marketing</option><option value="technical">Technical</option><option value="owner">Owner</option></select></label>
      <label class="field"><span>رمز عبور</span><input id="newUserPassword" type="password"></label>
    </div>`,
    [
      ["لغو","ghost",closeModal],
      ["افزودن","primary",async()=>{
        loading(true);
        try {
          await api("/api/users", {
            method:"POST",
            body:JSON.stringify({
              name:$("newUserName").value.trim(),
              username:$("newUsername").value.trim(),
              role:$("newUserRole").value,
              password:$("newUserPassword").value
            })
          });
          closeModal();await refresh();toast("کاربر اضافه شد.");
        } catch (e) { toast(e.message,"bad"); }
        finally { loading(false); }
      }]
    ]
  );
}
async function toggleUser(username) {
  loading(true);
  try {
    await api(`/api/users/${encodeURIComponent(username)}/toggle`, {method:"POST"});
    await refresh();toast("وضعیت کاربر بروزرسانی شد.");
  } catch (e) { toast(e.message,"bad"); }
  finally { loading(false); }
}
function resetPasswordModal(username) {
  modal(`تغییر رمز ${username}`,
    `<label class="field"><span>رمز جدید حداقل ۱۰ کاراکتر</span><input id="resetPassword" type="password"></label>`,
    [
      ["لغو","ghost",closeModal],
      ["ثبت رمز جدید","primary",async()=>{
        loading(true);
        try {
          await api(`/api/users/${encodeURIComponent(username)}/password`, {
            method:"POST",
            body:JSON.stringify({password:$("resetPassword").value})
          });
          closeModal();toast("رمز کاربر تغییر کرد.");
        } catch (e) { toast(e.message,"bad"); }
        finally { loading(false); }
      }]
    ]
  );
}

function modal(title, body, actions=[]) {
  $("modalTitle").textContent = title;
  $("modalBody").innerHTML = body;
  $("modalActions").innerHTML = "";
  actions.forEach(([label, cls, fn]) => {
    const btn = document.createElement("button");
    btn.className = `btn ${cls}`;
    btn.textContent = label;
    btn.onclick = fn;
    $("modalActions").appendChild(btn);
  });
  $("modalBack").classList.remove("hidden");
}
function closeModal() {
  $("modalBack").classList.add("hidden");
  $("modalBody").innerHTML = "";
  $("modalActions").innerHTML = "";
  closeDatePicker();
}

/* ---------- Premium Date Picker ---------- */
const MONTHS_FA = ["ژانویه","فوریه","مارس","آوریل","مه","ژوئن","ژوئیه","اوت","سپتامبر","اکتبر","نوامبر","دسامبر"];
const WEEK_FA = ["ی","د","س","چ","پ","ج","ش"];
let datePickerInput = null;
let datePickerCursor = null;

function isoDate(date){
  const y = date.getFullYear();
  const m = String(date.getMonth()+1).padStart(2,"0");
  const d = String(date.getDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
}
function parseIso(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value||"")) return null;
  const [y,m,d] = value.split("-").map(Number);
  const dt = new Date(y,m-1,d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}
function sameDay(a,b){
  return a && b && a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
}
function enhanceDateInputs(){
  $$('input[type="date"]').forEach(input=>{
    if(input.dataset.proDate) return;
    input.dataset.proDate="1";
    input.classList.add("date-pro");
    input.readOnly = true;
    input.addEventListener("click", e=>{
      e.preventDefault();
      openDatePicker(input);
    });
    input.addEventListener("focus", ()=>openDatePicker(input));
    input.addEventListener("keydown", e=>{
      if(e.key==="Enter" || e.key===" "){e.preventDefault();openDatePicker(input)}
    });
  });
}
function openDatePicker(input){
  const root = $("datePickerRoot");
  if(!root) return;
  datePickerInput = input;
  const selected = parseIso(input.value);
  datePickerCursor = selected ? new Date(selected) : new Date();
  datePickerCursor.setDate(1);
  renderDatePicker();
  root.classList.remove("hidden");
  root.setAttribute("aria-hidden","false");
  positionDatePicker();
}
function closeDatePicker(){
  const root = $("datePickerRoot");
  if(!root) return;
  root.classList.add("hidden");
  root.setAttribute("aria-hidden","true");
  datePickerInput = null;
}
function positionDatePicker(){
  const root = $("datePickerRoot");
  if(!datePickerInput || root.classList.contains("hidden")) return;
  const rect = datePickerInput.getBoundingClientRect();
  const width = Math.min(316, window.innerWidth - 24);
  const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left + rect.width - width));
  const roomBelow = window.innerHeight - rect.bottom;
  const top = roomBelow > 370 ? rect.bottom + 8 : Math.max(12, rect.top - 368);
  root.style.width = `${width}px`;
  root.style.left = `${left}px`;
  root.style.top = `${top}px`;
}
function renderDatePicker(){
  const root = $("datePickerRoot");
  if(!root || !datePickerCursor) return;
  const year = datePickerCursor.getFullYear();
  const month = datePickerCursor.getMonth();
  const selected = parseIso(datePickerInput?.value);
  const today = new Date();

  const first = new Date(year,month,1);
  const start = new Date(year,month,1-first.getDay());

  let days = "";
  for(let i=0;i<42;i++){
    const d = new Date(start);
    d.setDate(start.getDate()+i);
    const outside = d.getMonth()!==month;
    const classes = [
      "dp-day",
      outside ? "muted-day" : "",
      sameDay(d,today) ? "today" : "",
      sameDay(d,selected) ? "selected" : ""
    ].filter(Boolean).join(" ");
    days += `<button type="button" class="${classes}" data-date="${isoDate(d)}">${d.getDate()}</button>`;
  }

  root.innerHTML = `
    <div class="dp-head">
      <button type="button" class="dp-nav" data-dp="prev" aria-label="ماه قبل">‹</button>
      <div class="dp-title"><b>${MONTHS_FA[month]} ${year}</b><span>انتخاب تاریخ</span></div>
      <button type="button" class="dp-nav" data-dp="next" aria-label="ماه بعد">›</button>
    </div>
    <div class="dp-week">${WEEK_FA.map(x=>`<span>${x}</span>`).join("")}</div>
    <div class="dp-grid">${days}</div>
    <div class="dp-foot">
      <button type="button" data-dp="clear">پاک کردن</button>
      <button type="button" class="primary-date" data-dp="today">امروز</button>
    </div>`;

  root.querySelector('[data-dp="prev"]').onclick = ()=>{
    datePickerCursor.setMonth(datePickerCursor.getMonth()-1);
    renderDatePicker();
  };
  root.querySelector('[data-dp="next"]').onclick = ()=>{
    datePickerCursor.setMonth(datePickerCursor.getMonth()+1);
    renderDatePicker();
  };
  root.querySelector('[data-dp="today"]').onclick = ()=>setDateValue(new Date());
  root.querySelector('[data-dp="clear"]').onclick = ()=>{
    if(datePickerInput){
      datePickerInput.value="";
      datePickerInput.dispatchEvent(new Event("input",{bubbles:true}));
      datePickerInput.dispatchEvent(new Event("change",{bubbles:true}));
    }
    closeDatePicker();
  };
  root.querySelectorAll("[data-date]").forEach(btn=>{
    btn.onclick = ()=>{
      const chosen = parseIso(btn.dataset.date);
      if(chosen) setDateValue(chosen);
    };
  });
}
function setDateValue(date){
  if(!datePickerInput) return;
  datePickerInput.value = isoDate(date);
  datePickerInput.dispatchEvent(new Event("input",{bubbles:true}));
  datePickerInput.dispatchEvent(new Event("change",{bubbles:true}));
  closeDatePicker();
}

/* ---------- UI Motion ---------- */
function addRipple(e){
  const btn = e.target.closest(".btn,.plus,.nav,.tab,.icon,.dp-nav,.dp-day");
  if(!btn || btn.classList.contains("dp-day")) return;
  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width,rect.height);
  const ripple = document.createElement("span");
  ripple.className = "ui-ripple";
  ripple.style.width = ripple.style.height = `${size}px`;
  ripple.style.left = `${e.clientX - rect.left - size/2}px`;
  ripple.style.top = `${e.clientY - rect.top - size/2}px`;
  btn.appendChild(ripple);
  setTimeout(()=>ripple.remove(),600);
}

function bind() {
  $("finishSetupBtn").onclick = setup;
  $("loginBtn").onclick = login;
  $("passwordInput").onkeydown = e => { if (e.key === "Enter") login(); };
  $("logoutBtn").onclick = logout;
  $("refreshBtn").onclick = refresh;
  $("menuBtn").onclick = () => $("sidebar").classList.toggle("open");
  $$(".nav").forEach(btn => btn.onclick = () => show(btn.dataset.view));
  $("utmForm").onsubmit = createUtm;

  ["campaign","source","medium","creative","audience","destination"].forEach(id => $(id).oninput = preview);
  $("copyPreview").onclick = async () => {
    const url = buildPreviewUrl();
    if (!url) return toast("لینک معتبر ساخته نشده.","bad");
    await navigator.clipboard.writeText(url);
    toast("لینک کپی شد.");
  };

  $$("[data-add]").forEach(btn => btn.onclick = () => addDefinition(btn.dataset.add, item => {
    const map = {campaigns:"campaign",sources:"source",mediums:"medium",creatives:"creative",audiences:"audience"};
    const id = map[btn.dataset.add];
    if (id) { $(id).value = item.id; preview(); }
  }));

  ["search","filterCampaign","filterSource","filterMedium","filterStatus","fromDate","toDate"].forEach(id => {
    $(id).oninput = () => { S.page = 1; renderHistory(); };
  });

  $("prevPage").onclick = () => { if (S.page > 1) { S.page--; renderHistory(); } };
  $("nextPage").onclick = () => { S.page++; renderHistory(); };

  $("filteredCsvBtn").onclick = () => downloadText(filteredCsv(), `robinsood_utm_filtered_${localDay()}.csv`);
  $("csvBtn").onclick = () => downloadServerFile("/api/export/csv", `robinsood_utm_${localDay()}.csv`);
  $("xlsxBtn").onclick = () => downloadServerFile("/api/export/xlsx", "robinsood_utm_history.xlsx");

  $$("#tabs .tab").forEach(tab => tab.onclick = () => { S.defType = tab.dataset.def; renderDefs(); });
  $("addDefBtn").onclick = () => addDefinition(S.defType);
  $("addUserBtn").onclick = addUserModal;

  $("closeModal").onclick = closeModal;
  $("modalBack").onclick = e => { if (e.target === $("modalBack")) closeModal(); };
  document.onkeydown = e => {
    if (e.key === "Escape") {
      if (!$("datePickerRoot").classList.contains("hidden")) closeDatePicker();
      else closeModal();
    }
  };

  document.addEventListener("pointerdown", e=>{
    addRipple(e);
    const root = $("datePickerRoot");
    if(datePickerInput && !root.contains(e.target) && e.target !== datePickerInput) closeDatePicker();
  });
  window.addEventListener("resize", positionDatePicker);
  window.addEventListener("scroll", positionDatePicker, true);

  const observer = new MutationObserver(()=>enhanceDateInputs());
  observer.observe(document.body,{childList:true,subtree:true});
  enhanceDateInputs();
}

bind();
boot();
})();
