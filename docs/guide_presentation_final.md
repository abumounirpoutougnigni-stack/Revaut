# Guide ultime — Présentation du projet Revaut

## 1. Présentation en une minute

« Revaut est un système de surveillance et de révocation automatique des comptes administrateurs. Il surveille les journaux Linux SSH et sudo, transforme les activités suspectes en alertes JSON, cumule les points, verrouille automatiquement le compte concerné puis conserve une preuve locale et blockchain. »

Chaîne principale :

```text
Machine Linux
  -> detection.js lit auth.log
  -> alertes.jsonl contient les alertes
  -> agent.js cumule les points
  -> revoquer.sh verrouille le compte
  -> Hardhat/Smart contract conserve la preuve
  -> dashboard affiche l'état du système
```

Les rôles sont séparés :

- J2 détecte.
- J3 décide localement et agit sur Linux.
- J4 décide sur la blockchain que l'administration est révoquée.
- J5 présente les informations à l'écran.

## 2. Architecture à expliquer

### Composants

| Composant | Fichier | Rôle |
|---|---|---|
| Détection | `detection/detection.js` | Lit les journaux Linux |
| Alertes | `detection/alertes.jsonl` | Stocke les alertes JSON |
| Agent | `agent/agent.js` | Cumule les scores |
| Révocation Linux | `agent/revoquer.sh` | Coupe les sessions et verrouille le compte |
| Historique | `agent/revocations.jsonl` | Journal local des révocations |
| Smart contract | `contrat/contracts/RegistreAdmins.sol` | Score, statut et preuve blockchain |
| Connecteur | `contrat/scripts/signaler.js` | Appelle le contrat |
| Tableau | `dashboard/index.html` | Interface de surveillance |
| Serveur dashboard | `dashboard/server.js` | Lit les JSONL et sert l'interface |

### Différence entre les responsabilités

Le smart contract ne peut pas modifier directement Linux. Il peut :

- enregistrer les administrateurs ;
- accumuler les points ;
- changer leur statut ;
- produire un événement vérifiable.

Linux effectue réellement la révocation grâce à `revoquer.sh`.

L'agent fait le lien entre les deux mondes.

## 3. Barème

| Règle | Points |
|---|---:|
| Connexion SSH hors heures | 20 |
| Commande sudo sensible | 30 |
| Lecture de `/etc/shadow` | 50 |

### Seuils

| Score | Statut |
|---:|---|
| 50 | Administrateur restreint |
| 100 | Administrateur révoqué |

Dans les démonstrations, quatre commandes `sudo visudo` génèrent quatre alertes de 30 points. Le score atteint 120 points et dépasse donc le seuil.

## 4. Les trois règles de détection

### Heure inhabituelle

Une connexion SSH réussie est suspecte lorsque :

- le compte appartient à la liste des administrateurs surveillés ;
- la connexion est hors des heures configurées ;
- l'heure est généralement entre 03h00 et 08h00 ou après 18h00.

L'alerte contient :

```json
{
  "alerteId": "ssh-...",
  "admin": "admin1",
  "regle": "heure_inhabituelle",
  "points": 20,
  "heure": "2026-11-25T...Z"
}
```

### Sudo inhabituel

La règle surveille les commandes sensibles, notamment :

- `passwd`
- `visudo`
- `usermod`
- `useradd`
- `userdel`
- `groupadd`
- `sudoers`
- `sshd_config`
- `authorized_keys`

Une commande sensible effectuée par `admin1` produit une alerte de 30 points.

### Fichier secret

La détection surveille `/etc/shadow` via les événements auditd. Elle vérifie :

- l'existence de la clé `fichier_secret` ;
- l'accès à `shadow` ;
- l'UID authentifié ;
- la correspondance avec un administrateur surveillé ;
- le programme utilisé.

Une lecture avec `cat`, `less`, `cp`, `grep`, Python ou Perl peut produire une alerte de 50 points.

## 5. Format des fichiers

### Alerte

```json
{
  "alerteId": "sudo-...",
  "admin": "admin1",
  "regle": "sudo_inhabituel",
  "points": 30,
  "heure": "2026-11-25T10:00:00Z"
}
```

Chaque ligne correspond à une alerte indépendante. Le fichier est au format JSONL : une ligne JSON validée, suivie d'une fin de ligne.

### Révocation

```json
{
  "admin": "admin1",
  "totalPts": 120,
  "heure": "2026-11-25T10:05:00Z",
  "action": "revocation"
}
```

## 6. Préparation avant la démonstration

Lisez ces points 30 minutes avant la soutenance.

### Sur la VM

```bash
cd ~/Revaut
git pull
sudo passwd -u admin1
: > detection/alertes.jsonl
: > agent/revocations.jsonl
```

Cette préparation garantit :

- un compte administrateur déverrouillé ;
- des fichiers de test propres ;
- une démonstration sans anciens scores.

