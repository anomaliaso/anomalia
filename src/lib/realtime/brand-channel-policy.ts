/**
 * Whether a new connect() for `requestedBrandId` should piggy-back on the existing
 * connection instead of tearing it down and resubscribing.
 *
 * The app-shell effect re-runs on every navigation with a fresh `extras` object. During the
 * first connect's await (getSession / setAuth), `#channel` is still null — without treating an
 * in-flight connect as "already claimed", a second call would `channel()` the same topic after
 * it has already subscribed and throw:
 *   cannot add `presence` callbacks for realtime:brand:… after `subscribe()`.
 */
export function shouldCoalesceBrandConnect(
	currentBrandId: string | null,
	requestedBrandId: string,
	hasChannel: boolean,
	hasInFlight: boolean
): boolean {
	return currentBrandId === requestedBrandId && (hasChannel || hasInFlight);
}
