/**
 * Human-readable Italian summaries for completed async chat tool jobs.
 * Kept separate from the runner so we can unit-test without standing up a server.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

export function buildToolJobSummary(toolName: string, result: AnyRec): string {
  if (result.error) return `❌ ${toolName} failed: ${result.error}`;

  switch (toolName) {
    case 'generate_strategy': {
      const phases = (result.phases ?? []) as AnyRec[];
      const list = phases.map((p, i) => `${i + 1}. **${p.name}** — ${p.objective ?? ''}`).join('\n');
      return `✅ **Strategia attiva!**\n\nObiettivo: ${result.objective ?? '—'}\n\nFasi:\n${list}\n\nProcedo con il piano editoriale.`;
    }

    case 'generate_editorial_plan': {
      const weeks = (result.weeks ?? []) as AnyRec[];
      const list = weeks.map((w, i) => `${i + 1}. **${w.theme ?? 'Settimana'}** — ${w.focus ?? ''}`).join('\n');
      return `✅ **Piano editoriale attivo!**\n\nCadenza: ${JSON.stringify(result.cadence ?? {})}\n\nSettimane:\n${list}\n\nPoi: teaser Web hub (SEO/GEO/blog) — perché il traffico organico conta, 1 dato credibile (es. ~50–60% del traffico sito da organic / click concentrati in page 1), piano a pagamento se locked (Go se offerto / Starter / Pro; non menzionare Go se nascosto) + offer_upgrade — e subito dopo foto/video + bozze settimana 1. Non aspettare l'upgrade.`;
    }

    case 'generate_content':
    case 'produce_week': {
      const posts = (result.posts ?? []) as AnyRec[];
      const list = posts
        .map((p) => `${p.n}. [${p.platform ?? '?'} / ${p.pillar ?? p.format ?? '?'}] ${p.idea ?? ''}`)
        .join('\n');
      const imgBit =
        typeof result.images === 'number' ? ` (${result.images} con immagine)` : '';
      return `✅ **Settimana ${(result.week ?? 0) + 1} pronta!**\n\n${result.count ?? 0} bozze in Contenuti${imgBit}:\n${list}\n\nRivedile in Contenuti — caption e immagini sono già generate; niente è pubblicato ancora.`;
    }

    case 'create_campaign':
      return `✅ **Campagna "${result.campaign_name}" creata!**\n\n${result.count}/${result.requested} post pronti su ${result.platform}.\nApri Campagne o Contenuti per rivederli.`;

    case 'discover_competitors':
      return `✅ **Analisi competitor completata!**\n\nTrovati **${result.competitors_found} competitor**:\n${result.competitors?.map((c: AnyRec) => `- ${c.name} (${c.kind})`).join('\n') ?? ''}\n\nPost brand: ${result.benchmark?.brand_posts ?? 0}, Engagement mediano mercato: ${result.benchmark?.market_median_engagement ?? 0}`;

    case 'reanalyze_brand':
      return `✅ **Ri-analisi brand completata!**\n\nNome: ${result.name}\nCategoria: ${result.category}\nProdotti trovati: ${result.products_found}\nTipo sito: ${result.site_type}`;

    case 'sync_social_history':
      return `✅ **Sincronizzazione social completata!**\n\nProfili sincronizzati: ${result.profiles_synced}\nPost sincronizzati: ${result.posts_synced}${result.errors?.length ? `\nErrori: ${result.errors.length}` : ''}`;

    case 'generate_person':
      return `✅ **Persona creata!**\n\nNome: ${result.name}\nTipo: ${result.kind === 'ai' ? 'Avatar AI' : 'Foto reale'}\nImmagini: ${result.images_count}`;

    case 'sync_products':
      return `✅ **Sincronizzazione prodotti completata!**\n\nPiattaforma: ${result.platform}\nProdotti sincronizzati: ${result.products_synced}`;

    case 'seo_geo_audit':
      return `✅ **Audit SEO & GEO completato!**\n\nPunteggio tecnico: ${result.tech_score ?? 'n/a'}/100\nProblemi rilevati: ${result.issues}\nShare-of-voice AI: ${result.share_of_voice}%\nDomande dove il brand è assente dalle risposte AI: ${result.gaps}`;

    case 'seo_plan':
      return `✅ **Piano SEO generato!**\n\nValutazione: ${result.grade}\nIniziative consigliate: ${result.initiatives}`;

    case 'seo_add_initiatives':
      return `✅ **Aggiunte ${result.added} nuove iniziative SEO:**\n${(result.titles ?? []).map((t: string) => `- ${t}`).join('\n')}`;

    case 'motion_video_qc': {
      // La QC fuori banda di un motion video (vedi output-tools.ts): il rientro deve dire il
      // VERDETTO e se il remake è partito, non un JSON — è quello che l'utente aspetta al posto
      // del vecchio silenzio.
      const craft = result.craft as AnyRec | null | undefined;
      const ads = result.review as AnyRec | null | undefined;
      const verdict = String(craft?.verdict ?? ads?.verdict ?? 'senza verdetto');
      const lines = [
        `Verdetto craft: **${verdict}**${craft?.overall != null ? ` (${craft.overall}/10)` : ''}`,
        craft?.judgment ? String(craft.judgment) : '',
        result.applied
          ? `Il difetto (${result.rewrite_from ?? 'craft'}) è stato CORRETTO nel sorgente: il video va ri-renderizzato per consegnare la versione giusta.`
          : verdict === 'ship'
            ? 'Il video è verificato e consegnabile.'
            : result.note
              ? `Nessuna correzione applicata: ${result.note}.`
              : ''
      ].filter(Boolean);
      return `✅ **Verifica motion video completata**\n\n${lines.join('\n')}`;
    }

    default:
      return `✅ ${toolName} completato: ${JSON.stringify(result)}`;
  }
}
