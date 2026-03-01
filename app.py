"""
Portugal Trip Planner - Flask app.
Serves the trip planner page and fetches weather (Open-Meteo, no API key).
"""
import json
import html as html_lib
import ipaddress
import re
import secrets
from datetime import timedelta
from functools import wraps
from pathlib import Path
from urllib.parse import urlparse

import requests
from flask import Flask, render_template, jsonify, request, session, redirect, url_for

app = Flask(__name__)

DATA_FILE = Path(__file__).parent / "data" / "itinerary.json"
BACHELOR_PARTY_FILE = Path(__file__).parent / "data" / "bachelor_party.json"
LISBON_HOTELS_FILE = Path(__file__).parent / "data" / "lisbon_hotels.json"
SECRET_FILE = Path(__file__).parent / "data" / "flask_secret_key.txt"


def _get_or_create_secret_key() -> str:
    try:
        if SECRET_FILE.exists():
            v = SECRET_FILE.read_text(encoding="utf-8").strip()
            if v:
                return v
        SECRET_FILE.parent.mkdir(parents=True, exist_ok=True)
        v = secrets.token_hex(32)
        SECRET_FILE.write_text(v, encoding="utf-8")
        return v
    except Exception:
        return secrets.token_hex(32)


app.secret_key = _get_or_create_secret_key()
app.permanent_session_lifetime = timedelta(days=30)


def portugal_auth_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if session.get("portugal_authed") is True:
            return fn(*args, **kwargs)
        if request.path.startswith("/api/"):
            return jsonify({"auth_required": True}), 401
        nxt = request.args.get("next") or request.full_path or "/"
        return redirect(url_for("portugal_login", next=nxt))

    return wrapper


def load_itinerary():
    """Load itinerary from JSON file."""
    if not DATA_FILE.exists():
        return get_sample_itinerary()
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def get_sample_itinerary():
    """Default sample itinerary for Portugal May trip."""
    return {
        "trip": {
            "name": "Portugal May Trip",
            "start_date": "2026-05-16",
            "end_date": "2026-05-24",
        },
        "flights": {
            "confirmation": "AUG6N4",
            "outbound": {"route": "JFK → LIS", "date": "2026-05-15", "departure_time": "22:05", "arrival_time": "10:15", "airline": "TAP Portugal", "flight_number": "TP 210"},
            "return": {"route": "LIS → JFK", "date": "2026-05-24", "departure_time": "17:00", "arrival_time": "20:05", "airline": "TAP Portugal", "flight_number": "TP 209"},
        },
        "days": [
            {
                "date": "2026-05-01",
                "city": "Lisbon",
                "activities": [
                    {"name": "Arrive Lisbon", "time": "14:00", "lat": 38.7223, "lng": -9.1393, "notes": "Check-in, settle"},
                    {"name": "Alfama & São Jorge", "time": "17:00", "lat": 38.7139, "lng": -9.1334, "notes": "Wander, viewpoints"},
                ],
            },
            {
                "date": "2026-05-02",
                "city": "Lisbon",
                "activities": [
                    {"name": "Belém (Tower & Pastéis)", "time": "09:30", "lat": 38.6916, "lng": -9.2159, "notes": "Belém Tower, Pastéis de Belém"},
                    {"name": "LX Factory", "time": "14:00", "lat": 38.7024, "lng": -9.2062, "notes": "Lunch, shops"},
                ],
            },
            {
                "date": "2026-05-03",
                "city": "Sintra",
                "activities": [
                    {"name": "Pena Palace", "time": "09:00", "lat": 38.7885, "lng": -9.3905, "notes": "Book ahead"},
                    {"name": "Quinta da Regaleira", "time": "13:30", "lat": 38.7964, "lng": -9.3963, "notes": "Gardens & wells"},
                ],
            },
            {
                "date": "2026-05-04",
                "city": "Lisbon / Cascais",
                "activities": [
                    {"name": "Cascais day trip", "time": "10:00", "lat": 38.6970, "lng": -9.4215, "notes": "Beach, old town"},
                ],
            },
            {
                "date": "2026-05-05",
                "city": "Porto",
                "activities": [
                    {"name": "Travel to Porto", "time": "10:00", "lat": 41.1579, "lng": -8.6291, "notes": "Train ~3h"},
                    {"name": "Ribeira & Douro", "time": "15:00", "lat": 41.1404, "lng": -8.6112, "notes": "Riverside, port cellars"},
                ],
            },
            {
                "date": "2026-05-06",
                "city": "Porto",
                "activities": [
                    {"name": "Livraria Lello", "time": "09:30", "lat": 41.1474, "lng": -8.6145, "notes": "Book tickets online"},
                    {"name": "Port wine cellars", "time": "14:00", "lat": 41.1390, "lng": -8.6165, "notes": "Vila Nova de Gaia"},
                ],
            },
            {
                "date": "2026-05-07",
                "city": "Porto",
                "activities": [
                    {"name": "Free morning / beach", "time": "10:00", "lat": 41.1579, "lng": -8.6291, "notes": "Matosinhos or relax"},
                ],
            },
            {
                "date": "2026-05-08",
                "city": "Depart",
                "activities": [
                    {"name": "Depart Porto", "time": "—", "lat": 41.2481, "lng": -8.6814, "notes": "Airport or train"},
                ],
            },
        ],
        "hotels": [
            {"city": "Lisbon", "area": "Baixa / Chiado or Alfama", "suggestions": "Hotel do Chiado, Memmo Alfama, The Lumiares", "lat": 38.7109, "lng": -9.1396},
            {"city": "Porto", "area": "Ribeira or Centro", "suggestions": "Torel 1884, Pestana Vintage, Yeatman (splurge)", "lat": 41.1404, "lng": -8.6112},
        ],
    }


