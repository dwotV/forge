#!/bin/bash
source common.sh

colorecho "[*] Installing Active Directory Tools"
sudo apt-get install -y --no-install-recommends \
    metasploit-framework

sudo apt-get install -y --no-install-recommends \
    responder \
    netexec \
    ghidra \
    smbmap \
    python3-impacket \
    evil-winrm \
    bloodhound.py \
    rlwrap \
    smbclient

go install -v github.com/ropnop/kerbrute@latest
cp $(go env GOPATH)/bin/kerbrute /usr/local/bin/
