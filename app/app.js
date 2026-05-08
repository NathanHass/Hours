const STORAGE_KEY = 'hours_data';
const TIMESTAMP_KEY = 'hours_updated';
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// --- Time helpers ---

function formatHour(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 || 12;
  return m === 0 ? `${hour} ${period}` : `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function getHoursForDate(business, date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  const override = business.hours.overrides?.find(o => o.date === dateStr);
  if (override !== undefined) return override.hours; // null = closed, {open,close} = modified

  const dayKey = DAYS[date.getDay()];
  return business.hours.regular[dayKey] ?? null;
}

// Returns { label, openClass } for a business at `now`
function getStatus(business, now) {
  const todayHours = getHoursForDate(business, now);
  const nowMins = now.getHours() * 60 + now.getMinutes();

  if (todayHours) {
    const openMins = toMinutes(todayHours.open);
    const closeMins = toMinutes(todayHours.close);

    if (nowMins >= openMins && nowMins < closeMins) {
      return { label: `<span class="open">Open</span> · Closes ${formatHour(todayHours.close)}`, isOpen: true };
    }

    if (nowMins < openMins) {
      return { label: `<span class="closed">Closed</span> · Opens ${formatHour(todayHours.open)} today`, isOpen: false };
    }
  }

  // Closed for rest of today — find next open day
  for (let i = 1; i <= 7; i++) {
    const nextDate = new Date(now);
    nextDate.setDate(now.getDate() + i);
    const nextHours = getHoursForDate(business, nextDate);
    if (nextHours) {
      const dayLabel = i === 1 ? 'tomorrow' : nextDate.toLocaleDateString('en-US', { weekday: 'long' });
      return { label: `<span class="closed">Closed</span> · Opens ${formatHour(nextHours.open)} ${dayLabel}`, isOpen: false };
    }
  }

  return { label: `<span class="closed">Closed today</span>`, isOpen: false };
}

function getTomorrowLabel(business, now) {
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const h = getHoursForDate(business, tomorrow);
  if (!h) return 'Tomorrow: Closed';
  return `Tomorrow: ${formatHour(h.open)} – ${formatHour(h.close)}`;
}

// --- Render ---

const CATEGORY_LABELS = {
  books: 'Books',
  restaurant: 'Restaurants',
  shop: 'Shops',
};

let currentBusinesses = [];

function buildRow(business, now) {
  const { label } = getStatus(business, now);
  const tomorrowText = getTomorrowLabel(business, now);

  const li = document.createElement('li');
  li.className = 'biz-row';
  li.dataset.category = business.category;
  li.innerHTML = `
    <div class="biz-tomorrow">${tomorrowText}</div>
    <div class="biz-main">
      <div class="biz-name">${business.name}</div>
      <div class="biz-status">${label}</div>
    </div>`;

  attachSwipe(li);
  return li;
}

function renderList() {
  const list = document.getElementById('business-list');
  const now = new Date();
  list.innerHTML = '';

  if (activeFilters.size === 0) {
    // Group by category (alphabetized), businesses sorted by name within each group
    const groups = {};
    for (const biz of currentBusinesses) {
      (groups[biz.category] ??= []).push(biz);
    }
    for (const cat of Object.keys(groups).sort()) {
      const header = document.createElement('li');
      header.className = 'category-header';
      header.textContent = CATEGORY_LABELS[cat] ?? cat;
      list.appendChild(header);
      for (const biz of groups[cat].sort((a, b) => a.name.localeCompare(b.name))) {
        list.appendChild(buildRow(biz, now));
      }
    }
  } else {
    // Flat filtered list, sorted by name
    const filtered = currentBusinesses
      .filter(b => activeFilters.has(b.category))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const biz of filtered) {
      list.appendChild(buildRow(biz, now));
    }
  }

  document.getElementById('clear-btn').classList.toggle('visible', activeFilters.size > 0);
  updateTimestamp();
}

function render(businesses) {
  currentBusinesses = businesses;
  renderList();
}

// --- Swipe ---

function attachSwipe(row) {
  const main = row.querySelector('.biz-main');
  const SNAP_THRESHOLD = 0.3; // fraction of row width
  let startX = 0, startY = 0, currentX = 0, dragging = false, swiped = false;

  row.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    currentX = 0;
    dragging = true;
    row.classList.add('swiped'); // disable CSS transition while dragging
  }, { passive: true });

  row.addEventListener('touchmove', e => {
    if (!dragging) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;

    // Bail if primarily a vertical scroll
    if (!swiped && Math.abs(dy) > Math.abs(dx)) {
      dragging = false;
      return;
    }

    // Only reveal on rightward swipe (positive dx = finger moving right)
    currentX = Math.max(0, Math.min(dx, row.offsetWidth * 0.55));
    main.style.transform = `translateX(${currentX}px)`;
  }, { passive: true });

  row.addEventListener('touchend', () => {
    if (!dragging) return;
    dragging = false;
    row.classList.remove('swiped');

    const threshold = row.offsetWidth * SNAP_THRESHOLD;
    if (currentX >= threshold) {
      const maxX = row.offsetWidth * 0.55;
      main.style.transform = `translateX(${maxX}px)`;
      swiped = true;
    } else {
      main.style.transform = '';
      swiped = false;
    }
  });

  // Tap anywhere on a held-open row snaps it back
  row.addEventListener('click', () => {
    if (swiped) {
      main.style.transform = '';
      swiped = false;
    }
  });
}

// --- Filters ---

let activeFilters = new Set();

function applyFilters() {
  renderList();
}

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const f = btn.dataset.filter;
    const wasActive = activeFilters.has(f);
    activeFilters.clear();
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    if (!wasActive) {
      activeFilters.add(f);
      btn.classList.add('active');
    }
    applyFilters();
  });
});

document.getElementById('clear-btn').addEventListener('click', () => {
  activeFilters.clear();
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  applyFilters();
});

// --- Timestamp ---

function updateTimestamp() {
  const ts = localStorage.getItem(TIMESTAMP_KEY);
  const el = document.getElementById('updated-label');
  if (!ts) { el.textContent = ''; return; }

  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  let label;
  if (mins < 2) label = 'Updated just now';
  else if (mins < 60) label = `Updated ${mins} minutes ago`;
  else if (hours < 24) label = `Updated ${hours} hour${hours > 1 ? 's' : ''} ago`;
  else label = `Updated ${days} day${days > 1 ? 's' : ''} ago`;

  el.textContent = label;
}

// --- Data loading ---

async function loadData() {
  const cached = localStorage.getItem(STORAGE_KEY);

  if (cached) {
    render(JSON.parse(cached));
  }

  try {
    const res = await fetch('hours.json');
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
      document.getElementById('business-list').innerHTML =
        '<li style="padding:20px 16px;font-size:13px;color:var(--text-muted)">No data available. Connect to the internet to load hours.</li>';
    }
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

loadData();
