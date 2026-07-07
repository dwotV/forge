#!/bin/bash

source common.sh

colorecho "[*] Installing Forensic Tools"
sudo apt-get install -y --no-install-recommends \
    autopsy \
    binwalk \
    foremost \
    exiftool \
    steghide
