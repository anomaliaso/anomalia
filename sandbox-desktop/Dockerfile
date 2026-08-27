# L'IMMAGINE DEL COMPUTER DELL'AGENTE — un desktop Ubuntu vero, già cotto.
#
# Installare XFCE a runtime costava 209s di apt su una VM fredda (misurato il 26/8), più 68s di
# `apt-get update`: da solo sfondava il lease con cui la lane del computer apre la macchina. Qui
# è tutto dentro l'immagine, quindi la prima apertura è un boot, non un'installazione.
#
# Base: Ubuntu 24.04, non l'immagine ufficiale della sandbox — quella NON è scaricabile dal
# registry dei clienti (404 su `vcr.vercel.com/vercel/sandbox/ubuntu`). Quindi ciò che la
# piattaforma si aspetta va ricostruito qui sotto: utente `ubuntu` con home in `/vercel`, sudo
# senza password (i comandi con `sudo: true`) e node.
#
# 24.04 e non 26.04 di proposito: è una delle Ubuntu per cui Playwright pubblica i binari
# (PLAYWRIGHT_KNOWN_UBUNTU), quindi qui l'override di piattaforma non serve più.
FROM docker.io/library/ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# Le sorgenti restano su HTTP: qui il build gira con la rete aperta, e `ubuntu:24.04` non ha
# ancora `ca-certificates` — forzare HTTPS faceva fallire `apt-get update` in silenzio, lasciando
# liste vuote e un «Unable to locate package» per ogni pacchetto. La riscrittura su HTTPS serve a
# RUNTIME sulle lane chiuse (graphical-bootstrap.ts), non qui.

