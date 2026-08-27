/**
 * Material Design press feedback for interactive trees (e.g. app sidebar).
 *
 * - pointerdown: snappy scale-in + ink ripple from contact point
 * - pointerup / cancel / leave: springy scale-out + ripple fade
 *
 * Use via `use:materialPress` on a container; pressables are found by delegation.
 */
import './material-press.css';

const PRESSABLE_SELECTOR = [
	'a[href]',
	'button:not(:disabled)',
	'[role="button"]:not([aria-disabled="true"])',
	'[role="menuitem"]:not([data-disabled])',
	'[role="option"]:not([aria-disabled="true"])',
	'[data-sidebar="menu-button"]',
	'[data-sidebar="menu-action"]',
	'[data-sidebar="group-action"]',
	'[data-sidebar="menu-sub-button"]',
	'[data-sidebar="trigger"]',
	'[data-sidebar="rail"]',
	'[data-slot="dropdown-menu-item"]',
	'[data-slot="dropdown-menu-checkbox-item"]',
	'[data-slot="dropdown-menu-radio-item"]',
	'[data-slot="dropdown-menu-sub-trigger"]',
	'.sidebar-warn-btn'
].join(', ');

type ActivePress = {
	el: HTMLElement;
	ripple: HTMLSpanElement | null;
	pointerId: number;
};

function prefersReducedMotion(): boolean {
	return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function findPressable(root: HTMLElement, target: EventTarget | null): HTMLElement | null {
	if (!(target instanceof Element)) return null;
	const el = target.closest(PRESSABLE_SELECTOR);
	if (!el || !(el instanceof HTMLElement) || !root.contains(el)) return null;
	if (el.closest('[data-no-material-press]')) return null;
	if (el.matches('input, textarea, select, [contenteditable="true"]')) return null;
	if (el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled')) return null;
	if (el.hasAttribute('data-disabled')) return null;
	return el;
}

function ensureRippleHost(el: HTMLElement) {
	const style = getComputedStyle(el);
	if (style.position === 'static') {
		el.style.position = 'relative';
	}
	if (style.overflow === 'visible') {
		el.dataset.materialOverflow = 'visible';
		el.style.overflow = 'hidden';
	}
}

function restoreRippleHost(el: HTMLElement) {
	if (el.dataset.materialOverflow === 'visible') {
		el.style.overflow = '';
		delete el.dataset.materialOverflow;
	}
	// Only clear position if we set it and no ripples remain
	if (!el.querySelector('.material-ripple') && el.style.position === 'relative') {
		// Leave position:relative — harmless and avoids layout thrash on repeated presses
	}
}

function createRipple(el: HTMLElement, clientX: number, clientY: number): HTMLSpanElement {
	ensureRippleHost(el);
	const rect = el.getBoundingClientRect();
	const x = clientX - rect.left;
	const y = clientY - rect.top;
	const radius = Math.ceil(
		Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y))
	);
	const size = radius * 2;

	const ripple = document.createElement('span');
	ripple.className = 'material-ripple';
	ripple.setAttribute('aria-hidden', 'true');
	ripple.style.width = `${size}px`;
	ripple.style.height = `${size}px`;
	ripple.style.left = `${x - size / 2}px`;
	ripple.style.top = `${y - size / 2}px`;
	el.appendChild(ripple);

	// Double rAF so the initial scale(0) paints before expand
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			ripple.classList.add('material-ripple--expand');
		});
	});

	return ripple;
}

function fadeRipple(ripple: HTMLSpanElement | null, host: HTMLElement) {
	if (!ripple) {
		restoreRippleHost(host);
		return;
	}
	ripple.classList.add('material-ripple--fade');
	let removed = false;
	const remove = () => {
		if (removed) return;
		removed = true;
		ripple.remove();
		restoreRippleHost(host);
	};
	ripple.addEventListener('transitionend', remove, { once: true });
	window.setTimeout(remove, 400);
}

export function materialPress(node: HTMLElement) {
	node.dataset.materialPress = '';

	let active: ActivePress | null = null;

	function release(pointerId?: number) {
		if (!active) return;
		if (pointerId !== undefined && active.pointerId !== pointerId) return;
		const { el, ripple } = active;
		active = null;
		el.classList.remove('is-material-pressed');
		fadeRipple(ripple, el);
	}

	function onPointerDown(e: PointerEvent) {
		if (e.button !== 0 && e.pointerType === 'mouse') return;
		if (prefersReducedMotion()) return;

		const el = findPressable(node, e.target);
		if (!el) return;

		// Nested roots (e.g. ChatPrompt inside ChatColumn): only the closest owner handles it.
		const owner = el.closest('[data-material-press]');
		if (owner && owner !== node) return;

		// One press at a time on this root
		release();

		const ripple = createRipple(el, e.clientX, e.clientY);
		el.classList.add('is-material-pressed');
		active = { el, ripple, pointerId: e.pointerId };

		// Mouse only. Capturing a touch pointer makes the browser retarget the rest of the gesture,
		// and several mobile browsers then never fire the `click` — the button lights up under the
		// finger and does nothing, which is worse than losing the press-out animation on a drag.
		// Release is already covered by pointerup / pointercancel / pointerleave.
		if (e.pointerType === 'mouse') {
			try {
				el.setPointerCapture(e.pointerId);
			} catch {
				/* ignore — some elements don't support capture */
			}
		}
	}

	function onPointerUp(e: PointerEvent) {
		release(e.pointerId);
	}

	function onPointerCancel(e: PointerEvent) {
		release(e.pointerId);
	}

	function onLostCapture(e: PointerEvent) {
		release(e.pointerId);
	}

	// If the pointer leaves while not captured (rare), still release
	function onPointerLeave(e: PointerEvent) {
		if (!active || active.pointerId !== e.pointerId) return;
		if (active.el.hasPointerCapture?.(e.pointerId)) return;
		release(e.pointerId);
	}

	node.addEventListener('pointerdown', onPointerDown);
	node.addEventListener('pointerup', onPointerUp);
	node.addEventListener('pointercancel', onPointerCancel);
	node.addEventListener('lostpointercapture', onLostCapture);
	node.addEventListener('pointerleave', onPointerLeave);

	return {
		destroy() {
			release();
			delete node.dataset.materialPress;
			node.removeEventListener('pointerdown', onPointerDown);
			node.removeEventListener('pointerup', onPointerUp);
			node.removeEventListener('pointercancel', onPointerCancel);
			node.removeEventListener('lostpointercapture', onLostCapture);
			node.removeEventListener('pointerleave', onPointerLeave);
		}
	};
}