def fetch_weather(lat: float, lng: float, start: str, end: str):
    """Fetch daily weather from Open-Meteo (no API key)."""
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": lat,
        "longitude": lng,
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode",
        "timezone": "Europe/Lisbon",
        "start_date": start,
        "end_date": end,
        "temperature_unit": "fahrenheit",
    }
    try:
        r = requests.get(url, params=params, timeout=10)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        return {"error": str(e)}


def load_bachelor_party():
    """Load bachelor party destinations from JSON."""
    if not BACHELOR_PARTY_FILE.exists():
        return {"title": "Patrick's Bachelor Party", "destinations": []}
    with open(BACHELOR_PARTY_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    return normalize_bachelor_party_data(data, persist=True)


def save_bachelor_party(data):
    """Persist bachelor party data to JSON."""
    BACHELOR_PARTY_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(BACHELOR_PARTY_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def new_item_id() -> str:
    return secrets.token_urlsafe(8)


def is_safe_public_hostname(hostname: str) -> bool:
    host = (hostname or "").strip().lower()
    if not host:
        return False
    if host in ("localhost",):
        return False
    if host.endswith(".local"):
        return False
    # Block raw IPs that are private/link-local/etc
    try:
        ip = ipaddress.ip_address(host)
        return not (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
        )
    except ValueError:
        return True


def normalize_bachelor_party_data(data: dict, persist: bool = False) -> dict:
    """Ensure consistent schema and stable IDs for compendium items."""
    changed = False
    if not isinstance(data, dict):
        return {"title": "Patrick's Bachelor Party", "destinations": []}
    destinations = data.get("destinations", [])
    if not isinstance(destinations, list):
        data["destinations"] = []
        destinations = data["destinations"]
        changed = True
    for dest in destinations:
        if not isinstance(dest, dict):
            continue
        for key, kind in (("compendium_activities", "activity"), ("compendium_lodging", "lodging")):
            if key not in dest or not isinstance(dest.get(key), list):
                dest[key] = []
                changed = True
            for item in dest[key]:
                if not isinstance(item, dict):
                    continue
                if not item.get("id"):
                    item["id"] = new_item_id()
                    changed = True
                if "name" in item and isinstance(item["name"], str):
                    unescaped = html_lib.unescape(item["name"]).strip()
                    if unescaped != item["name"]:
                        item["name"] = unescaped
                        changed = True
                if "notes" in item and isinstance(item["notes"], str):
                    unescaped = html_lib.unescape(item["notes"]).strip()
                    if unescaped != item["notes"]:
                        item["notes"] = unescaped
                        changed = True
                if kind == "activity":
                    item.setdefault("category", "Custom")
                else:
                    item.setdefault("type", "Other")
                    item.setdefault("ballpark", "")
    if changed and persist:
        save_bachelor_party(data)
    return data


def fetch_page_metadata(url: str):
    """Fetch URL and extract basic metadata. Returns (final_url, title, description, verified)."""
    try:
        resp = requests.get(
            url,
            timeout=8,
            headers={"User-Agent": "Mozilla/5.0 (compatible; TripPlanner/1.0)"},
            allow_redirects=True,
        )
        resp.raise_for_status()
        final_url = resp.url
        text = resp.text
        if not text or len(text) > 500_000:
            return final_url, None, None, False
        content_type = (resp.headers.get("Content-Type") or "").lower()
        title = None
        desc = None
        title_m = re.search(r"<title[^>]*>([^<]+)</title>", text, re.I | re.DOTALL)
        if title_m:
            title = html_lib.unescape(re.sub(r"\s+", " ", title_m.group(1).strip()))[:200]
        meta_m = re.search(
            r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)["\']',
            text,
            re.I,
        )
        if not meta_m:
            meta_m = re.search(
                r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']description["\']',
                text,
                re.I,
            )
        if meta_m:
            desc = html_lib.unescape(re.sub(r"\s+", " ", meta_m.group(1).strip()))[:300]
        verified = final_url.startswith("https://") and "text/html" in content_type
        try:
            verified = verified and is_safe_public_hostname(urlparse(final_url).hostname or "")
        except Exception:
            verified = False
        return final_url, title, desc, verified
    except Exception:
        return None, None, None, False


def auto_activity_category(url: str, title: str | None, desc: str | None) -> str:
    text = f"{url} {title or ''} {desc or ''}".lower()
    if "escape" in text:
        return "Escape room"
    if any(k in text for k in ("climb", "boulder", "crag", "gym", "belay")):
        return "Climbing"
    if any(k in text for k in ("cooking", "cook class", "culinary", "chef")):
        return "Cooking"
    if any(k in text for k in ("brew", "brewery", "distill", "distillery", "bar", "pub", "ale trail", "taproom")):
        return "Drink"
    if any(k in text for k in ("hot spring", "spa", "sauna", "massage")):
        return "Relax"
    if any(k in text for k in ("restaurant", "kitchen", "steak", "grill", "bistro", "cafe", "diner", "tavern", "eat")):
        return "Restaurant"
    if any(k in text for k in ("hike", "trail", "rafting", "gondola", "ski", "snowboard", "kayak", "bike", "mountain", "park")):
        return "Outdoor"
    return "Custom"


def classify_lodging_type(url: str, title: str | None, desc: str | None) -> str:
    host = (urlparse(url).hostname or "").lower()
    text = f"{host} {title or ''} {desc or ''}".lower()
    if "airbnb." in host or "airbnb" in text:
        return "Airbnb"
    if "vrbo." in host or "vrbo" in text:
        return "VRBO"
    if any(k in text for k in ("hotel", "resort", "inn", "lodge", "suites")):
        return "Hotel"
    return "Other"


def parse_nightly_cost(text: str) -> tuple[str, int] | None:
    if not text:
        return None
    t = text.replace(",", "")
    patterns = [
        (r"(CA\\$)\\s*([0-9]{2,5})", "CA$"),
        (r"(\\$)\\s*([0-9]{2,5})", "$"),
        (r"(€)\\s*([0-9]{2,5})", "€"),
        (r"(£)\\s*([0-9]{2,5})", "£"),
    ]
    for pat, cur in patterns:
        m = re.search(pat, t, re.I)
        if m:
            try:
                amt = int(m.group(2))
                return cur, amt
            except Exception:
                continue
    return None


@app.route("/")
@portugal_auth_required
def index():
    return render_template("index.html")


@app.route("/bachelor-party")
def bachelor_party():
    return render_template("bachelor_party.html")


@app.route("/portugal-login", methods=["GET", "POST"])
def portugal_login():
    next_url = (request.values.get("next") or "/").strip()
    if request.method == "POST":
        pw = (request.form.get("password") or "").strip()
        if pw == "local":
            session["portugal_authed"] = True
            session.permanent = True
            return redirect(next_url or "/")
        return render_template("portugal_login.html", error="Incorrect password.", next_url=next_url)
    return render_template("portugal_login.html", error=None, next_url=next_url)


@app.route("/api/itinerary")
@portugal_auth_required
def api_itinerary():
    return jsonify(load_itinerary())


@app.route("/api/weather")
@portugal_auth_required
def api_weather():
    from datetime import date, timedelta
    data = load_itinerary()
    trip = data.get("trip", {})
    start = trip.get("start_date", "2026-05-01")
    end = trip.get("end_date", "2026-05-08")
    lat, lng = 38.7223, -9.1393
    # Use forecast when within horizon; otherwise show historical reference (previous year's same dates).
    try:
        start_d = date.fromisoformat(start)
        end_d = date.fromisoformat(end)
        if end_d < start_d:
            end_d = start_d
        tz = "Europe/Lisbon"
        today = date.today()
        forecast_limit = today + timedelta(days=14)
        if start_d <= forecast_limit:
            out = fetch_weather_forecast(lat, lng, start_d, end_d, tz)
            out["historical_reference"] = False
        else:
            out = fetch_weather_historical(lat, lng, start_d, end_d, tz)
        # ensure Fahrenheit for both forecast and historical
        out.setdefault("daily_units", {})
        out["daily_units"]["temperature_2m_max"] = "°F"
        out["daily_units"]["temperature_2m_min"] = "°F"
        return jsonify(out)
    except Exception as e:
        # fallback to old behavior (still Fahrenheit) if something goes wrong
        out = fetch_weather(lat, lng, start, end)
        out["historical_reference"] = True
        out["error"] = str(e)
        return jsonify(out), 200


@app.route("/api/bachelor-party")
def api_bachelor_party():
    return jsonify(load_bachelor_party())


@app.route("/api/lisbon-hotels")
@portugal_auth_required
def api_lisbon_hotels():
    if not LISBON_HOTELS_FILE.exists():
        return jsonify({"hotels": []})
    with open(LISBON_HOTELS_FILE, "r", encoding="utf-8") as f:
        return jsonify(json.load(f))


@app.route("/api/geocode")
@portugal_auth_required
def api_geocode():
    """Basic place search for adding restaurants/activities. Uses OpenStreetMap Nominatim."""
    q = (request.args.get("q") or "").strip()
    limit_s = (request.args.get("limit") or "").strip()
    try:
        limit = int(limit_s) if limit_s else 5
    except Exception:
        limit = 5
    if limit < 1:
        limit = 1
    if limit > 20:
        limit = 20
    if not q or len(q) < 3:
        return jsonify({"results": []})
    if len(q) > 120:
        q = q[:120]
    try:
        r = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": q, "format": "json", "limit": limit},
            timeout=10,
            headers={"User-Agent": "TripPlanner/1.0 (local dev)"},
        )
        r.raise_for_status()
        raw = r.json() if isinstance(r.json(), list) else []
        results = []
        for item in raw:
            try:
                results.append(
                    {
                        "display_name": item.get("display_name"),
                        "lat": float(item.get("lat")),
                        "lng": float(item.get("lon")),
                    }
                )
            except Exception:
                continue
        return jsonify({"results": results})
    except Exception:
        return jsonify({"results": []})


@app.route("/api/osrm/route", methods=["POST"])
@portugal_auth_required
def api_osrm_route():
    """Proxy for OSRM demo server. Body: { waypoints: [{lat,lng},...], mode }."""
    if not request.is_json:
        return jsonify({"error": "Content-Type must be application/json"}), 400
    body = request.get_json() or {}
    waypoints = body.get("waypoints") or []
    mode = (body.get("mode") or "walking").strip().lower()
    if mode not in ("walking", "driving", "cycling"):
        mode = "walking"
    if not isinstance(waypoints, list) or len(waypoints) < 2:
        return jsonify({"error": "Provide at least 2 waypoints"}), 400
    if len(waypoints) > 25:
        return jsonify({"error": "Too many waypoints (max 25)"}), 400

    pts = []
    for w in waypoints:
        try:
            lat = float(w.get("lat"))
            lng = float(w.get("lng"))
            pts.append((lat, lng))
        except Exception:
            continue
    if len(pts) < 2:
        return jsonify({"error": "Invalid waypoints"}), 400

    # OSRM expects lon,lat pairs
    coords = ";".join([f"{p[1]},{p[0]}" for p in pts])
    params = {
        "overview": "full",
        "geometries": "geojson",
        "steps": "false",
    }
    try:
        r = requests.get(f"https://router.project-osrm.org/route/v1/{mode}/{coords}", params=params, timeout=12)
        r.raise_for_status()
        data = r.json()
        if data.get("code") != "Ok":
            return jsonify({"error": f"OSRM failed: {data.get('code')}"}), 400
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/public/osrm/route", methods=["POST"])
def api_public_osrm_route():
    """Public OSRM proxy for the bachelor party page (no auth)."""
    # Reuse the same logic as the protected endpoint
    if not request.is_json:
        return jsonify({"error": "Content-Type must be application/json"}), 400
    body = request.get_json() or {}
    waypoints = body.get("waypoints") or []
    mode = (body.get("mode") or "walking").strip().lower()
    if mode not in ("walking", "driving", "cycling"):
        mode = "walking"
    if not isinstance(waypoints, list) or len(waypoints) < 2:
        return jsonify({"error": "Provide at least 2 waypoints"}), 400
    if len(waypoints) > 25:
        return jsonify({"error": "Too many waypoints (max 25)"}), 400

    pts = []
    for w in waypoints:
        try:
            lat = float(w.get("lat"))
            lng = float(w.get("lng"))
            pts.append((lat, lng))
        except Exception:
            continue
    if len(pts) < 2:
        return jsonify({"error": "Invalid waypoints"}), 400

    coords = ";".join([f"{p[1]},{p[0]}" for p in pts])
    params = {"overview": "full", "geometries": "geojson", "steps": "false"}
    try:
        r = requests.get(f"https://router.project-osrm.org/route/v1/{mode}/{coords}", params=params, timeout=12)
        r.raise_for_status()
        data = r.json()
        if data.get("code") != "Ok":
            return jsonify({"error": f"OSRM failed: {data.get('code')}"}), 400
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/ingest/hotel", methods=["POST"])
@portugal_auth_required
def api_ingest_hotel():
    """Ingest a hotel URL, extract metadata, and attempt to geocode it."""
    if not request.is_json:
        return jsonify({"error": "Content-Type must be application/json"}), 400
    body = request.get_json() or {}
    url = (body.get("url") or "").strip()
    if not url or not url.startswith("https://"):
        return jsonify({"error": "URL must start with https://"}), 400
    try:
        host = urlparse(url).hostname or ""
        if not is_safe_public_hostname(host):
            return jsonify({"error": "Hostname is not allowed"}), 400
    except Exception:
        return jsonify({"error": "Invalid URL"}), 400

    final_url, title, desc, verified = fetch_page_metadata(url)
    name = (title or "").strip()
    for sep in (" | ", " - ", " — "):
        if sep in name:
            name = name.split(sep)[0].strip()
            break
    if not name:
        name = host

    # Try to geocode based on title/name first
    q = f"{name} Portugal"
    lat = None
    lng = None
    address = None
    try:
        r = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": q, "format": "json", "limit": 1},
            timeout=10,
            headers={"User-Agent": "TripPlanner/1.0 (local dev)"},
        )
        r.raise_for_status()
        raw = r.json() if isinstance(r.json(), list) else []
        if raw:
            lat = float(raw[0].get("lat"))
            lng = float(raw[0].get("lon"))
            address = raw[0].get("display_name")
    except Exception:
        pass

    return jsonify(
        {
            "name": name[:120],
            "url": final_url or url,
            "verified": bool(verified),
            "lat": lat,
            "lng": lng,
            "address": address,
            "source_title": title,
            "source_description": desc,
        }
    )


