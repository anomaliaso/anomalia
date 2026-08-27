# Immagine della sandbox con Chromium già dentro.
#
# Trascrive la sequenza che ha funzionato in produzione il 21/08 — non la indovina. In runtime
# quella sequenza costa 1-2 minuti al primo turno di ricerca di ogni brand; qui si paga una volta
# in CI, e `SANDBOX_IMAGE` la punta.
#
# Base: l'immagine managed di Vercel, non `ubuntu:24.04`. Sembra il contrario di quello che serve —
# la 26.04 è proprio la versione che Playwright non conosce — ma il motivo è che utente, sudo e
# layout del filesystem devono restare IDENTICI a quelli su cui gira oggi il codice. Il disallineo
# di piattaforma lo risolve già `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE`, che è provato; cambiare base
# significherebbe introdurre un'incognita nuova per togliere una risolta.
FROM vcr.vercel.com/vercel/sandbox/ubuntu:latest

# Percorso ASSOLUTO, non `~/.cache`: l'immagine è condivisa fra utenti e run, quindi i binari non
# possono stare nella home di chi ha fatto il build. Deve combaciare con SANDBOX_BROWSERS_PATH.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/anomalia/browsers
# La 26.04 non è fra le piattaforme note a Playwright 1.60 (20.04/22.04/24.04): i binari 24.04
# girano, il contrario no. Stessa variabile che il runtime usa oggi.
ENV PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64

ARG PLAYWRIGHT_VERSION=1.60.0

RUN set -eux; \
    mkdir -p /opt/anomalia; \
    cd /opt/anomalia; \
    npm install --no-audit --no-fund "playwright@${PLAYWRIGHT_VERSION}"; \
    ./node_modules/.bin/playwright install-deps chromium; \
    ./node_modules/.bin/playwright install chromium; \
    # La prova, dentro il build: un'immagine che esce 0 con una .so mancante è il guasto che
    # abbiamo inseguito per quattro run. Qui fallisce il build, non la run di un cliente.
    node -e "import('/opt/anomalia/node_modules/playwright/index.js').then(async ({chromium}) => { const b = await chromium.launch({args:['--no-sandbox']}); await b.close(); console.log('LAUNCH_OK'); })"; \
    chmod -R a+rX /opt/anomalia; \
    touch /opt/anomalia/browser-ready
