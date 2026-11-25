// ===== PIT WALL — script.js =====

// ---------- Утилиты ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const now = () => new Date();
const TZ = "Asia/Almaty";
const LIVE_MS = 3 * 36e5; // окно «гонка идёт» — 3 часа от старта

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

const TRACK_INFO = typeof TRACKS !== "undefined" ? TRACKS : {};
const WIKI = typeof WIKI_LINKS !== "undefined" ? WIKI_LINKS : {};
const PHOTOS = typeof PHOTO_WIKI !== "undefined" ? PHOTO_WIKI : {};

// Ссылка на статью; если статьи нет в WIKI_LINKS, открываем поиск по Википедии
function wikiUrl(name) {
  const page = WIKI[name] || `${name} Formula One`;
  return WIKI[name]
    ? `https://en.wikipedia.org/wiki/${encodeURIComponent(page)}`
    : `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(page)}`;
}

// ---------- Настройки в localStorage ----------
const store = {
  get(key, fallback) {
    try {
      return localStorage.getItem(`pitwall:${key}`) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`pitwall:${key}`, value);
    } catch {
      /* приватный режим — просто не сохраняем */
    }
  }
};

const state = {
  season: pick(store.get("season", "2026"), ["2026", "2027"], "2026"),
  filter: pick(store.get("filter", "all"), ["all", "upcoming", "sprint"], "all"),
  sort: pick(store.get("sort", "points"), ["points", "name", "team"], "points"),
  theme: pick(store.get("theme", "dark"), ["dark", "light"], "dark"),
  query: ""
};

// ---------- Вычисляемые данные ----------
const DRIVERS = [...DRIVERS_2026].sort((a, b) => b.points - a.points);

// Очки команд считаются из пилотов, поле points в TEAMS_2026 не используется
const TEAMS = TEAMS_2026.map((t) => {
  const squad = DRIVERS_2026.filter((d) => d.team === t.name);
  return { ...t, squad, points: squad.reduce((sum, d) => sum + d.points, 0) };
}).sort((a, b) => b.points - a.points);

const CALENDARS = { "2026": CALENDAR_2026, "2027": CALENDAR_2027 };

// ---------- Тема ----------
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("#themeBtn").textContent = theme === "light" ? "Тёмная тема" : "Светлая тема";
}

$("#themeBtn").addEventListener("click", () => {
  state.theme = state.theme === "light" ? "dark" : "light";
  store.set("theme", state.theme);
  applyTheme(state.theme);
});

// ---------- Модальное окно ----------
const modal = $("#infoModal");
const modalBody = $("#modalBody");

function openModal(html) {
  modalBody.innerHTML = html;
  if (!modal.open) modal.showModal();
}

$("#closeModal").addEventListener("click", () => modal.close());
modal.addEventListener("click", (e) => {
  if (e.target === modal) modal.close();
});

// ---------- Фото из Википедии (общее для трасс, пилотов и команд) ----------
const wikiCache = new Map();
let photoRequest = 0; // защита от гонки запросов при быстром переключении

async function getWikiImage(title) {
  if (wikiCache.has(title)) return wikiCache.get(title);
  const res = await fetch(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
  );
  if (!res.ok) throw new Error(`Wiki ${res.status}`);
  const data = await res.json();
  const src = data.originalimage?.source || data.thumbnail?.source || "";
  wikiCache.set(title, src);
  return src;
}

// Блок-заглушка для фото; сам файл подгружается через loadHeroPhoto
function heroHtml(title) {
  return title
    ? `<div class="track-hero" id="heroPhoto"><span class="track-hero-empty">Загружаем фото…</span></div>`
    : `<div class="track-hero" id="heroPhoto"><span class="track-hero-empty">Фото не добавлено</span></div>`;
}

async function loadHeroPhoto(title, alt) {
  const hero = $("#heroPhoto");
  if (!title || !hero) return;
  const token = ++photoRequest;
  try {
    const src = await getWikiImage(title);
    if (token !== photoRequest || !hero.isConnected) return;
    hero.innerHTML = src
      ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy">`
      : `<span class="track-hero-empty">Фото не найдено</span>`;
  } catch {
    if (token === photoRequest && hero.isConnected) {
      hero.innerHTML = `<span class="track-hero-empty">Не удалось загрузить фото</span>`;
    }
  }
}

