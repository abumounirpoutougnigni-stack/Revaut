// detection/detection.js  v3.1
// Surveille auth.log et audit.log — crée des alertes JSON
// Compatible Ubuntu 26.04 (format auditd enrichi une-ligne)

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

// --- Options ligne de commande ---
function option(nom, defaut) {
  const i = process.argv.indexOf("--" + nom);
  return i !== -1 ? process.argv[i + 1] : defaut;
}

const FICHIER_AUTH   = option("auth",        "/var/log/auth.log");
const FICHIER_AUDIT  = option("audit",       "/var/log/audit/audit.log");
const ADMINS         = (option("admins",     "admin1")).split(",");
const HEURE_DEBUT    = parseInt(option("heure-debut", "8"));
const HEURE_FIN      = parseInt(option("heure-fin",   "18"));
const FICHIER_SORTIE = option("sortie", path.join(__dirname, "alertes.jsonl"));
const UNE_FOIS       = process.argv.includes("--une-fois");

console.log(`[detection] admins: ${ADMINS.join(",")} | heures: ${HEURE_DEBUT}h-${HEURE_FIN}h`);

// --- Barème ---
const POINTS = {
  heure_inhabituelle: 20,
  sudo_inhabituel:    30,
  fichier_secret:     50,
};

// Commandes sudo sensibles
const SUDO_SENSIBLE = /passwd|visudo|usermod|useradd|userdel|groupadd|sudoers|sshd_config|authorized_keys/i;

const alertesVues = new Set();

function creerAlerte(admin, regle, alerteId, heure) {
  return { alerteId, admin, regle, points: POINTS[regle], heure: heure || new Date().toISOString() };
}

function emettreAlerte(alerte) {
  if (alertesVues.has(alerte.alerteId)) return;
  alertesVues.add(alerte.alerteId);
  const ligne = JSON.stringify(alerte);
  console.log(ligne);
  fs.appendFileSync(FICHIER_SORTIE, ligne + "\n");
}

// --- Règles 1 et 3 : auth.log ---
function analyserLigneAuth(ligne) {
  // Règle 1 : SSH hors heures normales
  const mCo = ligne.match(
    /^(\S+T\d{2}:\d{2}:\d{2})[^\s]* \S+ sshd\[\d+\]: Accepted \S+ for (\S+) /
  );
  if (mCo) {
    const admin = mCo[2];
    if (ADMINS.includes(admin)) {
      const h = new Date(mCo[1]).getHours();
      const hors = (HEURE_DEBUT === 0 && HEURE_FIN === 0)
        || h < HEURE_DEBUT || h >= HEURE_FIN;
      if (hors) {
        const id = "ssh-" + crypto.createHash("md5").update(ligne).digest("hex").slice(0, 12);
        emettreAlerte(creerAlerte(admin, "heure_inhabituelle", id, new Date(mCo[1]).toISOString()));
      }
    }
    return;
  }

  // Règle 3 : sudo sensible
  const mSudo = ligne.match(/sudo:\s+(\S+)\s+:.*COMMAND=(\S+)/);
  if (mSudo) {
    const admin    = mSudo[1];
    const commande = mSudo[2];
    if (ADMINS.includes(admin) && SUDO_SENSIBLE.test(commande)) {
      const id = "sudo-" + crypto.createHash("md5").update(ligne).digest("hex").slice(0, 12);
      emettreAlerte(creerAlerte(admin, "sudo_inhabituel", id));
    }
  }
}

// --- Règle 2 : audit.log ---
const cacheAudit = new Map();

// Programmes suspects sur /etc/shadow
const PROGRAMMES_SUSPECTS = ["cat","less","more","cp","strings","grep","python3","python","perl"];

function analyserLigneAudit(ligne) {
  if (!ligne.includes("fichier_secret") && !ligne.includes("shadow")) return;

  // Format Ubuntu 26.04 enrichi : SYSCALL + PATH peuvent être sur une seule ligne.
  if (ligne.includes("fichier_secret") && ligne.includes("shadow")) {
    const mAuid = ligne.match(/\bauid=(\d+)/);
    if (!mAuid) return;
    traiterAudit(mAuid[1], ligne);
    return;
  }

  // Format historique : événements SYSCALL puis PATH avec le même msg=audit(...).
  const mMsg = ligne.match(/msg=audit\(([^)]+)\)/);
  if (!mMsg) return;
  const msgId = mMsg[1];

  const mSys = ligne.match(/type=SYSCALL.*msg=audit\(([^)]+)\).*\bauid=(\d+).*comm="([^"]+)"/);
  if (mSys) {
    const [, id, auid, prog] = mSys;
    if (ligne.includes("fichier_secret") || ligne.includes("key=\"fichier_secret\"")) {
      cacheAudit.set(id, { auid, prog });
    }
    return;
  }

  const mPath = ligne.match(/type=PATH.*msg=audit\(([^)]+)\).*name="([^"]*shadow[^"]*)"/);
  if (!mPath) return;

  const [, id] = mPath;
  const entree = cacheAudit.get(id);
  if (!entree) return;

  const { auid, prog } = entree;
  if (!PROGRAMMES_SUSPECTS.includes(prog)) {
    cacheAudit.delete(id);
    return;
  }

  traiterAudit(auid, ligne, msgId);
  cacheAudit.delete(id);
}

function traiterAudit(auid, ligne, msgId) {
  if (auid === "4294967295" || auid === "0") return;

  let adminNom = null;
  try {
    for (const l of fs.readFileSync("/etc/passwd", "utf8").split("\n")) {
      const p = l.split(":");
      if (p[2] === auid) { adminNom = p[0]; break; }
    }
  } catch (_) {
    adminNom = null;
  }

  if (!adminNom || !ADMINS.includes(adminNom)) return;

  const mTime = ligne.match(/msg=audit\(([^)]+)\)/);
  const ts = mTime ? mTime[1].replace(":", "-") : (msgId || Date.now().toString());
  const id = `audit-${ts}`;

  emettreAlerte(creerAlerte(adminNom, "fichier_secret", id));
}

// --- Suivi continu d'un fichier ---
function suivreFichier(chemin, analyser) {
  if (!fs.existsSync(chemin)) {
    console.error(`[detection] introuvable : ${chemin}`); return;
  }
  let acces;
  try { acces = fs.openSync(chemin, "r"); }
  catch { console.error(`[detection] accès refusé (sudo requis) : ${chemin}`); return; }

  let position = UNE_FOIS ? 0 : fs.fstatSync(acces).size;
  let tampon   = "";

  function lire() {
    const taille = fs.fstatSync(acces).size;
    if (taille < position) position = 0;
    if (taille === position) return;
    const buf = Buffer.alloc(taille - position);
    fs.readSync(acces, buf, 0, buf.length, position);
    position = taille;
    tampon += buf.toString("utf8");
    const lignes = tampon.split("\n");
    tampon = lignes.pop();
    for (const l of lignes) if (l.trim()) analyser(l);
  }

  lire();
  if (!UNE_FOIS) setInterval(lire, 1000);
  else fs.closeSync(acces);
}

// --- Démarrage ---
function demarrer() {
  suivreFichier(FICHIER_AUTH,  analyserLigneAuth);
  suivreFichier(FICHIER_AUDIT, analyserLigneAudit);
}

if (require.main === module) {
  demarrer();
}

module.exports = { demarrer, analyserLigneAuth, analyserLigneAudit };