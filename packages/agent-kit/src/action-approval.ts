import type {
	ActionApprovalConfig,
	ActionApprovalRule,
	AdapterContext,
	ToolCall,
	ToolSpec
} from './types';

export type { ActionApprovalConfig, ActionApprovalRule, ActionApprovalChecker } from './types';

export type ActionApprovalSource = 'require_approval' | 'always_allow' | 'default';

export type ActionApprovalResolved = {
	decision: 'ask' | 'allow';
	source: ActionApprovalSource;
	matchingRules: readonly ActionApprovalRule[];
};

export type AutoReviewJudgeDecision = 'pass' | 'ask' | 'error';

export type ActionGateSource = 'rule' | 'default' | 'judge-pass' | 'judge-ask' | 'judge-error';

export type ActionGateResult = {
	decision: 'ask' | 'allow';
	source: ActionGateSource;
	reason?: string;
};

const APPROVAL_EXEMPT_TOOLS = new Set([
	'computer_observe',
	'computer_act',
	'list_files',
	'read_file',
	'write_file',
	'shell',
	'open_path',
	'launch_app',
	'remember',
	'request_takeover',
	'request_secret',
	'run_subagent',
	'spawn_bot',
	'schedule_create',
	'schedule_list',
	'schedule_cancel'
]);

const APPROVAL_REQUIRED_BUILTIN_TOOLS = new Set(['destination.write', 'delete_bot', 'archive_bot']);
const READ_ONLY_CONNECTOR_PATTERN = /(^|_)(get|list|search|find|read)(_|$)/i;
const MUTATING_CONNECTOR_PATTERN =
	/(^|_)(accept|add|approve|archive|assign|buy|cancel|charge|checkout|close|commit|copy|create|delete|deploy|disable|enable|execute|forward|grant|invite|link|mark|merge|modify|move|patch|pay|post|publish|purchase|put|register|reject|remove|rename|replace|reply|reset|revoke|run|schedule|send|set|share|start|stop|submit|subscribe|trigger|unassign|unlink|unsubscribe|update|upload|upsert|write)(_|$)/i;
const COMPOUND_CONNECTOR_ACTION_PATTERN = /_(and|or|then)_/i;
const EMAIL_CONNECTOR_SLUGS = new Set(['gmail', 'outlook', 'microsoft_outlook']);
const PURCHASE_CONNECTOR_SLUGS = new Set(['stripe', 'shopify', 'paypal', 'square']);

export function connectorKindFromToolName(toolName: string, connectorKinds: string[] = []): string {
	const normalizedTool = toolName.toLowerCase();
	const matched = connectorKinds
		.map((kind) => kind.toLowerCase())
		.filter((kind) => normalizedTool === kind || normalizedTool.startsWith(`${kind}_`))
		.sort((left, right) => right.length - left.length)[0];
	if (matched) return matched;
	return toolName.split('_')[0]?.toLowerCase() ?? toolName.toLowerCase();
}

export function connectorToolRequiresApproval(toolName: string): boolean {
	if (MUTATING_CONNECTOR_PATTERN.test(toolName)) return true;
	if (COMPOUND_CONNECTOR_ACTION_PATTERN.test(toolName)) return true;
	return !READ_ONLY_CONNECTOR_PATTERN.test(toolName);
}

export function toolRequiresApproval(toolName: string, viaConnector: boolean): boolean {
	if (APPROVAL_EXEMPT_TOOLS.has(toolName)) return false;
	if (APPROVAL_REQUIRED_BUILTIN_TOOLS.has(toolName)) return true;
	if (viaConnector) return connectorToolRequiresApproval(toolName);
	return false;
}

function categoryMatches(category: string, toolName: string, connectorKind: string): boolean {
	const consequential = connectorToolRequiresApproval(toolName);
	if (category.toLowerCase() === 'email') {
		if (EMAIL_CONNECTOR_SLUGS.has(connectorKind.toLowerCase())) return consequential;
		return consequential && /send.*mail|gmail_send|outlook_send/i.test(toolName);
	}
	if (category.toLowerCase() === 'purchase') {
		if (PURCHASE_CONNECTOR_SLUGS.has(connectorKind.toLowerCase())) return consequential;
		return consequential && /purchase|pay_|charge|checkout|buy_/i.test(toolName);
	}
	return false;
}

