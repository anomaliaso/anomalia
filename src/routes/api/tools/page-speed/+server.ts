import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { guardTool } from '$lib/server/tool-guard';
import { fetchPageSpeed, pagespeedConfigured, type Verdict } from '$lib/server/pagespeed';
import type { Issue } from '$lib/server/seo-tools';

// PSI takes 10-30s on a heavy page — the whole point of the tool is heavy pages.
// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~60s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 60 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

const LABEL: Record<string, string> = {
  LCP: 'Largest Contentful Paint',
  INP: 'Interaction to Next Paint',
  CLS: 'Cumulative Layout Shift',
  FCP: 'First Contentful Paint',
  TTFB: 'Time to First Byte'
};

// Only the three Core Web Vitals are ranking factors; the rest are diagnostics.
const CORE = ['LCP', 'INP', 'CLS'];

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  const body = await request.json().catch(() => ({}));
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  const strategy = body?.strategy === 'desktop' ? 'desktop' : 'mobile';
  if (!url) return json({ error: 'A page URL is required' }, { status: 400 });
  if (!pagespeedConfigured()) return json({ error: 'Speed data is temporarily unavailable.' }, { status: 503 });

  const guard = await guardTool('page-speed', getClientAddress());
  if (!guard.ok) return guard.response;

  const report = await fetchPageSpeed(/^https?:\/\//i.test(url) ? url : `https://${url}`, strategy);
  if (!report) return json({ error: 'Could not measure that page. Check the URL is public and try again.' }, { status: 422 });

  const issues: Issue[] = [];
  const sev = (v: Verdict) => (v === 'poor' ? 'high' : 'medium') as Issue['severity'];

  // Field data is what Google actually ranks on, so it drives the findings when present.
  const source = report.field?.metrics ?? report.lab;
  for (const m of source.filter((x) => CORE.includes(x.id) && (x.verdict === 'poor' || x.verdict === 'needs-improvement'))) {
    issues.push({
      severity: sev(m.verdict),
      title: `${LABEL[m.id] ?? m.id} is ${m.verdict === 'poor' ? 'poor' : 'below target'} (${m.display})`,
      detail:
        m.id === 'CLS'
          ? 'Content shifting under the reader as the page loads. Reserve space for images, ads and embeds with explicit width/height.'
          : m.id === 'INP'
            ? 'The page is slow to respond after a tap or click. Usually long JavaScript tasks blocking the main thread.'
            : 'The main content takes too long to appear. Usually a large hero image, a slow server response, or render-blocking resources.'
    });
  }

  if (!report.field) {
    issues.push({
      severity: 'low',
      title: 'No real-user data yet',
      detail: 'This origin has too little Chrome traffic to appear in the Chrome UX Report, so only the lab test is shown. Lab results are a simulation, not what your visitors experience.'
    });
  }

  return json({ success: true, result: { ...report, labels: LABEL, issues } });
};
