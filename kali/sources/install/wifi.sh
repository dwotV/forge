#!/bin/bash

source common.sh

colorecho "[*] Installing Wifi Tools"
sudo apt-get install -y --no-install-recommends \
    aircrack-ng \
    fern-wifi-cracker \
    kismet
