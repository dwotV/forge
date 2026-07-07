#!/bin/bash
set -e

apt-get update && apt-get upgrade -y

source base.sh
source browser.sh
source desktop.sh
source web_tools.sh
source network.sh
source cracking.sh
source forensic.sh
source wifi.sh
source active_directory.sh
source shell.sh

curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.5/install.sh | bash
\. "$HOME/.nvm/nvm.sh"
nvm install 24

apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*
