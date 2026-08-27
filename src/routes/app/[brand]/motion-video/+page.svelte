<script lang="ts">
	import MotionVideoWorkbench from '$lib/components/motion-video/MotionVideoWorkbench.svelte';

	let { data } = $props();
</script>

<div class="flex h-full min-h-0 flex-col">
	<MotionVideoWorkbench
		brandSlug={data.brand.slug}
		brandName={data.brand.name}
		videos={data.videos}
		prompts={data.prompts}
		apiBase={`/app/${data.brand.slug}/motion-video`}
		brandPlan={data.brand.plan}
	/>
</div>
