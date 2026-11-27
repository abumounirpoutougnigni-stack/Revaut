const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFile, execFileSync } = require('child_process');
const crypto = require('crypto');

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
const monitoredAdmins = new Set(['admin1']);
const terminalLogs = {
  setup: [], j2: [], j3: [], j4node: [], j4tx: []
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
    execFile(command, args, { cwd: options.cwd || projectRoot, env: options.env || process.env, timeout: options.timeout || 120000 }, (error, stdout, stderr) => {
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
    startProcess('j2', 'node', ['detection/detection.js', '--admins', [...monitoredAdmins].join(',')], projectRoot);
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
    startProcess('j4node', 'npx', ['hardhat', 'node'], path.join(projectRoot, 'contrat'));
    jsonResponse(res, { ok:true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/action/j4/stop') {
    stopProcess('j4node');
    jsonResponse(res, { ok:true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/action/j4/deploy') {
    runCommand('j4tx', 'npx', ['hardhat', 'run', 'scripts/deploy.js', '--network', 'localhost'], {
      cwd: path.join(projectRoot, 'contrat')
    });
    setTimeout(() => jsonResponse(res, { ok:true }), 200);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/action/j4/status') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      let payload = {};
      try { payload = JSON.parse(body); } catch (_) {}
      const admin = /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(payload.admin || '') ? payload.admin : 'admin1';
      runCommand('j4tx', 'npx', ['hardhat', 'run', 'scripts/status-admin.js', '--network', 'localhost'], {
        cwd: path.join(projectRoot, 'contrat'),
        env: { ...process.env, ADMIN: admin }
      });
      setTimeout(() => jsonResponse(res, { ok:true }), 200);
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/action/j5/start') {
    jsonResponse(res, { ok:true });
    return;
  }

  if (url.pathname === '/api/admins') {
    let names = [];
    try {
      names = fs.readFileSync('/etc/passwd', 'utf8').split('\n').map(line => line.split(':')).filter(p => p[2] >= '1000' && p[2] !== '65534').map(p => p[0]).filter(name => name !== 'nobody');
    } catch (_) {}
    names = names.filter(name => name.startsWith('admin'));
    const locked = [];
    for (const name of names) {
      try {
        const status = execFileSync('passwd', ['-S', name], { encoding:'utf8' });
        if (/^\S+\s+L\b/.test(status)) locked.push(name);
      } catch (_) {}
    }
    jsonResponse(res, { admins:names, locked });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/create') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      let names = [];
      try { names = JSON.parse(body).names || []; } catch (_) {}
      for (const name of names) {
        const safe = /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(name);
        if (!safe) { logTerminal('setup', `[refus] Nom invalide: ${name}`); continue; }
        await runCommand('setup', 'bash', ['-lc', `if ! id ${name} >/dev/null 2>&1; then sudo useradd -m -s /bin/bash ${name}; fi; echo '${name}:Admin2026!' | sudo chpasswd; sudo passwd -u ${name} >/dev/null 2>&1 || true`]);
        await runCommand('setup', 'bash', ['-lc', `sudo install -d -m 0700 -o ${name} -g ${name} /home/${name}/.ssh; if [ ! -f /home/${name}/.ssh/revaut_demo ]; then sudo -u ${name} ssh-keygen -t ed25519 -N '' -f /home/${name}/.ssh/revaut_demo >/dev/null 2>&1; fi; sudo cp /home/${name}/.ssh/revaut_demo.pub /home/${name}/.ssh/authorized_keys; sudo chown ${name}:${name} /home/${name}/.ssh/authorized_keys; sudo chmod 0600 /home/${name}/.ssh/authorized_keys`]);
        fs.appendFileSync('/tmp/revaut-sudoers-part', `${name} ALL=(ALL) NOPASSWD: /usr/bin/visudo, /usr/bin/cat\n`);
        monitoredAdmins.add(name);
        logTerminal('setup', `[créé] ${name} — mot de passe de démonstration: Admin2026!`);
      }
      if (names.length) {
        fs.writeFileSync('/tmp/revaut-sudoers', `osboxes ALL=(ALL) NOPASSWD: ALL\n${fs.readFileSync('/tmp/revaut-sudoers-part', 'utf8')}`);
        await runCommand('setup', 'sudo', ['cp', '/tmp/revaut-sudoers', '/etc/sudoers.d/revaut-demo']);
        await runCommand('setup', 'sudo', ['chmod', '0440', '/etc/sudoers.d/revaut-demo']);
        await runCommand('setup', 'sudo', ['visudo', '-c']);
      }
      jsonResponse(res, { ok:true });
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/unlock') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      let payload = {};
      try { payload = JSON.parse(body); } catch (_) {}
      const admin = /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(payload.admin || '') ? payload.admin : 'admin1';
      await runCommand('setup', 'sudo', ['passwd', '-u', admin]);
      await runCommand('setup', 'sudo', ['passwd', '-S', admin]);
      await runCommand('j4tx', 'npx', ['hardhat', 'run', 'scripts/reintegrer-admin.js', '--network', 'localhost'], {
        cwd:path.join(projectRoot, 'contrat'), env:{...process.env, ADMIN:admin}
      }).catch(() => {});
      stopProcess('j3');
      jsonResponse(res, { ok:true });
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/action') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      let payload = {};
      try { payload = JSON.parse(body); } catch (_) {}
      const admin = /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(payload.admin || '') ? payload.admin : 'admin1';

      if (payload.rule === 'sudo') {
        await runCommand('j2', 'sudo', ['-n', 'visudo', '-c'], { ignoreError:true });
      } else if (payload.rule === 'shadow') {
        await runCommand('j2', 'sudo', ['-n', 'cat', '/etc/shadow'], { ignoreError:true });
      } else if (payload.rule === 'heure') {
        await runCommand('j2', 'logger', ['-t', 'sshd', `Accepted publickey for ${admin} from 127.0.0.1 port 50000 ssh2`], { ignoreError:true });
      }
      jsonResponse(res, { ok:true });
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/command') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      let payload = {};
      try { payload = JSON.parse(body); } catch (_) {}
      const admin = /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(payload.admin || '') ? payload.admin : 'admin1';
      const command = String(payload.command || '').trim();
      logTerminal('j2', `[session ${admin}] $ ${command}`);

      let execution = { ok:true };

      // Simuler la commande dans le terminal J2 (mode démonstration — injection directe)
      if (command === 'sudo visudo') {
        // Tenter la vraie commande mais ne pas bloquer sur son résultat
        runCommand('j2', 'sudo', ['-n', 'visudo', '-c'], { ignoreError:true });
      } else if (command === 'sudo cat /etc/shadow') {
        runCommand('j2', 'sudo', ['-n', 'cat', '/etc/shadow'], { ignoreError:true });
      } else if (command.startsWith('ssh ')) {
        // Simuler une entrée auth.log via logger (fonctionne sans root)
        runCommand('j2', 'logger', ['-t', 'sshd', `Accepted publickey for ${admin} from 127.0.0.1 port 50000 ssh2`], { ignoreError:true });
      } else {
        logTerminal('j2', '[sécurité] Commande non autorisée dans la démonstration');
        jsonResponse(res, { ok:true });
        return;
      }

      // Injection inconditionnelle de l'alerte (mode démo — ne dépend pas du résultat de la commande)
      let alerte = null;
      if (command === 'sudo visudo') {
        alerte = { alerteId:`sudo-demo-${crypto.randomBytes(6).toString('hex')}`, admin, regle:'sudo_inhabituel', points:30, heure:new Date().toISOString() };
      } else if (command === 'sudo cat /etc/shadow') {
        alerte = { alerteId:`shadow-demo-${crypto.randomBytes(6).toString('hex')}`, admin, regle:'fichier_secret', points:50, heure:new Date().toISOString() };
      } else if (command.startsWith('ssh ')) {
        alerte = { alerteId:`ssh-demo-${crypto.randomBytes(6).toString('hex')}`, admin, regle:'heure_inhabituelle', points:20, heure:new Date().toISOString() };
      }

      if (alerte) {
        fs.appendFileSync(path.join(projectRoot, 'detection/alertes.jsonl'), JSON.stringify(alerte) + '\n');
        logTerminal('j2', JSON.stringify(alerte));
        logTerminal('j2', `[J2→J3] Alerte injectée : ${alerte.regle} +${alerte.points} pts`);
        setTimeout(() => {
          runCommand('j4tx', 'npx', ['hardhat', 'run', 'scripts/status-admin.js', '--network', 'localhost'], {
            cwd:path.join(projectRoot, 'contrat'), env:{...process.env, ADMIN:admin}
          });
        }, 3200);
      }
      jsonResponse(res, { ok:true });
    });
    return;
  }

  if (url.pathname === '/console' || url.pathname === '/') {
    sendFile(res, path.join(root, 'console.html'));
    return;
  }

  const file = path.join(root, url.pathname.replace(/^\//, ''));
  if (!file.startsWith(root)) { res.writeHead(403); res.end('Forbidden'); return; }
  sendFile(res, file);
});

server.listen(PORT, '0.0.0.0', () => console.log(`[dashboard] http://localhost:${PORT}`));