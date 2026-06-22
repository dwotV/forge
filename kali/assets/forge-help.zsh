# ─────────────────────────────────────────────
#  forge-help.zsh
#  `help` command — quick reference for the Forge environment
#  Add this to ~/.zshrc (after your other zsh config)
# ─────────────────────────────────────────────

help() {
    local G="\033[38;2;0;255;136m"
    local GD="\033[38;2;0;204;106m"
    local DIM="\033[38;2;85;92;110m"
    local TXT="\033[38;2;200;205;216m"
    local RST="\033[0m"
    local BOLD="\033[1m"

    echo ""
    echo -e "${G}${BOLD}forge${RST}${DIM} — quick reference${RST}"
    echo -e "${DIM}────────────────────────────────────────${RST}"
    echo ""

    echo -e "${GD}  GUI apps${RST}"
    echo -e "  ${DIM}launch from the side panel, or:${RST}"
    echo -e "  ${G}firefox${RST}     ${TXT}browser${RST}"
    echo -e "  ${G}burpsuite${RST}   ${TXT}web proxy / intercept${RST}"
    echo -e "  ${G}zaproxy${RST}     ${TXT}OWASP ZAP${RST}"
    echo -e "  ${G}wireshark${RST}   ${TXT}packet capture${RST}"
    echo -e "  ${G}zenmap${RST}      ${TXT}nmap GUI${RST}"
    echo -e "  ${G}xhydra${RST}      ${TXT}brute force GUI${RST}"
    echo ""

    echo -e "${GD}  recon & scanning${RST}"
    echo -e "  ${G}nmap${RST}        ${TXT}network/port scanning${RST}"
    echo -e "  ${G}masscan${RST}     ${TXT}fast port scanning${RST}"
    echo -e "  ${G}arp-scan${RST}    ${TXT}local network discovery${RST}"
    echo ""

    echo -e "${GD}  web hacking${RST}"
    echo -e "  ${G}sqlmap${RST}      ${TXT}SQL injection${RST}"
    echo -e "  ${G}nikto${RST}       ${TXT}web server scanner${RST}"
    echo -e "  ${G}gobuster${RST}    ${TXT}directory/DNS brute force${RST}"
    echo -e "  ${G}ffuf${RST}        ${TXT}web fuzzing${RST}"
    echo ""

    echo -e "${GD}  passwords${RST}"
    echo -e "  ${G}hydra${RST}       ${TXT}network login brute force${RST}"
    echo -e "  ${G}john${RST}        ${TXT}password cracking${RST}"
    echo -e "  ${G}hashcat${RST}     ${TXT}GPU password cracking${RST}"
    echo ""

    echo -e "${GD}  exploitation${RST}"
    echo -e "  ${G}msfconsole${RST}  ${TXT}Metasploit Framework${RST}"
    echo ""

    echo -e "${GD}  forensics${RST}"
    echo -e "  ${G}binwalk${RST}     ${TXT}firmware/file analysis${RST}"
    echo -e "  ${G}exiftool${RST}    ${TXT}metadata inspection${RST}"
    echo -e "  ${G}steghide${RST}    ${TXT}steganography${RST}"
    echo ""

    echo -e "${DIM}────────────────────────────────────────${RST}"
    echo -e "  ${DIM}tip:${RST} ${TXT}toggle [ DESKTOP VIEWER ] to see GUI apps${RST}"
    echo -e "  ${DIM}tip:${RST} ${TXT}run 'help' anytime to see this again${RST}"
    echo ""
}
