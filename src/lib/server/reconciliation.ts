import type { SupabaseClient } from '@supabase/supabase-js';
import { checkScheduleDivergence, reschedulePost, stampVisualMetaPublished, type DivergentPost } from './publish';
import { jobEnabledForBrand } from './job-roster';

export interface ReconciliationResult {
  checked: number;
  brandsWithDivergence: number;
  details: Array<{ brand: string; divergent: DivergentPost[]; fixed: number; failed: number }>;
}

/**
 * Daily reconciliation: check every autopilot-enabled brand for DB↔Zernio divergence.
 *
 * Fix direction depends on the Zernio status:
 * 1. Zernio says PUBLISHED → the fact is done: align DB (status, published_url, scheduled_for).
 * 2. Both in the FUTURE but different times → DB is truth (user intent): fix Zernio via reschedulePost.
 * 3. Fix impossible (Zernio unreachable, delete failed) → needs_attention on the post + incident.
 *
 * Returns the results so callers can send incident emails.
 */
export async function dailyReconciliation(supabase: SupabaseClient): Promise<ReconciliationResult> {
  // "Brand autopilot" = attivo e senza opt-out sul lavoro 'autopilot' del roster (il booleano
  // `autopilot_enabled` è ritirato). Stessa definizione del gate in runAutopilotForBrand.
  const { data: brands } = await supabase
    .from('brands')
    .select('id, name, slug, timezone')
    .eq('status', 'active');

  const details: ReconciliationResult['details'] = [];

  for (const brand of brands ?? []) {
    if (!(await jobEnabledForBrand(brand.id, 'autopilot', supabase))) continue;
    const { divergent } = await checkScheduleDivergence(supabase, brand.id);

    if (divergent.length === 0) continue;

    let fixed = 0;
    let failed = 0;

    for (const d of divergent) {
      if (d.zernioStatus === 'published' || d.zernioStatus === 'sent') {
        // Case 1: Zernio already published → align DB to reality
        const publishedAt = new Date().toISOString();
        const { error } = await supabase.from('posts')
          .update({
            status: 'published',
            scheduled_for: d.zernioTime,
            published_url: d.zernioUrl,
            published_at: publishedAt
          })
          .eq('id', d.postId);
        if (error) {
          failed++;
        } else {
          // Same stamp on the visual-meta snapshot, else the learning loop never sees this post.
          await stampVisualMetaPublished(supabase, d.postId, publishedAt);
          // Also align publish_logs
          await supabase.from('publish_logs')
            .update({ status: 'published' })
            .eq('post_id', d.postId)
            .eq('status', 'scheduled');
          fixed++;
        }
      } else {
        // Case 2: Both future, different times → fix Zernio to match DB
        const r = await reschedulePost(supabase, d.postId, d.dbTime, brand.timezone ?? 'Europe/Rome');
        if (r.success) {
          fixed++;
        } else {
          // Case 3: Fix impossible → mark needs_attention
          await supabase.from('posts')
            .update({
              needs_attention: true,
              attention_reason: `Zernio schedule diverges: ${d.zernioTime} (DB says ${d.dbTime}). Manual review needed.`
            })
            .eq('id', d.postId);
          failed++;
        }
      }
    }

    details.push({ brand: brand.slug, divergent, fixed, failed });
  }

  return {
    checked: brands?.length ?? 0,
    brandsWithDivergence: details.length,
    details
  };
}
