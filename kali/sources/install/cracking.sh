#!/bin/bash

source common.sh

colorecho "Installing Cracking Tools"
sudo apt-get install -y --no-install-recommends \
    hydra \
    hydra-gtk \
    john \
    johnny \
    hashcat \
    crunch \
    wordlists \
    seclists \
    name-that-hash
