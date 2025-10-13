Todoissimus — Drag-and-drop lists for Todoist labels

Overview
- Local, single-file web app (no build tools required).
- Fetches Todoist tasks by a chosen label and shows them in a Todoist-like list.
- Reorder tasks via drag and drop without changing order inside Todoist (order stored locally).
- Completing a task, editing task properties, and creating new tasks syncs to Todoist.

Security & scope
- You provide a Todoist REST API token; it’s stored in your browser’s localStorage.
- Do not deploy this as a public site unless you add a secure backend.
- This app is intended for local, personal use.

Features
- Select label to load tasks for (persisted in localStorage).
- Drag-and-drop reorder (local only, per-label).
- Complete tasks (closes in Todoist).
- Edit task content, due date (simple date string), and priority.
- Create new tasks with the same label.

How to run
1. Open `index.html` in a modern browser, or run a simple local server (e.g., `python -m http.server`).
2. Paste your Todoist REST API token in the settings panel.
3. Enter the label to view (e.g., `@focus` without the `@` — just the label name) and click Load.

Notes
- If you hit CORS issues, open via a local server (most browsers restrict local file fetch CORS). If CORS persists, you’ll need a tiny proxy server. I can add one if needed.
- Local ordering is saved as `todoissimus_order_<label>` in localStorage.
- Token and label are saved as `todoissimus_token` and `todoissimus_label`.

Mobile (PWA) support
- This app is installable as a PWA. The repo includes `manifest.webmanifest` and `service-worker.js`.
- On desktop: You can “Install app” from the browser menu (Chrome/Edge)
- On phone in same Wi‑Fi: Open `http://<DEIN-PC-IP>:5173` in mobile Chrome/Edge/Safari, then “Zum Startbildschirm hinzufügen/Installieren”.
- Touch drag-and-drop is supported via a pointer‑based fallback. Use the handle “⋮⋮” to reorder.
- Note: For phones, your PC’s firewall must allow inbound port 5173.
- Icons: basic SVG icon is included at `icons/icon.svg`. You can replace it with your own or extend the manifest with PNG sizes (192/512). If you add PNGs, also add them to the service worker `ASSETS` list for offline caching.

Proxy server (optional but recommended)
- Purpose: Avoid CORS and keep your Todoist token on the server.
- Requirements: Node.js 18+.
- Setup (npm scripts + .env):
  1) Create `.env` from `.env.example` and set `TODOIST_TOKEN`.
  2) Install deps: `npm install`
  3) Start server: `npm start`
  4) Open: `http://localhost:5173`
- Frontend behavior:
  - If you do NOT paste a token in the UI, it will use the proxy at `/api` with the server-side token from `.env`.
  - If you paste a token in the UI, it will call Todoist directly.
 - The server now auto-opens your default browser. To disable, set `NO_OPEN=1` or `BROWSER=none` in `.env`.

Local HTTPS (optional)
- Purpose: On iOS/Safari, full PWA features prefer HTTPS. You can enable local HTTPS for testing.
- Steps (Windows):
  1) Install mkcert (easiest via Chocolatey): `choco install mkcert` (and run `mkcert -install` once)
  2) Generate certs in a `certs` folder: `mkcert -key-file certs/localhost+1-key.pem -cert-file certs/localhost+1.pem localhost 127.0.0.1`
  3) In `.env`, set:
     - `SSL_CERT_PATH=certs/localhost+1.pem`
     - `SSL_KEY_PATH=certs/localhost+1-key.pem`
     - Optional `HTTPS_PORT=5443`
  4) `npm start` → open `https://localhost:5443`
- Notes: Keep HTTP on 5173 for LAN access (phones in Wi‑Fi), and HTTPS locally for iOS testing.

External Hosting (HTTPS)
- Easiest: Render.com Web Service (free tier)
  1) Push this folder to GitHub.
  2) On Render: New → Web Service → Connect your repo.
  3) Build command: `npm install`
  4) Start command: `node server.js`
  5) Environment: add `TODOIST_TOKEN=...`
  6) Deploy → you get an `https://<your-app>.onrender.com` URL (TLS included).
  7) Use the app at that URL (token comes from Render env). Leave token empty in the UI.
- Alternatives: Railway.app, Fly.io, small VPS. Most platforms terminate HTTPS at the edge; no code changes needed.

GitHub safety (secrets)
- Do NOT commit your `.env` or certificates. They are already ignored by `.gitignore`.
- Verify before pushing:
  - `git status` shows no `.env` or `certs/` changes.
  - Optionally search for “TODOIST_TOKEN” references in tracked files.
- On Render, set `TODOIST_TOKEN` in the dashboard (Environment) — not in the repo.
- If you ever accidentally committed a secret, rotate the token in Todoist and force-remove it from git history.

Git: Initial setup and first push
- Prerequisites: Install Git (https://git-scm.com). Sign in to GitHub and create an empty repo (no README/license) — copy its HTTPS URL, e.g. `https://github.com/<USER>/todoissimus.git`.
- In PowerShell, from the project folder:
  - `cd "c:\Users\JMSto\Dropbox\Programme\Repository\Todoissimus"`
  - Initialize (if not already a repo): `git init`
  - Set main as default branch: `git branch -M main`
  - Verify ignored files won’t be tracked: `git status` (should NOT list `.env` or `certs/`)
  - Add files: `git add .`
  - First commit: `git commit -m "chore: initial import of Todoissimus"`
  - Link remote: `git remote add origin https://github.com/<USER>/todoissimus.git`
  - Push: `git push -u origin main`

Update after changes
- Make edits → `git add -A` → `git commit -m "feat: <kurze Beschreibung>"` → `git push`.
- Render auto‑deploy: If connected, Render will redeploy on every push to `main`.

Desktop shortcut
- Quick: Double-click `start-todoissimus.cmd` to start the server and open logs in a console.
- Create a Windows shortcut automatically:
  - Right-click `create-desktop-shortcut.ps1` → „Mit PowerShell ausführen“
  - This creates `Todoissimus.lnk` on your Desktop that starts `npm start` in this folder and closes the console when the server stops.
- Manual (alternative):
  - On Desktop → Right-click → New → Shortcut
  - Target: `C:\Windows\System32\cmd.exe /c cd /d "C:\Users\JMSto\Dropbox\Programme\Repository\Todoissimus" && npm start`
  - Name: `Todoissimus`

Run without console window
- Double-click `start-todoissimus.vbs` to launch the server hidden (no console window). To stop it, close Node from Task Manager or use your usual stop method if you started it from a visible console.

Roadmap (optional)
- OAuth flow instead of manual token paste.
- Server-side ordering to sync custom order across devices.
- Richer editing (labels, reminders, sections).

Usage notes
- Hidden launcher: `start-todoissimus.vbs` now detects if the server is already running; if so, it simply opens your browser to the app.
- Stop server: run `powershell -ExecutionPolicy Bypass -File .\stop-todoissimus.ps1` in the project folder (default port 5173).
- Desktop shortcut: re-run `create-desktop-shortcut.ps1` to (re)create a hidden-start shortcut on your Desktop.
 
Note
- The Desktop shortcut created by `create-desktop-shortcut.ps1` now launches Todoissimus hidden (no console window) via `start-todoissimus.vbs`.
