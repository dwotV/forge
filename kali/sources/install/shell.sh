#!/bin/bash

source common.sh

colorecho "Installing Shell Config Dependencies"

sudo apt-get install -y --no-install-recommends \
    fzf \
    eza \
    bat \
    zoxide

cp /root/sources/assets/forge-zshrc /usr/share/forge/forge-zshrc
cp /root/sources/assets/forge-welcome.sh /usr/share/forge/forge-welcome.sh
cp /root/sources/assets/forge-prompt.zsh /usr/share/forge/forge-prompt.zsh
cp /root/sources/assets/forge-help.zsh /usr/share/forge/forge-help.zsh
chmod +x /usr/share/forge/forge-welcome.sh
