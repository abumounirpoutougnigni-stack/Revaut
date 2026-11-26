async function api(path, method='GET', body){
  const options={method,headers:{}};
  if(body!==undefined){options.headers['Content-Type']='application/json';options.body=JSON.stringify(body)}
  const response=await fetch(path,options);return response.ok?response.json():{ok:false};
}

let active='admin1';

async function refreshAdmins(){
  const data=await api('/api/admins');
  const names=data.admins||[];
  const select=document.getElementById('activeAdmin');
  select.innerHTML=(names.length?names:['admin1']).map(name=>`<option>${name}</option>`).join('');
  if(!names.includes(active))active=names[0]||'admin1';
  select.value=active;
  document.getElementById('adminPrompt').textContent=`${active}@serveur-cible:~$`;
  const locked=data.locked?.includes(active);
  document.getElementById('accountStatus').textContent=locked?'Compte verrouillé':'Compte actif';
  document.getElementById('accountStatus').className=`status ${locked?'locked':''}`;
}

async function refreshDashboard(){
  const data=await api('/api/dashboard');
  const alerts=(data.alertes||[]).filter(item=>item.admin===active);
  const admin=(data.administrateurs||[]).find(item=>item.nom===active);
  const revoked=(data.revocations||[]).some(item=>item.admin===active);
  const score=admin?.score||0;
  document.getElementById('activeScore').textContent=score;
  document.getElementById('activeAlerts').textContent=alerts.length;
  document.getElementById('activeStatus').textContent=revoked?'Révoqué':(score>=50?'Restreint':'Actif');

  document.querySelectorAll('.stages div').forEach(node=>node.classList.remove('active','done'));
  const j2=document.getElementById('stage-j2');
  const j3=document.getElementById('stage-j3');
  const j4=document.getElementById('stage-j4');
  j2.classList.add(alerts.length?'done':'active');
  j3.classList.add(score>=30?(revoked?'done':'active'):'')
  j4.classList.add(revoked?'done':'');
  document.getElementById('pipelineStatus').textContent=revoked?'Révocation confirmée':(score>0?'Traitement automatique':'En attente');
}

async function refreshLogs(){
  const data=await api('/api/terminals');
  for(const name of ['j2','j3','j4']){
    const state=document.getElementById(`process-${name}`);
    if(state){
      const running=Boolean(data.processes?.[name]);
      state.textContent=running?'actif':'arrêté';
      state.className=`process-state ${running?'running':''}`;
    }
    const element=document.getElementById(`terminal-${name}`);
    if(element){element.textContent=(data.logs[name]||[]).join('\n')||'Aucune sortie.';element.scrollTop=element.scrollHeight}
  }
}

async function executeCommand(command){
  const admin=document.getElementById('activeAdmin').value;
  if(command.startsWith('ssh ')) command=`ssh ${admin}@127.0.0.1`;
  const output=document.getElementById('adminOutput');
  output.textContent+=`\n$ ${command}`;
  await api('/api/admin/command','POST',{admin,command});
  await refreshAdmins();await refreshDashboard();await refreshLogs();
}

document.getElementById('createAdmins').onclick=async()=>{
  const names=document.getElementById('adminNames').value.split(',').map(v=>v.trim()).filter(Boolean);
  await api('/api/admin/create','POST',{names});
  await refreshAdmins();
};

document.getElementById('activeAdmin').onchange=event=>{active=event.target.value;refreshAdmins();refreshDashboard();};
document.getElementById('unlockAdmin').onclick=()=>api('/api/admin/unlock','POST',{admin:document.getElementById('activeAdmin').value}).then(()=>{refreshAdmins();refreshDashboard()});
document.getElementById('commandForm').onsubmit=event=>{event.preventDefault();const input=document.getElementById('commandInput');if(input.value.trim())executeCommand(input.value.trim());input.value=''};
document.querySelectorAll('[data-command]').forEach(button=>button.onclick=()=>executeCommand(button.dataset.command));
document.querySelectorAll('[data-start]').forEach(button=>button.onclick=()=>api(`/api/action/${button.dataset.start}/start`,'POST'));
document.getElementById('startNode').onclick=()=>api('/api/action/j4/node','POST');
document.getElementById('deployContract').onclick=()=>api('/api/action/j4/deploy','POST');
document.getElementById('readContract').onclick=()=>api('/api/action/j4/status','POST',{admin:active});
document.querySelectorAll('[data-stop]').forEach(button=>button.onclick=()=>api(`/api/action/${button.dataset.stop}/stop`,'POST'));
document.getElementById('stopNode').onclick=()=>api('/api/action/j4/stop','POST');

setInterval(refreshAdmins,3000);setInterval(refreshDashboard,1000);setInterval(refreshLogs,800);
refreshAdmins();refreshDashboard();refreshLogs();
