# `anomalia login --email --password [--password-stdin]`

Oltre al flusso browser (che resta il default: unico che supporta provider SSO
e non mette la password negli argomenti di shell) il login accetta ora le
credenziali direttamente, per script e CI: due flag insieme o niente flag,
niente prompt interattivi da nascondere. `--password-stdin` legge la password
da standard input, fuori da shell history e `ps aux`. Stessa sessione su
`~/.config/anomalia/session.json`, stesso refresh silenzioso di sempre.