// ---------- Новости ----------
function findNews(query) {
  const q = query.toLowerCase();
  return NEWS_DATA.filter((n) =>
    [n.tag, n.title, n.summary, ...n.fullText].some((s) => s.toLowerCase().includes(q))
  );
}

function renderNewsList(items, emptyText) {
  if (!items.length) return `<p>${esc(emptyText)}</p>`;
  return items.map((i) => `
    <div class="mini-news">
      <small>${esc(i.date || "Сезон 2026")}</small>
      <strong>${esc(i.title)}</strong>
      <p>${esc(i.text || i.summary || "")}</p>
    </div>`).join("");
}

// ---------- Зачёт: пилоты ----------
function getVisibleDrivers() {
  const rankOf = new Map(DRIVERS.map((d, i) => [d.name, i + 1]));
  const q = state.query.trim().toLowerCase();

  let list = DRIVERS.filter(
    (d) => !q || d.name.toLowerCase().includes(q) || d.team.toLowerCase().includes(q)
  );
  if (state.sort === "name") {
    list = [...list].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }
  if (state.sort === "team") {
    list = [...list].sort((a, b) => a.team.localeCompare(b.team, "ru") || b.points - a.points);
  }
  return list.map((d) => ({ d, pos: rankOf.get(d.name) }));
}

function renderDrivers() {
  const leadDriver = DRIVERS[0].points || 1;
  const rows = getVisibleDrivers();
  const colorOf = (team) => TEAMS.find((t) => t.name === team)?.color || "#e1251b";

  $("#drivers").innerHTML = rows.length
    ? rows.map(({ d, pos }) => {
        const color = colorOf(d.team);
        const gap = pos === 1 ? "Лидер" : `−${DRIVERS[0].points - d.points}`;
        return `
          <div class="row${pos === 1 ? " is-leader" : ""}" role="button" tabindex="0" data-action="driver" data-id="${esc(d.name)}">
            <span class="pos">${pos}</span>
            <div class="name-wrap">
              <span class="team-dot" style="background:${color}"></span>
              <div>${esc(d.name)}<small>${esc(d.team)} · ${gap}</small></div>
            </div>
            <span class="pts">${d.points}</span>
            <i class="bar" style="width:${(d.points / leadDriver) * 100}%;background:${color}"></i>
          </div>`;
      }).join("")
    : `<p class="muted table-empty">Никого не нашли по запросу.</p>`;
}

// ---------- Зачёт: команды ----------
function renderTeams() {
  const leadTeam = TEAMS[0].points || 1;
  $("#teams").innerHTML = TEAMS.map((t, i) => {
    const gap = i === 0 ? "Лидер" : `−${TEAMS[0].points - t.points}`;
    return `
      <div class="row${i === 0 ? " is-leader" : ""}" role="button" tabindex="0" data-action="team" data-id="${esc(t.name)}">
        <span class="pos">${i + 1}</span>
        <div class="name-wrap">
          <span class="team-dot" style="background:${t.color}"></span>
          <div>${esc(t.name)}<small>${gap}</small></div>
        </div>
        <span class="pts">${t.points}</span>
        <i class="bar" style="width:${(t.points / leadTeam) * 100}%;background:${t.color}"></i>
      </div>`;
  }).join("");
}

