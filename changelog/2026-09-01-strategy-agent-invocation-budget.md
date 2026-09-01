# Lo strategy agent non si prende più tutta l'invocazione

`runStrategyAgent` chiedeva 280s di wall clock — `deadlineMs ?? 280_000` — e nessun chiamante
gliene passava un altro. Dentro il worker dell'onboarding quella cifra è una pretesa: lo studio di
mercato è già girato prima, e se l'agente finisce senza piano la pipeline legacy deve ancora
starci dentro i 300s di `maxDuration`.

I numeri di produzione dicevano che il tetto era già toccato:

| | |
| --- | --- |
| research job completati | 299s · 278s · 225s · 224s |
| `maxDuration` del worker | 300s |
| l'unico research fallito | `Job timed out after 3 attempts`, step `editorialPlan` |
| `strategy-agent`, 17 chiamate | media 108s, massimo 272s |
| `return_editorial_plan`, 206 chiamate | mediana 16,6s, massimo 87s |

Il passo del piano ora riceve `remainingMs` — quanto resta dell'invocazione — e `agentPlanBudget`
decide: all'agente va ciò che avanza dopo aver messo da parte i 90s della pipeline legacy, mai più
del suo tetto da solo. Se quel che resta non tiene entrambi, **l'agente non parte**: avviarlo
comprerebbe un'invocazione uccisa al posto di un piano.

Scartato: alzare `maxDuration`. Il tetto della piattaforma è 300s e il problema non è che serve
più tempo, è che due cose si contendevano lo stesso tempo senza saperlo.

Scartato anche: rendere l'agente più veloce (meno step, meno tool). È una cura per un sintomo —
finché il budget non è dichiarato, qualunque agente più veloce ricomincerà a sforare appena lo
studio davanti a lui rallenta.
