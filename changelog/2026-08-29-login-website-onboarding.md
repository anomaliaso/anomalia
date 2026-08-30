# Conserva il sito nel login autenticato

Un utente già autenticato che apriva `/login?website=...` finiva su `/app` e perdeva il sito da analizzare.

Il `load` del login ora tratta un `website` valido come intenzione di onboarding e riusa la sanitizzazione esistente. Non serve un cookie aggiuntivo: il valore è già nella query.