### Vérifier les ports

Le port SSH doit rester disponible :

```text
127.0.0.1:2222 -> invité:22
```

Le tableau peut utiliser :

```text
127.0.0.1:3000 -> invité:3000
```

La redirection du tableau ne bloque pas SSH.

## 7. Démonstration J1/Jalon 4

Ouvrez quatre terminaux VM.

### Terminal 1 : nœud blockchain

```bash
cd ~/Revaut/contrat
npx hardhat node
```

### Terminal 2 : déploiement

```bash
cd ~/Revaut/contrat
npx hardhat run scripts/deploy.js --network localhost
```

Conservez l'adresse affichée et vérifiez-la dans :

```bash
cat ~/Revaut/config/contrat.json
```

Cette adresse désigne le contrat déployé sur le nœud Hardhat.

### Terminal 3 : détection

```bash
cd ~/Revaut
sudo node detection/detection.js --admins admin1
```

### Terminal 4 : agent

```bash
cd ~/Revaut
sudo node agent/agent.js
```

## 8. Démonstration complète

Dans un cinquième terminal :

```bash
sudo visudo
sudo visudo
sudo visudo
sudo visudo
```

Pour chaque commande :

1. J2 lit la ligne sudo dans les journaux.
2. J2 produit une alerte de 30 points.
3. J2 l'ajoute à `detection/alertes.jsonl`.
4. J3 lit l'alerte toutes les deux secondes.
5. J3 cumule les alertes : 30, 60, 90, 120.
6. J3 dépasse le seuil de révocation.
7. J3 tue les sessions SSH actives.
8. J3 verrouille `admin1` avec `passwd -l`.
9. J3 écrit `agent/revocations.jsonl`.
10. J4 appelle le smart contract.
11. Le contrat atteint le statut `Revoque`.

## 9. Vérifications locales

### Compte Linux

```bash
sudo passwd -S admin1
```

Résultat attendu :

```text
admin1 L 2026-11-25 0 99999 7 -1
```

La lettre `L` signifie que le compte est verrouillé.

### Alertes

```bash
cat ~/Revaut/detection/alertes.jsonl
```

Les lignes contiennent les alertes avec leurs identifiants, administrateurs, règles et points.

### Révocations

```bash
cat ~/Revaut/agent/revocations.jsonl
```

Le fichier contient l'administrateur, le total de points, l'heure et l'action.

## 10. Vérification blockchain

Dans un terminal contrat :

```bash
cd ~/Revaut/contrat
npx hardhat console --network localhost
```

Dans la console :

```javascript
const c = await ethers.getContractAt(
  "RegistreAdmins",
  "ADRESSE_DANS_CONTRAT_JSON"
);

await c.lireAdmin("admin1");
```

Interprétation :

- `1` = Actif
- `2` = Restreint
- `3` = Révoque
- le deuxième nombre est le score

Résultat attendu :

```text
3n, 120n
```

## 11. Vérification blockchain avec JSON-RPC

Depuis la VM :

