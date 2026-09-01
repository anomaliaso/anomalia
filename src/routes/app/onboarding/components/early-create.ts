import { deserialize } from '$app/forms';
import type { ActionResult } from '@sveltejs/kit';
import type { GuestPost } from '$lib/guest-onboarding';

export type EarlyCreateSnapshot = {
  profile: unknown;
  url: string;
  creatorNiche: string;
  selectedPlatforms: string[];
  handleList: { platform: string; username: string | null; profileUrl: string | null }[];
  brandId: string | null;
  draftId: string | null;
  /** The post the visitor was shown before signing up, to adopt rather than regenerate. */
  guestPost?: GuestPost | null;
};

// FormData dallo stato vivo: i valori DOM di un form nascosto restano stantii per un tick
// dopo che analyze() ha scritto profile/brandName.
export function earlyCreateFormData(s: EarlyCreateSnapshot, name: string): FormData {
  const fd = new FormData();
  if (s.draftId) fd.set('draft_id', s.draftId);
  if (s.brandId) fd.set('brand_id', s.brandId);
  fd.set('name', name);
  fd.set('website', s.url);
  if (s.profile) fd.set('profile', JSON.stringify(s.profile));
  else if (s.creatorNiche.trim()) {
    fd.set('profile', JSON.stringify({ name, about: s.creatorNiche.trim(), url: s.url || '' }));
  }
  fd.set('platforms', JSON.stringify(s.selectedPlatforms));
  fd.set('handles', JSON.stringify(s.handleList));
  if (s.guestPost) fd.set('guest_post', JSON.stringify(s.guestPost));
  return fd;
}

export function resolveEarlyBrandName(
  brandName: string,
  profile: { name?: string } | null | undefined,
  url: string
): string {
  let name = brandName.trim() || String(profile?.name ?? '').trim();
  if (!name && url.trim()) {
    try {
      name = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '');
    } catch {
      name = '';
    }
  }
  return name;
}

export async function submitEarlyCreate(fd: FormData): Promise<{ result: ActionResult; status: number }> {
  const res = await fetch('?/create', {
    method: 'POST',
    body: fd,
    headers: { accept: 'application/json', 'x-sveltekit-action': 'true' }
  });
  const result = deserialize(await res.text()) as ActionResult;
  return { result, status: res.status };
}
