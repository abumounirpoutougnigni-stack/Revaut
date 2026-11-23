// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Registre des administrateurs et révocation automatique
contract RegistreAdmins {
    enum Statut { Inconnu, Actif, Restreint, Revoque }

    struct Admin {
        Statut statut;
        uint256 score;
    }

    uint256 public constant SEUIL_RESTREINT = 50;
    uint256 public constant SEUIL_REVOCATION = 100;

    address public proprietaire;
    address public connecteur;

    mapping(string => Admin) private admins;
    mapping(string => bool) private alertesTraitees;

    event AdminEnregistre(string admin);
    event AnomalieSignalee(string admin, string alerteId, uint256 points, uint256 score);
    event AdminRestreint(string admin, uint256 score);
    event RevocationDeclenchee(string admin, uint256 score, uint256 date);
    event AdminReintegre(string admin);

    modifier seulProprietaire() {
        require(msg.sender == proprietaire, "Reserve au proprietaire");
        _;
    }

    modifier seulConnecteur() {
        require(msg.sender == connecteur, "Reserve au connecteur");
        _;
    }

    constructor(address _connecteur) {
        proprietaire = msg.sender;
        connecteur = _connecteur;
    }

    function enregistrerAdmin(string calldata admin) external seulProprietaire {
        require(admins[admin].statut == Statut.Inconnu, "Admin deja enregistre");
        admins[admin] = Admin(Statut.Actif, 0);
        emit AdminEnregistre(admin);
    }

    function signalerAnomalie(
        string calldata admin,
        uint256 points,
        string calldata alerteId
    ) external seulConnecteur {
        Admin storage a = admins[admin];
        require(a.statut != Statut.Inconnu, "Admin inconnu");
        require(a.statut != Statut.Revoque, "Admin deja revoque");
        require(!alertesTraitees[alerteId], "Alerte deja traitee");

        alertesTraitees[alerteId] = true;
        a.score += points;
        emit AnomalieSignalee(admin, alerteId, points, a.score);

        if (a.score >= SEUIL_REVOCATION) {
            a.statut = Statut.Revoque;
            emit RevocationDeclenchee(admin, a.score, block.timestamp);
        } else if (a.score >= SEUIL_RESTREINT && a.statut == Statut.Actif) {
            a.statut = Statut.Restreint;
            emit AdminRestreint(admin, a.score);
        }
    }

    function reintegrer(string calldata admin) external seulProprietaire {
        require(admins[admin].statut != Statut.Inconnu, "Admin inconnu");
        admins[admin] = Admin(Statut.Actif, 0);
        emit AdminReintegre(admin);
    }

    function lireAdmin(string calldata admin) external view returns (Statut, uint256) {
        Admin memory a = admins[admin];
        return (a.statut, a.score);
    }
}