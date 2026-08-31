# Il carosello agenti dell'onboarding presenta la squadra, non un bivio

La slide chiedeva "Scegli con chi cominci" e sotto il bottone principale offriva
"Creane uno mio": due decisioni prima ancora di aver visto cosa sanno fare gli
agenti. Il link portava fuori dall'onboarding, in `/app/:slug/agents?new=1`, e chi
lo prendeva usciva dal flusso senza aver mai aperto una chat.

Ora il titolo nomina la cosa ("Il tuo team autonomo") invece di aprire un bivio, il
sottotitolo racconta cosa si sta guardando — un team di agenti esperti nel marketing
— e l'unica azione è un "Inizia" secco. Creare un agente proprio resta
dov'era, nella pagina Agents, raggiungibile a onboarding finito.

Sparisce con il bottone l'evento `onboarding_agent_create_own`: non c'è più il
punto in cui poteva scattare.
