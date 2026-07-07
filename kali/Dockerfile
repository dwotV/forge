# ─────────────────────────────────────────────
#  Kali Linux — Panel de Hacking con GUI Web
#  Imagen base: kalilinux/kali-rolling
# ─────────────────────────────────────────────

FROM kalilinux/kali-rolling

# ── Variables de entorno ──────────────────────

ARG KALI_USER
ARG KALI_PASSWORD
ARG LANG
ARG TZ

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:1 \
    VNC_PORT=5901 \
    NOVNC_PORT=6080 \
    VNC_RESOLUTION=1280x800 \
    VNC_DEPTH=24 \
    VNC_PASSWORD=${KALI_PASSWORD} \
    KALI_USER=${KALI_USER} \
    LANG=${LANG} \
    TZ=${TZ}

COPY sources /root/sources/
WORKDIR /root/sources/install
RUN chmod +x setup.sh
RUN ./setup.sh

# ZSH config
#COPY sources/assets/forge-zshrc           /usr/share/forge/forge-zshrc
#COPY sources/assets/forge-welcome.sh      /usr/share/forge/forge-welcome.sh
#COPY sources/assets/forge-prompt.zsh      /usr/share/forge/forge-prompt.zsh
#COPY sources/assets/forge-help.zsh        /usr/share/forge/forge-help.zsh
#RUN chmod +x /usr/share/forge/forge-welcome.sh
 
# ── Crear usuario no-root: hacker ─────────────
#    (Wireshark y otros piden no correr como root)
RUN groupadd -f wireshark && \
    useradd -m -s /bin/zsh -G sudo,wireshark "${KALI_USER}" && \
    echo "${KALI_USER}:${KALI_USER}" | chpasswd && \
    echo "${KALI_USER} ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# ── Configurar VNC para el usuario hacker ────
USER ${KALI_USER}
WORKDIR /home/${KALI_USER}

RUN mkdir -p ~/.vnc && \
    echo "$VNC_PASSWORD" | vncpasswd -f > ~/.vnc/passwd && \
    chmod 600 ~/.vnc/passwd

# Archivo de inicio del servidor VNC
RUN mkdir -p ~/.config/xfce4 ~/.vnc ~/.config/tigervnc && \
    printf '#!/bin/sh\n\
unset SESSION_MANAGER\n\
unset DBUS_SESSION_BUS_ADDRESS\n\
exec dbus-run-session startxfce4\n' > ~/.vnc/xstartup && \
    cp ~/.vnc/xstartup ~/.config/tigervnc/xstartup && \
    chmod +x ~/.vnc/xstartup ~/.config/tigervnc/xstartup

# ── Volver a root para el entrypoint ─────────
USER root

# ── Copiar script de inicio ───────────────────
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# ── Puertos expuestos ─────────────────────────
#   5901 → VNC directo
#   6080 → noVNC (acceso web)
EXPOSE 5901 6080

# ── Punto de entrada ──────────────────────────
ENTRYPOINT ["/entrypoint.sh"]
