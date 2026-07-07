#!/bin/bash

source common.sh

colorecho "[*] Installing Web Tools"
apt-get install -y --no-install-recommends \
    burpsuite \
    zaproxy \
    sqlmap \
    nikto \
    dirb \
    gobuster \
    ffuf \
    wfuzz \
    whatweb \
    wpscan
