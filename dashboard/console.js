async function api(path, method='GET', body) {
  const options = { method, headers: {} };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(path, options);
  return response.ok ? response.json() : { ok:false };
}

async function refreshAdmins() {
  const data = await api('/api/admins');
  const names = data.admins || [];
  document.getElementById('activeAdmin').innerHTML = names.map(name => `<option>${name}</option>`).join('') || '<option>admin1</option>';
  document.getElementById('adminList').innerHTML = names.map(name => `<span class="chip ${data.locked?.includes(name) ? 'locked' : ''}">${name}${data.locked?.includes(name) ? ' — verrouillé' : ''}</span>`).join('') || '<span class="chip">Aucun compte créé</span>';
}

async function refreshLogs() {
  const data = await api('/api/terminals');
  for (const name of ['j2','j3','j4']) {
    const element = document.getElementById(`terminal-${name}`);
    element.textContent = (data.logs[name] || []).join('\n') || 'Aucune sortie.';
    element.scrollTop = element.scrollHeight;
  }
}

document.getElementById('createAdmins').onclick = async () => {
  const names = document.getElementById('adminNames').value.split(',').map(name => name.trim()).filter(Boolean);
  await api('/api/admin/create', 'POST', { names });
  await refreshAdmins();
};

document.getElementById('unlockAdmin').onclick = async () => {
  const admin = document.getElementById('activeAdmin').value;
  await api('/api/admin/unlock', 'POST', { admin });
  await refreshAdmins();
};

document.querySelectorAll('[data-rule]').forEach(button => {
  button.onclick = async () => {
    const admin = document.getElementById('activeAdmin').value;
    await api('/api/admin/action', 'POST', { admin, rule:button.dataset.rule });
  };
});

document.querySelectorAll('[data-start]').forEach(button => button.onclick = () => api(`/api/action/${button.dataset.start}/start`, 'POST'));
document.querySelectorAll('[data-stop]').forEach(button => button.onclick = () => api(`/api/action/${button.dataset.stop}/stop`, 'POST'));
document.getElementById('deployContract').onclick = async () => {
  await api('/api/action/j4/node', 'POST');
  await api('/api/action/j4/deploy', 'POST');
};
document.getElementById('readStatus').onclick = () => api('/api/action/j4/status', 'POST');
document.getElementById('startAll').onclick = async () => {
  await api('/api/action/j2/start', 'POST');
  await api('/api/action/j3/start', 'POST');
  await api('/api/action/j4/node', 'POST');
};
document.getElementById('configureDemo').onclick = () => api('/api/demo/configure', 'POST');

setInterval(refreshAdmins, 3000);
setInterval(refreshLogs, 800);
refreshAdmins();
refreshLogs();
