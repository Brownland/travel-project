## Free hosting (2026): Koyeb (recommended)

Why Koyeb:
- Free tier supports Python web services
- Outbound internet works (needed for Open‑Meteo, OSRM, Overpass/Nominatim)
- HTTPS included

### Steps

1) Put this project on GitHub
- Create a GitHub repo
- Push the `portugal-trip-planner` folder

2) Create a Koyeb account + app
- Go to Koyeb and create an app from your GitHub repo.

3) Configure build/run
- **Build**: Koyeb will run `pip install -r requirements.txt`
- **Run command** (if asked): `gunicorn app:app --bind 0.0.0.0:$PORT`
- The repo includes a `Procfile` with the same command.

4) Environment variables
- None required by default.

5) Deploy
- Koyeb will give you a public URL like `https://<name>.koyeb.app`

### Notes
- Portugal page is password-protected (`local`) and remembered via cookie.
- Bachelor party page is public: `/bachelor-party`

