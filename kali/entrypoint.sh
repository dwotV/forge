#!/bin/bash
# ─────────────────────────────────────────────
#  entrypoint.sh — Inicio del contenedor Kali
# ─────────────────────────────────────────────

set -e

echo "[*] Initializing container Kali-Forge"

# ── Config de Xfce: copiar plantilla al home ──
#    Incluye el wallpaper preconfigurado.
#    Solo se copia si el usuario no tiene config propia
#    (primera vez que arranca el contenedor).
XFCE_DIR="/home/${KALI_USER}/.config/xfce4/xfconf/xfce-perchannel-xml"
if [[ ! -f "${XFCE_DIR}/xfce4-desktop.xml" ]]; then
  echo "[*] Aplicando configuración de escritorio..."
  mkdir -p "$XFCE_DIR"
  cp /etc/forge/xfce4/xfconf/xfce-perchannel-xml/xfce4-desktop.xml "$XFCE_DIR/"
fi

# Tema oscuro — se sobreescribe siempre para garantizar que se aplica
# incluso si el volumen ya existía de un arranque anterior.
mkdir -p "$XFCE_DIR"
cp /etc/forge/xfce4/xfconf/xfce-perchannel-xml/xsettings.xml "$XFCE_DIR/"
cp /etc/forge/xfce4/xfconf/xfce-perchannel-xml/xfwm4.xml     "$XFCE_DIR/"
chown -R ${KALI_USER}:${KALI_USER} /home/${KALI_USER}/.config

# ── Autoconfigure Forge shell scripts ─────────
if ! grep -q "forge-welcome.sh" /home/${KALI_USER}/.zshrc 2>/dev/null; then
  echo '[[ -o interactive ]] && /usr/share/forge/forge-welcome.sh' >> /home/${KALI_USER}/.zshrc
fi

if ! grep -q "forge-prompt.zsh" /home/${KALI_USER}/.zshrc 2>/dev/null; then
  echo 'source /usr/share/forge/forge-prompt.zsh' >> /home/${KALI_USER}/.zshrc
fi

if ! grep -q "forge-help.zsh" /home/${KALI_USER}/.zshrc 2>/dev/null; then
  echo 'source /usr/share/forge/forge-help.zsh' >> /home/${KALI_USER}/.zshrc
fi

# ── Iniciar D-Bus (necesario para Xfce) ──────
mkdir -p /run/dbus
dbus-daemon --system --fork 2>/dev/null || true

# ── Limpiar locks de VNC anteriores ──────────
rm -f /tmp/.X1-lock /tmp/.X11-unix/X1 2>/dev/null || true

# ── Configurar VNC en tiempo de ejecución (evita problemas de volumen persistente) ──
mkdir -p /home/${KALI_USER}/.vnc /home/${KALI_USER}/.config/tigervnc
echo "${VNC_PASSWORD}" | vncpasswd -f > /home/${KALI_USER}/.vnc/passwd
if [ ! "/home/${KALI_USER}/.vnc/passwd" -ef "/home/${KALI_USER}/.config/tigervnc/passwd" ]; then
    cp /home/${KALI_USER}/.vnc/passwd /home/${KALI_USER}/.config/tigervnc/passwd
fi
chmod 600 /home/${KALI_USER}/.vnc/passwd /home/${KALI_USER}/.config/tigervnc/passwd

printf '#!/bin/sh\n\
unset SESSION_MANAGER\n\
unset DBUS_SESSION_BUS_ADDRESS\n\
exec dbus-run-session startxfce4\n' > /home/${KALI_USER}/.vnc/xstartup
if [ ! "/home/${KALI_USER}/.vnc/xstartup" -ef "/home/${KALI_USER}/.config/tigervnc/xstartup" ]; then
    cp /home/${KALI_USER}/.vnc/xstartup /home/${KALI_USER}/.config/tigervnc/xstartup
fi
chmod +x /home/${KALI_USER}/.vnc/xstartup /home/${KALI_USER}/.config/tigervnc/xstartup
chown -R ${KALI_USER}:${KALI_USER} /home/${KALI_USER}/.vnc /home/${KALI_USER}/.config

# SSH
touch /home/${KALI_USER}/.hushlogin
chown ${KALI_USER}:${KALI_USER} /home/${KALI_USER}/.hushlogin

mkdir -p /run/sshd
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config
grep -q '^PubkeyAuthentication' /etc/ssh/sshd_config \
  || echo 'PubkeyAuthentication yes' >> /etc/ssh/sshd_config
grep -q '^PermitRootLogin' /etc/ssh/sshd_config \
  || echo 'PermitRootLogin no' >> /etc/ssh/sshd_config
grep -q '^UsePAM' /etc/ssh/sshd_config \
  || echo 'UsePAM no' >> /etc/ssh/sshd_config

echo "[*] Arrancando SSH..."

/usr/sbin/sshd

# ── Iniciar servidor VNC como usuario hacker ─
echo "[*] Arrancando TigerVNC en :1 (puerto 5901)..."
su -c "HOME=/home/${KALI_USER} USER=${KALI_USER} vncserver :1 \
    -geometry ${VNC_RESOLUTION} \
    -depth ${VNC_DEPTH} \
    -localhost no \
    -rfbport ${VNC_PORT}" ${KALI_USER}

# Esperar a que el display esté listo
sleep 2

# ── Iniciar noVNC (proxy WebSocket → VNC) ────
echo "[*] Arrancando noVNC en puerto ${NOVNC_PORT}..."
/usr/share/novnc/utils/novnc_proxy \
    --vnc localhost:${VNC_PORT} \
    --listen ${NOVNC_PORT} \
    --web /usr/share/novnc &

echo "[+] Sistema listo:"
echo "    VNC directo → localhost:${VNC_PORT}"
echo "    Web (noVNC) → http://localhost:${NOVNC_PORT}/vnc.html"
echo ""
echo "[*] Usa los botones del panel web para lanzar apps."

# ── Mantener el contenedor vivo ───────────────
tail -f /dev/null
