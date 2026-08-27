import { MediaQuery } from "svelte/reactivity";

const DEFAULT_MOBILE_BREAKPOINT = 768;

/** Phone + tablet only (not laptop). Desktop split shell starts at this width. */
export const SHELL_MOBILE_BREAKPOINT = 1024;

/**
 * Viewport-based mobile detection for the app *shell* (sidebar sheet, chat|workbench
 * split, mobile nav). Workbench *page* layouts must NOT use this — they use CSS
 * `@container workbench (…)`, keyed to `.workbench-pane` / `.wb-frame` width so a
 * narrow pane beside chat still goes “mobile” on a wide viewport.
 */
export class IsMobile extends MediaQuery {
	constructor(breakpoint: number = DEFAULT_MOBILE_BREAKPOINT) {
		super(`max-width: ${breakpoint - 1}px`);
	}
}
