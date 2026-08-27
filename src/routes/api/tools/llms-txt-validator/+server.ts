import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { guardTool, safeFetchUrl } from '$lib/server/tool-guard';

async function safeFetch(url: string): Promise<string> {
  try {
    const res = await safeFetchUrl(url, { timeoutMs: 10000 });
    return res.ok ? res.body : '';
  } catch {
    return '';
  }
}

function isLlmsTxt(body: string): boolean {
  const t = body.trim();
  if (!t) return false;
  if (/^\s*<(!doctype|html|head|body)\b/i.test(t)) return false;
  return /^#\s+\S/m.test(t) || /\[[^\]]+\]\([^)]+\)/.test(t);
}

function validateContent(content: string): { valid: boolean; issues: string[]; suggestions: string[] } {
  const issues: string[] = [];
  const suggestions: string[] = [];

  if (!content.trim()) {
    issues.push('File is empty');
    return { valid: false, issues, suggestions };
  }

  if (/^\s*<(!doctype|html|head|body)\b/i.test(content)) {
    issues.push('File contains HTML instead of markdown — AI engines expect plain markdown text');
    return { valid: false, issues, suggestions };
  }

  const hasHeading = /^#\s+\S/m.test(content);
  const hasLinks = /\[[^\]]+\]\([^)]+\)/.test(content);

  if (!hasHeading) {
    issues.push('No H1 heading found — llms.txt should start with a # heading naming the site');
  }
  if (!hasLinks) {
    issues.push('No markdown links found — llms.txt should contain links to important pages');
  }

  if (hasHeading && hasLinks) {
    const links = content.match(/\[[^\]]+\]\([^)]+\)/g) ?? [];
    if (links.length < 3) {
      suggestions.push('Consider adding more links to important pages (aim for 5-15)');
    }
    if (!content.toLowerCase().includes('##')) {
      suggestions.push('Consider organizing links under ## section headings for clarity');
    }
    if (content.length < 100) {
      suggestions.push('Content is very brief — consider adding a description and more pages');
    }
  }

  return { valid: hasHeading && hasLinks && issues.length === 0, issues, suggestions };
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  const guard = await guardTool('llms-txt-validator', getClientAddress());
  if (!guard.ok) return guard.response;
  try {
    const { url } = await request.json();

    if (!url || typeof url !== 'string') {
      return json({ error: 'URL is required' }, { status: 400 });
    }

    let origin: string;
    try {
      const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
      origin = parsed.origin;
    } catch {
      return json({ error: 'Invalid URL format' }, { status: 400 });
    }

    const content = await safeFetch(`${origin}/llms.txt`);

    if (!content) {
      return json({
        success: true,
        valid: false,
        exists: false,
        issues: ['No llms.txt file found at the site root'],
        suggestions: [
          'Create an llms.txt file at yourdomain.com/llms.txt',
          'Use our llms.txt Generator tool to create one in seconds'
        ],
        content: null
      });
    }

    const exists = isLlmsTxt(content);
    const validation = validateContent(content);

    return json({
      success: true,
      valid: validation.valid,
      exists,
      issues: validation.issues,
      suggestions: validation.suggestions,
      content: exists ? content : null
    });
  } catch (err) {
    console.error('[llms-txt-validator]', err);
    return json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
};
