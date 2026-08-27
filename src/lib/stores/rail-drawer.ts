import { writable } from 'svelte/store';

/**
 * Il drawer del rail su mobile: aperto/chiuso, e se in questo momento esiste.
 *
 * Due store invece di un prop perché i due lati stanno in rami diversi dell'albero: il
 * bottone è in `PageTopBar` (dentro `.main`, che ha `contain: layout` — un pannello fisso
 * lì dentro sarebbe ancorato al contenitore, non alla finestra), il pannello è montato in
 * fondo al layout del brand, accanto alla modal. `ready` è la risposta a "il burger apre
 * il rail o la sidebar della dashboard?": lo accende il drawer stesso quando la pagina
 * corrente vive dentro una sovrapposizione.
 */
export const railDrawerOpen = writable(false);
export const railDrawerReady = writable(false);
