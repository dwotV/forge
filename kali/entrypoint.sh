#!/bin/bash
# ─────────────────────────────────────────────
#  entrypoint.sh — Inicio del contenedor Kali
# ─────────────────────────────────────────────

set -e

echo "[*] Iniciando contenedor Kali — Panel de Hacking"

# ── Config de Xfce: copiar plantilla al home ──
#    Incluye el wallpaper preconfigurado.
#    Solo se copia si el usuario no tiene config propia
#    (primera vez que arranca el contenedor).
XFCE_DIR="/home/hacker/.config/xfce4/xfconf/xfce-perchannel-xml"
if [[ ! -f "${XFCE_DIR}/xfce4-desktop.xml" ]]; then
  echo "[*] Aplicando configuración de escritorio..."
  mkdir -p "$XFCE_DIR"
  cp /etc/forge/xfce4/xfconf/xfce-perchannel-xml/xfce4-desktop.xml "$XFCE_DIR/"
fi

# ── Iniciar D-Bus (necesario para Xfce) ──────
mkdir -p /run/dbus
dbus-daemon --system --fork 2>/dev/null || true

# ── Limpiar locks de VNC anteriores ──────────
rm -f /tmp/.X1-lock /tmp/.X11-unix/X1 2>/dev/null || true

# ── Configurar VNC en tiempo de ejecución (evita problemas de volumen persistente) ──
mkdir -p /home/hacker/.vnc /home/hacker/.config/tigervnc
echo "${VNC_PASSWORD:-kalipass}" | vncpasswd -f > /home/hacker/.vnc/passwd
if [ ! "/home/hacker/.vnc/passwd" -ef "/home/hacker/.config/tigervnc/passwd" ]; then
    cp /home/hacker/.vnc/passwd /home/hacker/.config/tigervnc/passwd
fi
chmod 600 /home/hacker/.vnc/passwd /home/hacker/.config/tigervnc/passwd

printf '#!/bin/sh\n\
unset SESSION_MANAGER\n\
unset DBUS_SESSION_BUS_ADDRESS\n\
exec dbus-run-session startxfce4\n' > /home/hacker/.vnc/xstartup
if [ ! "/home/hacker/.vnc/xstartup" -ef "/home/hacker/.config/tigervnc/xstartup" ]; then
    cp /home/hacker/.vnc/xstartup /home/hacker/.config/tigervnc/xstartup
fi
chmod +x /home/hacker/.vnc/xstartup /home/hacker/.config/tigervnc/xstartup
chown -R hacker:hacker /home/hacker/.vnc /home/hacker/.config

# ── Iniciar servidor VNC como usuario hacker ─
echo "[*] Arrancando TigerVNC en :1 (puerto 5901)..."
su -c "HOME=/home/hacker USER=hacker vncserver :1 \
    -geometry ${VNC_RESOLUTION} \
    -depth ${VNC_DEPTH} \
    -localhost no \
    -rfbport ${VNC_PORT}" hacker

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
