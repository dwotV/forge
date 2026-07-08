#!/bin/bash

source common.sh

colorecho "[*] Installing Dependencies"

apt-get install -y --no-install-recommends \
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
    unzip \
    openssh-server \
    python3 \
    python3-pip \
    python3-venv \
    xclip \
    golang

colorecho "[*] Setting Up Timezone"

echo "${LANG} UTF-8" > /etc/locale.gen && \
    locale-gen && \
    update-locale LANG=${LANG}

ln -snf /usr/share/zoneinfo/${TZ} /etc/localtime && echo ${TZ} > /etc/timezone

# Hack Nerd Fonts
mkdir -p /usr/local/share/fonts
wget https://github.com/ryanoasis/nerd-fonts/releases/download/v3.4.0/JetBrainsMono.zip
unzip JetBrainsMono.zip -d /usr/local/share/fonts