_overpass_cache = {}


@app.route("/api/restaurants/nearby", methods=["POST"])
@portugal_auth_required
def api_restaurants_nearby():
    """Find nearby restaurants using Overpass (OpenStreetMap).
    Body: { centers: [{lat,lng}], radius_m, keywords?, limit? }
    """
    if not request.is_json:
        return jsonify({"error": "Content-Type must be application/json"}), 400
    body = request.get_json() or {}
    centers = body.get("centers") or []
    keywords = (body.get("keywords") or "").strip()
    try:
        radius_m = int(body.get("radius_m") or 1600)
    except Exception:
        radius_m = 1600
    if radius_m < 200:
        radius_m = 200
    if radius_m > 8000:
        radius_m = 8000
    try:
        limit = int(body.get("limit") or 60)
    except Exception:
        limit = 60
    if limit < 1:
        limit = 1
    if limit > 200:
        limit = 200

    pts = []
    for c in centers:
        try:
            lat = float(c.get("lat"))
            lng = float(c.get("lng"))
            pts.append((lat, lng))
        except Exception:
            continue
    if not pts:
        return jsonify({"error": "Provide at least one center point"}), 400
    if len(pts) > 15:
        pts = pts[:15]

    # Cache for 60s (Overpass is rate limited)
    from time import time
    cache_key = (tuple((round(a, 5), round(b, 5)) for a, b in pts), radius_m, keywords.lower(), limit)
    cached = _overpass_cache.get(cache_key)
    if cached and time() - cached["ts"] < 60:
        return jsonify(cached["data"])

    arounds = "\n".join([f'  nwr(around:{radius_m},{lat},{lng})["amenity"~"^(restaurant|cafe|fast_food)$"];' for lat, lng in pts])
    query = f"""
[out:json][timeout:20];
(
{arounds}
);
out tags center;
"""
    try:
        r = requests.post(
            "https://overpass-api.de/api/interpreter",
            data=query.encode("utf-8"),
            timeout=25,
            headers={"User-Agent": "TripPlanner/1.0 (local dev)"},
        )
        r.raise_for_status()
        raw = r.json() if isinstance(r.json(), dict) else {}
        els = raw.get("elements") or []
        results = []
        for el in els:
            if not isinstance(el, dict):
                continue
            tags = el.get("tags") or {}
            name = (tags.get("name") or "").strip()
            if not name:
                continue
            lat = el.get("lat")
            lon = el.get("lon")
            if (lat is None or lon is None) and isinstance(el.get("center"), dict):
                lat = el["center"].get("lat")
                lon = el["center"].get("lon")
            try:
                lat = float(lat)
                lon = float(lon)
            except Exception:
                continue
            item = {
                "osm_type": el.get("type"),
                "osm_id": el.get("id"),
                "name": name[:160],
                "lat": lat,
                "lng": lon,
                "amenity": tags.get("amenity"),
                "cuisine": tags.get("cuisine"),
                "website": tags.get("website") or tags.get("contact:website"),
                "phone": tags.get("phone") or tags.get("contact:phone"),
                "opening_hours": tags.get("opening_hours"),
                "addr": ", ".join([x for x in [tags.get("addr:housenumber"), tags.get("addr:street"), tags.get("addr:city")] if x]),
                "diet_vegetarian": tags.get("diet:vegetarian"),
                "diet_vegan": tags.get("diet:vegan"),
                "wikidata": tags.get("wikidata"),
            }
            results.append(item)

        # Keyword filtering (best-effort)
        if keywords:
            toks = [t for t in re.split(r"[^a-z0-9]+", keywords.lower()) if t]
            def match(it):
                hay = " ".join([(it.get("name") or ""), (it.get("cuisine") or ""), (it.get("amenity") or ""), (it.get("addr") or "")]).lower()
                if "vegetarian" in toks and (it.get("diet_vegetarian") in ("yes", "only")):
                    return True
                if "vegan" in toks and (it.get("diet_vegan") in ("yes", "only")):
                    return True
                return all(t in hay for t in toks)
            results = [x for x in results if match(x)]

        # Heuristic "quality" score (OSM doesn't have ratings)
        def score(it):
            s = 0
            if it.get("website"):
                s += 2
            if it.get("opening_hours"):
                s += 1
            if it.get("phone"):
                s += 1
            if it.get("cuisine"):
                s += 1
            if it.get("addr"):
                s += 1
            if it.get("wikidata"):
                s += 1
            return s
        results.sort(key=score, reverse=True)
        results = results[:limit]

        out = {"source": "OpenStreetMap (Overpass API)", "results": results, "radius_m": radius_m}
        _overpass_cache[cache_key] = {"ts": time(), "data": out}
        return jsonify(out)
    except Exception as e:
        return jsonify({"error": str(e), "results": []}), 500


