#!/usr/bin/env zsh
# ─────────────────────────────────────────────
#  forge-welcome.sh
#  Welcome message — retro CRT-style terminal
#  Runs once when the shell opens (see .zshrc)
# ─────────────────────────────────────────────

# Colors (Forge palette: neon green on dark background)
G="\033[38;2;0;255;136m"      # Forge green
GD="\033[38;2;0;204;106m"     # dark green
DIM="\033[38;2;85;92;110m"    # dim gray
RST="\033[0m"
BOLD="\033[1m"

clear

echo -e "${G}${BOLD}"
cat << 'EOF'
  ███████╗░█████╗░██████╗░░██████╗░███████╗
  ██╔════╝██╔══██╗██╔══██╗██╔════╝░██╔════╝
  █████╗░░██║░░██║██████╔╝██║░░██╗░█████╗░░
  ██╔══╝░░██║░░██║██╔══██╗██║░░╚██╗██╔══╝░░
  ██║░░░░░╚█████╔╝██║░░██║╚██████╔╝███████╗
  ╚═╝░░░░░░╚════╝░╚═╝░░╚═╝░╚═════╝░╚══════╝
EOF
echo -e "${RST}"

echo -e "${DIM}  An environment forged for hacking         ${RST}"
echo -e "${DIM}  ──────────────────────────────────────────${RST}"
echo ""

# ── Quick system info ("status line" style) ──
USER_N="${USER:-hacker}"
HOST_N="$(hostname 2>/dev/null || echo kali)"
IP_ADDR="$(hostname -I 2>/dev/null | awk '{print $1}')"
DATE_N="$(date '+%Y-%m-%d %H:%M')"

echo -e "  ${G}❯${RST} user         ${GD}${USER_N}@${HOST_N}${RST}"
[[ -n "$IP_ADDR" ]] && echo -e "  ${G}❯${RST} ip           ${GD}${IP_ADDR}${RST}"
echo -e "  ${G}❯${RST} date         ${GD}${DATE_N}${RST}"
echo -e "  ${G}❯${RST} shell        ${GD}zsh${RST}"
echo ""

echo -e "  ${DIM}type${RST} ${G}help${RST}${DIM} to see available tools${RST}"
echo ""
