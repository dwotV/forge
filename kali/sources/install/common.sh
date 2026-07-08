#!/bin/bash

export RED='\033[1;31m'
export BLUE='\033[1;34m'
export GREEN='\033[1;32m'
export NOCOLOR='\033[0m'

### Echo functions

function colorecho () {
    echo -e "${BLUE}$*${NOCOLOR}"
}

function criticalecho () {
    echo -e "${RED}$*${NOCOLOR}" 2>&1
    exit 1
}

function criticalecho-noexit () {
    echo -e "${RED}$*${NOCOLOR}" 2>&1
}