@app.route("/api/bachelor-party/add", methods=["POST"])
def api_bachelor_party_add():
    """Ingest a URL and add it to the compendium.
    Body: { url, type: 'activity'|'lodging', destination: 'bend'|'banff', name?, category?, lodging_type?, nightly? }.
    """
    if not request.is_json:
        return jsonify({"error": "Content-Type must be application/json"}), 400
    body = request.get_json() or {}
    url = (body.get("url") or "").strip()
    kind = (body.get("type") or "activity").strip().lower()
    dest_id = (body.get("destination") or "").strip().lower()
    name_override = (body.get("name") or "").strip()
    category_override = (body.get("category") or "").strip()
    lodging_type_override = (body.get("lodging_type") or "").strip()
    nightly_override = (body.get("nightly") or "").strip()

    if not url or not url.startswith("https://"):
        return jsonify({"error": "URL is required and must use https"}), 400
    try:
        parsed = urlparse(url)
        if not parsed.netloc:
            return jsonify({"error": "Invalid URL"}), 400
        if parsed.username or parsed.password:
            return jsonify({"error": "Invalid URL"}), 400
        if not is_safe_public_hostname(parsed.hostname or ""):
            return jsonify({"error": "URL hostname not allowed"}), 400
    except Exception:
        return jsonify({"error": "Invalid URL"}), 400

    if kind not in ("activity", "lodging"):
        return jsonify({"error": "type must be 'activity' or 'lodging'"}), 400
    if dest_id not in ("bend", "banff"):
        return jsonify({"error": "destination must be 'bend' or 'banff'"}), 400

    data = load_bachelor_party()
    dest = next((d for d in data.get("destinations", []) if d.get("id") == dest_id), None)
    if not dest:
        return jsonify({"error": "Unknown destination"}), 404

    final_url, title, description, verified = fetch_page_metadata(url)
    final_url = final_url or url
    name = (name_override or title or (urlparse(final_url).netloc or parsed.netloc).replace("www.", "")).strip()
    notes = (description or "Added from link").strip()[:400]

    lat, lng = dest.get("lat"), dest.get("lng")

    if kind == "activity":
        key = "compendium_activities"
        if key not in dest:
            dest[key] = []
        category = category_override or auto_activity_category(final_url, title, description)
        new_item = {
            "id": new_item_id(),
            "name": name[:120],
            "category": category,
            "notes": notes,
            "url": final_url,
            "lat": lat,
            "lng": lng,
            "verified": bool(verified),
        }
        dest[key].append(new_item)
    else:
        key = "compendium_lodging"
        if key not in dest:
            dest[key] = []
        lodging_type = lodging_type_override or classify_lodging_type(final_url, title, description)
        nightly = None
        if nightly_override:
            nightly = parse_nightly_cost(nightly_override)
        if not nightly and description:
            nightly = parse_nightly_cost(description)
        if not nightly and title:
            nightly = parse_nightly_cost(title)
        ballpark = ""
        if nightly:
            ballpark = f"{nightly[0]}{nightly[1]}/night"
        new_item = {
            "id": new_item_id(),
            "name": name[:120],
            "type": lodging_type,
            "notes": notes,
            "url": final_url,
            "ballpark": ballpark,
            "lat": lat,
            "lng": lng,
            "verified": bool(verified),
        }
        dest[key].append(new_item)

    try:
        save_bachelor_party(data)
    except Exception as e:
        return jsonify({"error": f"Could not save: {e}"}), 500

    return jsonify({"ok": True, "item": new_item, "destination": dest_id}), 201


