#!/usr/bin/env bash
# Costruisce e pubblica l'immagine della sandbox con Chromium preinstallato.
#
# Serve una macchina con Docker e la CLI di Vercel. VCR serve l'immagine alle sandbox solo dopo
# aver preparato una build linux/amd64: se lo stato resta `Unoptimized`, hai costruito su arm64.
set -euo pipefail

REPO="${1:-anomalia-sandbox}"
TAG="${2:-latest}"

vercel vcr login docker
vercel vcr build docker "$(dirname "$0")/../docker/sandbox" "${REPO}:${TAG}" --push --platform linux/amd64

cat <<MSG

Fatto. Ora, nelle variabili d'ambiente del progetto:

  SANDBOX_IMAGE=${REPO}:${TAG}
  SANDBOX_BROWSERS_PATH=/opt/anomalia/browsers

e alza SANDBOX_GENERATION, altrimenti i brand che hanno già una sandbox continuano a riprendere
quella vecchia (getOrCreate risolve per nome).

Aspetta che la repo risulti "Ready" nel dashboard prima del primo turno.
MSG