// ---------- Окно пилота ----------
function openDriver(name) {
  const d = DRIVERS_2026.find((x) => x.name === name);
  if (!d) return;
  const pos = DRIVERS.indexOf(d) + 1;
  const gap = pos === 1 ? "Лидер" : `−${DRIVERS[0].points - d.points}`;
  const news = [...(d.news || []), ...findNews(d.name.split(" ").pop())];
  const others = DRIVERS.filter((x) => x.name !== d.name);

  openModal(`
    ${PHOTOS[d.name] ? heroHtml(PHOTOS[d.name]) : ""}
    <span class="profile-sub">Пилот · №${esc(d.number || "—")} · ${esc(d.country || "F1")}</span>
    <h2 id="modalTitle">${esc(d.name)}</h2>
    <div class="profile-meta">Команда: <strong>${esc(d.team)}</strong></div>
    <div class="stats-grid">
      <div class="stat-box"><b>${pos}</b><span>Позиция 2026</span></div>
      <div class="stat-box"><b>${d.points}</b><span>Очки 2026</span></div>
      <div class="stat-box"><b>${gap}</b><span>От лидера</span></div>
      <div class="stat-box"><b>${esc(d.team)}</b><span>Команда</span></div>
    </div>
    <div class="profile-section">
      <h3>Биография</h3>
      <p>${esc(d.bio || "Информация о пилоте добавляется.")}</p>
      <a class="track-link" href="${esc(wikiUrl(d.name))}" target="_blank" rel="noopener">Читать в Википедии →</a>
    </div>
    <div class="profile-section">
      <h3>Сравнить с другим пилотом</h3>
      <select id="cmpSelect" class="ui-select">
        <option value="">— выберите пилота —</option>
        ${others.map((x) => `<option value="${esc(x.name)}">${esc(x.name)}</option>`).join("")}
      </select>
      <div id="cmpBox"></div>
    </div>
    <div class="profile-section">
      <h3>Новости о пилоте</h3>
      ${renderNewsList(news, "Свежих заметок пока нет — добавьте их в поле news у пилота в data.js.")}
    </div>`);

  $("#cmpSelect").addEventListener("change", (e) => renderCompare(d, e.target.value));
  loadHeroPhoto(PHOTOS[d.name], d.name);
}

function renderCompare(a, bName) {
  const box = $("#cmpBox");
  const b = DRIVERS_2026.find((x) => x.name === bName);
  if (!b) {
    box.innerHTML = "";
    return;
  }
  const pa = DRIVERS.indexOf(a) + 1;
  const pb = DRIVERS.indexOf(b) + 1;
  const diff = a.points - b.points;
  const verdict =
    diff === 0
      ? "Очки равны."
      : diff > 0
        ? `${esc(a.name)} впереди на ${diff} оч.`
        : `${esc(b.name)} впереди на ${-diff} оч.`;

  box.innerHTML = `
    <table class="cmp-table">
      <thead><tr><th></th><th>${esc(a.name)}</th><th>${esc(b.name)}</th></tr></thead>
      <tbody>
        <tr><th>Команда</th><td>${esc(a.team)}</td><td>${esc(b.team)}</td></tr>
        <tr><th>Позиция</th><td>#${pa}</td><td>#${pb}</td></tr>
        <tr><th>Очки</th><td>${a.points}</td><td>${b.points}</td></tr>
      </tbody>
    </table>
    <p class="muted">${verdict}</p>`;
}

// ---------- Окно команды ----------
function openTeam(name) {
  const t = TEAMS.find((x) => x.name === name);
  if (!t) return;
  const pos = TEAMS.indexOf(t) + 1;
  const gap = pos === 1 ? "Лидер" : `−${TEAMS[0].points - t.points}`;
  const news = [...(t.news || []), ...findNews(t.name)];

  openModal(`
    ${PHOTOS[t.name] ? heroHtml(PHOTOS[t.name]) : ""}
    <span class="profile-sub">Конструктор · Сезон 2026</span>
    <h2 id="modalTitle">${esc(t.name)}</h2>
    <div class="profile-meta">${esc(t.base || "")} · Руководитель: ${esc(t.principal || "—")}</div>
    <div class="stats-grid">
      <div class="stat-box"><b>#${pos}</b><span>Место в КК</span></div>
      <div class="stat-box"><b>${t.points}</b><span>Очки 2026</span></div>
      <div class="stat-box"><b>${gap}</b><span>От лидера</span></div>
      <div class="stat-box"><b>${esc(t.stats?.titles || "—")}</b><span>Титулы</span></div>
    </div>
    <div class="profile-section">
      <h3>О команде</h3>
      <p>${esc(t.bio || "Информация о команде добавляется.")}</p>
      ${t.squad.length
        ? `<p><strong>Пилоты:</strong> ${t.squad.map((d) => `${esc(d.name)} (${d.points} оч.)`).join(", ")}</p>`
        : ""}
      <a class="track-link" href="${esc(wikiUrl(t.name))}" target="_blank" rel="noopener">Читать в Википедии →</a>
    </div>
    <div class="profile-section">
      <h3>Новости команды</h3>
      ${renderNewsList(news, "Свежих заметок пока нет — добавьте их в поле news у команды в data.js.")}
    </div>`);

  loadHeroPhoto(PHOTOS[t.name], t.name);
}

