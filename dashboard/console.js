async function api(path, method='GET', body) {
  const options={method,headers:{}};
  if(body!==undefined){options.headers['Content-Type']='application/json';options.body=JSON.stringify(body)}
  const response=await fetch(path,options); return response.ok?response.json():{ok:false};
}

let selectedAdmin='admin1';

async function refreshAdmins(){
  const data=await api('/api/admins');
  const names=data.admins||[];
  const select=document.getElementById('activeAdmin');
  select.innerHTML=(names.length?names:['admin1']).map(name=>`<option>${name}</option>`).join('');
  if(!names.includes(selectedAdmin)) selectedAdmin=names[0]||'admin1';
  select.value=selectedAdmin;
  document.getElementById('sessionPrompt').textContent=`${selectedAdmin}@serveur-cible:~$`;
  document.getElementById('adminChips').innerHTML=(names.length?names:['Aucun compte']).map(name=>`<span class="chip ${data.locked?.includes(name)?'locked':''}">${name}${data.locked?.includes(name)?' — verrouillé':''}</span>`).join('');
  document.getElementById('accountStatus').textContent=data.locked?.includes(selectedAdmin)?'Compte verrouillé':'Compte actif';
  document.getElementById('accountStatus').className=`account-status ${data.locked?.includes(selectedAdmin)?'locked':''}`;
}

async function refreshDashboard(){
  const data=await api('/api/dashboard');
  const admin=data.administrateurs?.find(item=>item.nom===selectedAdmin);
  const alerts=(data.alertes||[]).filter(item=>item.admin===selectedAdmin);
  const revoked=(data.revocations||[]).some(item=>item.admin===selectedAdmin);
  document.getElementById('activeScore').textContent=admin?.score||0;
  document.getElementById('activeAlerts').textContent=alerts.length;
  document.getElementById('activeStatus').textContent=revoked?'Révoqué':(admin?.score>=50?'Restreint':'Actif');
  document.getElementById('contractAddress').textContent=data.contrat?.adresse||'Non déployé';
  setStage(admin?.score||0,revoked);
}

function setStage(score,revoked){
  document.querySelectorAll('.stage').forEach(stage=>stage.classList.remove('active','done'));
  document.getElementById('stage-j2').classList.add(score>0?'done':'active');
  document.getElementById('stage-j3').classList.add(score>=30?(revoked?'done':'active'):(score>0?'active':''));
  document.getElementById('stage-j4').classList.add(revoked?'done':'');
  document.getElementById('pipelineStatus').textContent=revoked?'Révocation confirmée':(score>0?'Traitement automatique':'En attente');
}

async function refreshLogs(){
  const data=await api('/api/terminals');
  const owner=document.getElementById('ownerOutput');
  if(owner && data.logs?.setup?.length) owner.textContent=data.logs.setup.join('\n');
  for(const name of ['j2','j3','j4']){
    const element=document.getElementById(name==='j4'?'blockchainOutput':`terminal-${name}`);
    if(element){element.textContent=(data.logs[name]||[]).join('\n')||'Aucune sortie.';element.scrollTop=element.scrollHeight}
  }
}

async function executeCommand(command){
  const admin=document.getElementById('activeAdmin').value;
  const output=document.getElementById('adminOutput');
  output.textContent+=`$ ${command}\n`;
  await api('/api/admin/command','POST',{admin,command});
  await refreshAdmins();await refreshDashboard();await refreshLogs();
}

document.getElementById('createAdmins').onclick=async()=>{
  const names=document.getElementById('adminNames').value.split(',').map(v=>v.trim()).filter(Boolean);
  document.getElementById('ownerOutput').textContent=`Création des comptes : ${names.join(', ')}\n`;
  await api('/api/admin/create','POST',{names});
  document.getElementById('ownerOutput').textContent+=`Terminé. Comptes disponibles dans le terminal administrateur.\n`;
  await refreshAdmins();
};

document.getElementById('activeAdmin').onchange=event=>{selectedAdmin=event.target.value;refreshAdmins();refreshDashboard();};
document.getElementById('unlockActive').onclick=async()=>api('/api/admin/unlock','POST',{admin:document.getElementById('activeAdmin').value}).then(async()=>{await refreshAdmins();await refreshDashboard();});
document.getElementById('runCommand').onclick=()=>{const input=document.getElementById('commandInput');if(input.value.trim())executeCommand(input.value.trim());input.value=''};
document.getElementById('commandInput').onkeydown=event=>{if(event.key==='Enter')document.getElementById('runCommand').click()};
document.querySelectorAll('[data-command]').forEach(button=>button.onclick=()=>executeCommand(button.dataset.command));

document.querySelectorAll('[data-start]').forEach(button=>button.onclick=()=>api(`/api/action/${button.dataset.start}/start`,'POST'));
document.getElementById('startNode').onclick=()=>api('/api/action/j4/node','POST');
document.getElementById('deployContract').onclick=()=>api('/api/action/j4/deploy','POST');
document.getElementById('readContract').onclick=()=>api('/api/action/j4/status','POST');

setInterval(refreshAdmins,3000);setInterval(refreshDashboard,1200);setInterval(refreshLogs,800);
refreshAdmins();refreshDashboard();refreshLogs();
