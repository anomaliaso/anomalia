# Il verdetto dell'utente sul post, e l'evento di attivazione

Misura di produzione dell'1/9/2026, su 500 post: 243 `pending_user` (49%), 176 `published`,
61 `scheduled`, 14 `approved`, 6 `failed`, e **zero scartati da giugno** — lo stato non esiste.
Un post che il cliente ha odiato e uno che non ha mai aperto erano la stessa riga, e non c'era
nessuna definizione di «attivato» con cui giudicare un cambiamento del flusso d'ingresso.

## La forma scelta: una tabella di eventi

`post_verdicts` (post_id, brand_id, user_id, verdict, caption_before, caption_after, created_at).
Le altre due forme sono state scartate per un motivo ciascuna:

- **Un nuovo stato su `posts.status`.** Buttare un post ne CANCELLA la riga (`deletePostCancellingZernio`,
  `reject_post`, il bulk della CLI): uno stato `discarded` richiederebbe la cancellazione morbida,
  cioè un filtro in ogni lettura di `posts` del prodotto. È la migration più invasiva possibile per
  il segnale più raro.
- **Una colonna dedicata su `posts`.** Stesso problema per «buttato», più due: «modificato» succede
  più volte e una colonna tiene solo l'ultima, e `posts` non ha nessuna colonna che dica CHI ha
  deciso — il verdetto è di una persona, non di un brand.

`post_id` è deliberatamente **senza foreign key**: il verdetto `discarded` deve sopravvivere alla
riga che descrive, o «buttato» resta immisurabile come oggi.

**«Modificato» conserva la differenza**, perché costava zero: `applyPostEdits` legge già la caption
precedente per insegnarla a `brand_memory`. Le due colonne `caption_before` / `caption_after`
riusano quella lettura. Restano fuori le modifiche non testuali (media, orario): il verdetto
«modificato» qui vuol dire *l'utente ha riscritto quello che avevamo scritto noi*.

## La regola in un posto solo

`recordPostVerdict` (`src/lib/server/post-verdict.ts`) è l'unico posto che sa che forma ha un
verdetto. Le superfici dichiarano soltanto CHI ha deciso, perché è l'unica cosa che solo loro
sanno. Il verdetto viene emesso dalle tre strozzature che già esistevano:

- `publishApprovedPost` → `approved`, ma **solo** se lo stato memorizzato era `pending_user` e la
  chiamata porta un `by`. Le due condizioni servono entrambe: senza la prima una riprogrammazione
  o un repost conterebbero come approvazione, senza la seconda l'agente di analytics
  (`reschedule_pending_post`, che può pubblicare un `pending_user`) gonfierebbe l'attivazione con
  decisioni che nessun umano ha preso.
- `applyPostEdits` → `edited`, quando la caption cambia davvero.
- `deletePostCancellingZernio` → `discarded`.

Tre superfici scavalcavano una strozzatura e sono state ricondotte, non duplicate: la
`updateCaption` del calendario e quella di Content scrivevano `posts.caption` a mano (quindi non
insegnavano nemmeno la voce al brand), e `DELETE /api/v1/brands/:slug/posts/:id` cancellava la riga
senza passare dalla revoca Zernio. Il `update_post` e il `reject_post` della chat e il bulk-delete
della CLI restano con una chiamata esplicita: le loro scritture non sono le stesse.

L'approvazione via email non ha una sessione: `brandOwnerId` risolve brand → organizzazione →
proprietario, così anche quel percorso ha una persona dietro invece di un buco.

**Non registra un verdetto** `createManualPost`: un post che l'utente ha scritto lui non è un
giudizio su quello che abbiamo scritto noi, e contarlo come attivazione misurerebbe il prodotto
sbagliato.

## L'evento di attivazione

Non è una riga in più: è `min(created_at)` per `(user_id, brand_id)` sui verdetti `approved`.
L'indice parziale `post_verdicts_activation_idx` serve esattamente quella query. Nessun cruscotto,
nessuna colonna materializzata, nessuna pagina.

```sql
-- Attivazione per coorte di iscrizione: quanti utenti approvano il primo post, e dopo quanto.
with activation as (
  select user_id, brand_id, min(created_at) as activated_at
  from post_verdicts
  where verdict = 'approved'
  group by user_id, brand_id
)
select
  date_trunc('week', u.created_at)::date                                as signup_week,
  count(distinct u.id)                                                  as signed_up,
  count(distinct a.user_id)                                             as activated,
  round(100.0 * count(distinct a.user_id) / nullif(count(distinct u.id), 0), 1) as activation_pct,
  round(avg(extract(epoch from (a.activated_at - u.created_at)) / 3600) filter (where a.user_id is not null)::numeric, 1) as avg_hours_to_activate
from auth.users u
left join activation a on a.user_id = u.id
group by 1
order by 1 desc;
```

## La migration va applicata a mano

I deploy di questo repo non applicano le migration. `20260901140000_post_verdicts.sql` va applicata
PRIMA che il codice arrivi in produzione: senza la tabella ogni `recordPostVerdict` fallisce, e
fallisce in silenzio per costruzione (logga e prosegue — un verdetto non deve mai far fallire
un'approvazione). Il risultato sarebbe una feature che non registra niente senza che nessuno se ne
accorga.