function matches(rule: ActionApprovalRule, toolName: string, connectorKind: string): boolean {
	const value = rule.matchValue.toLowerCase();
	const name = toolName.toLowerCase();
	if (rule.matchKind === 'tool') return name === value;
	if (rule.matchKind === 'connector') return name === value || name.startsWith(`${value}_`);
	return categoryMatches(value, name, connectorKind);
}

function specificity(rule: ActionApprovalRule): number {
	if (rule.matchKind === 'tool') return 3;
	if (rule.matchKind === 'connector') return 2;
	return 1;
}

export function resolveActionApprovalDetail(input: {
	toolName: string;
	connectorKind?: string;
	connectorKinds?: string[];
	rules: readonly ActionApprovalRule[];
}): ActionApprovalResolved {
	const connectorKind = input.connectorKind ?? connectorKindFromToolName(input.toolName, input.connectorKinds);
	const matchingRules = input.rules.filter((rule) => matches(rule, input.toolName, connectorKind));
	if (matchingRules.length === 0) {
		return { decision: 'allow', source: 'default', matchingRules };
	}

	const highest = Math.max(...matchingRules.map(specificity));
	const winners = matchingRules.filter((rule) => specificity(rule) === highest);
	if (winners.some((rule) => rule.effect === 'require_approval')) {
		return { decision: 'ask', source: 'require_approval', matchingRules };
	}
	return { decision: 'allow', source: 'always_allow', matchingRules };
}

export function resolveActionApproval(input: {
	toolName: string;
	connectorKind?: string;
	connectorKinds?: string[];
	rules: readonly ActionApprovalRule[];
}): 'ask' | 'allow' {
	return resolveActionApprovalDetail(input).decision;
}

export function planActionGate(input: {
	resolved: ActionApprovalResolved;
	consequential: boolean;
	autoReviewEnabled: boolean;
	checkerConfigured: boolean;
}): 'ask' | 'allow' | 'judge' {
	if (input.resolved.decision === 'ask') return 'ask';
	if (input.resolved.source === 'always_allow') return 'allow';
	if (input.consequential && input.autoReviewEnabled && input.checkerConfigured && input.resolved.source === 'default') {
		return 'judge';
	}
	return 'allow';
}

export function applyJudgeDecision(input: {
	decision: AutoReviewJudgeDecision;
	consequential: boolean;
}): 'ask' | 'allow' {
	if (input.decision === 'pass') return 'allow';
	if (input.decision === 'ask') return 'ask';
	return input.consequential ? 'ask' : 'allow';
}

export async function gateAction(input: {
	spec: ToolSpec;
	call: ToolCall;
	context: AdapterContext;
	config: ActionApprovalConfig;
}): Promise<ActionGateResult> {
	const resolved = resolveActionApprovalDetail({ toolName: input.spec.name, rules: input.config.rules ?? [] });
	const plan = planActionGate({
		resolved,
		consequential: input.spec.consequential === true,
		autoReviewEnabled: input.config.autoReviewEnabled,
		checkerConfigured: input.config.checker != null
	});
	if (plan === 'allow') {
		return { decision: 'allow', source: resolved.source === 'default' ? 'default' : 'rule' };
	}
	if (plan === 'ask') return { decision: 'ask', source: 'rule', reason: 'human approval required' };

	try {
		const decision = await input.config.checker!({ spec: input.spec, call: input.call, context: input.context });
		const result = applyJudgeDecision({
			decision,
			consequential: input.spec.consequential === true
		});
		if (result === 'allow') return { decision: 'allow', source: 'judge-pass' };
		return {
			decision: 'ask',
			source: decision === 'error' ? 'judge-error' : 'judge-ask',
			reason: decision === 'error' ? 'auto-review failed' : 'auto-review requires approval'
		};
	} catch {
		return { decision: 'ask', source: 'judge-error', reason: 'auto-review failed' };
	}
}