// ---------- Обратный отсчёт и «гонка идёт» ----------
function fmtPlace(place, date) {
  const when = date.toLocaleString("ru-RU", {
    timeZone: TZ, day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit"
  });
  return `${place} · ${when} (Алматы)`;
}

function getNextEvent() {
  const t = now();
  const up2026 = CALENDAR_2026.find((r) => new Date(r.date) > t);
  if (up2026) return { label: "Ближайший этап 2026", race: up2026 };
  const up2027 = CALENDAR_2027.find((r) => new Date(r.date) > t) || CALENDAR_2027[0];
  return { label: "Обратный отсчёт до сезона 2027", race: up2027 };
}

function liveRace() {
  const t = now();
  return [...CALENDAR_2026, ...CALENDAR_2027].find((r) => {
    const elapsed = t - new Date(r.date);
    return elapsed >= 0 && elapsed < LIVE_MS;
  }) || null;
}

function startCountdown() {
  const clockEl = $("#clock");
  const cells = $$("#clock b");
  let target = null;

  const showNext = () => {
    const { label, race } = getNextEvent();
    target = new Date(race.date);
    $("#nxLabel").textContent = label;
    $("#nxName").textContent = race.name;
    $("#nxDate").textContent = fmtPlace(race.place, target);
  };

  const tick = () => {
    const live = liveRace();
    if (live) {
      clockEl.hidden = true;
      $("#nxLabel").textContent = "Гонка идёт сейчас";
      $("#nxName").textContent = live.name;
      $("#nxDate").textContent = fmtPlace(live.place, new Date(live.date));
      return;
    }

    clockEl.hidden = false;
    if (!target || now() >= target) showNext();

    const diff = Math.max(0, target - now());
    const parts = [
      Math.floor(diff / 864e5),
      Math.floor(diff / 36e5) % 24,
      Math.floor(diff / 6e4) % 60,
      Math.floor(diff / 1e3) % 60
    ];
    parts.forEach((v, i) => (cells[i].textContent = String(v).padStart(2, "0")));
  };

  tick();
  setInterval(tick, 1000);
}

// ---------- Календарь ----------
function renderCalendar() {
  const list = CALENDARS[state.season];
  const t = now();
  const nextRace = getNextEvent().race;

  const items = list
    .map((race, idx) => ({ race, idx }))
    .filter(({ race }) => {
      if (state.filter === "sprint") return race.sprint;
      if (state.filter === "upcoming") return new Date(race.date) > t;
      return true;
    });

  $("#cal").innerHTML = items.length
    ? items.map(({ race, idx }) => {
        const d = new Date(race.date);
        const isPast = d <= t;
        const isNext = race === nextRace && !isPast;
        const shortDate = d
          .toLocaleDateString("ru-RU", { timeZone: TZ, day: "2-digit", month: "short" })
          .replace(".", "");

        return `
          <button type="button" class="race ${isPast ? "is-past" : ""} ${isNext ? "is-next" : ""}"
                  data-action="track" data-season="${state.season}" data-idx="${idx}">
            <time>${shortDate}</time>
            <div><b>${esc(race.name)}</b><br><span>${esc(race.place)}</span></div>
            <div class="tags">
              ${race.sprint ? '<span class="tag sprint">Спринт</span>' : '<span class="tag">Этап</span>'}
              ${isPast ? '<span class="tag done">Завершён</span>' : ""}
            </div>
          </button>`;
      }).join("")
    : `<p class="muted">Нет этапов по этому фильтру.</p>`;
}

