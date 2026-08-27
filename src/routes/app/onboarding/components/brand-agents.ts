export type BrandAgent = { id: string; name: string; face: string; color: string };

// null = risposta non valida: il chiamante non tocca lo stato precedente.
export async function fetchCustomAgents(slug: string): Promise<BrandAgent[] | null> {
  const res = await fetch(`/app/${slug}/chat/agents`);
  if (!res.ok) return null;
  const d = await res.json();
  const list = d?.agents;
  if (!Array.isArray(list)) return null;
  return list.map((a: Record<string, unknown>) => ({
    id: String(a.id),
    name: String(a.name ?? 'Agent'),
    face: String(a.face ?? ''),
    color: String(a.color ?? '')
  }));
}
