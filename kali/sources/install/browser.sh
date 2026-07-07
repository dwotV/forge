#! /bin/bash

source common.sh

colorecho "[*] Installing Firefox"
sudo apt-get install -y --no-install-recommends \
    firefox-esr

colorecho "[*] Configuring Firefox Extensions"
mkdir -p /usr/share/firefox-esr/distribution/extensions && \
    \
    # Wappalyzer
    WAPP_URL=$(curl -s "https://addons.mozilla.org/api/v5/addons/addon/wappalyzer/" \
      | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['current_version']['file']['url'])") && \
    curl -sL "$WAPP_URL" \
      -o "/usr/share/firefox-esr/distribution/extensions/wappalyzer@crunchlabz.com.xpi" && \
    \
    # FoxyProxy Standard
    FOXY_URL=$(curl -s "https://addons.mozilla.org/api/v5/addons/addon/foxyproxy-standard/" \
      | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['current_version']['file']['url'])") && \
    curl -sL "$FOXY_URL" \
      -o "/usr/share/firefox-esr/distribution/extensions/foxyproxy@eric.h.jung.xpi"