@app.route("/api/bachelor-party/remove", methods=["POST"])
def api_bachelor_party_remove():
    """Remove an item from the shared compendium. Body: { destination, type: 'activity'|'lodging', id }."""
    if not request.is_json:
        return jsonify({"error": "Content-Type must be application/json"}), 400
    body = request.get_json() or {}
    dest_id = (body.get("destination") or "").strip().lower()
    kind = (body.get("type") or "").strip().lower()
    item_id = (body.get("id") or "").strip()
    if dest_id not in ("bend", "banff"):
        return jsonify({"error": "destination must be 'bend' or 'banff'"}), 400
    if kind not in ("activity", "lodging"):
        return jsonify({"error": "type must be 'activity' or 'lodging'"}), 400
    if not item_id:
        return jsonify({"error": "id is required"}), 400

    data = load_bachelor_party()
    dest = next((d for d in data.get("destinations", []) if d.get("id") == dest_id), None)
    if not dest:
        return jsonify({"error": "Unknown destination"}), 404
    key = "compendium_activities" if kind == "activity" else "compendium_lodging"
    items = dest.get(key, [])
    if not isinstance(items, list):
        return jsonify({"error": "Compendium is invalid"}), 500
    before = len(items)
    dest[key] = [x for x in items if not (isinstance(x, dict) and x.get("id") == item_id)]
    if len(dest[key]) == before:
        return jsonify({"error": "Item not found"}), 404
    try:
        save_bachelor_party(data)
    except Exception as e:
        return jsonify({"error": f"Could not save: {e}"}), 500
    return jsonify({"ok": True}), 200


