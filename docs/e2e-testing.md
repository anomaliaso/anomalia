# Testing E2E su Anomalia, senza andare a tentativi

Come far girare l'app in locale, loggare **al primo colpo**, aprire un thread
con un agente e verificarne la risposta. Ogni sezione nasce da un inciampo già
pagato: le fonti sono [LESSONS.md](../LESSONS.md) e le verifiche fatte il
28/08/2026 sullo stack locale.

Il principio: **mai fare una verifica nel browser finché l'ambiente non è
deterministico**. Un login che fallisce a caso non è un ambiente di test, è un
casinò: ogni minuto speso a ritentare credenziali giuste è un minuto tolto al
difetto che si sta cercando.

---

## 1. Worktree: `npm ci` + `.env`, sempre

Ogni task vive nel suo worktree, mai sul checkout principale. Un worktree nuovo
parte senza `node_modules` e senza `.env`: senza i due, la suite muore con
errori fuorvianti (`Cannot find package '@sentry/sveltekit'`,
`SUPABASE_SERVICE_ROLE_KEY not configured`). Vedi LESSONS, *Ambiente e
worktree*.

```bash
git worktree add -b fix/<slug> ../anomalia-wt/<slug> dev
cd ../anomalia-wt/<slug>
cp /Users/andreabuttarelli/Documents/GitHub/anomalia/.env .env
npm ci   # patch-package riapplica le patch delle dipendenze in postinstall
```

Dopo un rebase su dev che ha accolto PR nuove: **`npm ci` di nuovo** (lockfile
vecchio = guasti deterministici e fuori posto, tipo `X is not a function` su
codice mai toccato).

## 2. Stack locale: chi c'è, e chi compete per la coda

```bash
docker ps --format '{{.Names}}\t{{.Status}}'
```

La stack porta `anomalia-app` (immagine `anomalia-selfhost-app`, porta 3000),
`anomalia-kong` (8000), `anomalia-db` (5432), `anomalia-cron`. Attenzione:
`anomalia-app` prosciuga `chat_jobs` dallo stesso DB del tuo dev server — se
l'immagine è più vecchia del checkout, il codice nuovo **non gira mai** e i due
reaper si contendono i turni. Prima di giudicare un flusso chat:

```bash
docker images | grep anomalia-selfhost-app   # data dell'immagine vs git log -1
docker logs --since 1h anomalia-app 2>&1 | grep -i chat
```

Se il container è stantio e non serve alla verifica, fermalo; se serve,
ricostruiscilo. E ricorda di riaccenderlo. (LESSONS, *Il worker locale è un
build vecchio*.)

## 3. Dev server del worktree: env overlay, mai l'.env del repo

L'.env del repo punta al progetto hosted; la stack locale ha le sue chiavi
dentro `anomalia-kong`. Il dev server del worktree deve parlare con la stack
locale, con `PUBLIC_SUPABASE_URL=http://localhost:8000` — **non** l'hostname
`kong` del container, che dal Mac non risolve (errore tipico nel log:
`getaddrinfo ENOTFOUND kong` a ogni login).

Le chiavi valide si leggono dall'ambiente del container, senza copiarle a mano:

```bash
getenv() { docker inspect anomalia-app --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | perl -ne "if (/^\Q$1\E=(.*)\$/) { print \$1; exit }"; }

PUBLIC_SUPABASE_URL=http://localhost:8000 \
PUBLIC_SUPABASE_ANON_KEY=$(getenv PUBLIC_SUPABASE_ANON_KEY) \
SUPABASE_SERVICE_ROLE_KEY=$(getenv SUPABASE_SERVICE_ROLE_KEY) \
ORIGIN=http://localhost:5176 \
PUBLIC_APP_URL=http://localhost:5176 \
npm run dev -- --port 5176 > /tmp/dev-<slug>.log 2>&1 &
```

Porta esplicita sempre: la 5173 può appartenere al vite di un altro worktree,
che risponde 404 a tutto e resta lì in ascolto (LESSONS). Il log su file è
fondamentale: è lì che appaiono gli errori server che il browser non mostra.

