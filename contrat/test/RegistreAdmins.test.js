const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RegistreAdmins", function () {
  let registre, proprietaire, connecteur, autre;

  beforeEach(async function () {
    [proprietaire, connecteur, autre] = await ethers.getSigners();
    const Registre = await ethers.getContractFactory("RegistreAdmins");
    registre = await Registre.deploy(connecteur.address);
    await registre.waitForDeployment();
    await registre.enregistrerAdmin("admin1");
  });

  it("un admin enregistre est actif avec un score de 0", async function () {
    const [statut, score] = await registre.lireAdmin("admin1");
    expect(statut).to.equal(1n);
    expect(score).to.equal(0n);
  });

  it("20 points ne revoquent pas", async function () {
    await registre.connect(connecteur).signalerAnomalie("admin1", 20, "a001");
    const [statut, score] = await registre.lireAdmin("admin1");
    expect(statut).to.equal(1n);
    expect(score).to.equal(20n);
  });

  it("50 points rendent l'admin restreint", async function () {
    await expect(registre.connect(connecteur).signalerAnomalie("admin1", 50, "a002"))
      .to.emit(registre, "AdminRestreint");
    const [statut] = await registre.lireAdmin("admin1");
    expect(statut).to.equal(2n);
  });

  it("120 points revoquent et emettent l'evenement", async function () {
    await expect(registre.connect(connecteur).signalerAnomalie("admin1", 120, "a003"))
      .to.emit(registre, "RevocationDeclenchee");
    const [statut, score] = await registre.lireAdmin("admin1");
    expect(statut).to.equal(3n);
    expect(score).to.equal(120n);
  });

  it("plusieurs petites alertes finissent par revoquer", async function () {
    await registre.connect(connecteur).signalerAnomalie("admin1", 40, "a004");
    await registre.connect(connecteur).signalerAnomalie("admin1", 40, "a005");
    await expect(registre.connect(connecteur).signalerAnomalie("admin1", 40, "a006"))
      .to.emit(registre, "RevocationDeclenchee");
  });

  it("un compte non autorise est refuse", async function () {
    await expect(
      registre.connect(autre).signalerAnomalie("admin1", 20, "a007")
    ).to.be.revertedWith("Reserve au connecteur");
  });

  it("une alerte en double est refusee", async function () {
    await registre.connect(connecteur).signalerAnomalie("admin1", 20, "a008");
    await expect(
      registre.connect(connecteur).signalerAnomalie("admin1", 20, "a008")
    ).to.be.revertedWith("Alerte deja traitee");
  });

  it("un admin inconnu est refuse", async function () {
    await expect(
      registre.connect(connecteur).signalerAnomalie("fantome", 20, "a009")
    ).to.be.revertedWith("Admin inconnu");
  });

  it("un admin deja revoque ne recoit plus d'alerte", async function () {
    await registre.connect(connecteur).signalerAnomalie("admin1", 100, "a010");
    await expect(
      registre.connect(connecteur).signalerAnomalie("admin1", 20, "a011")
    ).to.be.revertedWith("Admin deja revoque");
  });

  it("la reintegration remet le score a 0", async function () {
    await registre.connect(connecteur).signalerAnomalie("admin1", 100, "a012");
    await registre.reintegrer("admin1");
    const [statut, score] = await registre.lireAdmin("admin1");
    expect(statut).to.equal(1n);
    expect(score).to.equal(0n);
  });

  it("seul le proprietaire peut reintegrer", async function () {
    await expect(
      registre.connect(autre).reintegrer("admin1")
    ).to.be.revertedWith("Reserve au proprietaire");
  });
});