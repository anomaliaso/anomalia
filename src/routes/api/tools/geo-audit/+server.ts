import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { auditSiteTech } from '$lib/server/geo';
import { guardTool } from '$lib/server/tool-guard';

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  const guard = await guardTool('geo-audit', getClientAddress());
  if (!guard.ok) return guard.response;
  try {
    const { url } = await request.json();

    if (!url || typeof url !== 'string') {
      return json({ error: 'URL is required' }, { status: 400 });
    }

    // Normalize URL
    let normalizedUrl = url.trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = `https://${normalizedUrl}`;
    }

    // Validate URL format
    try {
      new URL(normalizedUrl);
    } catch {
      return json({ error: 'Invalid URL format' }, { status: 400 });
    }

    const audit = await auditSiteTech(normalizedUrl);

    if (!audit) {
      return json({ error: 'Could not reach the website. Please check the URL and try again.' }, { status: 422 });
    }

    return json({ success: true, audit });
  } catch (err) {
    console.error('[geo-audit-api]', err);
    return json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
};
