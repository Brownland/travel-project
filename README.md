# Portugal Trip Planner

A simple trip planner for your May Portugal trip: **map**, **day-by-day schedule**, **hotel suggestions**, and **weather** for each day.

## What's included

- **Map** — All activities and hotel areas on one map (Leaflet + dark theme).
- **Schedule** — Day-by-day itinerary with suggested timings.
- **Hotels** — Suggestions by city (Lisbon: Baixa/Chiado or Alfama; Porto: Ribeira or Centro).
- **Weather** — Daily forecast (max/min temp, rain) from Open-Meteo (no API key).

## Setup with Conda (recommended)

This project is set up to use **Conda** with **Python 3.13**.

1. Open **Anaconda Prompt** or **Miniconda Prompt** (or a terminal where `conda` is in your PATH).
2. Go to the project and create the environment:

   ```bash
   cd c:\Users\manan\PycharmProjects\portugal-trip-planner
   conda env create -f environment.yml
   conda activate portugal-trip-planner
   python app.py
   ```

3. Open **http://127.0.0.1:5000** in your browser.

**If `conda` is not recognized:** use the Start Menu shortcut **Anaconda Prompt** or **Anaconda PowerShell Prompt**; those terminals have conda on PATH. If conda is installed in a custom location, add its `Scripts` folder to your PATH.

**If Python 3.13 isn’t available in your conda:** edit `environment.yml` and change `python=3.13` to e.g. `python=3.12`.

## Run with pip (no Conda)

```bash
cd portugal-trip-planner
pip install -r requirements.txt
python app.py
```

Open **http://127.0.0.1:5000** in your browser.

## Your itinerary

The app reads from `data/itinerary.json`. Right now it uses a **sample** 8-day Lisbon → Sintra → Porto itinerary.

**To use your own plan:** paste your brief itinerary in the chat and we can update `data/itinerary.json` with your dates, cities, and activities (and add coordinates so they show on the map).

## Dates and weather

- Set `start_date` and `end_date` in `data/itinerary.json` to your real travel dates (e.g. May 2026).
- Weather is fetched for that range; the free API only supports about 16 days ahead, so run the app close to your trip for accurate forecasts.
