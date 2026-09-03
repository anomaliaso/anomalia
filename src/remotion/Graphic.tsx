import React from 'react';
import { continueRender, delayRender } from 'remotion';
import { transform } from 'sucrase';

/**
 * La grafica del brand renderizzata da un BROWSER, non da satori.
 *
 * Satori è un sottoinsieme stretto di flexbox: niente `grid`, niente `clamp()`, niente
 * `text-wrap: balance`, niente percentuali su `max-width`. Un sorgente che in Chrome sta in piedi
 * lì trabocca e si sovrappone — e il gate che c'è ispeziona l'albero DICHIARATO, quindi non lo
 * vede. È così che è uscita una headline tagliata su due lati con `success: true`.
 *
 * UNA composizione sola, bundlata una volta: il sorgente arriva come prop e viene compilato QUI,
 * nel browser. Così un render non paga mai un bundle — misurato, 1.35s il bundle (una volta) e
 * ~220ms lo still, contro i 6.6s del primo giro che erano boot di Chromium e bundle insieme.
 */
export type GraphicProps = {
	/** Il sorgente del modello: TSX che esporta `Graphic`, o HTML già avvolto in un componente. */
	source: string;
};

export const Graphic: React.FC<GraphicProps> = ({ source }) => {
	const [element, setElement] = React.useState<React.ReactElement | null>(null);
	// Remotion non scatta finché il render è "in ritardo": senza questo lo still uscirebbe bianco,
	// perché la compilazione avviene in un effect e il primo frame è vuoto.
	const [handle] = React.useState(() => delayRender('compiling the graphic source'));

	React.useEffect(() => {
		try {
			const { code } = transform(source, { transforms: ['typescript', 'jsx'], jsxRuntime: 'classic' });
			const factory = new Function('React', `${code}; return typeof Graphic !== 'undefined' ? Graphic : null;`);
			const Composed = factory(React) as React.FC | null;
			if (!Composed) throw new Error('the source does not define `Graphic`');
			setElement(React.createElement(Composed));
		} catch (e) {
			// Il render FALLISCE invece di consegnare una tela bianca: un PNG vuoto che si spaccia
			// per riuscito è peggio di un errore, perché arriva fino all'utente.
			throw e instanceof Error ? e : new Error(String(e));
		} finally {
			continueRender(handle);
		}
	}, [source, handle]);

	return element;
};
