<script lang="ts">
  import BlogPost from '$lib/components/blog/BlogPost.svelte';
  let { data } = $props();
</script>

<BlogPost brand={data.brand} article={data.article} base={data.base} siteUrl={data.siteUrl} />
