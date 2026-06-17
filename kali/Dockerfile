# ─────────────────────────────────────────────
#  Kali Linux — Panel de Hacking con GUI Web
#  Imagen base: kalilinux/kali-rolling
# ─────────────────────────────────────────────

FROM kalilinux/kali-rolling

# ── Variables de entorno ──────────────────────
ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:1 \
    VNC_PORT=5901 \
    NOVNC_PORT=6080 \
    VNC_RESOLUTION=1280x800 \
    VNC_DEPTH=24 \
    VNC_PASSWORD=kalipass \
    LANG=es_MX.UTF-8 \
    TZ=America/Mexico_City

# ── Actualizar sistema base ───────────────────
RUN apt-get update && apt-get upgrade -y

# ── Desktop ligero: Xfce ─────────────────────
RUN apt-get install -y --no-install-recommends \
    xfce4 \
    xfce4-terminal \
    xfce4-screenshooter \
    dbus-x11 \
    x11-utils \
    x11-xserver-utils

# ── Servidor VNC: TigerVNC ────────────────────
RUN apt-get install -y --no-install-recommends \
    tigervnc-standalone-server \
    tigervnc-common \
    tigervnc-tools

# ── noVNC: acceso al VNC desde el navegador ──
RUN apt-get install -y --no-install-recommends \
    novnc \
    websockify \
    python3 \
    python3-pip

# ── Shell y utilidades base ───────────────────
RUN apt-get install -y --no-install-recommends \
    zsh \
    curl \
    wget \
    git \
    vim \
    nano \
    procps \
    net-tools \
    iputils-ping \
    dnsutils \
    locales \
    tzdata \
    sudo \
    tmux \
    openvpn \
    unzip

# SSH
RUN apt-get install -y \
    openssh-server

# ── Herramientas de red y escaneo ─────────────
RUN apt-get install -y --no-install-recommends \
    nmap \
    zenmap \
    wireshark \
    ettercap-graphical \
    netcat-openbsd \
    tcpdump \
    masscan \
    arp-scan

# ── Web hacking ───────────────────────────────
RUN apt-get install -y --no-install-recommends \
    burpsuite \
    zaproxy \
    sqlmap \
    nikto \
    dirb \
    gobuster \
    ffuf \
    wfuzz \
    whatweb

# ── Navegador Firefox ─────────────────────────
RUN apt-get install -y --no-install-recommends \
    firefox-esr

# ── Passwords y fuerza bruta ──────────────────
RUN apt-get install -y --no-install-recommends \
    hydra \
    hydra-gtk \
    john \
    johnny \
    hashcat \
    crunch \
    wordlists \
    seclists

# ── Forense ───────────────────────────────────
RUN apt-get install -y --no-install-recommends \
    autopsy \
    binwalk \
    foremost \
    exiftool \
    steghide

# ── Wireless ─────────────────────────────────
RUN apt-get install -y --no-install-recommends \
    aircrack-ng \
    fern-wifi-cracker \
    kismet

# ── Metasploit Framework ──────────────────────
RUN apt-get install -y --no-install-recommends \
    metasploit-framework

# ── Windows ───────────────────────────────────
RUN apt-get install -y --no-install-recommends \
    responder \
    netexec

# ── Limpiar caché para reducir tamaño ────────
RUN apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# ── Configurar locale ─────────────────────────
RUN echo "es_MX.UTF-8 UTF-8" > /etc/locale.gen && \
    locale-gen && \
    update-locale LANG=es_MX.UTF-8

# ── Configurar zona horaria ───────────────────
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# ── Copiar wallpaper a la imagen ──────────────
#    Se copia en /usr/share/forge/ para que esté
#    disponible para cualquier usuario que se cree.
COPY assets/forge-wallpaper.png /usr/share/forge/forge-wallpaper.png

# ── Crear usuario dinámico en tiempo de build──
#    El usuario real se crea en entrypoint.sh
#    con las variables FORGE_USER/FORGE_PASSWORD.
#    Aquí solo preparamos la estructura de Xfce
#    que se copiará al home del usuario real.
RUN mkdir -p /etc/forge/xfce4/xfconf/xfce-perchannel-xml
 
# ── Config Xfce: wallpaper ────────────────────
#    xfdesktop lee este XML para saber qué fondo usar.
RUN cat > /etc/forge/xfce4/xfconf/xfce-perchannel-xml/xfce4-desktop.xml << 'XFCONF'
<?xml version="1.0" encoding="UTF-8"?>
<channel name="xfce4-desktop" version="1.0">
  <property name="backdrop" type="empty">
    <property name="screen0" type="empty">
      <property name="monitorVNC-0" type="empty">
        <property name="workspace0" type="empty">
          <property name="color-style" type="int" value="0"/>
          <property name="image-style" type="int" value="5"/>
          <property name="last-image" type="string" value="/usr/share/forge/forge-wallpaper.png"/>
        </property>
      </property>
      <property name="monitor0" type="empty">
        <property name="workspace0" type="empty">
          <property name="color-style" type="int" value="0"/>
          <property name="image-style" type="int" value="5"/>
          <property name="last-image" type="string" value="/usr/share/forge/forge-wallpaper.png"/>
        </property>
      </property>
    </property>
  </property>
</channel>
XFCONF
 
# ── Crear usuario no-root: hacker ─────────────
#    (Wireshark y otros piden no correr como root)
RUN groupadd -f wireshark && \
    useradd -m -s /bin/zsh -G sudo,wireshark hacker && \
    echo "hacker:hacker" | chpasswd && \
    echo "hacker ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# ── Configurar VNC para el usuario hacker ────
USER hacker
WORKDIR /home/hacker

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
