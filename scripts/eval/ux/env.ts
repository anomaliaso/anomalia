import { createEvalStackEnv, evalServices, EVAL_SERVICES, envFileContents, freePorts } from './stack.mjs';

export { createEvalStackEnv, evalServices, EVAL_SERVICES, envFileContents, freePorts };

const OPEN_BILLING_PROVIDER = 'open';

export function evalServerEnv(source: NodeJS.ProcessEnv, agentKit: 'on' | 'off'): NodeJS.ProcessEnv {
	return {
		...source,
		NO_HMR: '1',
		AGENT_KIT: agentKit,
		BILLING_PROVIDER: source.BILLING_PROVIDER || OPEN_BILLING_PROVIDER
	};
}
