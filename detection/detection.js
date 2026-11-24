// detection/detection.js
// Surveille auth.log et audit.log et crée des alertes JSON

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

// --- Options de la ligne de commande ---
function option(nom, defaut) {
  const i = process.argv.indexOf("--" + nom);
  return i !== -1 ? process.argv[i + 1] : defaut;
}

const FICHIER_AUTH  = option("auth",        "/var/log/auth.log");
const FICHIER_AUDIT = option("audit",       "/var/log/audit/audit.log");
const ADMINS        = (option("admins",     "admin1")).split(",");
const HEURE_DEBUT   = parseInt(option("heure-debut", "8"));
const HEURE_FIN     = parseInt(option("heure-fin",   "18"));
const FICHIER_SORTIE = option("sortie",     path.join(__dirname, "alertes.jsonl"));
const UNE_FOIS      = process.argv.includes("--une-fois");

console.log(`[detection] admins surveilles : ${ADMINS.join(", ")} | heures normales : ${HEURE_DEBUT}h-${HEURE_FIN}h`);

// --- Barème des points ---
const POINTS = {
  heure_inhabituelle: 20,
  sudo_inhabituel:    30,
  fichier_secret:     50,
};

// Commandes sudo considérées comme sensibles
const SUDO_SENSIBLE = /passwd|visudo|usermod|useradd|userdel|groupadd|sudoers|sshd_config|authorized_keys/i;

// Programmes qui, en lisant /etc/shadow, déclenchent une alerte
const PROGRAMMES_SUSPECTS = ["cat", "less", "more", "cp", "strings", "grep", "python3", "python", "perl"];

// Évite les doublons dans la même session
const alertesVues = new Set();

// --- Fabrique une alerte ---
function creerAlerte(admin, regle, alerteId, heure) {
  return {
    alerteId,
    admin,
    regle,
    points: POINTS[regle],
    heure: heure || new Date().toISOString(),
  };
}

// --- Enregistre et affiche une alerte ---
function emettreAlerte(alerte) {
  if (alertesVues.has(alerte.alerteId)) return;
  alertesVues.add(alerte.alerteId);
  const ligne = JSON.stringify(alerte);
  console.log(ligne);
  fs.appendFileSync(FICHIER_SORTIE, ligne + "\n");
}

// --- Analyse une ligne d'auth.log ---
function analyserLigneAuth(ligne) {
  // Règle 1 : connexion SSH réussie hors heures normales
  const mConnexion = ligne.match(/^(\S+T\d{2}:\d{2}:\d{2})[^\s]* \S+ sshd\[\d+\]: Accepted \S+ for (\S+) /);
  if (mConnexion) {
    const admin = mConnexion[2];
    if (ADMINS.includes(admin)) {
      const heure = new Date(mConnexion[1]);
      const h = heure.getHours();
      const hors = HEURE_DEBUT === 0 && HEURE_FIN === 0
        ? true
        : (h < HEURE_DEBUT || h >= HEURE_FIN);
      if (hors) {
        const id = "ssh-" + crypto.createHash("md5").update(ligne).digest("hex").slice(0, 12);
        emettreAlerte(creerAlerte(admin, "heure_inhabituelle", id, heure.toISOString()));
      }
    }
    return;
  }

  // Règle 3 : commande sudo sensible
  const mSudo = ligne.match(/sudo:\s+(\S+)\s+:.*COMMAND=(\S+)/);
  if (mSudo) {
    const admin   = mSudo[1];
    const commande = mSudo[2];
    if (ADMINS.includes(admin) && SUDO_SENSIBLE.test(commande)) {
      const id = "sudo-" + crypto.createHash("md5").update(ligne).digest("hex").slice(0, 12);
      emettreAlerte(creerAlerte(admin, "sudo_inhabituel", id));
    }
  }
}

// Cache pour reconstruire les événements audit multi-lignes
const cacheAudit = new Map();

