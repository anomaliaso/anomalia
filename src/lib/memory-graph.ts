/** Client-safe memory correlation graph (no server imports). */

export type MemoryGraphNode = {
  id: string;
  key: string;
  value: string;
  category: string;
  source: string;
  confidence: number;
  times_used: number;
  times_reinforced: number;
};

export type MemoryGraphEdge = {
  sourceId: string;
  targetId: string;
  weight: number;
  reason: 'category' | 'tokens';
};

const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are',
  'be', 'as', 'at', 'by', 'from', 'that', 'this', 'it', 'its', 'we', 'our', 'you',
  'your', 'their', 'brand', 'always', 'never', 'should', 'must', 'will', 'can'
]);

function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9àèéìòù_]+/i)) {
    const t = raw.trim();
    if (t.length < 3 || STOP.has(t)) continue;
    out.add(t);
  }
  return out;
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

/**
 * Build a lightweight dependency/correlation graph:
 * - every pair in the same category gets a soft edge
 * - pairs that share meaningful tokens in key+value get a stronger edge
 */
export function buildMemoryGraph(entries: MemoryGraphNode[]): {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
} {
  const nodes = entries.slice(0, 80); // keep the viz readable
  const edges: MemoryGraphEdge[] = [];
  const seen = new Set<string>();

  const tokById = new Map(nodes.map((n) => [n.id, tokens(`${n.key} ${n.value}`)]));

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      let weight = 0;
      let reason: MemoryGraphEdge['reason'] | null = null;

      const shared = overlap(tokById.get(a.id)!, tokById.get(b.id)!);
      if (shared >= 2) {
        weight = Math.min(5, shared);
        reason = 'tokens';
      } else if (a.category === b.category) {
        weight = 1;
        reason = 'category';
      }

      if (!reason || weight <= 0) continue;
      const key = `${a.id}:${b.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ sourceId: a.id, targetId: b.id, weight, reason });
    }
  }

  return { nodes, edges };
}

/** Deterministic radial layout clustered by category. */
export function layoutMemoryGraph(
  nodes: MemoryGraphNode[],
  width: number,
  height: number
): Map<string, { x: number; y: number }> {
  const cx = width / 2;
  const cy = height / 2;
  const byCat = new Map<string, MemoryGraphNode[]>();
  for (const n of nodes) {
    const list = byCat.get(n.category) ?? [];
    list.push(n);
    byCat.set(n.category, list);
  }

  const cats = [...byCat.keys()].sort();
  const pos = new Map<string, { x: number; y: number }>();
  const ringR = Math.min(width, height) * 0.32;

  cats.forEach((cat, ci) => {
    const angle = (ci / Math.max(cats.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const hubX = cx + Math.cos(angle) * ringR;
    const hubY = cy + Math.sin(angle) * ringR;
    const group = byCat.get(cat) ?? [];
    const localR = 28 + Math.min(70, group.length * 10);

    group.forEach((n, ni) => {
      const a = angle + ((ni - (group.length - 1) / 2) * 0.35) / Math.max(group.length, 1);
      const r = group.length === 1 ? 0 : localR;
      pos.set(n.id, {
        x: hubX + Math.cos(a) * r,
        y: hubY + Math.sin(a) * r
      });
    });
  });

  return pos;
}
