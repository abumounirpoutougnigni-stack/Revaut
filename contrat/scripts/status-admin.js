const { ethers } = require("hardhat");

async function main() {
  const admin = process.env.ADMIN || "admin1";
  const { adresse } = require("../../config/contrat.json");
  const [signer] = await ethers.getSigners();
  const registre = await ethers.getContractAt("RegistreAdmins", adresse, signer);
  const [statut, score] = await registre.lireAdmin(admin);
  const noms = ["Inconnu", "Actif", "Restreint", "Revoque"];
  console.log(`Admin: ${admin}`);
  console.log(`Statut: ${noms[Number(statut)]} (${statut})`);
  console.log(`Score: ${score}`);
}

main().catch(error => { console.error(error.message); process.exit(1); });
