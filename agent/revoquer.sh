#!/bin/bash
# revoquer.sh <admin>
# Révoque les accès d'un administrateur :
#   1. Tue toutes ses sessions SSH actives
#   2. Verrouille le compte Linux (passwd -l)
# Usage : sudo bash revoquer.sh admin1

set -euo pipefail
ADMIN="${1:?Usage: $0 <nom_admin>}"
LOG="$(dirname "$0")/revocations.jsonl"

echo "[revoquer] Révocation de : $ADMIN"

# 1. Tuer les processus SSH de l'utilisateur
PIDS=$(pgrep -u "$ADMIN" sshd 2>/dev/null || true)
if [ -n "$PIDS" ]; then
  echo "[revoquer] Sessions SSH actives : $PIDS"
  kill -9 $PIDS 2>/dev/null || true
  echo "[revoquer] Sessions coupées."
else
  echo "[revoquer] Aucune session SSH active."
fi

# 2. Tuer toutes les autres sessions (screen, tmux…)
pkill -u "$ADMIN" 2>/dev/null || true

# 3. Verrouiller le compte (bloque les futures connexions)
passwd -l "$ADMIN" 2>/dev/null && echo "[revoquer] Compte verrouillé." \
  || echo "[revoquer] AVERTISSEMENT : verrouillage échoué (droits insuffisants?)"

# 4. Écrire dans le journal
ENTREE="{\"admin\":\"$ADMIN\",\"action\":\"revocation\",\"heure\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
echo "$ENTREE" | tee -a "$LOG"

echo "[revoquer] Terminé."