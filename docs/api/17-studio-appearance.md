# 17 — Studio: il look del brand

`GET`/`PUT` `/api/v1/brands/:slug/studio/appearance` — logo, favicon, palette, i due font con cui
le grafiche sono composte, e il brief visivo che ogni render segue. Tutto vive in `brand_kit`.

Tool MCP: `set_appearance` (la lettura è `query` su `brand_kit`). Nessun modello, nessun credito.

## `GET`

```json
{
  "brand": "demo",
  "appearance": {
    "logo_url": "https://…/media/<user>/studio/logo-<uuid>.png",
    "favicon_url": null,
    "colors": ["#7c5cff", "#ffffff"],
    "graphic_style": { "display_font": "Playfair Display", "body_font": "Inter", "instructions": "" },
    "visual_style": "Fotografia naturale, luce morbida…",
    "visual_style_locked": true
  }
}
```

`logo_url` e' una URL sola, non l'array grezzo: una voce `type: 'og-image'` e' il logo che abbiamo
indovinato dal sito, non quello che il brand ha scelto, e non conta.

## `PUT`

Cambia solo i campi inviati.

| campo | nota |
|---|---|
| `logo_url` | **scaricata e ri-ospitata**, non collegata. Max 4MB, dietro `safeFetchBytes` |
| `favicon_url` | stesse regole |
| `remove_logo` | azzera il logo. Non combinabile con `logo_url` |
| `display_font` + `body_font` | vanno insieme; verificati contro Google Fonts prima di salvare |
| `graphic_instructions` | art direction, 1200 caratteri |
| `visual_style` | 20–2000 caratteri. **Lo BLOCCA** (`visual_style_locked = true`) |

### Perche' il logo si scarica invece di salvarne l'indirizzo

Salvare la stringa significherebbe mettere in ogni grafica del brand un'immagine che qualcun altro
puo' cambiare — o togliere — dopo che e' stata approvata. La risposta riporta l'indirizzo **nostro**,
che e' quello che i render useranno.

### Errori

| errore | status | quando |
|---|---|---|
| `no_fields` | 400 | richiesta senza campi |
| `logo_conflict` | 400 | `logo_url` e `remove_logo` insieme |
| `font_pair_incomplete` | 400 | un font solo dei due |
| `font_not_available` | 400 | Google Fonts non serve quella famiglia (`missing` la nomina) |
| `image_rejected` | 400 | la guardia SSRF, la dimensione o il tipo hanno rifiutato l'immagine |
| `update_failed` | 500 | scrittura fallita |

I colori restano su `set_colors` (`PUT /studio/colors`): tre o sei cifre esadecimali, max 8, la
lista sostituisce la palette.
