import type { SupabaseClient } from '@supabase/supabase-js';

export type BrandPlanDocument = {
  id: string;
  title: string;
  markdown: string;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function loadBrandPlanDocument(
  supabase: SupabaseClient,
  brandId: string,
  planId: string
): Promise<BrandPlanDocument | null> {
  const { data: plan } = await supabase
    .from('brand_documents')
    .select('id, title, markdown, content_text, summary, status, created_at, updated_at')
    .eq('id', planId)
    .eq('brand_id', brandId)
    .eq('kind', 'plan')
    .maybeSingle();

  if (!plan) return null;

  return {
    id: plan.id as string,
    title: (plan.title as string) ?? '',
    markdown: ((plan.markdown ?? plan.content_text) as string) ?? '',
    summary: (plan.summary as string | null) ?? null,
    createdAt: plan.created_at as string,
    updatedAt: plan.updated_at as string
  };
}
