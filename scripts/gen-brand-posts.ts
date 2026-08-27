// Drive the REAL onboarding pipeline programmatically to generate on-brand posts for several
// sites, saving each rendered image + caption locally. Run with the SvelteKit/Vite aliases resolved:
//   node --env-file=.env node_modules/.bin/vite-node scripts/gen-brand-posts.ts
// (vite-node resolves $lib / $env/* the same way the app does.)
import { mkdirSync, writeFileSync } from 'node:fs';
import { runBrandAnalysis } from '$lib/server/brand-analysis';
import { planPreviewPosts, renderPreviewImages, type PreviewPost } from '$lib/server/content-preview';

const BRANDS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['https://withmellon.com', 'https://andreabuttarelli.com', 'https://flash-camp.com'];
const POSTS_PER_BRAND = 3;
const OUT = '/tmp/Anomalia-gen';

// The renderer's "never invent a product" guard skips any post that names a product but has no real
// photo to anchor it — correct for physical goods, but it also blanks service/portfolio posts whose
// "products" are services (no product shot). For those, clear post.product so the rich image_prompt
// renders a scene instead of being skipped. Real-product posts (with photos) keep their anchor.
const norm = (s: string) =>
  String(s).toLowerCase().replace(/\[[^\]]*\]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
function stripUnphotographedProducts(profile: Record<string, unknown>, posts: PreviewPost[]) {
  const products = Array.isArray(profile?.products) ? (profile.products as Record<string, unknown>[]) : [];
  const photographed = products
    .filter((p) => Array.isArray(p?.images) && (p.images as unknown[]).length)
    .map((p) => norm(String(p?.name ?? p?.title ?? '')))
    .filter(Boolean);
  for (const post of posts) {
    if (!post.product) continue;
    const np = norm(post.product);
    const hasPhoto = photographed.some((name) => name && (name.includes(np) || np.includes(name)));
    if (!hasPhoto) post.product = '';
  }
}

// Stub Supabase: intercept the storage upload renderPreviewImages performs and write the bytes to
// disk instead, returning the local file path as the "public URL". Nothing else is touched.
function stubSupabase(dir: string) {
  return {
    storage: {
      from() {
        return {
          async upload(path: string, bytes: Buffer) {
            const file = `${dir}/${path.split('/').pop()}`;
            writeFileSync(file, bytes);
            return { data: { path: file }, error: null };
          },
          getPublicUrl(path: string) {
            return { data: { publicUrl: `${dir}/${path.split('/').pop()}` } };
          }
        };
      }
    }
  };
}

const slug = (u: string) => u.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/-+$/,'');
const log = (b: string) => (step: string, msg: string) => console.log(`  [${b}] ${step}: ${msg}`);

mkdirSync(OUT, { recursive: true });
const manifest: Array<{ brand: string; file: string; caption: string; platform: string; format: string }> = [];

for (const url of BRANDS) {
  const b = slug(url);
  const dir = `${OUT}/${b}`;
  mkdirSync(dir, { recursive: true });
  console.log(`\n=== ${url} ===`);
  try {
    const profile = await runBrandAnalysis(url, log(b), undefined, 'English');
    console.log(`  → analysed: ${profile?.name ?? '(no name)'} · ${(profile?.products?.length ?? 0)} products`);

    const posts = await planPreviewPosts(
      profile,
      { platforms: ['instagram'], prefs: {}, maxVideos: 0, onProgress: log(b) },
      POSTS_PER_BRAND
    );
    console.log(`  → planned ${posts.length} posts`);
    stripUnphotographedProducts(profile as Record<string, unknown>, posts);

    let i = 0;
    await renderPreviewImages(profile, posts, {
      supabase: stubSupabase(dir) as never,
      userId: b,
      onProgress: log(b),
      onPost: (post: PreviewPost) => {
        i += 1;
        const file = post.imageUrl ?? '(no image)';
        manifest.push({ brand: b, file, caption: post.caption, platform: post.platform, format: post.format });
        writeFileSync(`${dir}/${String(i).padStart(2, '0')}-caption.txt`, post.caption ?? '');
        console.log(`  ✓ post ${i}: ${file}`);
      }
    });
  } catch (e) {
    console.error(`  ✗ ${url}:`, e instanceof Error ? e.message : e);
  }
}

writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(`\nDone. ${manifest.length} posts → ${OUT}/manifest.json`);
