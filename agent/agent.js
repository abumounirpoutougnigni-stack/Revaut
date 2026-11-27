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
// Chemin vers le connecteur blockchain J1/J4
const CONTRAT_DIR = path.join(__dirname, "../contrat");
const SIGNALER_JS = path.join(CONTRAT_DIR, "scripts/signaler.js");

console.log(`[agent] Surveille : ${FICHIER_ALERTES}`);
console.log(`[agent] Seuil de révocation : ${SEUIL} pts`);

// --- État ---
const scores    = {};   // { admin: nombre_de_points }
const revoques  = new Set(); // admins déjà révoqués (évite la répétition)
const alertesLues = new Set(); // alerteId déjà traités
const alertesRecents = new Map(); // admin:regle -> timestamp, évite les doublons J2 + bridge démo

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

    // Ignorer les alertes dupliquées dans une fenêtre de 5 secondes
    const cleRegle = `${admin}:${regle}`;
    const derniere = alertesRecents.get(cleRegle) || 0;
    const maintenant = Date.now();
    if (maintenant - derniere < 5000) continue;
    alertesRecents.set(cleRegle, maintenant);

    // Cumuler les points
    scores[admin] = (scores[admin] || 0) + points;
    console.log(`[agent] +${points} pts (${regle}) → ${admin} = ${scores[admin]} pts`);

    // Envoyer chaque alerte à la blockchain, pas uniquement le seuil final
    signalerAlerte(admin, points, alerteId);

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

  // 3. La blockchain est mise à jour une transaction par alerte ci-dessus.

  console.log(`[agent] ✅ Révocation de ${admin} terminée.\n`);
}

// --- Envoyer une alerte à la blockchain ---
// Utilise node + chemin absolu vers hardhat/cli pour éviter EACCES sur le symlink .bin/
const HARDHAT_CLI = path.join(CONTRAT_DIR, "node_modules/hardhat/internal/cli/cli.js");
function signalerAlerte(admin, points, alerteId) {
  if (!fs.existsSync(SIGNALER_JS)) return;
  const hardhatBin = fs.existsSync(HARDHAT_CLI) ? HARDHAT_CLI : null;
  const cmd = hardhatBin
    ? `"${process.execPath}" "${hardhatBin}" run scripts/signaler.js --network localhost`
    : `npx hardhat run scripts/signaler.js --network localhost`;
  try {
    const sortie = execSync(cmd, {
      encoding: "utf8",
      stdio: "pipe",
      cwd: CONTRAT_DIR,
      env: { ...process.env, ADMIN: admin, POINTS: String(points), ID: alerteId }
    });
    console.log(`[agent] Blockchain : ${sortie.trim().split('\n').pop()}`);
  } catch (err) {
    console.warn(`[agent] Blockchain non disponible : ${err.message.split("\n")[0]}`);
  }
}

// --- Boucle principale ---
lireAlertes();
setInterval(lireAlertes, 2000);
console.log("[agent] Prêt. Ctrl+C pour arrêter.");