```bash
curl -X POST http://127.0.0.1:8545 \
  -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

Cette réponse confirme que le nœud Hardhat répond sur le port 8545.

## 12. Démonstration du dashboard

### Démarrer le serveur

Dans un terminal VM :

```bash
cd ~/Revaut
node dashboard/server.js
```

Adresse locale sur la VM :

```text
http://127.0.0.1:3000
```

Adresse depuis Windows avec redirection VirtualBox :

```text
http://127.0.0.1:3000
```

Attention : utilisez l'adresse hôte Windows, pas l'adresse affichée dans la VM.

### Contenu affiché

Le tableau de bord affiche :

- le nombre d'alertes ;
- le nombre total de points présents dans les alertes ;
- le nombre de révocations ;
- l'adresse du contrat ;
- les administrateurs surveillés ;
- les scores cumulés ;
- les dernières alertes ;
- l'historique des révocations.

Le tableau se rafraîchit toutes les trois secondes.

## 13. API du dashboard

Pour vérifier les données brutes :

```bash
curl http://127.0.0.1:3000/api/dashboard
```

L'API doit contenir :

- `actif`
- `alertes`
- `revocations`
- `administrateurs`
- `contrat`

## 14. Questions probables du jury

### Pourquoi ne pas retirer directement l'accès depuis le contrat ?

Parce qu'un contrat Solidity tourne uniquement dans la blockchain. Il ne peut pas accéder aux processus Linux ou modifier `/etc/passwd`.

L'agent est donc nécessaire. Il lit l'événement blockchain ou les alertes locales, puis agit sur la machine.

### Pourquoi utiliser un score cumulatif ?

Un seul petit comportement ne suffit pas forcément à couper définitivement l'accès. Le score permet de cumuler plusieurs anomalies et d'appliquer un seuil.

### Que se passe-t-il à 50 points ?

Le contrat passe l'administrateur en état `Restreint`. Il existe encore un seuil de 100 pour la révocation complète.

### Que se passe-t-il à 100 points ?

Le contrat passe l'administrateur en état `Revoque`. L'agent Linux tue les sessions actives et verrouille le compte.

### Pourquoi deux journaux sont-ils nécessaires ?

- `auth.log` repère les connexions SSH et les commandes sudo.
- `auditd/audit.log` repère les accès système aux fichiers sensibles.

### Que garantit la blockchain ?

Elle garde une trace immuable des anomalies et de la révocation. Elle n'enregistre pas les mots de passe ni les commandes complètes, mais les scores, les identifiants d'alerte et les événements.

### Pourquoi utiliser des fichiers JSONL ?

Ils permettent une communication simple entre les composants indépendants : une alerte par ligne, facile à lire, écrire, importer et partager.

### Qu'est-ce qui empêche une alerte d'être comptée deux fois ?

La détection utilise `alerteId` pour éviter les doublons en mémoire. Le contrat possède également une liste `alertesTraitees` afin d'empêcher le même identifiant d'être ajouté plusieurs fois.

### Que se passe-t-il si un processus redémarre ?

L'agent maintient uniquement son état actuel en mémoire. Pour une démonstration simple, il faut vérifier qu'une seule instance tourne à la fois. Une version de production devrait restaurer les scores depuis la blockchain ou un stockage persistant.

## 15. Scénario de présentation en 10 minutes

### Minute 0 à 2 : contexte

Présentez le problème : limiter les risques liés aux comptes administrateurs après un comportement suspect.

Montrez :

```text
Machine surveillée -> Détection -> Agent -> Blockchain -> Revocation
```

### Minute 2 à 4 : barème

Expliquez les trois règles :

- 20 points SSH hors heures ;
- 30 points sudo sensible ;
- 50 points lecture shadow.

Expliquez le seuil 100.

### Minute 4 à 6 : démonstration locale

Montrez :

1. J2 en fonctionnement.
2. Quatre alertes générées par `sudo visudo`.
3. Score passant de 30 à 120.
4. Session SSH coupée.
5. Compte verrouillé.

### Minute 6 à 8 : démonstration blockchain

Affichez :

- transaction envoyée ;
- événement `RevocationDeclenchee` ;
- lecture finale `3, 120`.

### Minute 8 à 10 : tableau de bord

Montrez :

- 4 ou plusieurs alertes ;
- 120 points ;
- 1 ou plusieurs révocations ;
- administrateur révoqué ;
- adresse du contrat.

## 16. Script oral court

« Nous avons séparé le projet en cinq couches. La détection surveille les journaux Linux et produit des alertes JSON. L'agent lit ces alertes, cumule les points et déclenche la révocation locale. Le script Bash ferme les processus SSH et verrouille le compte. Le smart contract reçoit ensuite une preuve de l'événement et donne à l'administrateur le statut révoqué. Enfin, le tableau de bord affiche les alertes, les scores et les révocations en temps réel. »

Puis :

« Ici, les quatre commandes sudo visudo produisent quatre alertes de 30 points. Le score passe à 120. Comme le seuil est 100, l'agent coupe les sessions, verrouille le compte et appelle le contrat. La lecture blockchain finale confirme le statut Revoque et un score de 120. »

## 17. Fin obligatoire de démonstration

Après la présentation, déverrouillez le compte :

```bash
sudo passwd -u admin1
sudo passwd -S admin1
```

La lettre `L` ne doit plus être présente.

Arrêtez les terminaux temporaires avec `Ctrl+C`, notamment :

- le dashboard ;
- J2 ;
- J3 ;
- Hardhat console.

Conservez seulement les fichiers nécessaires pour la soutenance.

## 18. Checklist finale

- [ ] VM démarrée et SSH disponible sur le port 2222.
- [ ] Redirection dashboard 3000 configurée.
- [ ] `admin1` déverrouillé avant la démonstration.
- [ ] Anciens fichiers JSONL nettoyés.
- [ ] Nœud Hardhat actif.
- [ ] Contrat déployé.
- [ ] `config/contrat.json` contient l'adresse correcte.
- [ ] Détection J2 lancée.
- [ ] Agent J3 lancé.
- [ ] Dashboard J5 lancé.
- [ ] Commandes `sudo visudo` prêtes.
- [ ] Compte bloqué vérifié.
- [ ] Score blockchain vérifié.
- [ ] Compte déverrouillé après démonstration.

## 19. Résumé à retenir

- J2 = observe.
- J3 = décide localement et agit.
- J4 = garde la preuve blockchain.
- J5 = montre l'état du système.
- Le seuil principal est 100 points.
- Le compte Linux est verrouillé après la révocation.
- La blockchain confirme le statut mais ne modifie pas directement Linux.
