async function loadDashboard() {
  try {
    const response = await fetch('/api/dashboard');
    if (!response.ok) throw new Error('API indisponible');
    const data = await response.json();

    document.getElementById('alertCount').textContent = data.alertes.length;
    document.getElementById('revocationCount').textContent = data.revocations.length;
    document.getElementById('contractAddress').textContent = data.contrat.adresse || '—';
    document.getElementById('adminCount').textContent = data.administrateurs.length;

    const totalPoints = data.alertes.reduce((sum, item) => sum + Number(item.points || 0), 0);
    document.getElementById('pointCount').textContent = totalPoints;

    const status = document.getElementById('systemStatus');
    status.className = `status ${data.actif ? 'online' : 'offline'}`;
    status.innerHTML = `<span></span>${data.actif ? 'Système actif' : 'Agent hors ligne'}`;

    const latest = data.alertes.slice(-8).reverse();
    document.getElementById('alertRows').innerHTML = latest.length
      ? latest.map(item => `<tr><td>${formatHour(item.heure)}</td><td>${escapeHtml(item.admin)}</td><td>${escapeHtml(item.regle)}</td><td>+${Number(item.points)}</td></tr>`).join('')
      : '<tr><td colspan="4" class="empty">Aucune alerte enregistrée</td></tr>';

    document.getElementById('admins').innerHTML = data.administrateurs.length
      ? data.administrateurs.map(admin => {
          const revoked = data.revocations.some(item => item.admin === admin.nom);
          const score = Math.min(admin.score, 120);
          return `<div class="admin"><div class="admin-head"><span class="admin-name">${escapeHtml(admin.nom)}</span><span class="badge ${revoked ? 'revoked' : ''}">${revoked ? 'Révoqué' : 'Actif'}</span></div><div class="score"><div style="width:${Math.min(100, score / 100 * 100)}%"></div></div><small>${admin.score} points</small></div>`;
        }).join('')
      : '<div class="empty">Aucun administrateur détecté</div>';

    document.getElementById('revocations').innerHTML = data.revocations.length
      ? data.revocations.slice().reverse().map(item => `<div class="timeline-item"><div><strong>${escapeHtml(item.admin)}</strong><time>${formatDate(item.heure)}</time></div><span>${Number(item.totalPts || 0)} pts</span></div>`).join('')
      : '<div class="empty">Aucune révocation enregistrée</div>';

    document.getElementById('updatedAt').textContent = new Date().toLocaleTimeString('fr-FR');
  } catch (error) {
    const status = document.getElementById('systemStatus');
    status.className = 'status offline';
    status.innerHTML = '<span></span>API indisponible';
  }
}

function formatHour(value) { return value ? new Date(value).toLocaleString('fr-FR') : '—'; }
function formatDate(value) { return value ? new Date(value).toLocaleString('fr-FR') : '—'; }
function escapeHtml(value) { const div = document.createElement('div'); div.textContent = String(value || ''); return div.innerHTML; }

loadDashboard();
setInterval(loadDashboard, 3000);
