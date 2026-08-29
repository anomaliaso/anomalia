# Il DM raggiunge i custom agent per nome (e senza routine)

Difetto trovato al gate del ticket 2: `message_agent` non riusciva a consegnare
un DM a "Scriba Fischietto". Il modello conosce solo il NOME; `resolveDmTarget`
accettava l'id — ma lo cercava in `custom_agent_schedules`, la tabella delle
ROUTINE. Dalla 0210 l'identità sta in `custom_agents`: un agente custom senza
nessuna routine (il caso normale di chi lo crea dalla pagina Agenti) era
irraggiungibile anche con l'id esatto, e per nome lo era per costruzione. Il
modello bruciava i suoi step a provare grafie del nome finché il turno moriva
per `step_limit` — con l'utente che vedeva solo un'escusa.

Fix: `resolveDmTarget` legge l'identità via `listCustomAgents` (con il ponte
pre-0210 che il modulo foglia già porta) e accetta tre forme: id nudo,
`custom:<uuid>`, e il nome esatto case-insensitive. `resolveDmInitiator` aveva
lo stesso difetto di tabella e ora passa da `getCustomAgent`: chi scrive da un
thread custom si firma con la sua identità anche se non ha routine. L'errore di
destinatario sconosciuto dice ora al modello che il NOME va bene.

Test prima del fix, visti rossi: DM per nome, DM per id di un agente senza
routine, firma dell'initiator dal thread custom. Il fake del test non conosce
più `custom_agent_schedules`: se qualcuno ci torna, il test lo urla.
