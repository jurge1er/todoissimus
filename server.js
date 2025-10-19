// Minimaler Todoist-Proxy + statische Auslieferung
// Nutzung: .env (TODOIST_TOKEN) anlegen, dann `npm start`
// Erfordert Node 18+ (wegen global fetch)

require('dotenv').config();
const fs = require('fs');
const https = require('https');
const express = require('express');
const cors = require('cors');

const PORT = process.env.PORT || 5173;
const HTTPS_PORT = process.env.HTTPS_PORT || '';
const SSL_CERT_PATH = process.env.SSL_CERT_PATH || '';
const SSL_KEY_PATH = process.env.SSL_KEY_PATH || '';
const TODOIST_TOKEN = process.env.TODOIST_TOKEN;
const API_BASE = 'https://api.todoist.com/rest/v2';

if (!TODOIST_TOKEN) {
  console.warn('[Todoissimus] WARN: TODOIST_TOKEN ist nicht gesetzt. Setze die Umgebungsvariable, um den Proxy zu nutzen.');
}

const app = express();
app.use(cors());
app.use(express.json());

// Statische Dateien (index.html, app.js, styles.css)
app.use(express.static('.'));

function authHeader(req) {
  // Bevorzuge Server-Token; optional X-Auth-Token erlauben (z.B. Tests)
  const token = TODOIST_TOKEN || req.header('X-Auth-Token');
  if (!token) throw new Error('Fehlendes Server-Token (TODOIST_TOKEN)');
  return { Authorization: `Bearer ${token}` };
}

async function forward(req, res, targetUrl, options = {}) {
  try {
    const headers = { 'Content-Type': 'application/json', ...authHeader(req) };
    const init = {
      method: options.method || req.method,
      headers,
      body: options.body !== undefined
        ? JSON.stringify(options.body)
        : (req.method !== 'GET' && req.body && Object.keys(req.body).length ? JSON.stringify(req.body) : undefined),
    };
    const r = await fetch(targetUrl, init);
    const text = await r.text();
    res.status(r.status);
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('application/json')) res.type('application/json');
    res.send(text);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
}

// Proxy-Routen
app.get('/api/tasks', (req, res) => {
  const { label } = req.query;
  const url = `${API_BASE}/tasks${label ? `?label=${encodeURIComponent(label)}` : ''}`;
  return forward(req, res, url);
});

app.post('/api/tasks', (req, res) => {
  const url = `${API_BASE}/tasks`;
  return forward(req, res, url, { method: 'POST' });
});

app.post('/api/tasks/:id/close', (req, res) => {
  const url = `${API_BASE}/tasks/${req.params.id}/close`;
  return forward(req, res, url, { method: 'POST', body: {} });
});

app.post('/api/tasks/:id', (req, res) => {
  const url = `${API_BASE}/tasks/${req.params.id}`;
  return forward(req, res, url, { method: 'POST' });
});

app.patch('/api/tasks/:id', (req, res) => {
  const url = `${API_BASE}/tasks/${req.params.id}`;
  return forward(req, res, url, { method: 'PATCH' });
});

// Projects (for displaying project names without client token)
app.get('/api/projects', (req, res) => {
  const url = `${API_BASE}/projects`;
  return forward(req, res, url);
});

// Start HTTP server
const httpServer = app.listen(PORT, () => {
  console.log(`[Todoissimus] Server läuft: http://localhost:${PORT}`);
  // Browser automatisch öffnen (falls nicht deaktiviert)
  if (!process.env.NO_OPEN && process.env.BROWSER !== 'none') {
    const url = `http://localhost:${PORT}`;
    try {
      const { exec } = require('child_process');
      if (process.platform === 'win32') exec(`start "" "${url}"`);
      else if (process.platform === 'darwin') exec(`open "${url}"`);
      else exec(`xdg-open "${url}"`);
    } catch (_) {
      // Ignorieren, falls Öffnen fehlschlägt
    }
  }
});

// Optional: Start HTTPS server if cert/key provided
if (SSL_CERT_PATH && SSL_KEY_PATH) {
  try {
    const cert = fs.readFileSync(SSL_CERT_PATH);
    const key = fs.readFileSync(SSL_KEY_PATH);
    const port = Number(HTTPS_PORT) || 5443;
    https.createServer({ key, cert }, app).listen(port, () => {
      console.log(`[Todoissimus] HTTPS aktiv: https://localhost:${port}`);
    });
  } catch (err) {
    console.warn('[Todoissimus] WARN: HTTPS konnte nicht gestartet werden:', err.message);
  }
}
