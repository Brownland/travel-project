(function () {
  const TAB_IDS = ["bend", "banff"];
  const STORAGE_KEY = "bachelor_party_itinerary_v2";
  const PAGE_SIZE = 8;
  const DATE_COLORS = ["#58a6ff", "#7ee787", "#f0c674", "#f97583", "#d2a8ff", "#79c0ff", "#a5d6ff"];

  let data = null;
  const itineraryMaps = {};
  const itineraryLayers = {};
  const uiState = {
    bend: { activityPage: 1, activityFilter: "", lodgingPage: 1 },
    banff: { activityPage: 1, activityFilter: "", lodgingPage: 1 },
  };

  const BP_DAY_KEY = "bp_active_day_v1";
  let activeDayKey = null;

  function getActiveDayKey() {
    if (activeDayKey) return activeDayKey;
    try {
      const v = localStorage.getItem(BP_DAY_KEY);
      if (v) return v;
    } catch (e) {}
    return null;
  }

  function setActiveDayKey(k) {
    activeDayKey = k;
    try {
      localStorage.setItem(BP_DAY_KEY, k);
    } catch (e) {}
  }

  function getDayKeysFromDates() {
    const { start, end } = getTripDates();
    if (!start || !end || end < start) return [];
    const keys = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) keys.push(dateToKey(new Date(d)));
    return keys;
  }

  function renderDayRadio(dayKeys, destinations) {
    const el = document.getElementById("bp-day-radio");
    if (!el) return;
    el.innerHTML = "";
    if (!dayKeys.length) {
      el.innerHTML = '<div class="text-muted">Set start/end dates to select a day.</div>';
      return;
    }
    const current = getActiveDayKey() || dayKeys[0];
    if (!getActiveDayKey()) setActiveDayKey(current);
    dayKeys.forEach((k) => {
      const id = "bp-day-" + k;
      const labelTxt = new Date(k + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
      const label = document.createElement("label");
      label.setAttribute("for", id);
      label.innerHTML = `
        <input id="${escapeHtml(id)}" type="radio" name="bp-active-day" value="${escapeHtml(k)}" ${k === current ? "checked" : ""} />
        <span class="day-radio-text">
          <span class="day-radio-title">${escapeHtml(labelTxt)}</span>
          <span class="day-radio-sub">${escapeHtml(k)}</span>
        </span>
      `;
      label.querySelector("input")?.addEventListener("change", () => {
        setActiveDayKey(k);
        (destinations || []).forEach((d) => buildCalendar(d.id, d));
      });
      // Accept drops: move an item to this day (from whichever visible day)
      label.addEventListener("dragover", (e) => e.preventDefault());
      label.addEventListener("drop", (e) => {
        e.preventDefault();
        const json = e.dataTransfer.getData("application/json");
        const fromDate = e.dataTransfer.getData("from-date");
        const fromSlot = e.dataTransfer.getData("from-slot");
        const fromIndex = e.dataTransfer.getData("from-index");
        if (!json) return;
        try {
          const payload = JSON.parse(json);
          const destId = (window.location.hash || "#bend").replace("#", "") || "bend";
          const it = getItinerary(destId);
          if (fromDate && fromSlot && fromIndex !== "" && it.days[fromDate] && Array.isArray(it.days[fromDate][fromSlot])) {
            const i = parseInt(fromIndex, 10);
            if (Number.isFinite(i) && it.days[fromDate][fromSlot][i] !== undefined) it.days[fromDate][fromSlot].splice(i, 1);
          }
          const dayData = it.days[k] || (it.days[k] = { food: [], activities: [] });
          const slot = isFoodCategory(payload.category) ? "food" : "activities";
          (dayData[slot] || (dayData[slot] = [])).push(payload);
          setItinerary(destId, it);
          setActiveDayKey(k);
          const dest = (destinations || []).find((x) => x.id === destId);
          if (dest) buildCalendar(destId, dest);
        } catch (err) {}
      });
      el.appendChild(label);
    });
  }

  function escapeHtml(s) {
    if (!s) return "";
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function safeLink(href, text) {
    if (!href || !href.startsWith("https://")) return escapeHtml(text || "");
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="act-link">${escapeHtml(text || href)}</a>`;
  }

  function getTripDates() {
    const startEl = document.getElementById("trip-start");
    const endEl = document.getElementById("trip-end");
    if (!startEl || !endEl) return { start: null, end: null };
    const start = startEl.value ? new Date(startEl.value + "T12:00:00") : null;
    const end = endEl.value ? new Date(endEl.value + "T12:00:00") : null;
    return { start, end };
  }

  function setDefaultTripDates() {
    const startEl = document.getElementById("trip-start");
    const endEl = document.getElementById("trip-end");
    if (!startEl || !endEl) return;
    if (startEl.value && endEl.value) return;
    // Default requested weekend: 2026-07-09 through 2026-07-12
    startEl.value = "2026-07-09";
    endEl.value = "2026-07-12";
    syncEndDateMin();
  }

  function syncEndDateMin() {
    const startEl = document.getElementById("trip-start");
    const endEl = document.getElementById("trip-end");
    if (!startEl || !endEl) return;
    const startVal = startEl.value;
    const endVal = endEl.value;
    endEl.min = startVal || "";
    if (endVal && startVal && endVal < startVal) endEl.value = startVal;
  }

  function dateToKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function isFoodCategory(cat) {
    return ["Restaurant", "Drink", "Food & Drink"].includes((cat || "").trim());
  }

  function normalizeItinerary(raw) {
    const it = raw && typeof raw === "object" ? raw : {};
    if (it.days && typeof it.days === "object") return it;
    // migrate v1: { [date]: { lodging, activities } }
    const out = { tripLodging: null, days: {} };
    Object.keys(it).forEach((k) => {
      const v = it[k];
      if (!v || typeof v !== "object") return;
      if (!out.tripLodging && v.lodging) out.tripLodging = v.lodging;
      const acts = Array.isArray(v.activities) ? v.activities : [];
      const food = [];
      const activities = [];
      acts.forEach((a) => (isFoodCategory(a.category) ? food : activities).push(a));
      out.days[k] = { food, activities };
    });
    return out;
  }

  function getItinerary(destId) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { tripLodging: null, days: {} };
      const all = JSON.parse(raw);
      return normalizeItinerary(all[destId]);
    } catch (e) {
      return { tripLodging: null, days: {} };
    }
  }

  function setItinerary(destId, itinerary) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const all = raw ? JSON.parse(raw) : {};
      all[destId] = itinerary;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch (e) {}
  }

  function getPanel(destId) {
    return document.querySelector(`[data-dest="${destId}"]`);
  }

  function switchTab(destId) {
    TAB_IDS.forEach((id) => {
      const tab = document.getElementById("tab-" + id);
      const p = getPanel(id);
      if (tab) tab.setAttribute("aria-selected", id === destId ? "true" : "false");
      if (p) {
        if (id === destId) {
          p.classList.add("is-visible");
          p.removeAttribute("hidden");
        } else {
          p.classList.remove("is-visible");
          p.setAttribute("hidden", "");
        }
      }
    });
    window.location.hash = destId;
    if (itineraryMaps[destId]) setTimeout(() => itineraryMaps[destId].invalidateSize(), 100);
  }

  function initTabs() {
    const hash = (window.location.hash || "#bend").replace("#", "");
    const initial = TAB_IDS.includes(hash) ? hash : "bend";
    switchTab(initial);
    TAB_IDS.forEach((id) => {
      const btn = document.getElementById("tab-" + id);
      if (btn) btn.addEventListener("click", () => switchTab(id));
    });
    window.addEventListener("hashchange", () => {
      const h = (window.location.hash || "#bend").replace("#", "");
      if (TAB_IDS.includes(h)) switchTab(h);
    });
  }

  function renderOverview(dest) {
    const taglineEl = document.getElementById("tagline-" + dest.id);
    const glanceEl = document.getElementById("glance-" + dest.id);
    if (taglineEl) taglineEl.textContent = dest.tagline || "";
    if (glanceEl) {
      glanceEl.innerHTML = `
        <dt>Best time</dt><dd>${escapeHtml(dest.best_season || "")}</dd>
        <dt>Getting there</dt><dd>${escapeHtml(dest.flight_notes || "")}</dd>
        <dt>Vibe</dt><dd>${escapeHtml(dest.vibe || "")}</dd>
      `;
    }
  }

  function weatherCodeToDesc(code) {
    const t = {
      0: "Clear",
      1: "Mainly clear",
      2: "Partly cloudy",
      3: "Overcast",
      45: "Fog",
      48: "Fog",
      51: "Drizzle",
      53: "Drizzle",
      55: "Drizzle",
      61: "Slight rain",
      63: "Rain",
      65: "Heavy rain",
      80: "Showers",
      81: "Showers",
      82: "Showers",
      95: "Thunderstorm",
      96: "Thunderstorm",
    };
    return t[code] || "—";
  }

  function renderWeather(destId, weatherData) {
    const el = document.getElementById("weather-" + destId);
    if (!el) return;
    if (!weatherData.daily || weatherData.error) {
      el.innerHTML = '<p class="weather-day">Weather unavailable. Set dates above.</p>';
      return;
    }
    const isHistorical = !!weatherData.historical_reference;
    const wrap = el.closest(".card");
    let noteEl = wrap?.querySelector(".weather-note");
    if (wrap) {
      if (isHistorical && !noteEl) {
        noteEl = document.createElement("p");
        noteEl.className = "weather-note text-muted";
        noteEl.setAttribute("role", "status");
        wrap.insertBefore(noteEl, wrap.querySelector(".weather-grid") || el);
      }
      if (noteEl) {
        noteEl.textContent = isHistorical ? "Typical weather (based on same dates last year — historical reference)" : "";
        noteEl.style.display = isHistorical ? "block" : "none";
      }
    }

    const days = weatherData.daily.time || [];
    const maxT = weatherData.daily.temperature_2m_max || [];
    const minT = weatherData.daily.temperature_2m_min || [];
    const precip = weatherData.daily.precipitation_sum || [];
    const codes = weatherData.daily.weathercode || [];

    el.innerHTML = "";
    days.forEach((d, i) => {
      const dateStr = new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
      const max = maxT[i] != null ? Math.round(maxT[i]) : "—";
      const min = minT[i] != null ? Math.round(minT[i]) : "—";
      const pr = precip[i] != null ? precip[i] : 0;
      const code = codes[i] != null ? codes[i] : 0;
      const div = document.createElement("div");
      div.className = "weather-day";
      div.setAttribute("role", "listitem");
      div.innerHTML = `<div class="date">${escapeHtml(dateStr)}</div><div class="temp">${max}° / ${min}°</div><div class="desc">${weatherCodeToDesc(code)}</div><div class="precip">${pr > 0 ? "Rain: " + pr + " mm" : "Dry"}</div>`;
      el.appendChild(div);
    });
  }

  function getActivitiesForDest(dest) {
    return Array.isArray(dest.compendium_activities) ? dest.compendium_activities : [];
  }

  function getLodgingForDest(dest) {
    return Array.isArray(dest.compendium_lodging) ? dest.compendium_lodging : [];
  }

  function renderPager(pagerEl, page, totalPages, onChange) {
    if (!pagerEl) return;
    if (totalPages <= 1) {
      pagerEl.innerHTML = "";
      return;
    }
    pagerEl.innerHTML = `
      <span class="pager-label">Page ${page} of ${totalPages}</span>
      <span class="pager-controls">
        <button type="button" class="pager-btn" data-dir="prev" ${page <= 1 ? "disabled" : ""}>Prev</button>
        <button type="button" class="pager-btn" data-dir="next" ${page >= totalPages ? "disabled" : ""}>Next</button>
      </span>
    `;
    pagerEl.querySelectorAll(".pager-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const dir = btn.getAttribute("data-dir");
        if (dir === "prev" && page > 1) onChange(page - 1);
        if (dir === "next" && page < totalPages) onChange(page + 1);
      });
    });
  }

  async function removeFromLibrary(destination, type, id) {
    const res = await fetch("/api/bachelor-party/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destination, type, id }),
    });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || "Remove failed");
    return out;
  }

  function renderActivities(dest) {
    const listEl = document.getElementById("activities-list-" + dest.id);
    const filterEl = document.getElementById("filter-" + dest.id);
    const pagerEl = document.getElementById("pager-activities-" + dest.id);
    if (!listEl) return;

    const st = uiState[dest.id] || uiState.bend;
    const all = getActivitiesForDest(dest);
    const category = (filterEl?.value || st.activityFilter || "").trim();
    st.activityFilter = category;
    const filtered = all.filter((a) => !category || a.category === category);
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (st.activityPage > totalPages) st.activityPage = totalPages;
    const pageItems = filtered.slice((st.activityPage - 1) * PAGE_SIZE, st.activityPage * PAGE_SIZE);

    listEl.innerHTML = "";
    pageItems.forEach((a) => {
      const li = document.createElement("li");
      li.className = "activity-chip";
      li.draggable = true;
      li.dataset.kind = "activity";
      li.dataset.json = JSON.stringify(a);
      const linkPart = a.url ? safeLink(a.url, a.name) : escapeHtml(a.name);
      li.innerHTML = `
        <span class="act-category">${escapeHtml(a.category || "")}</span>
        ${linkPart}
        ${a.notes ? `<span class="act-notes">— ${escapeHtml(a.notes)}</span>` : ""}
        <span class="item-actions"><button type="button" class="item-remove" aria-label="Remove from library">×</button></span>
      `;
      li.querySelector(".item-remove")?.addEventListener("click", async (e) => {
        e.preventDefault();
        await removeFromLibrary(dest.id, "activity", a.id);
        data = await fetch("/api/bachelor-party").then((r) => r.json());
        const d = (data.destinations || []).find((x) => x.id === dest.id);
        if (d) renderActivities(d);
      });
      li.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("application/json", li.dataset.json || "{}");
        e.dataTransfer.effectAllowed = "copy";
        li.classList.add("dragging");
      });
      li.addEventListener("dragend", () => li.classList.remove("dragging"));
      listEl.appendChild(li);
    });

    renderPager(pagerEl, st.activityPage, totalPages, (p) => {
      st.activityPage = p;
      renderActivities(dest);
    });
    if (filterEl && !filterEl.dataset.bound) {
      filterEl.dataset.bound = "1";
      filterEl.addEventListener("change", () => {
        st.activityPage = 1;
        renderActivities(dest);
      });
    }
  }

  function renderStay(dest) {
    const el = document.getElementById(dest.id === "banff" ? "stay-list-banff" : "stay-bend");
    const pagerEl = document.getElementById("pager-lodging-" + dest.id);
    if (!el) return;

    const st = uiState[dest.id] || uiState.bend;
    const all = getLodgingForDest(dest);
    const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    if (st.lodgingPage > totalPages) st.lodgingPage = totalPages;
    const pageItems = all.slice((st.lodgingPage - 1) * PAGE_SIZE, st.lodgingPage * PAGE_SIZE);

    el.innerHTML = "";
    pageItems.forEach((s) => {
      const div = document.createElement("div");
      div.className = "stay-item activity-chip";
      div.draggable = true;
      div.dataset.kind = "lodging";
      div.dataset.json = JSON.stringify(s);
      const linkPart = s.url ? safeLink(s.url, s.name) : escapeHtml(s.name);
      div.innerHTML = `
        <div class="stay-type">${linkPart}</div>
        <div class="stay-suggestion">${escapeHtml(s.type || "")}${s.notes ? " — " + escapeHtml(s.notes) : ""}</div>
        ${s.ballpark ? `<div class="stay-ballpark">${escapeHtml(s.ballpark)}</div>` : ""}
        <span class="item-actions"><button type="button" class="item-remove" aria-label="Remove from library">×</button></span>
      `;
      div.querySelector(".item-remove")?.addEventListener("click", async (e) => {
        e.preventDefault();
        await removeFromLibrary(dest.id, "lodging", s.id);
        data = await fetch("/api/bachelor-party").then((r) => r.json());
        const d = (data.destinations || []).find((x) => x.id === dest.id);
        if (d) renderStay(d);
      });
      div.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("application/json", div.dataset.json || "{}");
        e.dataTransfer.effectAllowed = "copy";
        div.classList.add("dragging");
      });
      div.addEventListener("dragend", () => div.classList.remove("dragging"));
      el.appendChild(div);
    });

    renderPager(pagerEl, st.lodgingPage, totalPages, (p) => {
      st.lodgingPage = p;
      renderStay(dest);
    });
  }

  function setupTripLodgingDrop(el, destId, dest) {
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      el.classList.add("drag-over");
    });
    el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.classList.remove("drag-over");
      const json = e.dataTransfer.getData("application/json");
      if (!json) return;
      const payload = JSON.parse(json);
      if (!payload || (!payload.type && !payload.ballpark && !payload.nightly_cost)) return;
      const it = getItinerary(destId);
      it.tripLodging = payload;
      setItinerary(destId, it);
      buildCalendar(destId, dest);
    });
  }

  function setupActivityDropZone(zoneEl, destId, dateKey, slot, it, dest) {
    zoneEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      zoneEl.classList.add("drag-over");
    });
    zoneEl.addEventListener("dragleave", () => zoneEl.classList.remove("drag-over"));
    zoneEl.addEventListener("drop", (e) => {
      e.preventDefault();
      zoneEl.classList.remove("drag-over");
      const json = e.dataTransfer.getData("application/json");
      const fromDate = e.dataTransfer.getData("from-date");
      const fromSlot = e.dataTransfer.getData("from-slot");
      const fromIndex = e.dataTransfer.getData("from-index");
      if (!json) return;
      const payload = JSON.parse(json);
      if (!payload || payload.type || payload.ballpark || payload.nightly_cost) return;

      if (fromDate && fromSlot && fromIndex !== "" && it.days[fromDate] && Array.isArray(it.days[fromDate][fromSlot])) {
        const i = parseInt(fromIndex, 10);
        if (Number.isFinite(i) && it.days[fromDate][fromSlot][i] !== undefined) it.days[fromDate][fromSlot].splice(i, 1);
      }

      const dayData = it.days[dateKey] || (it.days[dateKey] = { food: [], activities: [] });
      (dayData[slot] || (dayData[slot] = [])).push(payload);
      setItinerary(destId, it);
      buildCalendar(destId, dest);
    });
  }

  function buildCalendar(destId, dest) {
    const { start, end } = getTripDates();
    const calendarEl = document.getElementById("calendar-" + destId);
    const tripLodgingEl = document.getElementById("trip-lodging-" + destId);
    if (!calendarEl || !tripLodgingEl) return;

    const it = getItinerary(destId);
    calendarEl.innerHTML = "";
    tripLodgingEl.innerHTML = "";
    setupTripLodgingDrop(tripLodgingEl, destId, dest);

    if (it.tripLodging) {
      const chip = document.createElement("div");
      chip.className = "lodging-chip";
      chip.innerHTML = `${it.tripLodging.url ? safeLink(it.tripLodging.url, it.tripLodging.name) : escapeHtml(it.tripLodging.name)} <button type="button" class="chip-remove" aria-label="Remove">×</button>`;
      tripLodgingEl.appendChild(chip);
      chip.querySelector(".chip-remove")?.addEventListener("click", (e) => {
        e.preventDefault();
        it.tripLodging = null;
        setItinerary(destId, it);
        buildCalendar(destId, dest);
      });
    }

    if (!start || !end || end < start) {
      calendarEl.innerHTML = '<p class="text-muted">Set start and end dates above.</p>';
      updateItineraryMap(destId, dest, it, []);
      return;
    }

    const dayKeys = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) dayKeys.push(dateToKey(new Date(d)));
    const active = getActiveDayKey() || dayKeys[0];
    if (active) setActiveDayKey(active);

    dayKeys.filter((k) => k === active).forEach((key) => {
      const dateStr = new Date(key + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
      const dayData = it.days[key] || (it.days[key] = { food: [], activities: [] });
      const dayDiv = document.createElement("div");
      dayDiv.className = "calendar-day";
      dayDiv.innerHTML = `
        <div class="calendar-day-header">${escapeHtml(dateStr)}</div>
        <div class="calendar-day-body">
          <div class="drop-col">
            <div class="calendar-col-title">Food</div>
            <div class="activity-drop-zone" data-date="${escapeHtml(key)}" data-slot="food" aria-label="Food for ${escapeHtml(dateStr)}"></div>
          </div>
          <div class="drop-col">
            <div class="calendar-col-title">Activities</div>
            <div class="activity-drop-zone" data-date="${escapeHtml(key)}" data-slot="activities" aria-label="Activities for ${escapeHtml(dateStr)}"></div>
          </div>
        </div>
      `;

      const foodZone = dayDiv.querySelector('[data-slot="food"]');
      const actZone = dayDiv.querySelector('[data-slot="activities"]');

      function renderZone(zoneEl, items, slotName) {
        zoneEl.innerHTML = "";
        (items || []).forEach((a, idx) => {
          const chip = document.createElement("div");
          chip.className = "activity-chip";
          chip.draggable = true;
          chip.dataset.json = JSON.stringify(a);
          chip.innerHTML = `${a.url ? safeLink(a.url, a.name) : escapeHtml(a.name)} <button type="button" class="chip-remove" aria-label="Remove">×</button>`;
          chip.querySelector(".chip-remove")?.addEventListener("click", (e) => {
            e.preventDefault();
            items.splice(idx, 1);
            setItinerary(destId, it);
            buildCalendar(destId, dest);
          });
          chip.addEventListener("dragstart", (e) => {
            e.dataTransfer.setData("application/json", chip.dataset.json);
            e.dataTransfer.setData("from-date", key);
            e.dataTransfer.setData("from-slot", slotName);
            e.dataTransfer.setData("from-index", String(idx));
            e.dataTransfer.effectAllowed = "move";
            chip.classList.add("dragging");
          });
          chip.addEventListener("dragend", () => chip.classList.remove("dragging"));
          chip.addEventListener("dragover", (e) => e.preventDefault());
          chip.addEventListener("drop", (e) => {
            e.preventDefault();
            const fromDate = e.dataTransfer.getData("from-date");
            const fromSlot = e.dataTransfer.getData("from-slot");
            const fromIndex = e.dataTransfer.getData("from-index");
            if (fromDate === key && fromSlot === slotName) {
              const i = parseInt(fromIndex, 10);
              if (Number.isFinite(i) && items[i]) {
                const [moved] = items.splice(i, 1);
                items.splice(idx, 0, moved);
                setItinerary(destId, it);
                buildCalendar(destId, dest);
              }
            }
          });
          zoneEl.appendChild(chip);
        });
        setupActivityDropZone(zoneEl, destId, key, slotName, it, dest);
      }

      renderZone(foodZone, dayData.food, "food");
      renderZone(actZone, dayData.activities, "activities");

      calendarEl.appendChild(dayDiv);
    });

    setItinerary(destId, it);
    updateItineraryMap(destId, dest, it, dayKeys);
  }

  function updateItineraryMap(destId, dest, it, dayKeys) {
    const mapEl = document.getElementById("itinerary-map-" + destId);
    if (!mapEl) return;
    if (!itineraryMaps[destId]) {
      itineraryMaps[destId] = L.map(mapEl).setView([dest.lat, dest.lng], 10);
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { attribution: "&copy; OSM, CARTO" }).addTo(itineraryMaps[destId]);
      itineraryLayers[destId] = L.layerGroup().addTo(itineraryMaps[destId]);
    }
    const map = itineraryMaps[destId];
    itineraryLayers[destId].clearLayers();
    const bounds = [];
    const active = getActiveDayKey();

    if (it.tripLodging && it.tripLodging.lat != null && it.tripLodging.lng != null) {
      const m = L.circleMarker([it.tripLodging.lat, it.tripLodging.lng], { radius: 10, fillColor: "#ffffff", color: "#000", weight: 1, fillOpacity: 0.85 }).addTo(itineraryLayers[destId]);
      m.bindPopup(`<strong>${escapeHtml(it.tripLodging.name)}</strong> (lodging)`);
      m.bindTooltip(escapeHtml(it.tripLodging.name || "Lodging"), { permanent: true, direction: "top", opacity: 0.85 });
      bounds.push([it.tripLodging.lat, it.tripLodging.lng]);
    }

    (dayKeys || []).forEach((dateKey, i) => {
      if (active && dateKey !== active) return;
      const color = DATE_COLORS[i % DATE_COLORS.length];
      const dayData = (it.days || {})[dateKey] || { food: [], activities: [] };
      [...(dayData.food || []), ...(dayData.activities || [])].forEach((a) => {
        if (!a || a.lat == null || a.lng == null) return;
        const m = L.circleMarker([a.lat, a.lng], { radius: 8, fillColor: color, color: "#fff", weight: 1, fillOpacity: 0.9 }).addTo(itineraryLayers[destId]);
        m.bindPopup(`<strong>${escapeHtml(a.name)}</strong> (${dateKey})`);
        m.bindTooltip(escapeHtml(a.name || "Stop"), { permanent: true, direction: "top", opacity: 0.85 });
        bounds.push([a.lat, a.lng]);
      });
    });

    if (bounds.length > 1) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 12 });
  }

  function formatMeters(m) {
    const km = m / 1000;
    if (km < 1) return `${Math.round(m)} m`;
    return `${km.toFixed(km < 10 ? 1 : 0)} km`;
  }
  function formatSeconds(s) {
    const mins = Math.round(s / 60);
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m}m`;
  }

  async function drawRouteForDest(destId) {
    const modeEl = document.getElementById("bp-route-mode-" + destId);
    const summaryEl = document.getElementById("bp-route-summary-" + destId);
    const mode = (modeEl?.value || "walking").trim();
    const it = getItinerary(destId);
    const active = getActiveDayKey();
    if (!active) {
      if (summaryEl) summaryEl.textContent = "Pick a day first.";
      return;
    }
    const day = (it.days || {})[active] || { food: [], activities: [] };
    const pts = [];
    if (it.tripLodging && it.tripLodging.lat != null && it.tripLodging.lng != null) pts.push({ lat: it.tripLodging.lat, lng: it.tripLodging.lng });
    [...(day.food || []), ...(day.activities || [])].forEach((a) => {
      if (a?.lat != null && a?.lng != null) pts.push({ lat: a.lat, lng: a.lng });
    });
    if (it.tripLodging && it.tripLodging.lat != null && it.tripLodging.lng != null && pts.length > 1) pts.push({ lat: it.tripLodging.lat, lng: it.tripLodging.lng });
    if (pts.length < 2) {
      if (summaryEl) summaryEl.textContent = "Need 2+ pinned stops to draw a route.";
      return;
    }
    if (summaryEl) summaryEl.textContent = "Drawing…";
    const map = itineraryMaps[destId];
    const layer = itineraryLayers[destId];
    try {
      const res = await fetch("/api/public/osrm/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waypoints: pts, mode }),
      });
      const j = await res.json();
      if (!res.ok || j.error) {
        if (summaryEl) summaryEl.textContent = j.error || "Route failed.";
        return;
      }
      const route = j.routes?.[0];
      const geom = route?.geometry;
      if (!geom?.coordinates) {
        if (summaryEl) summaryEl.textContent = "No route geometry.";
        return;
      }
      // remove previous route if present
      if (layer.__route) {
        try { layer.removeLayer(layer.__route); } catch (e) {}
        layer.__route = null;
      }
      const latlngs = geom.coordinates.map((c) => [c[1], c[0]]);
      layer.__route = L.polyline(latlngs, { color: "#55a6ff", weight: 5, opacity: 0.8 }).addTo(layer);
      if (summaryEl) summaryEl.textContent = `Route: ${formatMeters(route.distance || 0)} · ${formatSeconds(route.duration || 0)} (${mode})`;
    } catch (e) {
      if (summaryEl) summaryEl.textContent = "Route failed.";
    }
  }

  function clearRouteForDest(destId) {
    const summaryEl = document.getElementById("bp-route-summary-" + destId);
    const layer = itineraryLayers[destId];
    if (layer?.__route) {
      try { layer.removeLayer(layer.__route); } catch (e) {}
      layer.__route = null;
    }
    if (summaryEl) summaryEl.textContent = "";
  }

  function exportPdfForDest(dest) {
    const destId = dest.id;
    const it = getItinerary(destId);
    const dayKeys = getDayKeysFromDates();
    const w = window.open("", "_blank");
    if (!w) return;
    const html = `
<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(dest.name)} itinerary</title>
<style>
body{font-family:Segoe UI,system-ui,sans-serif;margin:24px;color:#111;}
h1{margin:0 0 6px 0;}
.muted{color:#555;margin:0 0 16px 0;}
.day{border:1px solid #ddd;border-radius:10px;padding:14px 16px;margin:14px 0;}
.day h2{margin:0 0 10px 0;font-size:16px;}
.item{display:grid;grid-template-columns:90px 1fr;gap:10px;padding:6px 0;border-bottom:1px solid #eee;}
.item:last-child{border-bottom:none;}
.slot{font-size:12px;color:#555;text-transform:uppercase;letter-spacing:0.06em;}
a{color:#0b60d1;text-decoration:underline;}
</style></head><body>
<h1>${escapeHtml(dest.name)}</h1>
<p class="muted">${escapeHtml((document.getElementById("trip-start")?.value || "") + " → " + (document.getElementById("trip-end")?.value || ""))}</p>
${it.tripLodging ? `<p class="muted"><strong>Lodging:</strong> ${it.tripLodging.url ? `<a href="${escapeHtml(it.tripLodging.url)}">${escapeHtml(it.tripLodging.name)}</a>` : escapeHtml(it.tripLodging.name)}</p>` : ""}
${dayKeys.map(k=>{
  const d = new Date(k+"T12:00:00").toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short",year:"numeric"});
  const day = (it.days||{})[k] || {food:[],activities:[]};
  const items = [];
  (day.food||[]).forEach(a=>items.push({slot:"Food", a}));
  (day.activities||[]).forEach(a=>items.push({slot:"Activity", a}));
  const rows = items.map(({slot,a})=>`<div class="item"><div><div class="slot">${slot}</div></div><div>${a.url ? `<a href="${escapeHtml(a.url)}">${escapeHtml(a.name)}</a>` : escapeHtml(a.name)}</div></div>`).join("");
  return `<div class="day"><h2>${escapeHtml(d)}</h2>${rows || "<div class='muted'>No items</div>"}</div>`;
}).join("")}
<script>window.onload=()=>window.print();</script>
</body></html>`;
    w.document.open(); w.document.write(html); w.document.close();
  }

  async function fetchWeatherForDates(destId, start, end) {
    if (!start || !end) return {};
    const startStr = start.toISOString().slice(0, 10);
    const endStr = end.toISOString().slice(0, 10);
    const res = await fetch(`/api/bachelor-party/weather/${destId}?start_date=${startStr}&end_date=${endStr}`);
    return res.json();
  }

  function initAddToLibrary() {
    document.querySelectorAll(".add-library-form").forEach((form) => {
      const destId = form.dataset.dest;
      const typeSelect = form.querySelector('select[name="type"]');
      const categorySelect = form.querySelector('select[name="category"]');
      const lodgingOnly = form.querySelectorAll(".add-lodging-only");

      function syncMode() {
        const isLodging = (typeSelect?.value || "activity") === "lodging";
        lodgingOnly.forEach((el) => el.classList.toggle("is-hidden", !isLodging));
        if (categorySelect) categorySelect.classList.toggle("is-hidden", isLodging);
      }
      typeSelect?.addEventListener("change", syncMode);
      syncMode();

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const url = (form.querySelector('input[name="url"]')?.value || "").trim();
        const name = (form.querySelector('input[name="name"]')?.value || "").trim();
        const category = (form.querySelector('select[name="category"]')?.value || "").trim();
        const lodgingType = (form.querySelector('select[name="lodging_type"]')?.value || "").trim();
        const nightly = (form.querySelector('input[name="nightly"]')?.value || "").trim();
        const type = (typeSelect?.value || "activity").trim();
        const statusEl = document.getElementById("add-library-status-" + destId);

        if (!url) {
          if (statusEl) {
            statusEl.textContent = "Please enter a URL.";
            statusEl.className = "add-library-status error";
          }
          return;
        }
        if (statusEl) {
          statusEl.textContent = "Adding…";
          statusEl.className = "add-library-status";
        }

        const res = await fetch("/api/bachelor-party/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url,
            destination: destId,
            type,
            name: name || undefined,
            category: category || undefined,
            lodging_type: lodgingType || undefined,
            nightly: nightly || undefined,
          }),
        });
        const out = await res.json();
        if (!res.ok) {
          if (statusEl) {
            statusEl.textContent = out.error || "Failed to add.";
            statusEl.className = "add-library-status error";
          }
          return;
        }

        data = await fetch("/api/bachelor-party").then((r) => r.json());
        const dest = (data.destinations || []).find((d) => d.id === destId);
        if (dest) {
          renderActivities(dest);
          renderStay(dest);
          buildCalendar(destId, dest);
        }
        if (statusEl) {
          statusEl.textContent = "Added. It’s now in the list above.";
          statusEl.className = "add-library-status success";
        }
        form.reset();
        syncMode();
      });
    });
  }

  async function load() {
    try {
      setDefaultTripDates();
      const startEl = document.getElementById("trip-start");
      const endEl = document.getElementById("trip-end");

      data = await fetch("/api/bachelor-party").then((r) => r.json());
      const destinations = data.destinations || [];

      destinations.forEach((dest) => {
        renderOverview(dest);
        renderActivities(dest);
        renderStay(dest);
        buildCalendar(dest.id, dest);
      });

      // Day picker
      renderDayRadio(getDayKeysFromDates(), destinations);
      destinations.forEach((dest) => {
        document.getElementById("bp-route-draw-" + dest.id)?.addEventListener("click", () => drawRouteForDest(dest.id));
        document.getElementById("bp-route-clear-" + dest.id)?.addEventListener("click", () => clearRouteForDest(dest.id));
        document.getElementById("bp-export-" + dest.id)?.addEventListener("click", () => exportPdfForDest(dest));
      });

      async function refreshWeatherAndCalendar() {
        syncEndDateMin();
        const { start, end } = getTripDates();
        renderDayRadio(getDayKeysFromDates(), destinations);
        for (const dest of destinations) {
          const w = await fetchWeatherForDates(dest.id, start, end);
          renderWeather(dest.id, w);
          buildCalendar(dest.id, dest);
        }
      }

      startEl?.addEventListener("change", () => {
        syncEndDateMin();
        endEl?.focus();
        if (typeof endEl?.showPicker === "function") {
          try {
            endEl.showPicker();
          } catch (err) {}
        }
        refreshWeatherAndCalendar();
      });
      endEl?.addEventListener("change", refreshWeatherAndCalendar);

      const { start, end } = getTripDates();
      const [bendW, banffW] = await Promise.all([
        fetchWeatherForDates("bend", start, end),
        fetchWeatherForDates("banff", start, end),
      ]);
      renderWeather("bend", bendW);
      renderWeather("banff", banffW);

      initTabs();
      initAddToLibrary();
    } catch (e) {
      console.error(e);
      const main = document.querySelector(".main--tabs");
      if (main) main.innerHTML = "<p>Could not load destinations. Is the server running?</p>";
    }
  }

  load();
})();