## 4. Utente e brand di prova: esistono già, riusali

Lo stack locale ha l'utente di test e il brand demo:

- **utente**: `test@anomalia.so` / `123456`
- **brand**: slug `demo`, nome `Demo Brand`, piano `pro`, attivo

Verifica che esistano (idempotente, mai ricreare a mano):

```bash
docker exec anomalia-db psql -U postgres -d postgres -c \
  "select id, email from auth.users where email = 'test@anomalia.so';
   select id, slug, name, plan, status from public.brands where slug = 'demo';"
```

Se manca il membership o l'utente, il seed ufficiale è idempotente:

```bash
DATABASE_URL=postgres://postgres:<POSTGRES_PASSWORD>@localhost:5432/postgres \
PUBLIC_SUPABASE_URL=http://localhost:8000 \
SUPABASE_SERVICE_ROLE_KEY=$(getenv SUPABASE_SERVICE_ROLE_KEY) \
SEED_DEMO_EMAIL=test@anomalia.so SEED_DEMO_PASSWORD=123456 \
node scripts/db-seed.mjs
```

Se l'utente esiste ma il login fallisce per password, **allineala via admin API
in una chiamata**, senza tentativi UI:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X PUT \
  'http://localhost:8000/auth/v1/admin/users/<USER_ID>' \
  -H "apikey: $(getenv SUPABASE_SERVICE_ROLE_KEY)" \
  -H "Authorization: Bearer $(getenv SUPABASE_SERVICE_ROLE_KEY)" \
  -H 'Content-Type: application/json' \
  --data '{"password":"123456","email_confirm":true}'
# 200 = password allineata
```

## 5. Login al primo colpo

Il form di login è stabile e i suoi selettori non cambiano:

- form: `form[action="?/login"]`
- email: `input[name="email"]`
- password: `input[name="password"]`
- submit: bottone con testo `Accedi` (i18n: su istanza inglese `Sign in`)

Recipe Playwright (headed: il browser deve essere visibile, non headless):

```js
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:5176/login');
await page.locator('input[name="email"]').fill('test@anomalia.so');
await page.locator('input[name="password"]').fill('123456');
await page.locator('form[action="?/login"] button[type="submit"]').click();
await page.waitForTimeout(1000);
```

Due trappole che sembrano "login rotto" e non lo sono:

1. **Il redirect finale va all'ultimo brand usato**, non a `/app`: il cookie
   `anomalia_last_brand` può mandarti su `/app/<vecchio-brand>`. Naviga sempre
   esplicitamente dove devi verificare:
   ```js
   await page.goto('http://localhost:5176/app/demo');
   ```
2. **Cookie stantii da sessioni precedenti**: se il log del dev server mostra
   `AuthApiError: Invalid Refresh Token: Refresh Token Not Found`, il browser
   porta un token di una sessione passata. Cancella i cookie e riparti:
   ```js
   await page.context().clearCookies();
   ```

Identità sempre verificata, mai presunta: dopo il login controlla `page.url()`
e che la sidebar mostri il brand atteso.

## 6. Aprire un thread e mandare un messaggio a un agente

`/app/<slug>` apre la home chat del brand. Il composer è `ChatPrompt.svelte`:

- textarea: `textarea.ch-input`
- **il bottone Invia appare solo quando c'è testo** — prima c'è il microfono
  (`aria-label="Detta un messaggio"`). Dopo il `fill`, il submit esiste:
  ```js
  await page.locator('textarea.ch-input').fill('Rispondi solo con OK');
  await page.locator('button.ch-send[type="submit"]').click();
  ```

Alternativa da tastiera (identica per l'app): focus sulla textarea e `Enter`
senza Shift. Non usare `Enter` se il menu slash (`/`) è aperto: seleziona il
comando invece di inviare.

Per un agente specifico, la sidebar elenca i thread per agente
(`Content Creator`, `Web Specialist`, …): apri il thread esistente oppure
invia dalla home, che ne crea uno nuovo con l'agente di default.

## 7. Aspettare la risposta e verificare che sopravviva

Non dormire a caso: **aspetta la condizione**, non un numero di secondi
(LESSONS, *Il sonno fisso prima dell'asserzione è la race in nuce*). Metti un
marcatore univoco nel messaggio e interroga il testo di pagina.

Attenzione: il marker compare anche nella bolla dell'utente, quindi un semplice
`document.body.innerText.includes(marker)` matcha il messaggio CHE HAI INVIATO
TU ed è un falso positivo — nel gate del 28/8 ha mascherato un 401 reale
(LESSONS, *Il marcatore che matcha la bolla dell'utente è un falso positivo*).
Conta le occorrenze (≥ 2: la tua bolla + la risposta) oppure aspetta il
selettore della bolla dell'assistente:

```js
const marker = 'OK-' + Date.now();
await page.locator('textarea.ch-input').fill('Rispondi solo con ' + marker);
await page.locator('button.ch-send[type="submit"]').click();

