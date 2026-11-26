#!/bin/bash
set -euo pipefail

OWNER="${SUDO_USER:-$(logname 2>/dev/null || echo "$USER")}"

cat > /etc/sudoers.d/revaut-demo <<EOF
$OWNER ALL=(ALL) NOPASSWD: ALL
EOF
chmod 0440 /etc/sudoers.d/revaut-demo
visudo -c >/dev/null

mkdir -p /home/"$OWNER"/Revaut/dashboard
chown -R "$OWNER":"$OWNER" /home/"$OWNER"/Revaut/dashboard

echo "Configuration Revaut prête pour $OWNER"
