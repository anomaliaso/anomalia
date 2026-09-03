import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { Graphic, type GraphicProps } from './Graphic';

/**
 * L'entry point del bundle Remotion per le grafiche, e registra SOLO `Graphic`.
 *
 * Non `Root.tsx`: quello monta anche Design e MotionAd, che importano `$lib/design/schema`. Il
 * bundler di Remotion è webpack con la sua configurazione e non conosce gli alias di SvelteKit,
 * quindi passare da lì significherebbe insegnargli `$lib` per portarsi dietro due composizioni che
 * a un render di grafica non servono. `Graphic` importa react, remotion e sucrase: il bundle resta
 * quello che gli serve.
 */
const GraphicRoot: React.FC = () => (
	<Composition
		id="Graphic"
		component={Graphic}
		durationInFrames={1}
		fps={30}
		width={1080}
		height={1080}
		defaultProps={{ source: 'const Graphic = () => <div />;' } satisfies GraphicProps}
	/>
);

registerRoot(GraphicRoot);
