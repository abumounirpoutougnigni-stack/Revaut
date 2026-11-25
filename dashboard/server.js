const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const root = __dirname;

function readJsonLines(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch (_) { return null; }
    }).filter(Boolean);
  } catch (_) { return []; }
}

function readContractConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(root, '../config/contrat.json'), 'utf8')); }
  catch (_) { return { adresse: null, abi: [] }; }
}

function jsonResponse(res, value, statusCode = 200) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (error, content) => {
    if (error) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/dashboard') {
    const alertes = readJsonLines(path.join(root, '../detection/alertes.jsonl'));
    const revocations = readJsonLines(path.join(root, '../agent/revocations.jsonl'));
    const adminNames = [...new Set(alertes.map(item => item.admin).filter(Boolean))];
    const scores = {};
    for (const alert of alertes) scores[alert.admin] = (scores[alert.admin] || 0) + Number(alert.points || 0);
    const administrateurs = adminNames.map(nom => ({ nom, score: scores[nom] || 0 }));

    jsonResponse(res, {
      actif: fs.existsSync(path.join(root, '../detection/alertes.jsonl')),
      alertes,
      revocations,
      administrateurs,
      contrat: readContractConfig()
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/demo/alert') {
    const alertesFile = path.join(root, '../detection/alertes.jsonl');
    const alertes = readJsonLines(alertesFile);
    const alert = {
      alerteId: `sudo-demo-${Date.now()}`,
      admin: 'admin1',
      regle: 'sudo_inhabituel',
      points: 30,
      heure: new Date().toISOString()
    };
    fs.appendFileSync(alertesFile, JSON.stringify(alert) + '\n');
    const total = alertes.filter(item => item.admin === 'admin1').reduce((sum, item) => sum + Number(item.points || 0), 0) + 30;
    jsonResponse(res, { alerte: alert, total });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/demo/complete') {
    const alertesFile = path.join(root, '../detection/alertes.jsonl');
    const revocationsFile = path.join(root, '../agent/revocations.jsonl');
    const existing = readJsonLines(alertesFile).filter(item => item.admin === 'admin1');
    const existingPoints = existing.reduce((sum, item) => sum + Number(item.points || 0), 0);
    const alertes = [];

    for (let points = existingPoints; points < 120; points += 30) {
      const alert = {
        alerteId: `sudo-demo-${Date.now()}-${alertes.length}`,
        admin: 'admin1',
        regle: 'sudo_inhabituel',
        points: 30,
        heure: new Date().toISOString()
      };
      alertes.push(alert);
      fs.appendFileSync(alertesFile, JSON.stringify(alert) + '\n');
    }

    const revocation = { admin: 'admin1', totalPts: 120, heure: new Date().toISOString(), action: 'revocation' };
    fs.appendFileSync(revocationsFile, JSON.stringify(revocation) + '\n');
    jsonResponse(res, { alertes, revocation });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/demo/reset') {
    fs.writeFileSync(path.join(root, '../detection/alertes.jsonl'), '');
    fs.writeFileSync(path.join(root, '../agent/revocations.jsonl'), '');
    jsonResponse(res, { reset: true });
    return;
  }

  const file = url.pathname === '/' ? path.join(root, 'index.html') : path.join(root, url.pathname.replace(/^\//, ''));
  if (!file.startsWith(root)) { res.writeHead(403); res.end('Forbidden'); return; }
  sendFile(res, file);
});

server.listen(PORT, '0.0.0.0', () => console.log(`[dashboard] http://localhost:${PORT}`));
