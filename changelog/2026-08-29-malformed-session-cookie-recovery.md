# Recupero dai cookie di sessione corrotti

Prima, un cookie auth con Base64-URL non valido faceva fallire la recovery Supabase e poteva
terminare il dev server.

Ora il cookie auth corrotto viene ignorato insieme ai suoi chunk e la richiesta prosegue come
anonima. I cookie validi restano invariati.
