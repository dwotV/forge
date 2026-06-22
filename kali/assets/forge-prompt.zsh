# ─────────────────────────────────────────────
#  forge-prompt.zsh
#  Minimal prompt for the Forge terminal
#  Add this to ~/.zshrc (after your other zsh config)
# ─────────────────────────────────────────────

autoload -Uz vcs_info
setopt PROMPT_SUBST

# Only check git status when needed (kept light, no slow calls)
zstyle ':vcs_info:git:*' formats ' (%b)'
zstyle ':vcs_info:*' enable git

precmd() {
    vcs_info
}

# Forge palette
local C_USER="%F{42}"     # neon green   — user@host
local C_PATH="%F{251}"    # light gray   — current path
local C_GIT="%F{42}"      # neon green   — git branch
local C_DIM="%F{240}"     # dim gray     — separators
local C_OK="%F{42}"       # green        — prompt char, success
local C_ERR="%F{203}"     # red          — prompt char, last command failed
local RST="%f"

# %(?..) → conditional based on exit code of last command
PROMPT='${C_USER}%n@%m${RST} ${C_PATH}%~${RST}${C_GIT}${vcs_info_msg_0_}${RST} %(?.'${C_OK}'.'${C_ERR}')❯${RST} '
