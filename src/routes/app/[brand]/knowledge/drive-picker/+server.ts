import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { kickSourceWork, knowledgeConnectorsEnabled, saveDriveSelection } from '$lib/server/knowledge-sources';
import { driveFileFormValue, type DriveFileOption } from '$lib/drive-folders';

function pickerConfig(): { apiKey: string; appId: string } {
  const apiKey = (env.GOOGLE_PICKER_API_KEY || publicEnv.PUBLIC_GOOGLE_PICKER_API_KEY || '').trim();
  const appId = (env.GOOGLE_PICKER_APP_ID || publicEnv.PUBLIC_GOOGLE_PICKER_APP_ID || '').trim();
  return { apiKey, appId };
}

function parseFiles(raw: unknown): DriveFileOption[] {
  if (!Array.isArray(raw)) return [];
  const out: DriveFileOption[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const id = String(o.id ?? '').trim();
    const name = String(o.name ?? '').trim() || id;
    const mimeType = String(o.mimeType ?? o.mime_type ?? '').trim() || 'application/octet-stream';
    if (!id) continue;
    out.push({ id, name, mimeType });
  }
  return out;
}

export const GET: RequestHandler = async ({ params, locals }) => {
  if (!knowledgeConnectorsEnabled()) {
    return json({ error: 'Knowledge connectors are not configured' }, { status: 503 });
  }
  const { apiKey, appId } = pickerConfig();
  if (!apiKey || !appId) {
    return json(
      {
        error: 'picker_unconfigured',
        message:
          'Google Picker is not configured. Set GOOGLE_PICKER_API_KEY and GOOGLE_PICKER_APP_ID.'
      },
      { status: 503 }
    );
  }
  const { supabase, safeGetSession } = locals;
  const { user } = await safeGetSession();
  if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
  const { data: brand } = await supabase.from('brands').select('id').eq('slug', params.brand).maybeSingle();
  if (!brand) return json({ error: 'Brand not found' }, { status: 404 });
  const { data: source } = await supabase
    .from('brand_knowledge_sources')
    .select('connected_account_id')
    .eq('brand_id', brand.id)
    .eq('provider', 'google-drive')
    .neq('status', 'disconnected')
    .maybeSingle();
  if (!String(source?.connected_account_id ?? '').trim()) {
    return json({ error: 'not_connected', message: 'Connect Google Drive first.' }, { status: 400 });
  }
  // Google Picker runs in the browser and needs a real OAuth access token. Composio brokers the
  // connection and never hands the token out, so the picker cannot be driven from a Composio
  // connection — the folder list below (served through the proxy) is the supported path.
  return json(
    {
      error: 'picker_unavailable',
      message:
        'The Google Picker is unavailable with the current connector setup. Pick Drive folders from the list in Settings → Connectors instead.'
    },
    { status: 503 }
  );
};

export const POST: RequestHandler = async ({ params, locals, request, url }) => {
  if (!knowledgeConnectorsEnabled()) {
    return json({ error: 'Knowledge connectors are not configured' }, { status: 503 });
  }
  const { supabase, safeGetSession } = locals;
  const { user } = await safeGetSession();
  if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
  const { data: brand } = await supabase.from('brands').select('id').eq('slug', params.brand).maybeSingle();
  if (!brand) return json({ error: 'Brand not found' }, { status: 404 });
  let body: { files?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const files = parseFiles(body.files);
  try {
    const saved = await saveDriveSelection(
      supabase,
      brand.id,
      files.map((f) => driveFileFormValue(f))
    );
    void kickSourceWork(url.origin);
    return json({ ok: true, files: saved.files, folders: saved.folders });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
};
