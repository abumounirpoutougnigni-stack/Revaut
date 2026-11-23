const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [proprietaire, connecteur] = await ethers.getSigners();

  const Registre = await ethers.getContractFactory("RegistreAdmins");
  const registre = await Registre.deploy(connecteur.address);
  await registre.waitForDeployment();

  const adresse = await registre.getAddress();
  console.log("Contrat deploye a l'adresse :", adresse);

  await registre.enregistrerAdmin("admin1");
  console.log("admin1 enregistre.");

  const config = {
    adresse,
    abi: JSON.parse(registre.interface.formatJson())
  };

  const configDir = path.join(__dirname, "../../config");
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

  fs.writeFileSync(
    path.join(configDir, "contrat.json"),
    JSON.stringify(config, null, 2)
  );
  console.log("Config ecrite dans config/contrat.json");
}

main().catch((e) => { console.error(e); process.exit(1); });