const occurrences = (m) => document.body.innerText.split(m).length - 1;
await page.waitForFunction(occurrences, marker, { timeout: 120_000 });

// La risposta deve essere PERSISTENTE, non solo streammata (e anche dopo il
// reload la tua bolla matcha: conta di nuovo, non fare includes):
await page.reload();
await page.waitForLoadState('networkidle');
if (await page.evaluate(occurrences, marker) < 2) {
  throw new Error('risposta non persistita dopo reload');
}
```

Un turno chat può metterci decine di secondi (tool in volo, continuazioni). Il
reload post-risposta è parte della verifica: senza, stai testando solo lo
stream, non la persistenza.

## 8. Diagnosi rapida quando qualcosa non torna

In ordine, sempre nello stesso ordine:

1. **Log del dev server** (`/tmp/dev-<slug>.log`): gli errori server veri
   vivono lì, non nel browser. Cercare `error`, `AuthApiError`, `AGENT_KIT`.
2. **`ai_calls` fallite** (ultimi 7 giorni, chidice da sola):
   ```bash
   docker exec anomalia-db psql -U postgres -d postgres -c \
     "select created_at, label, provider, left(error,300) from public.ai_calls
      where ok = false and created_at > now() - interval '7 days'
      order by created_at desc limit 30;"
   ```
3. **`chat_jobs` falliti**:
   ```bash
   docker exec anomalia-db psql -U postgres -d postgres -c \
     "select created_at, status, tool_name, left(error,300) from public.chat_jobs
      where status = 'failed' and created_at > now() - interval '7 days'
      order by created_at desc limit 30;"
   ```
4. **Chi prosciuga la coda** (§2): un'app-container stantia falsa ogni
   diagnosi sul percorso chat.

Un thread che mostra «Errore del turno: …» conserva il messaggio d'errore
originale nel testo della bolla: leggilo lì prima di aprire il codice.

## 9. La smoke suite esistente

`npm run test:e2e` (Playwright, porta 4173) gira con env placeholder e **senza
database**: copre solo superfici db-free (login page, redirect, landing,
changelog, robots). È la rete per regressioni di routing/rendering, non per i
flussi autenticati: quelli vanno verificati con la recipe di questa guida sullo
stack vero. Dettagli in `tests/e2e/`.

## 10. Checklist anti-tentativi

Prima di ogni sessione E2E, in fila, un minuto:

- [ ] worktree proprio, `npm ci` fatto (di nuovo, se hai ribasato)
- [ ] stack docker su, `anomalia-app` fresco o fermato consapevolmente
- [ ] dev server su porta esplicita, env overlay con `localhost:8000`, log su file
- [ ] utente `test@anomalia.so` e brand `demo` presenti (una query psql)
- [ ] browser headed, cookie puliti se il log parla di refresh token
- [ ] navigazione esplicita a `/app/demo` (mai fidarsi del redirect finale)
- [ ] marker univoco nel messaggio, attesa sulla condizione, reload di verifica
