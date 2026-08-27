<script lang="ts" module>
	import { tv, type VariantProps } from "tailwind-variants";

	export const sidebarMenuButtonVariants = tv({
		// Press wash uses --paper (solid surface), not ink washes / --paper-3.
		// touch-manipulation skips the 300ms click delay and keeps :active reliable on iOS/Android.
		// Selected rows stay bg-transparent at rest, but still get a press wash via active:.
		base: "ring-sidebar-ring cursor-pointer bg-transparent hover:bg-black/[0.04] dark:hover:bg-white/[0.06] active:bg-[var(--paper)] data-[active=true]:bg-transparent data-[active=true]:active:bg-[var(--paper)] data-[pending=true]:bg-black/[0.06] dark:data-[pending=true]:bg-white/[0.08] data-[pending=true]:opacity-70 data-open:hover:bg-black/[0.04] dark:data-open:hover:bg-white/[0.06] gap-2 rounded-md p-2 text-left text-sm transition-[width,height,padding,background-color,opacity] touch-manipulation select-none group-has-data-[sidebar=menu-action]/menu-item:pr-8 group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! focus-visible:ring-2 data-[active=true]:font-medium peer/menu-button group/menu-button flex w-full items-center overflow-hidden outline-hidden disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&>span:last-child]:truncate",
		variants: {
			variant: {
				default: "bg-transparent hover:bg-black/[0.04] dark:hover:bg-white/[0.06] active:bg-[var(--paper)]",
				outline: "bg-transparent hover:bg-black/[0.04] dark:hover:bg-white/[0.06] active:bg-[var(--paper)] shadow-[0_0_0_1px_var(--sidebar-border)]",
			},
			size: {
				default: "h-8 text-sm",
				sm: "h-7 text-xs",
				lg: "h-12 text-sm group-data-[collapsible=icon]:p-0!",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	});

	export type SidebarMenuButtonVariant = VariantProps<
		typeof sidebarMenuButtonVariants
	>["variant"];
	export type SidebarMenuButtonSize = VariantProps<typeof sidebarMenuButtonVariants>["size"];
</script>

<script lang="ts">
	import * as Tooltip from "$lib/components/ui/tooltip/index.js";
	import { cn, type WithElementRef, type WithoutChildrenOrChild } from "$lib/utils.js";
	import { mergeProps } from "bits-ui";
	import type { ComponentProps, Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";
	import { useSidebar } from "./context.svelte.js";

	let {
		ref = $bindable(null),
		class: className,
		children,
		child,
		variant = "default",
		size = "default",
		isActive = false,
		isPending = false,
		tooltipContent,
		tooltipContentProps,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLButtonElement>, HTMLButtonElement> & {
		isActive?: boolean;
		/** True while a navigation to this item is in flight (mobile tap feedback). */
		isPending?: boolean;
		variant?: SidebarMenuButtonVariant;
		size?: SidebarMenuButtonSize;
		tooltipContent?: Snippet | string;
		tooltipContentProps?: WithoutChildrenOrChild<ComponentProps<typeof Tooltip.Content>>;
		child?: Snippet<[{ props: Record<string, unknown> }]>;
	} = $props();

	const sidebar = useSidebar();

	const buttonProps = $derived({
		class: cn(sidebarMenuButtonVariants({ variant, size }), className),
		"data-slot": "sidebar-menu-button",
		"data-sidebar": "menu-button",
		"data-size": size,
		"data-active": isActive ? "true" : undefined,
		"data-pending": isPending ? "true" : undefined,
		"aria-busy": isPending ? true : undefined,
		...restProps,
	});
</script>

{#snippet Button({ props }: { props?: Record<string, unknown> })}
	{@const mergedProps = mergeProps(buttonProps, props)}
	{#if child}
		{@render child({ props: mergedProps })}
	{:else}
		<button bind:this={ref} {...mergedProps}>
			{@render children?.()}
		</button>
	{/if}
{/snippet}

{#if !tooltipContent}
	{@render Button({})}
{:else}
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				{@render Button({ props })}
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content
			side="right"
			align="center"
			hidden={sidebar.state !== "collapsed" || sidebar.isMobile}
			{...tooltipContentProps}
		>
			{#if typeof tooltipContent === "string"}
				{tooltipContent}
			{:else if tooltipContent}
				{@render tooltipContent()}
			{/if}
		</Tooltip.Content>
	</Tooltip.Root>
{/if}
