#!/bin/bash

source common.sh

colorecho "[*] Installing Network Tools"
sudo apt-get install -y --no-install-recommends \
    nmap \
    zenmap \
    wireshark \
    ettercap-graphical \
    netcat-openbsd \
    tcpdump \
    masscan \
    arp-scan