// ---------- Карточка трассы ----------
function openTrack(race) {
  const info = TRACK_INFO[race.name];
  const date = new Date(race.date);
  const finished = date <= now();

  const stats = info
    ? [
        ["Открыта", info.opened],
        ["Первый Гран-при", info.firstF1],
        ["Длина круга", info.length],
        ["Поворотов", info.turns]
      ].filter(([, v]) => v)
    : [];

  openModal(`
    ${heroHtml(info?.wiki)}
    <span class="profile-sub">${race.sprint ? "Спринт-уикенд" : "Гран-при"} · ${finished ? "Завершён" : "Предстоит"}</span>
    <h2 id="modalTitle">${esc(race.name)}</h2>
    <div class="profile-meta">${esc(fmtPlace(race.place, date))}</div>

    ${stats.length
      ? `<div class="stats-grid">${stats.map(([k, v]) =>
          `<div class="stat-box"><b>${esc(v)}</b><span>${k}</span></div>`).join("")}</div>`
      : ""}

    <div class="profile-section">
      <h3>История трассы</h3>
      ${info?.history?.length
        ? info.history.map((p) => `<p>${esc(p)}</p>`).join("")
        : `<p>Подробная история этой трассы пока не добавлена. Добавьте запись в TRACKS в data.js по образцу.</p>`}
    </div>

    ${info?.facts?.length
      ? `<div class="profile-section">
           <h3>Интересные факты</h3>
           <ul class="track-facts">${info.facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
         </div>`
      : ""}

    ${info?.wiki
      ? `<a class="track-link" href="https://en.wikipedia.org/wiki/${encodeURIComponent(info.wiki)}"
            target="_blank" rel="noopener">Читать в Википедии →</a>`
      : ""}
  `);

  loadHeroPhoto(info?.wiki, race.name);
}

// ---------- Сезон 2027 ----------
function renderFuture2027() {
  $("#futureGrid").innerHTML = SEASON_2027_HIGHLIGHTS.map((item) => `
    <article class="future-card">
      <span class="num">${esc(item.num)}</span>
      <h3>${esc(item.title)}</h3>
      <p>${esc(item.text)}</p>
    </article>`).join("");
}

// ---------- Новости ----------
function renderNews() {
  $("#newsGrid").innerHTML = NEWS_DATA.map((n, idx) => `
    <article class="card" data-action="news" data-idx="${idx}" tabindex="0" role="button">
      <div class="img"><span class="badge">${esc(n.tag)}</span></div>
      <div class="t">
        <h3>${esc(n.title)}</h3>
        <p>${esc(n.summary)}</p>
        <span class="read-more">Читать разбор &rarr;</span>
      </div>
    </article>`).join("");
}

function openNews(idx) {
  const item = NEWS_DATA[idx];
  if (!item) return;
  openModal(`
    <span class="profile-sub">${esc(item.tag)}</span>
    <h2 id="modalTitle">${esc(item.title)}</h2>
    <div class="profile-section">
      ${item.fullText.map((p) => `<p>${esc(p)}</p>`).join("")}
    </div>`);
}

// ---------- Делегирование событий ----------
function bindActions(root, handler) {
  root.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (el) handler(el);
  });
  root.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const el = e.target.closest("[data-action]");
    if (!el || el.tagName === "BUTTON") return;
    e.preventDefault();
    handler(el);
  });
}

bindActions($("#drivers"), (el) => openDriver(el.dataset.id));
bindActions($("#teams"), (el) => openTeam(el.dataset.id));
bindActions($("#cal"), (el) => openTrack(CALENDARS[el.dataset.season][Number(el.dataset.idx)]));
bindActions($("#newsGrid"), (el) => openNews(Number(el.dataset.idx)));

// ---------- Поиск и сортировка пилотов ----------
$("#driverSearch").addEventListener("input", (e) => {
  state.query = e.target.value;
  renderDrivers();
});

$("#driverSort").addEventListener("change", (e) => {
  state.sort = e.target.value;
  store.set("sort", state.sort);
  renderDrivers();
});

// ---------- Переключатели календаря ----------
function setActive(group, btn) {
  $$(".filter-btn", group).forEach((b) => {
    const on = b === btn;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  });
}

function syncCalendarControls() {
  $$("#seasonSwitch .filter-btn").forEach((b) => {
    const on = b.dataset.season === state.season;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  });
  $$("#calFilters .filter-btn").forEach((b) => {
    const on = b.dataset.filter === state.filter;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  });
}

$("#seasonSwitch").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-season]");
  if (!btn) return;
  state.season = btn.dataset.season;
  store.set("season", state.season);
  setActive($("#seasonSwitch"), btn);
  renderCalendar();
});

$("#calFilters").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-filter]");
  if (!btn) return;
  state.filter = btn.dataset.filter;
  store.set("filter", state.filter);
  setActive($("#calFilters"), btn);
  renderCalendar();
});

// ---------- Старт ----------
applyTheme(state.theme);
$("#driverSort").value = state.sort;
syncCalendarControls();
renderDrivers();
renderTeams();
startCountdown();
renderCalendar();
renderFuture2027();
renderNews();