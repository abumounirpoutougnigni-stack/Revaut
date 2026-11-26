const { ethers } = require("hardhat");

async function main() {
  const admin = process.env.ADMIN || "admin1";
  const { adresse } = require("../../config/contrat.json");
  const [proprietaire] = await ethers.getSigners();
  const registre = await ethers.getContractAt("RegistreAdmins", adresse, proprietaire);
  await (await registre.reintegrer(admin)).wait();
  const [statut, score] = await registre.lireAdmin(admin);
  console.log(`Admin ${admin} reintegre : statut ${statut}, score ${score}`);
}

main().catch(error => { console.error(error.message); process.exit(1); });