# 1. Il desktop: window manager, pannello, scrivania, file manager, terminale.
# 2. Il ponte verso il browser: Xvfb (schermo senza schermo), x11vnc, websockify + noVNC.
# 3. Gli occhi e le mani dell'agente: xdotool (observe/act) e ImageMagick (screenshot).
# 4. Le librerie di sistema di Chromium: senza, Remotion e Playwright muoiono all'avvio con
#    `libnspr4.so: cannot open shared object file`.
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
      xfce4 xfce4-panel xfce4-session xfdesktop4 xfwm4 xfce4-settings \
      xfce4-terminal thunar mousepad \
      dbus-x11 xvfb x11vnc novnc websockify \
      xdotool imagemagick x11-utils xterm xclip \
      fonts-dejavu-core dbus \
      libnspr4 libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
      libpango-1.0-0 libcairo2 libasound2t64 libatspi2.0-0t64 \
    && rm -rf /var/lib/apt/lists/*

# L'ASPETTO. XFCE nudo è quello del 2010: cornici squadrate, icone anni Duemila, font Sans.
# Yaru è il tema DI UBUNTU (stesso pacchetto della 24.04 desktop), quindi il risultato somiglia
# all'Ubuntu che la gente conosce invece che a uno XFCE del decennio scorso.
#
# Niente plank: il secondo pannello di XFCE fa già da dock in basso, e due dock sono confusione,
# non modernità.
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
      yaru-theme-gtk yaru-theme-icon papirus-icon-theme fonts-ubuntu \
    && rm -rf /var/lib/apt/lists/*

# xfdesktop cerca lo sfondo di Xubuntu, che in questa immagine non c'è, e senza uno sfondo valido
# la scrivania resta nera. Uno sfondo generato qui evita un pacchetto di wallpaper da 40 MB.
RUN mkdir -p /usr/share/backgrounds \
    && convert -size 1920x1080 gradient:'#2c001e-#77216f' /usr/share/backgrounds/anomalia.png

# I default del desktop, scritti come xfconf li legge al primo avvio: tema scuro Yaru, icone
# Yaru, font Ubuntu, pannello sottile in alto, niente decorazioni squadrate.
COPY xfconf /vercel/.config/xfce4/xfconf/xfce-perchannel-xml
RUN chown -R 1000:1000 /vercel/.config 2>/dev/null || true

# Quello che la sandbox dà per scontato e una `ubuntu:24.04` nuda non ha.
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
      sudo curl ca-certificates git openssh-client procps psmisc unzip \
    && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y -qq nodejs \
    && rm -rf /var/lib/apt/lists/*

# `ubuntu` con home in `/vercel`: è l'utente e il percorso su cui il resto del codice conta —
# `BROWSERS_PATH`, il progetto di render, il profilo Chrome persistente.
RUN (id ubuntu >/dev/null 2>&1 || useradd -m -u 1000 -s /bin/bash ubuntu) \
    && mkdir -p /vercel \
    && usermod -d /vercel ubuntu \
    && chown -R ubuntu:ubuntu /vercel \
    && echo 'ubuntu ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/ubuntu \
    && chmod 0440 /etc/sudoers.d/ubuntu

# IL BROWSER, nel posto dove il codice lo cerca già.
#
# Non `chromium` di Ubuntu: è uno stub snap e dentro un container non parte. Non Chrome di Google:
# sarebbe un secondo browser accanto a quello che l'agente usa. Questo è LO STESSO binario di
# Playwright che `observe`/`act` avviano (FIND_CHROME cerca sotto questi percorsi), scaricato una
# volta qui invece che a ogni VM fredda.
# FUORI dall'immagine, per forza. L'immagine deve stare in UNO strato — a strati la sandbox non
# parte (410 interno appena nata, misurato) — e un blob unico oltre il mezzo giga il registry lo
# rifiuta con 413. Chromium ci fa sfondare il tetto, quindi lo scarica `ensureChromium` al primo
# avvio (~60s) e da lì in poi vive nello snapshot della VM.
#
# Il percorso resta questo, che è dove `observe`/`act` lo cercano: chi lo scarica lo trova già
# apparecchiato. `WITH_CHROMIUM=1` serve solo per provare un'immagine grassa a mano.
ARG WITH_CHROMIUM=0
ENV PLAYWRIGHT_BROWSERS_PATH=/vercel/.anomalia-desktop/browsers
RUN mkdir -p "$PLAYWRIGHT_BROWSERS_PATH" \
    && if [ "$WITH_CHROMIUM" = "1" ]; then npx --yes playwright@1.60.0 install chromium-headless-shell; fi \
    && chown -R 1000:1000 /vercel/.anomalia-desktop
RUN if [ "$WITH_CHROMIUM" = "1" ]; then npx --yes playwright@1.60.0 install chromium; fi \
    && chown -R 1000:1000 /vercel/.anomalia-desktop

# Perché compaia nel menu Applicazioni e nel dock come un'app qualunque, invece di essere un
# binario che solo l'agente sa dove trovare.
RUN printf '%s\n' \
      '[Desktop Entry]' \
      'Type=Application' \
      'Name=Chromium' \
      'Comment=Il browser che usa anche l'"'"'agente' \
      'Exec=sh -c "$(find /vercel/.anomalia-desktop/browsers -name chrome -type f -perm -u+x | head -1)" --no-sandbox --disable-dev-shm-usage --user-data-dir=/vercel/.anomalia-desktop/chrome-profile %U' \
      'Icon=web-browser' \
      'Categories=Network;WebBrowser;' \
      'Terminal=false' \
    > /usr/share/applications/chromium-anomalia.desktop

COPY anomalia-desktop /usr/local/bin/anomalia-desktop
RUN chmod +x /usr/local/bin/anomalia-desktop

# `chrome` nel PATH: il binario di Playwright vive sotto `browsers/chromium-<build>/chrome-linux64`
# e chi lavora da shell guarda `$PATH`. Senza questo, un agente conclude che il browser non è
# installato — e propone di scaricarne un altro. Lo script risolve il percorso al momento, perché
# il numero di build cambia a ogni aggiornamento di Playwright.
RUN printf '%s\n' '#!/bin/sh' \
      'CHROME=$(find /vercel/.anomalia-desktop/browsers /vercel/.anomalia/browsers -name chrome -type f -perm -u+x 2>/dev/null | head -1)' \
      '[ -z "$CHROME" ] && { echo "chrome non ancora scaricato su questa VM" >&2; exit 127; }' \
      'exec "$CHROME" "$@"' \
    > /usr/local/bin/chrome && chmod +x /usr/local/bin/chrome

USER ubuntu
WORKDIR /vercel
