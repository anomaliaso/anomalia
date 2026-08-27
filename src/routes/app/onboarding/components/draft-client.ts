export async function postDraft(body: string): Promise<{ id?: string; status: number } | null> {
  try {
    const res = await fetch('/app/onboarding/draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body
    });
    if (res.ok) {
      const { id } = (await res.json()) as { id?: string };
      return { id, status: res.status };
    }
    return { status: res.status };
  } catch {
    return null;
  }
}
