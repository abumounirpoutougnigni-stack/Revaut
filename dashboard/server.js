const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

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

const projectRoot = path.join(root, '..');
const processes = {};
const terminalLogs = {
  setup: [], j2: [], j3: [], j4: [], j5: []
};

function logTerminal(name, text) {
  const clean = String(text).replace(/\r/g, '');
  const lines = clean.split('\n').filter(Boolean);
  terminalLogs[name].push(...lines);
  if (terminalLogs[name].length > 300) terminalLogs[name] = terminalLogs[name].slice(-300);
}

function runCommand(name, command, args = [], options = {}) {
  return new Promise(resolve => {
    logTerminal(name, `$ ${command} ${args.join(' ')}`);
    execFile(command, args, { cwd: options.cwd || projectRoot, timeout: options.timeout || 120000 }, (error, stdout, stderr) => {
      if (stdout) logTerminal(name, stdout.trim());
      if (stderr) logTerminal(name, stderr.trim());
      if (error && !options.ignoreError) logTerminal(name, `[erreur] ${error.message}`);
      resolve({ ok: !error, error: error ? error.message : null });
    });
  });
}

function startProcess(name, command, args, cwd, label) {
  if (processes[name]) logTerminal(name, '[info] Processus déjà actif');
  if (processes[name]) return;
  logTerminal(name, `$ ${label || `${command} ${args.join(' ')}`}`);
  const child = spawn(command, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  processes[name] = child;
  child.stdout.on('data', chunk => logTerminal(name, chunk.toString()));
  child.stderr.on('data', chunk => logTerminal(name, chunk.toString()));
  child.on('exit', code => { logTerminal(name, `[processus arrêté, code ${code}]`); delete processes[name]; });
}

function stopProcess(name) {
  if (!processes[name]) { logTerminal(name, '[info] Aucun processus actif'); return; }
  processes[name].kill('SIGTERM');
  delete processes[name];
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
      contrat: readContractConfig(),
      terminalLogs
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/demo/reset') {
    fs.writeFileSync(path.join(projectRoot, 'detection/alertes.jsonl'), '');
    fs.writeFileSync(path.join(projectRoot, 'agent/revocations.jsonl'), '');
    runCommand('setup', 'sudo', ['-n', 'passwd', '-u', 'admin1'], { ignoreError:true });
    Object.keys(terminalLogs).forEach(name => terminalLogs[name] = []);
    jsonResponse(res, { ok:true });
    return;
  }

  if (url.pathname === '/api/terminals') {
    jsonResponse(res, {
      logs: terminalLogs,
      processes: Object.fromEntries(Object.keys(processes).map(name => [name, true]))
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/demo/create-admin') {
    (async () => {
      const exists = await runCommand('setup', 'id', ['admin1'], { ignoreError:true });
      if (!exists.ok) await runCommand('setup', 'sudo', ['-n', 'useradd', '-m', '-s', '/bin/bash', 'admin1']);
      await runCommand('setup', 'sudo', ['-n', 'passwd', '-u', 'admin1'], { ignoreError:true });
      await runCommand('setup', 'id', ['admin1']);
      jsonResponse(res, { ok:true });
    })();
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/demo/unlock') {
    runCommand('setup', 'sudo', ['-n', 'passwd', '-u', 'admin1']).then(() => runCommand('setup', 'sudo', ['-n', 'passwd', '-S', 'admin1']));
    setTimeout(() => jsonResponse(res, { ok:true }), 150);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/action/j2/start') {
    startProcess('j2', 'node', ['detection/detection.js', '--admins', 'admin1'], projectRoot);
    jsonResponse(res, { ok:true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/action/j2/stop') {
    stopProcess('j2'); jsonResponse(res, { ok:true }); return;
  }

  if (req.method === 'POST' && url.pathname === '/api/action/j3/start') {
    startProcess('j3', 'sudo', ['-n', 'node', 'agent/agent.js'], projectRoot);
    jsonResponse(res, { ok:true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/action/j3/stop') {
    stopProcess('j3'); jsonResponse(res, { ok:true }); return;
  }

  if (req.method === 'POST' && url.pathname === '/api/action/j2/sudo') {
    runCommand('j2', 'sudo', ['-n', 'visudo', '-c']);
    setTimeout(() => jsonResponse(res, { ok:true }), 100);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/action/j2/ssh') {
    runCommand('j2', 'ssh', ['-o', 'StrictHostKeyChecking=no', '-o', 'BatchMode=yes', 'admin1@127.0.0.1', 'true'], { timeout:10000, ignoreError:true });
    setTimeout(() => jsonResponse(res, { ok:true }), 100);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/action/j2/shadow') {
    runCommand('j2', 'sudo', ['-n', 'cat', '/etc/shadow'], { ignoreError:true });
    setTimeout(() => jsonResponse(res, { ok:true }), 100);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/action/j4/node') {
    startProcess('j4', 'npx', ['hardhat', 'node'], path.join(projectRoot, 'contrat'));
    jsonResponse(res, { ok:true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/action/j4/deploy') {
    runCommand('j4', 'npx', ['hardhat', 'run', 'scripts/deploy.js', '--network', 'localhost'], { cwd:path.join(projectRoot, 'contrat') }).then(() => jsonResponse(res, { ok:true }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/action/j4/status') {
    runCommand('j4', 'npx', ['hardhat', 'run', 'scripts/status-admin.js', '--network', 'localhost'], {
      cwd:path.join(projectRoot, 'contrat')
    }).then(() => jsonResponse(res, { ok:true }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/action/j5/start') {
    jsonResponse(res, { ok:true });
    return;
  }

  const file = url.pathname === '/' ? path.join(root, 'index.html') : path.join(root, url.pathname.replace(/^\//, ''));
  if (!file.startsWith(root)) { res.writeHead(403); res.end('Forbidden'); return; }
  sendFile(res, file);
});

server.listen(PORT, '0.0.0.0', () => console.log(`[dashboard] http://localhost:${PORT}`));