// --- Analyse une ligne d'audit.log ---
function analyserLigneAudit(ligne) {
  // Règle 2 : lecture de /etc/shadow par un programme suspect
  if (!ligne.includes('key="fichier_secret"') && !ligne.includes("key=fichier_secret")) return;

  // Ligne SYSCALL : retient l'auid et le programme
  const mSyscall = ligne.match(/msg=audit\(([^)]+)\).*\bauid=(\d+).*\bcomm="([^"]+)"/);
  if (mSyscall) {
    const msgId  = mSyscall[1];
    const auid   = mSyscall[2];
    const prog   = mSyscall[3];
    if (auid === "4294967295" || auid === "0") return; // système, pas un humain
    cacheAudit.set(msgId, { auid, prog });
    return;
  }

  // Ligne PATH : confirme que c'est bien /etc/shadow
  const mPath = ligne.match(/msg=audit\(([^)]+)\).*name="([^"]+)"/);
  if (mPath) {
    const msgId = mPath[1];
    const nom   = mPath[2];
    if (!nom.includes("/etc/shadow")) return;
    const entree = cacheAudit.get(msgId);
    if (!entree) return;

    const { auid, prog } = entree;
    if (!PROGRAMMES_SUSPECTS.includes(prog)) return;

    // Cherche le nom d'utilisateur à partir de l'auid
    let adminNom = null;
    try {
      const shadow = fs.readFileSync("/etc/passwd", "utf8");
      for (const ligne of shadow.split("\n")) {
        const parts = ligne.split(":");
        if (parts[2] === auid) { adminNom = parts[0]; break; }
      }
    } catch (_) { adminNom = "uid" + auid; }

    if (!adminNom || !ADMINS.includes(adminNom)) return;

    // L'alerteId est basé sur le msgId (numéro d'événement audit) → stable
    const [sec, seq] = msgId.split(":");
    const id = `audit-${sec}-${seq}`;
    emettreAlerte(creerAlerte(adminNom, "fichier_secret", id));
    cacheAudit.delete(msgId);
  }
}

// --- Suit un fichier : lit les nouvelles lignes chaque seconde ---
function suivreFichier(chemin, analyser, label) {
  if (!fs.existsSync(chemin)) {
    console.error(`[detection] fichier introuvable : ${chemin}`);
    return;
  }

  let acces;
  try {
    acces = fs.openSync(chemin, "r");
  } catch (e) {
    console.error(`[detection] lecture impossible (essayez avec sudo) : ${chemin}`);
    return;
  }

  let position = UNE_FOIS ? 0 : fs.fstatSync(acces).size;
  let tampon = "";

  function lire() {
    const taille = fs.fstatSync(acces).size;
    if (taille < position) position = 0; // fichier rotaté
    if (taille === position) return;

    const buf = Buffer.alloc(taille - position);
    fs.readSync(acces, buf, 0, buf.length, position);
    position = taille;

    tampon += buf.toString("utf8");
    const lignes = tampon.split("\n");
    tampon = lignes.pop(); // dernière ligne peut être incomplète
    for (const l of lignes) {
      if (l.trim()) analyser(l);
    }
  }

  lire();
  if (!UNE_FOIS) setInterval(lire, 1000);
  else fs.closeSync(acces);
}

// --- Point d'entrée ---
function demarrer(surAlerte) {
  // On remplace emettreAlerte si un callback externe est fourni (jalon 4)
  if (surAlerte) {
    // surAlerte sera appelé avec l'objet alerte
    const original = emettreAlerte;
    // On ne peut pas réécrire emettreAlerte ici (const), on expose demarrer pour le jalon 4
  }
  suivreFichier(FICHIER_AUTH,  analyserLigneAuth,  "auth");
  suivreFichier(FICHIER_AUDIT, analyserLigneAudit, "audit");
}

// Si lancé directement (node detection.js ...)
if (require.main === module) {
  demarrer();
  if (!UNE_FOIS) {
    // Reste en vie
  }
}

module.exports = { demarrer, analyserLigneAuth, analyserLigneAudit };