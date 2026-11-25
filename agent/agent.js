// agent/agent.js  v1.0
// Lit alertes.jsonl (J2), cumule les scores, révoque dès 100 pts
// Usage : sudo node agent.js [--alertes <path>] [--seuil <pts>]

const fs     = require("fs");
const path   = require("path");
const { execSync } = require("child_process");

// --- Options ---
function option(nom, defaut) {
  const i = process.argv.indexOf("--" + nom);
  return i !== -1 ? process.argv[i + 1] : defaut;
}

const FICHIER_ALERTES  = option("alertes", path.join(__dirname, "../detection/alertes.jsonl"));
const SEUIL            = parseInt(option("seuil", "100"));
const FICHIER_REVOC    = path.join(__dirname, "revocations.jsonl");
const SCRIPT_REVOQUER  = path.join(__dirname, "revoquer.sh");
// Chemin vers signaler.js de J1 (blockchain) — facultatif
const SIGNALER_JS      = path.join(__dirname, "../contrat/signaler.js");

console.log(`[agent] Surveille : ${FICHIER_ALERTES}`);
console.log(`[agent] Seuil de révocation : ${SEUIL} pts`);

// --- État ---
const scores    = {};   // { admin: nombre_de_points }
const revoques  = new Set(); // admins déjà révoqués (évite la répétition)
const alertesLues = new Set(); // alerteId déjà traités

// --- Lire les alertes ---
let position = 0;

function lireAlertes() {
  if (!fs.existsSync(FICHIER_ALERTES)) return;
  const taille = fs.statSync(FICHIER_ALERTES).size;
  if (taille === position) return;
  if (taille < position) position = 0; // fichier rotaté

  const buf = Buffer.alloc(taille - position);
  const fd  = fs.openSync(FICHIER_ALERTES, "r");
  fs.readSync(fd, buf, 0, buf.length, position);
  fs.closeSync(fd);
  position = taille;

  const lignes = buf.toString("utf8").split("\n");
  for (const ligne of lignes) {
    if (!ligne.trim()) continue;
    let alerte;
    try { alerte = JSON.parse(ligne); } catch { continue; }

    const { alerteId, admin, regle, points } = alerte;
    if (!alerteId || !admin || !points) continue;
    if (alertesLues.has(alerteId)) continue;
    alertesLues.add(alerteId);

    // Cumuler les points
    scores[admin] = (scores[admin] || 0) + points;
    console.log(`[agent] +${points} pts (${regle}) → ${admin} = ${scores[admin]} pts`);

    // Vérifier le seuil
    if (scores[admin] >= SEUIL && !revoques.has(admin)) {
      revoquer(admin, scores[admin]);
    }
  }
}

// --- Révoquer ---
function revoquer(admin, totalPts) {
  revoques.add(admin);
  console.log(`\n🚨 [agent] SEUIL ATTEINT — révocation de ${admin} (${totalPts} pts)`);

  // 1. Lancer le script bash de révocation
  try {
    const sortie = execSync(`bash "${SCRIPT_REVOQUER}" "${admin}"`, {
      encoding: "utf8", stdio: "pipe"
    });
    console.log(sortie);
  } catch (err) {
    console.error(`[agent] Erreur revoquer.sh : ${err.message}`);
  }

  // 2. Enregistrer dans revocations.jsonl
  const entree = JSON.stringify({
    admin,
    totalPts,
    heure: new Date().toISOString(),
    action: "revocation"
  });
  fs.appendFileSync(FICHIER_REVOC, entree + "\n");
  console.log(`[agent] Enregistré dans ${FICHIER_REVOC}`);

  // 3. Signaler sur la blockchain (J1) — optionnel
  if (fs.existsSync(SIGNALER_JS)) {
    try {
      const sortieBC = execSync(
        `node "${SIGNALER_JS}" --admin "${admin}" --score ${totalPts}`,
        { encoding: "utf8", stdio: "pipe", cwd: path.dirname(SIGNALER_JS) }
      );
      console.log(`[agent] Blockchain : ${sortieBC.trim()}`);
    } catch (err) {
      console.warn(`[agent] Blockchain non disponible : ${err.message.split("\n")[0]}`);
    }
  }

  console.log(`[agent] ✅ Révocation de ${admin} terminée.\n`);
}

// --- Boucle principale ---
lireAlertes();
setInterval(lireAlertes, 2000);
console.log("[agent] Prêt. Ctrl+C pour arrêter.");