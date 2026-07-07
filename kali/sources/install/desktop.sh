#!/bin/bash

source common.sh

colorecho "[*] Installing Xfce4"
# Xfce4 Desktop
sudo apt-get install -y --no-install-recommends \
    xfce4 \
    xfce4-terminal \
    xfce4-screenshooter \
    dbus-x11 \
    x11-utils \
    x11-xserver-utils \
    arc-theme \
    papirus-icon-theme

colorecho "[*] Installing VNC Server"
# VNC Server
sudo apt-get install -y --no-install-recommends \
    tigervnc-standalone-server \
    tigervnc-common \
    tigervnc-tools

colorecho "[*] Installing noVNC"
# noVNC
sudo apt-get install -y --no-install-recommends \
    novnc \
    websockify \

mkdir /usr/share/forge/
cp /root/sources/assets/forge-wallpaper.png /usr/share/forge/

mkdir -p /etc/forge/xfce4/xfconf/xfce-perchannel-xml

colorecho "[*] Configuring Desktop"
cat > /etc/forge/xfce4/xfconf/xfce-perchannel-xml/xfce4-desktop.xml << 'XFCONF'
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

cat > /etc/forge/xfce4/xfconf/xfce-perchannel-xml/xsettings.xml << 'XFCONF'
<?xml version="1.0" encoding="UTF-8"?>
<channel name="xsettings" version="1.0">
  <property name="Net" type="empty">
    <property name="ThemeName"     type="string" value="Arc-Dark"/>
    <property name="IconThemeName" type="string" value="Papirus-Dark"/>
  </property>
</channel>
XFCONF
 
# ── Config Xfce: tema de ventanas (xfwm4) ────
cat > /etc/forge/xfce4/xfconf/xfce-perchannel-xml/xfwm4.xml << 'XFCONF'
<?xml version="1.0" encoding="UTF-8"?>
<channel name="xfwm4" version="1.0">
  <property name="general" type="empty">
    <property name="theme" type="string" value="Arc-Dark"/>
  </property>
</channel>
XFCONF