def fetch_weather_forecast(lat: float, lng: float, start: "date", end: "date", tz: str):
    """Forecast API (next ~16 days). Returns dict with daily data or error."""
    params = {
        "latitude": lat,
        "longitude": lng,
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode",
        "timezone": tz,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "temperature_unit": "fahrenheit",
    }
    r = requests.get("https://api.open-meteo.com/v1/forecast", params=params, timeout=10)
    r.raise_for_status()
    return r.json()


def fetch_weather_historical(lat: float, lng: float, start: "date", end: "date", tz: str):
    """Historical archive API (past dates). Same daily structure for UI. Uses same calendar dates from previous year."""
    from datetime import date, timedelta
    # Use same month/day from previous year (or 2024 if this year to avoid future)
    year = start.year - 1
    if year > date.today().year:
        year = date.today().year - 1
    start_past = date(year, start.month, start.day)
    end_past = date(year, end.month, end.day)
    if end_past < start_past:
        end_past = start_past
    params = {
        "latitude": lat,
        "longitude": lng,
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode",
        "timezone": tz,
        "start_date": start_past.isoformat(),
        "end_date": end_past.isoformat(),
        "temperature_unit": "fahrenheit",
    }
    r = requests.get("https://archive-api.open-meteo.com/v1/archive", params=params, timeout=10)
    r.raise_for_status()
    data = r.json()
    # Use requested (future) dates for time axis so UI shows the user's chosen dates
    if data.get("daily", {}).get("time"):
        data["daily"] = dict(data["daily"])
        n = len(data["daily"]["time"])
        data["daily"]["time"] = [
            (start + timedelta(days=i)).isoformat()
            for i in range(min(n, (end - start).days + 1))
        ]
    data["historical_reference"] = True
    data["historical_year"] = start_past.year
    return data


