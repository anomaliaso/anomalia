# Il composer non perde più allegati selezionati all'avvio

Il file input del composer veniva renderizzato anche nel markup SSR. Un browser poteva trovarlo e
selezionare un'immagine prima che Svelte avesse collegato `onPickFiles`; la selezione si perdeva,
la strip non compariva e il turno partiva senza allegato.

Il picker viene ora montato solo dopo l'hydration del composer. Il selettore del browser aspetta
così un input già interattivo; il percorso di downscale e il blocco dell'invio durante
l'elaborazione restano invariati.
