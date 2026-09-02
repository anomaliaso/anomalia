# Diciassette cifre di errore di arrotondamento, spacciate per un prezzo

Nel menu dei modelli si leggeva:

```
OpenAI: GPT-5.6 Luna   1050k · $0.19999999999999998/$1.2 per 1M
```

Il gateway pubblica il prezzo in dollari per TOKEN (`0.0000002`) e noi lo portiamo per milione con
una moltiplicazione. In binario quel prodotto non fa `0.2`, e il menu mostrava la coda intera.

`usdPerMillion` arrotonda dove il prezzo cambia davvero: tre decimali sotto il dollaro — un modello
economico costa `$0.075` e la terza cifra È il prezzo — due sopra, dove il millesimo è rumore. Zero
diventa `free`, non `$0.000`.

Trovato aprendo il menu nel browser, che è l'unico posto dove un prezzo si legge.