@app.route("/api/bachelor-party/weather/<dest_id>")
def api_bachelor_party_weather(dest_id):
    """Weather for a bachelor party destination. Query params: start_date, end_date (YYYY-MM-DD).
    If dates are beyond forecast range (~16 days), returns historical same-dates from previous year."""
    from datetime import date, timedelta
    data = load_bachelor_party()
    dest = next((d for d in data.get("destinations", []) if d.get("id") == dest_id), None)
    if not dest:
        return jsonify({"error": "Unknown destination"}), 404
    from flask import request
    start_s = request.args.get("start_date")
    end_s = request.args.get("end_date")
    if start_s and end_s:
        try:
            start = date.fromisoformat(start_s)
            end = date.fromisoformat(end_s)
            if start > end:
                end = start
            if (end - start).days > 16:
                end = start + timedelta(days=16)
        except (ValueError, TypeError):
            start = date.today()
            end = start + timedelta(days=6)
    else:
        start = date.today()
        end = start + timedelta(days=6)
    tz = dest.get("timezone", "America/Los_Angeles")
    today = date.today()
    forecast_limit = today + timedelta(days=14)
    try:
        if start <= forecast_limit:
            out = fetch_weather_forecast(dest["lat"], dest["lng"], start, end, tz)
        else:
            out = fetch_weather_historical(dest["lat"], dest["lng"], start, end, tz)
        return jsonify(out)
    except Exception as e:
        return jsonify({"error": str(e), "daily": None}), 500


if __name__ == "__main__":
    Path(DATA_FILE).parent.mkdir(parents=True, exist_ok=True)
    app.run(debug=True, port=5000)
