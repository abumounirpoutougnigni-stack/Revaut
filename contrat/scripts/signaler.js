const { ethers } = require("hardhat");
const crypto = require("crypto");

async function main() {
  const admin  = process.env.ADMIN  || "admin1";
  const points = parseInt(process.env.POINTS || "20");
  const id     = process.env.ID     || ("manuel-" + crypto.randomBytes(4).toString("hex"));

  const [proprietaire, connecteur] = await ethers.getSigners();

  const { adresse, abi } = require("../../config/contrat.json");
  const registre = new ethers.Contract(adresse, abi, connecteur);

  const [statutAvant] = await registre.lireAdmin(admin);
  if (Number(statutAvant) === 0) {
    await (await registre.connect(proprietaire).enregistrerAdmin(admin)).wait();
    console.log(`Admin ${admin} enregistre automatiquement.`);
  }

  const tx = await registre.signalerAnomalie(admin, points, id);
  await tx.wait();

  const [statut, score] = await registre.lireAdmin(admin);
  const noms = ["Inconnu", "Actif", "Restreint", "Revoque"];
  console.log(`Alerte ${id} envoyee : ${admin} +${points} points -> score ${score}, statut ${noms[Number(statut)]}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });