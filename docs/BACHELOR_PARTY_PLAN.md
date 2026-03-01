# Patrick's Bachelor Party — Page plan

## Page structure

- **Second page:** "Patrick's Bachelor Party" at `/bachelor-party`.
- **Tabs** for destinations: **Bend, Oregon** | **Banff, Alberta, Canada** (same layout per tab, different data).
- **Navigation:** Link from main dashboard (Portugal) to this page and back.

## Each tab (destination) contains

| Section | Purpose | Dynamic elements |
|--------|---------|------------------|
| **Overview** | Tagline, vibe, best season, how to get there | — |
| **At a glance** | Quick compare: flight notes, best time, vibe in one line | Optional: “Compare both” expand |
| **Weather** | Forecast for next 7–14 days (or “typical weekend” dates) | **Live:** Open-Meteo API by destination lat/lng; user can pick dates later |
| **Activities** | Curated list with category (Outdoor, Nightlife, Food, Relax) | **Dynamic:** Filter by category; map pins for each |
| **Where to stay** | Lodging type + suggestions + ballpark price | **Dynamic:** Toggle “group house” vs “hotels” if we add more options |
| **Budget ballpark** | Per-person estimate (flights, lodging, activities, food) | **Dynamic:** Input group size + nights → recalc ballpark range |
| **Map** | Pins for activities and stay areas | **Dynamic:** Click activity → highlight on map; same as Portugal |

## Dynamic elements (what people use when planning)

1. **Weather by destination and date** — So you can pick a weekend with good conditions.
2. **Budget estimator** — Group size + number of nights → rough total and per-person (ranges from our data).
3. **Activity filters** — e.g. “Outdoor only” or “Nightlife” to build a rough itinerary.
4. **Compare view (future)** — Side-by-side Bend vs Banff (weather, cost, flight time) on one screen.
5. **“Sample weekend” itinerary (future)** — E.g. “Fri evening → Sun noon” template with suggested activities per day.
6. **Packing / checklist (future)** — E.g. “Ski weekend” vs “Summer hiking” list.

## Tech

- **Data:** `data/bachelor_party.json` — destinations array with Bend and Banff (coords, activities, stay, budget notes).
- **Tabs:** Accessible (ARIA tablist/tab/tabpanel), URL hash `#bend` / `#banff` so tabs are shareable and back-button friendly.
- **Weather:** Same Open-Meteo API; each destination has lat/lng and timezone; default to “next 7 days” or a fixed “sample weekend” date range.
- **Map:** One Leaflet map per tab; fitBounds to that destination’s pins.
