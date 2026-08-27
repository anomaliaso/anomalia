<script lang="ts">
	import * as Tooltip from "$lib/components/ui/tooltip/index.js";
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";
	import { browser } from "$app/environment";
	import { SIDEBAR_WIDTH, SIDEBAR_WIDTH_ICON } from "./constants.js";
	import { setSidebar } from "./context.svelte.js";
	import { readSidebarOpen, writeSidebarOpen } from "$lib/shell-prefs";

	// Prefer localStorage (+ cookie fallback) so collapse survives reloads permanently.
	function readPersistedOpen(): boolean {
		if (!browser) return true;
		return readSidebarOpen(true);
	}

	let {
		ref = $bindable(null),
		open = $bindable(true),
		onOpenChange = () => {},
		/** When true, sidebar stays expanded and collapse is not persisted (e.g. settings). */
		locked = false,
		class: className,
		style,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		locked?: boolean;
	} = $props();

	if (!locked && browser) {
		open = readPersistedOpen();
	} else if (locked) {
		open = true;
	}

	// Suppress the CSS transition on the very first render so the sidebar gap
	// snaps to the correct width instead of animating from the default.
	let firstRender = $state(true);
	$effect(() => {
		queueMicrotask(() => {
			firstRender = false;
		});
	});

	const sidebar = setSidebar({
		open: () => open,
		setOpen: (value: boolean) => {
			if (locked) return;
			open = value;
			onOpenChange(value);
			writeSidebarOpen(open);
		}
	});
</script>

<svelte:window onkeydown={sidebar.handleShortcutKeydown} />

<Tooltip.Provider delayDuration={0}>
	<div
		data-slot="sidebar-wrapper"
		data-no-transition={firstRender ? "true" : undefined}
		style="--sidebar-width: {SIDEBAR_WIDTH}; --sidebar-width-icon: {SIDEBAR_WIDTH_ICON}; {style}"
		class={cn(
			"group/sidebar-wrapper has-data-[variant=inset]:bg-sidebar flex min-h-svh w-full",
			className
		)}
		bind:this={ref}
		{...restProps}
	>
		{@render children?.()}
	</div>
</Tooltip.Provider>
