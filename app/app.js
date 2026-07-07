const STORAGE_KEY = "hours_data";
const TIMESTAMP_KEY = "hours_updated";
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// --- Time helpers ---

function formatHour(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h < 12 ? "AM" : "PM";
  const hour = h % 12 || 12;
  return m === 0
    ? `${hour} ${period}`
    : `${hour}:${String(m).padStart(2, "0")} ${period}`;
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// A business open around the clock: stored as 00:00–24:00
function isAllDay(h) {
  return h && h.open === "00:00" && h.close === "24:00";
}

function getHoursForDate(business, date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const dateStr = `${yyyy}-${mm}-${dd}`;

  const override = business.hours.overrides?.find((o) => o.date === dateStr);
  if (override !== undefined) return override.hours; // null = closed, {open,close} = modified

  const dayKey = DAYS[date.getDay()];
  return business.hours.regular[dayKey] ?? null;
}

// Returns { label, openClass } for a business at `now`
function getStatus(business, now) {
  const todayHours = getHoursForDate(business, now);
  const nowMins = now.getHours() * 60 + now.getMinutes();

  if (todayHours) {
    if (isAllDay(todayHours)) {
      return {
        label: `<span class="open">Open</span> · 24 hours`,
        isOpen: true,
      };
    }

    const openMins = toMinutes(todayHours.open);
    const closeMins = toMinutes(todayHours.close);

    if (nowMins >= openMins && nowMins < closeMins) {
      return {
        label: `<span class="open">Open</span> · Closes ${formatHour(todayHours.close)}`,
        isOpen: true,
      };
    }

    if (nowMins < openMins) {
      return {
        label: `<span class="closed">Closed</span> · Opens ${formatHour(todayHours.open)} today`,
        isOpen: false,
      };
    }
  }

  // Closed for rest of today — find next open day
  for (let i = 1; i <= 7; i++) {
    const nextDate = new Date(now);
    nextDate.setDate(now.getDate() + i);
    const nextHours = getHoursForDate(business, nextDate);
    if (nextHours) {
      const dayLabel =
        i === 1
          ? "tomorrow"
          : nextDate.toLocaleDateString("en-US", { weekday: "long" });
      return {
        label: `<span class="closed">Closed</span> · Opens ${formatHour(nextHours.open)} ${dayLabel}`,
        isOpen: false,
      };
    }
  }

  return { label: `<span class="closed">Closed today</span>`, isOpen: false };
}

function buildScheduleHTML(business) {
  const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const reg = business.hours.regular;

  // Group consecutive days with identical hours
  const groups = [];
  let i = 0;
  while (i < 7) {
    const h = reg[DAY_KEYS[i]] ?? null;
    const hKey = h ? `${h.open}|${h.close}` : "null";
    let j = i + 1;
    while (j < 7) {
      const nh = reg[DAY_KEYS[j]] ?? null;
      if ((nh ? `${nh.open}|${nh.close}` : "null") !== hKey) break;
      j++;
    }
    groups.push({ start: i, end: j - 1, hours: h });
    i = j;
  }

  let html = '<div class="biz-schedule">';

  for (const g of groups) {
    const dayLabel =
      g.start === g.end
        ? DAY_LABELS[g.start]
        : `${DAY_LABELS[g.start]}–${DAY_LABELS[g.end]}`;
    const hoursStr = g.hours
      ? isAllDay(g.hours)
        ? "24 hours"
        : `${formatHour(g.hours.open)}–${formatHour(g.hours.close)}`
      : "Closed";
    html += `<span class="schedule-day">${dayLabel}</span><span class="schedule-hours">${hoursStr}</span>`;
  }

  // Upcoming overrides only
  const todayStr = new Date().toISOString().slice(0, 10);
  const upcoming = (business.hours.overrides || [])
    .filter((o) => o.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (upcoming.length > 0) {
    html += '<span class="schedule-override-rule"></span><span></span>';
    for (const o of upcoming) {
      const [y, mo, d] = o.date.split("-").map(Number);
      const dateLabel = new Date(y, mo - 1, d).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      const label = o.reason ? `${dateLabel} (${o.reason})` : dateLabel;
      const hoursStr = o.hours
        ? isAllDay(o.hours)
          ? "24 hours"
          : `${formatHour(o.hours.open)}–${formatHour(o.hours.close)}`
        : "Closed";
      html += `<span class="schedule-day schedule-override">${label}</span><span class="schedule-hours">${hoursStr}</span>`;
    }
  }

  html += "</div>";
  return html;
}

// --- Render ---

function categoryLabel(cat) {
  // Capitalize the first letter of each word ("package stores" → "Package Stores")
  return cat.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

// Sort key that ignores a leading article ("The Autograph" sorts under "A")
function sortName(name) {
  return name.replace(/^(the|an|a)\s+/i, "");
}

function byName(a, b) {
  return sortName(a.name).localeCompare(sortName(b.name));
}

let currentBusinesses = [];

function buildRow(business, now) {
  const { label } = getStatus(business, now);
  const scheduleHTML = buildScheduleHTML(business);
  const phoneHTML = business.phone
    ? `<a class="biz-call" href="tel:${business.phone}">${business.phone}</a>`
    : "";
  const mapsURL =
    business.lat != null
      ? `https://maps.apple.com/?ll=${business.lat},${business.lng}&q=${encodeURIComponent(business.name)}`
      : null;
  const mapsHTML =
    mapsURL && business.address
      ? `<a class="biz-maps" href="${mapsURL}" target="_blank">${business.address}</a>`
      : "";
  let webHost = "";
  if (business.website) {
    try {
      webHost = new URL(business.website).hostname.replace(/^www\./, "");
    } catch {}
  }
  const webHTML = business.website
    ? `<a class="biz-web" href="${business.website}" target="_blank" rel="noopener noreferrer">${webHost || "Website"}</a>`
    : "";

  const li = document.createElement("li");
  li.className = "biz-row";
  li.dataset.category = business.category;
  li.innerHTML = `
    <div class="biz-main">
      <div class="biz-header">
        <div class="biz-name">${business.name}</div>
        <div class="biz-status">${label}</div>
      </div>
      <div class="biz-accordion">
        ${scheduleHTML}
        <div class="biz-contact">${phoneHTML}${webHTML}${mapsHTML}</div>
      </div>
    </div>`;

  return li;
}

function renderFilters() {
  const scroll = document.getElementById("filter-scroll");
  scroll.innerHTML = "";

  // Note: the "Open Now" pill lives statically in index.html (pinned, doesn't
  // scroll with the category pills) — we only manage its active state here.
  const categories = [
    ...new Set(currentBusinesses.map((b) => b.category)),
  ].sort();
  for (const f of activeFilters) {
    if (!categories.includes(f)) activeFilters.delete(f);
  }

  for (const cat of categories) {
    const btn = document.createElement("button");
    btn.className = "filter-btn";
    btn.dataset.filter = cat;
    btn.textContent = categoryLabel(cat);
    scroll.appendChild(btn);
  }

  syncFilterButtons();
}

function renderList() {
  const list = document.getElementById("business-list");
  const now = new Date();
  list.innerHTML = "";

  const matchesStatus = (biz) =>
    !statusFilter || getStatus(biz, now).isOpen === (statusFilter === "open");

  if (activeFilters.size === 0) {
    // No category filter → keep the grouped, category-labeled view.
    // A status filter (e.g. Open Now) just narrows each group; empty groups drop out.
    const groups = {};
    for (const biz of currentBusinesses) {
      if (!matchesStatus(biz)) continue;
      (groups[biz.category] ??= []).push(biz);
    }
    for (const cat of Object.keys(groups).sort()) {
      const header = document.createElement("li");
      header.className = "category-header";
      header.textContent = categoryLabel(cat);
      list.appendChild(header);
      for (const biz of groups[cat].sort(byName)) {
        list.appendChild(buildRow(biz, now));
      }
    }
  } else {
    // A category is selected → flat list, sorted by name, status also applies
    const filtered = currentBusinesses
      .filter((b) => activeFilters.has(b.category) && matchesStatus(b))
      .sort(byName);
    for (const biz of filtered) {
      list.appendChild(buildRow(biz, now));
    }
  }

  if (!list.querySelector(".biz-row")) {
    const empty = document.createElement("li");
    empty.className = "empty-msg";
    empty.textContent =
      statusFilter === "open" ? "Nothing open now." : "No matches.";
    list.appendChild(empty);
  }

  // Clear is only for category filters — Open Now alone doesn't show it
  document
    .getElementById("clear-btn")
    .classList.toggle("visible", activeFilters.size > 0);
  updateTimestamp();
}

function render(businesses) {
  currentBusinesses = businesses;
  renderFilters();
  renderList();
}

// --- Filters ---

let activeFilters = new Set();
let statusFilter = "open"; // null | "open" — defaults to showing open-now

// Restore filter state from the URL hash (#open=1&cat=restaurant) if present.
// A hash carrying our params is authoritative; a bare URL keeps the defaults.
// Using the hash (not a query string) keeps the offline cache match intact.
(function initFiltersFromURL() {
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.has("open")) {
    statusFilter = params.get("open") === "1" ? "open" : null;
  }
  const cat = params.get("cat");
  if (cat) activeFilters.add(cat);
})();

// Persist current filter state to the URL hash so it survives reload / can be shared.
function writeFiltersToURL() {
  const params = new URLSearchParams();
  params.set("open", statusFilter === "open" ? "1" : "0");
  const cat = [...activeFilters][0];
  if (cat) params.set("cat", cat);
  history.replaceState(null, "", `#${params.toString()}`);
}

function syncFilterButtons() {
  document.querySelectorAll(".filter-btn").forEach((b) => {
    const on = b.dataset.status
      ? statusFilter === b.dataset.status
      : activeFilters.has(b.dataset.filter);
    b.classList.toggle("active", on);
  });
}

function applyFilters() {
  renderList();
  writeFiltersToURL();
  document.getElementById("business-list").scrollTop = 0;
  window.scrollTo(0, 0);
}

document.getElementById("filter-bar").addEventListener("click", (e) => {
  const btn = e.target.closest(".filter-btn");
  if (!btn) return;

  if (btn.dataset.status) {
    // Status filter — single-select within open/closed, toggles off when re-tapped
    statusFilter = statusFilter === btn.dataset.status ? null : btn.dataset.status;
  } else {
    // Category filter — single-select
    const f = btn.dataset.filter;
    const wasActive = activeFilters.has(f);
    activeFilters.clear();
    if (!wasActive) activeFilters.add(f);
  }

  syncFilterButtons();
  applyFilters();
});

document.getElementById("clear-btn").addEventListener("click", () => {
  // Clear only category filters; leave the Open Now status untouched
  activeFilters.clear();
  syncFilterButtons();
  applyFilters();
});

document.getElementById("business-list").addEventListener("click", (e) => {
  if (e.target.closest("a")) return;
  const row = e.target.closest(".biz-row");
  if (row) row.classList.toggle("expanded");
});

// --- Timestamp ---

function updateTimestamp() {
  const ts = localStorage.getItem(TIMESTAMP_KEY);
  const el = document.getElementById("updated-label");
  if (!ts) {
    el.textContent = "";
    return;
  }

  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  let label;
  if (mins < 2) label = "Updated just now";
  else if (mins < 60) label = `Updated ${mins} minutes ago`;
  else if (hours < 24)
    label = `Updated ${hours} hour${hours > 1 ? "s" : ""} ago`;
  else label = `Updated ${days} day${days > 1 ? "s" : ""} ago`;

  el.textContent = label;
}

// --- Data loading ---

async function loadData() {
  const cached = localStorage.getItem(STORAGE_KEY);

  if (cached) {
    render(JSON.parse(cached));
  }

  try {
    const res = await fetch("hours.json");
    if (!res.ok) throw new Error(res.status);
    const fresh = await res.json();
    const freshStr = JSON.stringify(fresh);

    if (freshStr !== cached) {
      localStorage.setItem(STORAGE_KEY, freshStr);
      localStorage.setItem(TIMESTAMP_KEY, new Date().toISOString());
      render(fresh);
    }
  } catch {
    if (!cached) {
      document.getElementById("business-list").innerHTML =
        '<li style="padding:20px 16px;font-size:13px;color:var(--text-muted)">No data available. Connect to the internet to load hours.</li>';
    }
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" });

  // When a new SW takes control (after skipWaiting), reload to get fresh files
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

loadData();
