(function () {
  const mapEl = document.getElementById("map");
  const scheduleEl = document.getElementById("schedule");
  const weatherEl = document.getElementById("weather-grid");
  const weatherNoteEl = document.getElementById("weather-note");
  const flightsEl = document.getElementById("flights");
  const tripDatesEl = document.getElementById("trip-dates");
  const hotelSelectEl = document.getElementById("hotel-select");
  const hotelPinBtn = document.getElementById("hotel-pin-btn");
  const hotelClearBtn = document.getElementById("hotel-clear-btn");
  const hotelDetailsEl = document.getElementById("hotel-details");
  const daySelectEl = document.getElementById("day-select");
  const tripModeEl = document.getElementById("trip-mode");
  const dayRadioEl = document.getElementById("day-radio");
  const routeModeEl = document.getElementById("route-mode");
  const routeDrawBtn = document.getElementById("route-draw");
  const routeClearBtn = document.getElementById("route-clear");
  const routeSummaryEl = document.getElementById("route-summary");
  const baseHotelUrlEl = document.getElementById("base-hotel-url");
  const baseHotelSetEl = document.getElementById("base-hotel-set");
  const baseHotelClearEl = document.getElementById("base-hotel-clear");
  const baseHotelDetailsEl = document.getElementById("base-hotel-details");
  const exportPdfEl = document.getElementById("export-pdf");
  const restQEl = document.getElementById("rest-q");
  const restSearchEl = document.getElementById("rest-search");
  const restResultsEl = document.getElementById("rest-results");
  const restPagerEl = document.getElementById("rest-pager");
  const restHintEl = document.getElementById("rest-hint");
  const restRadiusEl = document.getElementById("rest-radius");
  const restDropPinEl = document.getElementById("rest-drop-pin");

  let map = null;
  let markers = [];
  let markerIndex = {
    byId: new Map(), // id -> marker
    byDay: new Map(), // date -> [id]
    allIds: [],
  };
  let activeDay = null;
  let selectedHotel = null;
  let selectedHotelMarkerId = null;
  let tripMode = false;
  let completedIds = new Set();
  let currentItinerary = null;
  let activeScheduleDay = null;
  let routeGroup = null;
  let routeRequestId = 0;
  let baseHotel = null;
  let baseHotelMarkerId = null;
  let dragDrop = { draggingId: null, beforeId: null, after: false };
  let restState = { results: [], page: 0 };
  let restMode = "day";
  let restPin = null;
  let restPinMarker = null;
  let restLayer = null;

  const REST_PAGE_SIZE = 3;

  const ITIN_STORAGE_KEY = "portugal_itinerary_v1";
  const TRIP_MODE_KEY = "portugal_trip_mode_v1";
  const CHECKLIST_KEY = "portugal_checklist_v1";
  const SCHEDULE_DAY_KEY = "portugal_schedule_day_v1";
  const BASE_HOTEL_KEY = "portugal_base_hotel_v1";

  function setActiveDayHeaderUI() {
    document.querySelectorAll(".day-header").forEach((el) => {
      const dateKey = el.getAttribute("data-date") || "";
      if (activeDay && dateKey === activeDay) el.classList.add("day-header--active");
      else el.classList.remove("day-header--active");
    });
  }

  function initMap() {
    map = L.map("map").setView([39.5, -8.5], 7);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap, &copy; CARTO",
    }).addTo(map);
    routeGroup = L.layerGroup().addTo(map);
    restLayer = L.layerGroup().addTo(map);
  }

  function clearRoute() {
    routeRequestId++;
    try { routeGroup?.clearLayers(); } catch {}
    if (routeSummaryEl) routeSummaryEl.textContent = "";
  }

  function clearDropStyles(container) {
    (container?.querySelectorAll?.(".activity.drop-before, .activity.drop-after") || []).forEach((el) => {
      el.classList.remove("drop-before", "drop-after");
    });
  }

  function getInsertionTarget(container, clientX, clientY) {
    if (!container) return { beforeId: null, targetEl: null, after: false };
    const el = document.elementFromPoint(clientX, clientY);
    const act = el?.closest?.(".activity");
    if (act && container.contains(act)) {
      const rect = act.getBoundingClientRect();
      const after = (clientY - rect.top) > rect.height / 2;
      if (after) {
        // insert after current => before next
        let next = act.nextElementSibling;
        while (next && !next.classList?.contains("activity")) next = next.nextElementSibling;
        return { beforeId: next?.dataset?.id || null, targetEl: act, after: true };
      }
      return { beforeId: act.dataset.id || null, targetEl: act, after: false };
    }

    // If dropped in whitespace above the list, insert before first item
    const first = container.querySelector(".activity");
    if (first) {
      const r = first.getBoundingClientRect();
      if (clientY < r.top) return { beforeId: first.dataset.id || null, targetEl: first, after: false };
    }
    // Otherwise append to end
    return { beforeId: null, targetEl: null, after: false };
  }

  function removeActivity(activityId) {
    if (!currentItinerary || !activityId) return;
    for (const day of currentItinerary.days || []) {
      const idx = (day.activities || []).findIndex((a) => (a?.id || a?.__id) === activityId);
      if (idx >= 0) {
        day.activities.splice(idx, 1);
        completedIds.delete(activityId);
        saveCompleted();
        saveLocalItinerary(currentItinerary);
        syncAfterItineraryChange();
        return;
      }
    }
  }

  function gatherDayWaypoints(dateKey) {
    const day = (currentItinerary?.days || []).find((d) => d?.date === dateKey);
    if (!day) return [];
    const pts = [];
    if (baseHotel && baseHotel.lat != null && baseHotel.lng != null) {
      pts.push({ lat: baseHotel.lat, lng: baseHotel.lng, name: baseHotel.name || "Hotel" });
    }
    (day.activities || []).forEach((a) => {
      if (a?.lat != null && a?.lng != null) pts.push({ lat: a.lat, lng: a.lng, name: a.name || "" });
    });
    if (baseHotel && baseHotel.lat != null && baseHotel.lng != null && pts.length > 1) {
      pts.push({ lat: baseHotel.lat, lng: baseHotel.lng, name: baseHotel.name || "Hotel" });
    }
    return pts;
  }

  function formatMeters(m) {
    if (m == null) return "";
    const km = m / 1000;
    if (km < 1) return `${Math.round(m)} m`;
    return `${km.toFixed(km < 10 ? 1 : 0)} km`;
  }

  function formatSeconds(s) {
    if (s == null) return "";
    const mins = Math.round(s / 60);
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m}m`;
  }

  async function drawRouteForActiveDay() {
    if (!activeDay) {
      if (routeSummaryEl) routeSummaryEl.textContent = "Pick a day to draw a route.";
      return;
    }
    const pts = gatherDayWaypoints(activeDay);
    if (pts.length < 2) {
      if (routeSummaryEl) routeSummaryEl.textContent = "Need at least 2 pinned locations on this day to draw a route.";
      return;
    }
    const mode = routeModeEl?.value || "walking";
    if (routeSummaryEl) routeSummaryEl.textContent = "Drawing route…";
    clearRoute();
    const myReq = routeRequestId;
    try {
      const res = await fetch("/api/osrm/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waypoints: pts.map((p) => ({ lat: p.lat, lng: p.lng })), mode }),
      });
      const j = await res.json();
      if (myReq !== routeRequestId) return;
      if (!res.ok || j.error) {
        const msg = j?.details ? `${j.error} (${j.details})` : (j.error || "Could not draw route.");
        if (routeSummaryEl) routeSummaryEl.textContent = msg;
        return;
      }
      const route = j.routes?.[0];
      const geom = route?.geometry;
      if (!geom || geom.type !== "LineString" || !Array.isArray(geom.coordinates)) {
        if (routeSummaryEl) routeSummaryEl.textContent = "No route geometry returned.";
        return;
      }
      const latlngs = geom.coordinates.map((c) => [c[1], c[0]]);
      L.polyline(latlngs, { color: "#55a6ff", weight: 5, opacity: 0.85 }).addTo(routeGroup);
      const dist = route?.distance || 0;
      const dur = route?.duration || 0;
      if (routeSummaryEl) routeSummaryEl.textContent = `Route (OSRM): ${formatMeters(dist)} · ${formatSeconds(dur)} (${mode})`;
    } catch (e) {
      if (routeSummaryEl) routeSummaryEl.textContent = "Route failed. Please try again.";
      console.error(e);
    }
  }

  function clearMarkers() {
    markers.forEach((m) => m.remove());
    markers = [];
  }

  function addMarker(id, lat, lng, label, popup) {
    const marker = L.marker([lat, lng])
      .addTo(map)
      .bindPopup(`<strong>${escapeHtml(label)}</strong><br>${escapeHtml(popup || "")}`);
    marker.bindTooltip(escapeHtml(label), {
      permanent: true,
      direction: "top",
      offset: [0, -10],
      opacity: 0.85,
      className: "pin-label",
    });
    marker.__id = id;
    marker.__isHotel = id.startsWith("hotel::") || id.startsWith("picked-hotel::") || id.startsWith("base-hotel::");
    markers.push(marker);
    markerIndex.byId.set(id, marker);
    return marker;
  }

  function escapeHtml(s) {
    if (!s) return "";
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function safeHttpsUrl(url) {
    const u = (url || "").trim();
    return u.startsWith("https://") ? u : "";
  }

  function loadCompleted() {
    try {
      const raw = localStorage.getItem(CHECKLIST_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      completedIds = new Set(Array.isArray(arr) ? arr : []);
    } catch {
      completedIds = new Set();
    }
  }

  function saveCompleted() {
    try {
      localStorage.setItem(CHECKLIST_KEY, JSON.stringify([...completedIds]));
    } catch {}
  }

  function loadTripMode() {
    try {
      tripMode = localStorage.getItem(TRIP_MODE_KEY) === "1";
    } catch {
      tripMode = false;
    }
    if (tripModeEl) tripModeEl.checked = tripMode;
  }

  function saveTripMode() {
    try {
      localStorage.setItem(TRIP_MODE_KEY, tripMode ? "1" : "0");
    } catch {}
  }

  function loadActiveScheduleDay() {
    try {
      activeScheduleDay = localStorage.getItem(SCHEDULE_DAY_KEY) || null;
    } catch {
      activeScheduleDay = null;
    }
  }

  function saveActiveScheduleDay() {
    try {
      if (activeScheduleDay) localStorage.setItem(SCHEDULE_DAY_KEY, activeScheduleDay);
    } catch {}
  }

  function newId() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return "id_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  function ensureStableActivityIds(itin) {
    (itin?.days || []).forEach((d) => {
      (d.activities || []).forEach((a) => {
        if (!a) return;
        if (!a.id) a.id = newId();
      });
    });
  }

  function loadLocalItinerary() {
    try {
      const raw = localStorage.getItem(ITIN_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function migrateLocalItinerary(localItin, serverItin) {
    // If user has older local data (e.g., only May 17–19), merge it into the newer server itinerary
    // by date so edits are preserved where possible, while new days appear.
    if (!localItin || !serverItin) return serverItin || localItin;
    const localDays = Array.isArray(localItin.days) ? localItin.days : [];
    const serverDays = Array.isArray(serverItin.days) ? serverItin.days : [];
    const localTrip = localItin.trip || {};
    const serverTrip = serverItin.trip || {};

    const serverRangeChanged =
      (localTrip.start_date && serverTrip.start_date && localTrip.start_date !== serverTrip.start_date) ||
      (localTrip.end_date && serverTrip.end_date && localTrip.end_date !== serverTrip.end_date);
    const localIsSmaller = localDays.length > 0 && serverDays.length > 0 && localDays.length < serverDays.length;

    if (!serverRangeChanged && !localIsSmaller) return localItin;

    const byDate = new Map(localDays.filter((d) => d && d.date).map((d) => [d.date, d]));
    const merged = {
      ...serverItin,
      days: serverDays.map((sd) => {
        const ld = sd?.date ? byDate.get(sd.date) : null;
        if (!ld) return sd;
        return {
          ...sd,
          // keep user-edited activities for that date if present
          activities: Array.isArray(ld.activities) ? ld.activities : sd.activities,
        };
      }),
    };
    return merged;
  }

  function saveLocalItinerary(itin) {
    try {
      localStorage.setItem(ITIN_STORAGE_KEY, JSON.stringify(itin));
    } catch {}
  }

  function loadBaseHotel() {
    try {
      const raw = localStorage.getItem(BASE_HOTEL_KEY);
      baseHotel = raw ? JSON.parse(raw) : null;
    } catch {
      baseHotel = null;
    }
  }

  function saveBaseHotel() {
    try {
      if (baseHotel) localStorage.setItem(BASE_HOTEL_KEY, JSON.stringify(baseHotel));
      else localStorage.removeItem(BASE_HOTEL_KEY);
    } catch {}
  }

  function renderBaseHotel() {
    if (!baseHotelDetailsEl) return;
    if (!baseHotel) {
      baseHotelDetailsEl.textContent = "Optional: set your main hotel so routes start/end there.";
      return;
    }
    const href = safeHttpsUrl(baseHotel.url);
    const link = href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(baseHotel.name || "Hotel")}</a>` : escapeHtml(baseHotel.name || "Hotel");
    const addr = baseHotel.address ? `<br>${escapeHtml(baseHotel.address)}` : "";
    baseHotelDetailsEl.innerHTML = `${link}${addr}`;
  }

  async function ingestBaseHotel(url) {
    const u = safeHttpsUrl(url);
    if (!u) throw new Error("URL must start with https://");
    const res = await fetch("/api/ingest/hotel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: u }),
    });
    const j = await res.json();
    if (!res.ok || j.error) throw new Error(j.error || "Hotel ingest failed");
    return j;
  }

  function renderDayRadio(itin) {
    if (!dayRadioEl) return;
    dayRadioEl.innerHTML = "";
    const days = itin?.days || [];
    days.forEach((d) => {
      if (!d?.date) return;
      const dateLabel = new Date(d.date + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
      const id = `day-radio-${d.date}`;
      const label = document.createElement("label");
      label.setAttribute("for", id);
      label.dataset.date = d.date;
      label.innerHTML = `
        <input id="${escapeHtml(id)}" type="radio" name="active-day" value="${escapeHtml(d.date)}" ${activeScheduleDay === d.date ? "checked" : ""} />
        <span class="day-radio-text">
          <span class="day-radio-title">${escapeHtml(dateLabel)} — ${escapeHtml(d.city || "")}</span>
          <span class="day-radio-sub">${escapeHtml((d.activities || []).length ? (d.activities.length + " items") : "No items yet")}</span>
        </span>
      `;

      // Drag-drop onto day option to move activity to that day
      label.addEventListener("dragover", (e) => e.preventDefault());
      label.addEventListener("drop", (e) => {
        e.preventDefault();
        const payload = e.dataTransfer?.getData("application/json");
        if (!payload) return;
        try {
          const { activityId } = JSON.parse(payload);
          moveActivity(activityId, d.date, null);
          activeScheduleDay = d.date;
          saveActiveScheduleDay();
          renderDayRadio(currentItinerary);
        } catch {}
      });

      label.querySelector("input")?.addEventListener("change", () => {
        activeScheduleDay = d.date;
        saveActiveScheduleDay();
        applyDayFilter(activeScheduleDay);
        renderDayRadio(itin);
        renderSchedule(itin);
      });
      dayRadioEl.appendChild(label);
    });
  }

  function renderSchedule(data) {
    const trip = data.trip || {};
    const start = trip.start_date || "";
    const end = trip.end_date || "";
    if (tripDatesEl && start && end) {
      const startFmt = new Date(start + "T12:00:00").toLocaleDateString("en-GB", { month: "short", day: "numeric", year: "numeric" });
      const endFmt = new Date(end + "T12:00:00").toLocaleDateString("en-GB", { month: "short", day: "numeric", year: "numeric" });
      tripDatesEl.textContent = `${startFmt} – ${endFmt} — Itinerary, map & weather`;
    }

    scheduleEl.innerHTML = "";
    const days = data.days || [];
    const day = days.find((d) => d?.date === activeScheduleDay) || days[0];
    if (!day) return;
    {
      const dayDiv = document.createElement("div");
      const dateKey = day.date || "";
      dayDiv.className = "day-block";
      const dateStr = day.date ? new Date(day.date + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "";
      dayDiv.innerHTML = `
        <div class="day-header" tabindex="0" role="button" data-date="${escapeHtml(dateKey)}" aria-label="Focus map on ${escapeHtml(dateStr)}">${escapeHtml(dateStr)} — ${escapeHtml(day.city || "")}</div>
        <div class="activities" data-date="${escapeHtml(dateKey)}"></div>
      `;
      const activitiesEl = dayDiv.querySelector(".activities");
      const headerEl = dayDiv.querySelector(".day-header");
      headerEl?.addEventListener("click", () => {
        activeScheduleDay = dateKey;
        saveActiveScheduleDay();
        toggleDayFilter(dateKey);
        renderDayRadio(data);
      });
      headerEl?.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activeScheduleDay = dateKey;
          saveActiveScheduleDay();
          toggleDayFilter(dateKey);
          renderDayRadio(data);
        }
      });

      // Allow dropping onto the header to move an activity to this day
      headerEl?.addEventListener("dragover", (e) => e.preventDefault());
      headerEl?.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const payload = e.dataTransfer?.getData("application/json");
        if (!payload) return;
        try {
          const { activityId } = JSON.parse(payload);
          moveActivity(activityId, dateKey, null);
        } catch {}
      });
      activitiesEl?.addEventListener("dragover", (e) => e.preventDefault());
      activitiesEl?.addEventListener("dragover", (e) => {
        e.preventDefault();
        clearDropStyles(activitiesEl);
        const t = getInsertionTarget(activitiesEl, e.clientX, e.clientY);
        if (t.targetEl) t.targetEl.classList.add(t.after ? "drop-after" : "drop-before");
        activitiesEl.dataset.beforeId = t.beforeId || "";
      });
      activitiesEl?.addEventListener("drop", (e) => {
        e.preventDefault();
        const payload = e.dataTransfer?.getData("application/json");
        if (!payload) return;
        try {
          const { activityId } = JSON.parse(payload);
          const beforeId = activitiesEl.dataset.beforeId || getInsertionTarget(activitiesEl, e.clientX, e.clientY).beforeId;
          moveActivity(activityId, dateKey, beforeId);
        } catch {}
        clearDropStyles(activitiesEl);
        delete activitiesEl.dataset.beforeId;
      });

      (day.activities || []).forEach((a) => {
        const actDiv = document.createElement("div");
        const actId = a.__id || a.id || "";
        const done = actId && completedIds.has(actId);
        actDiv.className = "activity" + (done ? " activity--done" : "");
        actDiv.setAttribute("tabindex", "0");
        actDiv.dataset.id = actId;
        actDiv.setAttribute("draggable", "true");
        actDiv.addEventListener("dragstart", (e) => {
          try {
            e.dataTransfer?.setData("application/json", JSON.stringify({ activityId: actId }));
            e.dataTransfer.effectAllowed = "move";
          } catch {}
        });
        actDiv.addEventListener("dragend", () => {
          clearDropStyles(activitiesEl);
          delete activitiesEl?.dataset?.beforeId;
        });

        const href = safeHttpsUrl(a.url);
        const nameHtml = href
          ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(a.name || "")}</a>`
          : `<span>${escapeHtml(a.name || "")}</span>`;

        const checklist = tripMode
          ? `<input class="activity-check" type="checkbox" ${done ? "checked" : ""} aria-label="Mark done: ${escapeHtml(a.name || "")}" />`
          : "";
        actDiv.innerHTML = `
          <span class="time">${escapeHtml(a.time || "—")}</span>
          <div class="details">
            <div class="activity-meta">
              ${checklist}
              <span class="name">${nameHtml}</span>
            </div>
            ${a.notes ? `<div class="notes">${escapeHtml(a.notes)}</div>` : ""}
          </div>
          <div class="activity-actions">
            <button type="button" class="activity-remove" aria-label="Remove ${escapeHtml(a.name || "item")}">×</button>
          </div>
        `;
        const checkEl = actDiv.querySelector(".activity-check");
        actDiv.querySelector(".activity-remove")?.addEventListener("click", (e) => {
          e.stopPropagation();
          removeActivity(actId);
        });
        checkEl?.addEventListener("click", (e) => e.stopPropagation());
        checkEl?.addEventListener("change", () => {
          if (!actId) return;
          if (checkEl.checked) completedIds.add(actId);
          else completedIds.delete(actId);
          saveCompleted();
          actDiv.classList.toggle("activity--done", checkEl.checked);
        });

        actDiv.addEventListener("click", (e) => {
          const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
          if (tag === "a" || tag === "input") return;
          focusMarker(actId);
        });
        actDiv.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            focusMarker(actId);
          }
        });
        activitiesEl.appendChild(actDiv);
      });

      // Add item form
      const add = document.createElement("form");
      add.className = "add-activity";
      add.innerHTML = `
        <div class="add-activity-row">
          <label>Time</label>
          <input name="time" placeholder="e.g. 19:30" inputmode="numeric" />
        </div>
        <div class="add-activity-row">
          <label>Name</label>
          <input name="name" placeholder="Add a restaurant / activity" required />
        </div>
        <div class="add-activity-row">
          <label>Link</label>
          <input name="url" placeholder="https://… (optional)" />
        </div>
        <div class="add-activity-actions">
          <button class="primary" type="submit">Add</button>
          <button type="button" data-action="add-and-pin">Add + pin (auto)</button>
        </div>
      `;
      add.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(add);
        const name = (fd.get("name") || "").toString().trim();
        const time = (fd.get("time") || "").toString().trim();
        const url = (fd.get("url") || "").toString().trim();
        if (!name) return;
        await addActivity(dateKey, { name, time, url, autoPin: false });
        add.reset();
      });
      add.querySelector('[data-action="add-and-pin"]')?.addEventListener("click", async () => {
        const fd = new FormData(add);
        const name = (fd.get("name") || "").toString().trim();
        const time = (fd.get("time") || "").toString().trim();
        const url = (fd.get("url") || "").toString().trim();
        if (!name) return;
        await addActivity(dateKey, { name, time, url, autoPin: true });
        add.reset();
      });
      dayDiv.appendChild(add);

      scheduleEl.appendChild(dayDiv);
    }
  }

  function renderFlights(data) {
    if (!flightsEl || !data.flights) return;
    const f = data.flights;
    const out = f.outbound || {};
    const ret = f.return || {};
    const fmtDate = (d) => d ? new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", month: "short", day: "numeric" }) : "";
    flightsEl.innerHTML = `
      <div class="flights-confirmation">Confirmation: <strong>${escapeHtml(f.confirmation || "")}</strong></div>
      <div class="flights-cards">
        <div class="flight-card flight-outbound">
          <span class="flight-label">Outbound</span>
          <div class="flight-route">${escapeHtml(out.route || "")}</div>
          <div class="flight-meta">${fmtDate(out.date)} · ${escapeHtml(out.airline || "")} ${escapeHtml(out.flight_number || "")}</div>
          <div class="flight-times">${escapeHtml(out.departure_time || "")} → ${escapeHtml(out.arrival_time || "")}${out.duration ? " (" + out.duration + ")" : ""}</div>
        </div>
        <div class="flight-card flight-return">
          <span class="flight-label">Return</span>
          <div class="flight-route">${escapeHtml(ret.route || "")}</div>
          <div class="flight-meta">${fmtDate(ret.date)} · ${escapeHtml(ret.airline || "")} ${escapeHtml(ret.flight_number || "")}</div>
          <div class="flight-times">${escapeHtml(ret.departure_time || "")} → ${escapeHtml(ret.arrival_time || "")}${ret.duration ? " (" + ret.duration + ")" : ""}</div>
        </div>
      </div>
    `;
  }

  function haversineKm(aLat, aLng, bLat, bLng) {
    const toRad = (x) => (x * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(bLat - aLat);
    const dLng = toRad(bLng - aLng);
    const lat1 = toRad(aLat);
    const lat2 = toRad(bLat);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function computeItineraryCenter(itinerary) {
    const pts = [];
    (itinerary.days || []).forEach((d) => {
      const city = (d.city || "").toLowerCase();
      if (!city.includes("lisbon")) return;
      (d.activities || []).forEach((a) => {
        if (a.lat != null && a.lng != null) pts.push([a.lat, a.lng]);
      });
    });
    if (pts.length === 0) return { lat: 38.7223, lng: -9.1393 };
    const lat = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const lng = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    return { lat, lng };
  }

  function renderHotelPicker(hotels, center) {
    if (!hotelSelectEl) return;
    hotelSelectEl.innerHTML = "";
    const sorted = [...hotels].map((h) => ({
      ...h,
      distKm: h.lat != null && h.lng != null ? haversineKm(center.lat, center.lng, h.lat, h.lng) : null,
    })).sort((a, b) => (a.distKm ?? 999) - (b.distKm ?? 999));

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select a hotel…";
    hotelSelectEl.appendChild(placeholder);

    sorted.forEach((h) => {
      const opt = document.createElement("option");
      opt.value = h.id;
      const dist = h.distKm != null ? `${h.distKm.toFixed(1)} km` : "";
      opt.textContent = `${h.name} — ${h.area}${dist ? " · " + dist : ""}`;
      opt.dataset.hotel = JSON.stringify(h);
      hotelSelectEl.appendChild(opt);
    });
  }

  function setHotelDetails(h) {
    if (!hotelDetailsEl) return;
    if (!h) {
      hotelDetailsEl.textContent = "";
      return;
    }
    const link = h.url ? `<a href="${escapeHtml(h.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(h.url)}</a>` : "";
    hotelDetailsEl.innerHTML = `
      <strong>${escapeHtml(h.name)}</strong> · ${escapeHtml(h.area || "")} · ${escapeHtml(h.price_tier || "")}<br>
      ${h.notes ? escapeHtml(h.notes) + "<br>" : ""}
      ${link}
    `;
  }

  function pinSelectedHotel(h) {
    if (!map || !h || h.lat == null || h.lng == null) return;
    // remove previous picked marker
    if (selectedHotelMarkerId) {
      const prev = markerIndex.byId.get(selectedHotelMarkerId);
      if (prev && map.hasLayer(prev)) map.removeLayer(prev);
      markerIndex.byId.delete(selectedHotelMarkerId);
      selectedHotelMarkerId = null;
    }
    selectedHotelMarkerId = `picked-hotel::${h.id}`;
    addMarker(selectedHotelMarkerId, h.lat, h.lng, `Hotel: ${h.name}`, h.area || "");
    focusMarker(selectedHotelMarkerId);
  }

  function clearSelectedHotel() {
    selectedHotel = null;
    if (hotelSelectEl) hotelSelectEl.value = "";
    setHotelDetails(null);
    if (selectedHotelMarkerId) {
      const prev = markerIndex.byId.get(selectedHotelMarkerId);
      if (prev && map.hasLayer(prev)) map.removeLayer(prev);
      markerIndex.byId.delete(selectedHotelMarkerId);
      selectedHotelMarkerId = null;
    }
  }

  function renderWeather(weatherData, itinerary) {
    if (!weatherData.daily || weatherData.error) {
      weatherEl.innerHTML = '<p class="weather-day">Weather unavailable. Check connection.</p>';
      if (weatherNoteEl) weatherNoteEl.textContent = "";
      return;
    }
    const days = weatherData.daily.time || [];
    const maxT = weatherData.daily.temperature_2m_max || [];
    const minT = weatherData.daily.temperature_2m_min || [];
    const precip = weatherData.daily.precipitation_sum || [];
    const codes = weatherData.daily.weathercode || [];

    weatherEl.innerHTML = "";
    if (weatherNoteEl) {
      if (weatherData.historical_reference) {
        const y = weatherData.historical_year ? String(weatherData.historical_year) : "previous year";
        weatherNoteEl.textContent = `(historical reference: ${y})`;
      } else {
        weatherNoteEl.textContent = "";
      }
    }
    days.forEach((d, i) => {
      const dateStr = new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
      const max = maxT[i] != null ? Math.round(maxT[i]) : "—";
      const min = minT[i] != null ? Math.round(minT[i]) : "—";
      const pr = precip[i] != null ? precip[i] : 0;
      const code = codes[i] != null ? codes[i] : 0;
      const desc = weatherCodeToDesc(code);
      const div = document.createElement("div");
      div.className = "weather-day";
      div.setAttribute("role", "listitem");
      div.innerHTML = `
        <div class="date">${escapeHtml(dateStr)}</div>
        <div class="temp">${max}°F / ${min}°F</div>
        <div class="desc">${escapeHtml(desc)}</div>
        <div class="precip">${pr > 0 ? "Rain: " + pr + " mm" : "Dry"}</div>
      `;
      weatherEl.appendChild(div);
    });
  }

  function weatherCodeToDesc(code) {
    const table = {
      0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
      45: "Fog", 48: "Fog", 51: "Drizzle", 53: "Drizzle", 55: "Drizzle",
      61: "Slight rain", 63: "Rain", 65: "Heavy rain",
      80: "Showers", 81: "Showers", 82: "Showers",
      95: "Thunderstorm", 96: "Thunderstorm",
    };
    return table[code] || "—";
  }

  function buildMarkerIndex(data) {
    markerIndex = { byId: new Map(), byDay: new Map(), allIds: [] };
    (data.days || []).forEach((day) => {
      const dateKey = day.date || "";
      (day.activities || []).forEach((a) => {
        if (!a) return;
        const id = a.id || a.__id || "";
        a.__id = id;
        if (!markerIndex.byDay.has(dateKey)) markerIndex.byDay.set(dateKey, []);
        if (id) {
          markerIndex.byDay.get(dateKey).push(id);
          markerIndex.allIds.push(id);
        }
      });
    });
  }

  function plotItinerary(data) {
    clearMarkers();
    const bounds = [];
    buildMarkerIndex(data);
    (data.days || []).forEach((day) => {
      (day.activities || []).forEach((a) => {
        if (a.lat != null && a.lng != null) {
          addMarker(a.__id, a.lat, a.lng, a.name || "Activity", a.notes);
          bounds.push([a.lat, a.lng]);
        }
      });
    });
    if (baseHotel && baseHotel.lat != null && baseHotel.lng != null) {
      baseHotelMarkerId = "base-hotel::base";
      addMarker(baseHotelMarkerId, baseHotel.lat, baseHotel.lng, `Hotel (base): ${baseHotel.name || "Hotel"}`, baseHotel.address || "");
      bounds.push([baseHotel.lat, baseHotel.lng]);
    }
    if (selectedHotel && selectedHotel.lat != null && selectedHotel.lng != null) {
      selectedHotelMarkerId = `picked-hotel::${selectedHotel.id}`;
      addMarker(selectedHotelMarkerId, selectedHotel.lat, selectedHotel.lng, `Hotel: ${selectedHotel.name}`, selectedHotel.area || "");
      bounds.push([selectedHotel.lat, selectedHotel.lng]);
    }
    if (bounds.length > 0 && map) {
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
    }
  }

  function syncAfterItineraryChange() {
    if (!currentItinerary) return;
    plotItinerary(currentItinerary);
    renderSchedule(currentItinerary);
    setActiveDayHeaderUI();
    applyDayFilter(activeDay);
  }

  function findActivity(itin, activityId) {
    for (const day of itin.days || []) {
      const idx = (day.activities || []).findIndex((a) => (a?.id || a?.__id) === activityId);
      if (idx >= 0) return { day, idx, activity: day.activities[idx] };
    }
    return null;
  }

  function moveActivity(activityId, toDateKey, beforeActivityId) {
    if (!currentItinerary || !activityId || !toDateKey) return;
    const from = findActivity(currentItinerary, activityId);
    if (!from) return;
    const fromDay = from.day;
    const act = from.activity;
    const toDay = (currentItinerary.days || []).find((d) => d.date === toDateKey);
    if (!toDay) return;
    if (!Array.isArray(toDay.activities)) toDay.activities = [];

    if (toDay === fromDay && beforeActivityId === activityId) return;
    const bIdxBefore = beforeActivityId ? toDay.activities.findIndex((a) => (a?.id || a?.__id) === beforeActivityId) : -1;
    const fromIdxBefore = from.idx;

    fromDay.activities.splice(from.idx, 1);

    let insertAt = toDay.activities.length;
    if (bIdxBefore >= 0) {
      if (toDay === fromDay && fromIdxBefore < bIdxBefore) insertAt = Math.max(0, bIdxBefore - 1);
      else insertAt = bIdxBefore;
    }
    toDay.activities.splice(insertAt, 0, act);

    saveLocalItinerary(currentItinerary);
    syncAfterItineraryChange();
  }

  async function addActivity(dateKey, { name, time, url, autoPin }) {
    if (!currentItinerary) return;
    const day = (currentItinerary.days || []).find((d) => d.date === dateKey);
    if (!day) return;
    if (!Array.isArray(day.activities)) day.activities = [];

    const a = { id: newId(), name, time: time || "—", notes: "", url: safeHttpsUrl(url) || "" };
    if (autoPin) {
      try {
        const q = `${name}, ${day.city || "Lisbon"}, Portugal`;
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
        const j = await res.json();
        const first = j?.results?.[0];
        if (first && first.lat != null && first.lng != null) {
          a.lat = first.lat;
          a.lng = first.lng;
          a.notes = (a.notes || "") + (a.notes ? " " : "") + "(Auto-pinned)";
        }
      } catch {}
    }
    day.activities.push(a);
    saveLocalItinerary(currentItinerary);
    syncAfterItineraryChange();
  }

  function getDayCity(dateKey) {
    const d = (currentItinerary?.days || []).find((x) => x?.date === dateKey);
    const city = (d?.city || "Lisbon").trim();
    const norm = city.toLowerCase();
    // "Travel" days break search quality; default to Lisbon.
    if (norm === "travel" || norm === "depart") return "Lisbon";
    return city;
  }

  function parseTitleFromDisplayName(displayName) {
    if (!displayName) return "";
    return String(displayName).split(",")[0].trim();
  }

  function googleMapsLink(title, lat, lng) {
    if (lat != null && lng != null) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lat + "," + lng)}`;
    }
    if (title) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(title)}`;
    }
    return "";
  }

  function renderRestaurantPager() {
    if (!restPagerEl) return;
    const total = restState.results.length;
    if (!total) {
      restPagerEl.innerHTML = "";
      return;
    }
    const totalPages = Math.ceil(total / REST_PAGE_SIZE);
    const page = Math.min(restState.page, Math.max(0, totalPages - 1));
    restState.page = page;
    const start = page * REST_PAGE_SIZE + 1;
    const end = Math.min(total, (page + 1) * REST_PAGE_SIZE);
    restPagerEl.innerHTML = `
      <button type="button" class="pager-btn" data-action="prev" ${page === 0 ? "disabled" : ""}>Prev</button>
      <span class="pager-status">Showing ${start}–${end} of ${total}</span>
      <button type="button" class="pager-btn" data-action="next" ${page >= totalPages - 1 ? "disabled" : ""}>Next</button>
    `;
    restPagerEl.querySelector('[data-action="prev"]')?.addEventListener("click", () => {
      if (restState.page > 0) restState.page -= 1;
      renderRestaurantResults(restState.results);
    });
    restPagerEl.querySelector('[data-action="next"]')?.addEventListener("click", () => {
      const tp = Math.ceil(restState.results.length / REST_PAGE_SIZE);
      if (restState.page < tp - 1) restState.page += 1;
      renderRestaurantResults(restState.results);
    });
  }

  function renderRestaurantResults(results) {
    if (!restResultsEl) return;
    restState.results = Array.isArray(results) ? results : [];
    if (!restState.results.length) {
      restResultsEl.innerHTML = '<div class="text-muted">No results. Try a different search.</div>';
      if (restPagerEl) restPagerEl.innerHTML = "";
      return;
    }
    restResultsEl.innerHTML = "";
    const totalPages = Math.ceil(restState.results.length / REST_PAGE_SIZE);
    if (restState.page >= totalPages) restState.page = 0;
    const slice = restState.results.slice(restState.page * REST_PAGE_SIZE, (restState.page + 1) * REST_PAGE_SIZE);
    slice.forEach((r) => {
      const card = document.createElement("div");
      card.className = "rest-result";
      const title = parseTitleFromDisplayName(r.display_name) || "Result";
      const sub = r.display_name || "";
      const osm = r.lat != null && r.lng != null ? `https://www.openstreetmap.org/?mlat=${encodeURIComponent(r.lat)}&mlon=${encodeURIComponent(r.lng)}#map=18/${encodeURIComponent(r.lat)}/${encodeURIComponent(r.lng)}` : "";
      const gmaps = googleMapsLink(title, r.lat, r.lng);
      card.innerHTML = `
        <div>
          <div class="rest-result-title">${escapeHtml(title)}</div>
          <div class="rest-result-sub">${escapeHtml(sub)}</div>
          <div class="rest-links">
            ${osm ? `<a href="${escapeHtml(osm)}" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>` : ""}
            ${gmaps ? `<a href="${escapeHtml(gmaps)}" target="_blank" rel="noopener noreferrer">Google Maps</a>` : ""}
          </div>
        </div>
        <div class="rest-result-actions">
          <button type="button" class="route-btn" data-action="add">Add</button>
          <button type="button" class="route-btn route-btn--secondary" data-action="addpin">Add + pin</button>
        </div>
      `;
      card.querySelector('[data-action="add"]')?.addEventListener("click", async () => {
        if (!activeScheduleDay) return;
        const web = safeHttpsUrl(r?._raw?.website);
        await addActivity(activeScheduleDay, { name: title, time: "", url: web || osm, autoPin: false });
        // ensure location is included when we already have it
        const day = (currentItinerary.days || []).find((d) => d.date === activeScheduleDay);
        const last = day?.activities?.[day.activities.length - 1];
        if (last && r.lat != null && r.lng != null) {
          last.lat = r.lat; last.lng = r.lng; last.notes = sub;
          saveLocalItinerary(currentItinerary);
          syncAfterItineraryChange();
        }
      });
      card.querySelector('[data-action="addpin"]')?.addEventListener("click", async () => {
        if (!activeScheduleDay) return;
        const web = safeHttpsUrl(r?._raw?.website);
        await addActivity(activeScheduleDay, { name: title, time: "", url: web || osm, autoPin: false });
        const day = (currentItinerary.days || []).find((d) => d.date === activeScheduleDay);
        const last = day?.activities?.[day.activities.length - 1];
        if (last && r.lat != null && r.lng != null) {
          last.lat = r.lat; last.lng = r.lng; last.notes = sub;
          saveLocalItinerary(currentItinerary);
          syncAfterItineraryChange();
        }
      });
      restResultsEl.appendChild(card);
    });
    renderRestaurantPager();
  }

  function clearRestaurantLayer() {
    try { restLayer?.clearLayers(); } catch {}
  }

  function renderRestaurantMarkers(results) {
    if (!map || !restLayer) return;
    clearRestaurantLayer();
    (results || []).forEach((r, idx) => {
      if (r.lat == null || r.lng == null) return;
      const isTop = idx < 12;
      const m = L.circleMarker([r.lat, r.lng], {
        radius: isTop ? 7 : 5,
        color: isTop ? "#f0c674" : "#58a6ff",
        weight: 2,
        fillColor: isTop ? "#f0c674" : "#58a6ff",
        fillOpacity: isTop ? 0.65 : 0.35,
      }).addTo(restLayer);
      m.bindTooltip(escapeHtml(r.name || "Restaurant"), { permanent: false, direction: "top", opacity: 0.9, className: "pin-label" });
      const osm = r.osm_type && r.osm_id ? `https://www.openstreetmap.org/${encodeURIComponent(r.osm_type)}/${encodeURIComponent(r.osm_id)}` : "";
      const g = googleMapsLink(r.name, r.lat, r.lng);
      const web = safeHttpsUrl(r.website);
      const links = [
        osm ? `<a href="${escapeHtml(osm)}" target="_blank" rel="noopener noreferrer">OSM</a>` : "",
        g ? `<a href="${escapeHtml(g)}" target="_blank" rel="noopener noreferrer">Google Maps</a>` : "",
        web ? `<a href="${escapeHtml(web)}" target="_blank" rel="noopener noreferrer">Website</a>` : "",
      ].filter(Boolean).join(" · ");
      m.bindPopup(`<strong>${escapeHtml(r.name || "")}</strong><br>${escapeHtml(r.cuisine || r.amenity || "")}${links ? "<br>" + links : ""}`);
    });
  }

  function getRestCentersForMode() {
    if (restMode === "pin") {
      return restPin ? [{ lat: restPin.lat, lng: restPin.lng }] : [];
    }
    // day mode: use all pinned activities for the selected day (best coverage)
    const day = (currentItinerary?.days || []).find((d) => d?.date === activeScheduleDay);
    const centers = [];
    (day?.activities || []).forEach((a) => {
      if (a?.lat != null && a?.lng != null) centers.push({ lat: a.lat, lng: a.lng });
    });
    if (!centers.length && baseHotel?.lat != null && baseHotel?.lng != null) centers.push({ lat: baseHotel.lat, lng: baseHotel.lng });
    return centers.slice(0, 12);
  }

  async function searchRestaurantsBetter() {
    if (!restResultsEl) return;
    const keywords = (restQEl?.value || "").trim();
    const radius_m = parseInt(restRadiusEl?.value || "1600", 10) || 1600;
    const centers = getRestCentersForMode();
    if (!centers.length) {
      restResultsEl.innerHTML = restMode === "pin"
        ? '<div class="text-muted">Drop a pin on the map first.</div>'
        : '<div class="text-muted">No pinned activity locations for this day yet. Add/pin a couple of stops, or set a base hotel.</div>';
      return;
    }
    restResultsEl.innerHTML = '<div class="text-muted">Searching nearby restaurants…</div>';
    if (restPagerEl) restPagerEl.innerHTML = "";
    restState.page = 0;
    clearRestaurantLayer();
    try {
      const res = await fetch("/api/restaurants/nearby", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ centers, radius_m, keywords, limit: 60 }),
      });
      const j = await res.json();
      if (!res.ok || j.error) {
        restResultsEl.innerHTML = `<div class="text-muted">Search failed: ${escapeHtml(j.error || "unknown error")}</div>`;
        return;
      }
      // If no keywords, this becomes a broad “well-tagged” list
      const results = j.results || [];
      if (!results.length) {
        restResultsEl.innerHTML = '<div class="text-muted">No matches. Try fewer keywords (e.g. “vegetarian”, “seafood”).</div>';
        return;
      }
      if (restHintEl) {
        const src = j.source ? ` · Source: ${j.source}` : "";
        restHintEl.textContent = `Showing restaurants within ${(radius_m/1609.34).toFixed(radius_m>=1600?1:2)} mi${src}. Top markers are “best-tagged” places (no review scores in OSM).`;
      }
      renderRestaurantMarkers(results);
      // reuse list renderer but adapt fields
      const mapped = results.map((r) => ({
        display_name: [r.name, r.addr, r.cuisine].filter(Boolean).join(" · "),
        lat: r.lat,
        lng: r.lng,
        _raw: r,
      }));
      renderRestaurantResults(mapped);
    } catch (e) {
      restResultsEl.innerHTML = '<div class="text-muted">Search failed. Try again.</div>';
      console.error(e);
    }
  }

  async function searchRestaurants() {
    if (!restQEl || !restResultsEl) return;
    let q = (restQEl.value || "").trim();
    if (!q) return;
    const city = getDayCity(activeScheduleDay);
    restResultsEl.innerHTML = '<div class="text-muted">Searching…</div>';
    if (restPagerEl) restPagerEl.innerHTML = "";
    restState.page = 0;
    try {
      // Nominatim works best with "named place" style queries; normalize common phrases.
      const qNorm = q.toLowerCase().replace(/\s+/g, " ").trim();
      const qTweaked =
        qNorm.includes("vegetarian friendly") ? qNorm.replace("vegetarian friendly", "vegetarian") :
        qNorm.includes("veg friendly") ? qNorm.replace("veg friendly", "vegetarian") :
        qNorm;

      const queries = [
        `vegetarian restaurant ${city} Portugal`,
        `vegan restaurant ${city} Portugal`,
        `restaurant ${qTweaked} ${city} Portugal`,
        `restaurant ${city} Portugal`,
      ];

      let results = [];
      for (const query of queries) {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}&limit=15`);
        const j = await res.json();
        results = j?.results || [];
        if (results.length) break;
      }
      if (!results.length) {
        restResultsEl.innerHTML =
          '<div class="text-muted">No results. Try a shorter query like “vegetarian”, “vegan”, “tapas”, or a specific restaurant name.</div>';
        return;
      }
      renderRestaurantResults(results);
    } catch {
      restResultsEl.innerHTML = '<div class="text-muted">Search failed. Try again.</div>';
      if (restPagerEl) restPagerEl.innerHTML = "";
    }
  }

  function exportPdf() {
    if (!currentItinerary) return;
    const w = window.open("", "_blank");
    if (!w) return;
    const base = baseHotel ? `${baseHotel.name || "Hotel"}${baseHotel.address ? " — " + baseHotel.address : ""}` : "";
    const days = currentItinerary.days || [];
    const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Portugal Itinerary</title>
  <style>
    body{font-family:Segoe UI,system-ui,sans-serif;margin:24px;color:#111;}
    h1{margin:0 0 6px 0;}
    .muted{color:#555;margin:0 0 16px 0;}
    .day{border:1px solid #ddd;border-radius:10px;padding:14px 16px;margin:14px 0;}
    .day h2{margin:0 0 10px 0;font-size:16px;}
    .item{display:grid;grid-template-columns:70px 1fr;gap:10px;padding:6px 0;border-bottom:1px solid #eee;}
    .item:last-child{border-bottom:none;}
    .time{color:#0b60d1;font-weight:600;}
    a{color:#0b60d1;text-decoration:underline;}
  </style>
</head>
<body>
  <h1>${escapeHtml(currentItinerary.trip?.name || "Trip itinerary")}</h1>
  <p class="muted">${escapeHtml((currentItinerary.trip?.start_date || "") + " → " + (currentItinerary.trip?.end_date || ""))}${base ? "<br><strong>Base hotel:</strong> " + escapeHtml(base) : ""}</p>
  ${days.map(d=>{
    const label = new Date(d.date + "T12:00:00").toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short",year:"numeric"});
    const items = (d.activities||[]).map(a=>{
      const u = safeHttpsUrl(a.url);
      const name = u ? `<a href="${u}">${escapeHtml(a.name||"")}</a>` : escapeHtml(a.name||"");
      const notes = a.notes ? `<div class="muted">${escapeHtml(a.notes)}</div>` : "";
      return `<div class="item"><div class="time">${escapeHtml(a.time||"—")}</div><div>${name}${notes}</div></div>`;
    }).join("");
    return `<div class="day"><h2>${escapeHtml(label)} — ${escapeHtml(d.city||"")}</h2>${items || "<div class='muted'>No items</div>"}</div>`;
  }).join("")}
  <script>window.onload=()=>{window.print();};</script>
</body>
</html>`;
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  function focusMarker(id) {
    if (!id || !map) return;
    const m = markerIndex.byId.get(id);
    if (!m) return;
    map.setView(m.getLatLng(), Math.max(map.getZoom(), 13), { animate: true });
    m.openPopup();
  }

  function setMarkersVisible(visibleIds) {
    const visible = new Set(visibleIds);
    markers.forEach((m) => {
      const id = m.__id;
      const isVisible = id && visible.has(id);
      if (isVisible) {
        if (!map.hasLayer(m)) m.addTo(map);
      } else {
        // Keep selected hotel always on
        if (!m.__isHotel && map.hasLayer(m)) map.removeLayer(m);
      }
    });
  }

  function fitToVisible(visibleIds) {
    return fitToVisibleOpts(visibleIds, { includeHotel: true });
  }

  function fitToVisibleOpts(visibleIds, { includeHotel }) {
    const pts = [];
    visibleIds.forEach((id) => {
      const m = markerIndex.byId.get(id);
      if (m) pts.push(m.getLatLng());
    });
    if (includeHotel && selectedHotelMarkerId) {
      const hm = markerIndex.byId.get(selectedHotelMarkerId);
      if (hm) pts.push(hm.getLatLng());
    }
    if (pts.length === 1) {
      map.setView(pts[0], Math.max(map.getZoom(), 16), { animate: true });
      return;
    }
    if (pts.length > 1) {
      const bounds = L.latLngBounds(pts);
      const dist = map.distance(bounds.getSouthWest(), bounds.getNorthEast());
      if (dist < 600) {
        map.setView(bounds.getCenter(), 16, { animate: true });
        return;
      }
      if (dist < 1800) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
        return;
      }
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }
  }

  function applyDayFilter(dateKey) {
    activeDay = dateKey || null;
    if (!activeDay) {
      clearRoute();
      setMarkersVisible(markerIndex.allIds);
      fitToVisibleOpts(markerIndex.allIds, { includeHotel: true });
      if (daySelectEl) daySelectEl.value = "";
      setActiveDayHeaderUI();
      return;
    }
    const ids = markerIndex.byDay.get(activeDay) || [];
    setMarkersVisible(ids);
    // Fit to *day items only* (keep hotel visible but don't zoom out to include it)
    fitToVisibleOpts(ids, { includeHotel: false });
    if (daySelectEl) daySelectEl.value = activeDay;
    setActiveDayHeaderUI();
    clearRoute();
  }

  function toggleDayFilter(dateKey) {
    if (!dateKey) return;
    applyDayFilter(activeDay === dateKey ? null : dateKey);
  }

  async function load() {
    try {
      const [itineraryRes, weatherRes, hotelsRes] = await Promise.all([
        fetch("/api/itinerary"),
        fetch("/api/weather"),
        fetch("/api/lisbon-hotels"),
      ]);
      if (itineraryRes.status === 401 || weatherRes.status === 401 || hotelsRes.status === 401) {
        window.location.href = "/portugal-login";
        return;
      }
      const serverItinerary = await itineraryRes.json();
      const weather = await weatherRes.json();
      const hotelsPayload = await hotelsRes.json();
      const hotels = hotelsPayload.hotels || [];

      if (!map) initMap();

      loadTripMode();
      loadCompleted();
      tripModeEl?.addEventListener("change", () => {
        tripMode = !!tripModeEl.checked;
        saveTripMode();
        if (currentItinerary) renderSchedule(currentItinerary);
      });

      const local = loadLocalItinerary();
      currentItinerary = migrateLocalItinerary(local, serverItinerary);
      ensureStableActivityIds(currentItinerary);
      saveLocalItinerary(currentItinerary);
      loadActiveScheduleDay();
      loadBaseHotel();
      if (!activeScheduleDay && (currentItinerary.days || []).length) {
        activeScheduleDay = currentItinerary.days[0].date || null;
        saveActiveScheduleDay();
      }

      renderFlights(currentItinerary);
      // plot first so we can attach marker ids into schedule
      plotItinerary(currentItinerary);
      renderDayRadio(currentItinerary);
      renderSchedule(currentItinerary);
      renderWeather(weather, currentItinerary);
      setActiveDayHeaderUI();
      // Default map + schedule to the active schedule day for one-day-at-a-time UX
      if (activeScheduleDay) applyDayFilter(activeScheduleDay);
      routeDrawBtn?.addEventListener("click", drawRouteForActiveDay);
      routeClearBtn?.addEventListener("click", clearRoute);
      // Map needs a resize after grid layout calculates
      setTimeout(() => {
        try { map?.invalidateSize(); } catch {}
      }, 50);

      // Day selector for map filtering
      if (daySelectEl) {
        daySelectEl.innerHTML = '<option value="">All days</option>';
        (currentItinerary.days || []).forEach((d) => {
          if (!d.date) return;
          const opt = document.createElement("option");
          opt.value = d.date;
          const label = new Date(d.date + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
          opt.textContent = `${label} — ${d.city || ""}`.trim();
          daySelectEl.appendChild(opt);
        });
        daySelectEl.addEventListener("change", () => {
          const val = daySelectEl.value || null;
          if (val) {
            activeScheduleDay = val;
            saveActiveScheduleDay();
            renderDayRadio(currentItinerary);
            renderSchedule(currentItinerary);
          }
          applyDayFilter(val);
        });
      }

      // Hotel picker
      const center = computeItineraryCenter(currentItinerary);
      renderHotelPicker(hotels, center);
      hotelSelectEl?.addEventListener("change", () => {
        const opt = hotelSelectEl.selectedOptions?.[0];
        selectedHotel = opt?.dataset?.hotel ? JSON.parse(opt.dataset.hotel) : null;
        setHotelDetails(selectedHotel);
      });
      hotelPinBtn?.addEventListener("click", () => pinSelectedHotel(selectedHotel));
      hotelClearBtn?.addEventListener("click", clearSelectedHotel);

      // Base hotel
      renderBaseHotel();
      baseHotelClearEl?.addEventListener("click", () => {
        baseHotel = null;
        saveBaseHotel();
        renderBaseHotel();
        syncAfterItineraryChange();
      });
      baseHotelSetEl?.addEventListener("click", async () => {
        const u = (baseHotelUrlEl?.value || "").trim();
        if (baseHotelDetailsEl) baseHotelDetailsEl.textContent = "Setting hotel…";
        try {
          const j = await ingestBaseHotel(u);
          baseHotel = {
            name: j.name,
            url: j.url,
            lat: j.lat,
            lng: j.lng,
            address: j.address,
          };
          saveBaseHotel();
          renderBaseHotel();
          syncAfterItineraryChange();
        } catch (e) {
          if (baseHotelDetailsEl) baseHotelDetailsEl.textContent = String(e?.message || e);
        }
      });

      // Restaurant finder
      document.querySelectorAll('input[name="rest-mode"]').forEach((el) => {
        el.addEventListener("change", () => {
          restMode = document.querySelector('input[name="rest-mode"]:checked')?.value || "day";
          if (restHintEl) {
            restHintEl.textContent = restMode === "pin"
              ? "Tip: click “Drop pin”, then click the map. We’ll search within the chosen radius."
              : "We’ll search within the chosen radius of your pinned activities for the selected day.";
          }
        });
      });
      restDropPinEl?.addEventListener("click", () => {
        restMode = "pin";
        const pinRadio = document.querySelector('input[name="rest-mode"][value="pin"]');
        if (pinRadio) pinRadio.checked = true;
        if (restHintEl) restHintEl.textContent = "Click anywhere on the map to place your search pin.";
        map?.once("click", (ev) => {
          restPin = { lat: ev.latlng.lat, lng: ev.latlng.lng };
          try { if (restPinMarker) map.removeLayer(restPinMarker); } catch {}
          restPinMarker = L.marker([restPin.lat, restPin.lng]).addTo(map).bindTooltip("Restaurant search pin", { permanent: false });
          if (restHintEl) restHintEl.textContent = "Pin set. Click Search to find restaurants nearby.";
        });
      });
      restSearchEl?.addEventListener("click", searchRestaurantsBetter);
      restQEl?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          searchRestaurantsBetter();
        }
      });

      // Export PDF
      exportPdfEl?.addEventListener("click", exportPdf);
    } catch (e) {
      console.error(e);
      scheduleEl.innerHTML = "<p>Could not load itinerary. Is the server running?</p>";
    }
  }

  load();
})();
