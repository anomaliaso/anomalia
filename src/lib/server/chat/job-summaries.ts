/**
 * Human-readable summaries for completed async chat tool jobs.
 * Italian when the chat locale is Italian; English otherwise — never the reverse.
 * Kept separate from the runner so we can unit-test without standing up a server.
 */
import { bilingualNoticeLocale } from '$lib/i18n/locale';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

export function buildToolJobSummary(toolName: string, result: AnyRec, locale: string = 'en'): string {
  if (result.error) return `❌ ${toolName} failed: ${result.error}`;
  const en = bilingualNoticeLocale(locale) === 'en';

  switch (toolName) {
    case 'generate_strategy': {
      const phases = (result.phases ?? []) as AnyRec[];
      const list = phases.map((p, i) => `${i + 1}. **${p.name}** — ${p.objective ?? ''}`).join('\n');
      return en
        ? `✅ **Strategy is live!**\n\nObjective: ${result.objective ?? '—'}\n\nPhases:\n${list}\n\nNext: the editorial plan.`
        : `✅ **Strategia attiva!**\n\nObiettivo: ${result.objective ?? '—'}\n\nFasi:\n${list}\n\nProcedo con il piano editoriale.`;
    }

    case 'generate_editorial_plan': {
      const weeks = (result.weeks ?? []) as AnyRec[];
      const list = weeks.map((w, i) => `${i + 1}. **${w.theme ?? (en ? 'Week' : 'Settimana')}** — ${w.focus ?? ''}`).join('\n');
      return en
        ? `✅ **Editorial plan is live!**\n\nCadence: ${JSON.stringify(result.cadence ?? {})}\n\nWeeks:\n${list}\n\nThen: Web hub teaser (SEO/GEO/blog) — why organic traffic compounds, 1 credible stat (e.g. ~50–60% of site traffic from organic / clicks concentrated on page 1), paid plan if locked (Go when offered / Starter / Pro; do not mention Go if hidden) + offer_upgrade — then immediately photos/video + week-1 drafts. Do not wait for the upgrade.`
        : `✅ **Piano editoriale attivo!**\n\nCadenza: ${JSON.stringify(result.cadence ?? {})}\n\nSettimane:\n${list}\n\nPoi: teaser Web hub (SEO/GEO/blog) — perché il traffico organico conta, 1 dato credibile (es. ~50–60% del traffico sito da organic / click concentrati in page 1), piano a pagamento se locked (Go se offerto / Starter / Pro; non menzionare Go se nascosto) + offer_upgrade — e subito dopo foto/video + bozze settimana 1. Non aspettare l'upgrade.`;
    }

    case 'generate_content':
    case 'produce_week': {
      const posts = (result.posts ?? []) as AnyRec[];
      const list = posts
        .map((p) => `${p.n}. [${p.platform ?? '?'} / ${p.pillar ?? p.format ?? '?'}] ${p.idea ?? ''}`)
        .join('\n');
      const imgBit =
        typeof result.images === 'number'
          ? en
            ? ` (${result.images} with image)`
            : ` (${result.images} con immagine)`
          : '';
      return en
        ? `✅ **Week ${(result.week ?? 0) + 1} is ready!**\n\n${result.count ?? 0} drafts in Content${imgBit}:\n${list}\n\nReview them in Content — captions and images are already generated; nothing is published yet.`
        : `✅ **Settimana ${(result.week ?? 0) + 1} pronta!**\n\n${result.count ?? 0} bozze in Contenuti${imgBit}:\n${list}\n\nRivedile in Contenuti — caption e immagini sono già generate; niente è pubblicato ancora.`;
    }

    case 'create_campaign':
      return en
        ? `✅ **Campaign "${result.campaign_name}" created!**\n\n${result.count}/${result.requested} posts ready on ${result.platform}.\nOpen Campaigns or Content to review them.`
        : `✅ **Campagna "${result.campaign_name}" creata!**\n\n${result.count}/${result.requested} post pronti su ${result.platform}.\nApri Campagne o Contenuti per rivederli.`;

    case 'discover_competitors':
      return en
        ? `✅ **Competitor analysis complete!**\n\nFound **${result.competitors_found} competitors**:\n${result.competitors?.map((c: AnyRec) => `- ${c.name} (${c.kind})`).join('\n') ?? ''}\n\nBrand posts: ${result.benchmark?.brand_posts ?? 0}, market median engagement: ${result.benchmark?.market_median_engagement ?? 0}`
        : `✅ **Analisi competitor completata!**\n\nTrovati **${result.competitors_found} competitor**:\n${result.competitors?.map((c: AnyRec) => `- ${c.name} (${c.kind})`).join('\n') ?? ''}\n\nPost brand: ${result.benchmark?.brand_posts ?? 0}, Engagement mediano mercato: ${result.benchmark?.market_median_engagement ?? 0}`;

    case 'reanalyze_brand':
      return en
        ? `✅ **Brand re-analysis complete!**\n\nName: ${result.name}\nCategory: ${result.category}\nProducts found: ${result.products_found}\nSite type: ${result.site_type}`
        : `✅ **Ri-analisi brand completata!**\n\nNome: ${result.name}\nCategoria: ${result.category}\nProdotti trovati: ${result.products_found}\nTipo sito: ${result.site_type}`;

    case 'sync_social_history':
      return en
        ? `✅ **Social sync complete!**\n\nProfiles synced: ${result.profiles_synced}\nPosts synced: ${result.posts_synced}${result.errors?.length ? `\nErrors: ${result.errors.length}` : ''}`
        : `✅ **Sincronizzazione social completata!**\n\nProfili sincronizzati: ${result.profiles_synced}\nPost sincronizzati: ${result.posts_synced}${result.errors?.length ? `\nErrori: ${result.errors.length}` : ''}`;

    case 'generate_person':
      return en
        ? `✅ **Persona created!**\n\nName: ${result.name}\nType: ${result.kind === 'ai' ? 'AI avatar' : 'Real photo'}\nImages: ${result.images_count}`
        : `✅ **Persona creata!**\n\nNome: ${result.name}\nTipo: ${result.kind === 'ai' ? 'Avatar AI' : 'Foto reale'}\nImmagini: ${result.images_count}`;

    case 'sync_products':
      return en
        ? `✅ **Product sync complete!**\n\nPlatform: ${result.platform}\nProducts synced: ${result.products_synced}`
        : `✅ **Sincronizzazione prodotti completata!**\n\nPiattaforma: ${result.platform}\nProdotti sincronizzati: ${result.products_synced}`;

    case 'seo_geo_audit':
      return en
        ? `✅ **SEO & GEO audit complete!**\n\nTechnical score: ${result.tech_score ?? 'n/a'}/100\nIssues found: ${result.issues}\nAI share of voice: ${result.share_of_voice}%\nQuestions where the brand is absent from AI answers: ${result.gaps}`
        : `✅ **Audit SEO & GEO completato!**\n\nPunteggio tecnico: ${result.tech_score ?? 'n/a'}/100\nProblemi rilevati: ${result.issues}\nShare-of-voice AI: ${result.share_of_voice}%\nDomande dove il brand è assente dalle risposte AI: ${result.gaps}`;

    case 'seo_plan':
      return en
        ? `✅ **SEO plan generated!**\n\nGrade: ${result.grade}\nRecommended initiatives: ${result.initiatives}`
        : `✅ **Piano SEO generato!**\n\nValutazione: ${result.grade}\nIniziative consigliate: ${result.initiatives}`;

    case 'seo_add_initiatives':
      return en
        ? `✅ **Added ${result.added} new SEO initiatives:**\n${(result.titles ?? []).map((t: string) => `- ${t}`).join('\n')}`
        : `✅ **Aggiunte ${result.added} nuove iniziative SEO:**\n${(result.titles ?? []).map((t: string) => `- ${t}`).join('\n')}`;

    case 'motion_video_qc': {
      // La QC fuori banda di un motion video (vedi output-tools.ts): il rientro deve dire il
      // VERDETTO e se il remake è partito, non un JSON — è quello che l'utente aspetta al posto
      // del vecchio silenzio.
      const craft = result.craft as AnyRec | null | undefined;
      const ads = result.review as AnyRec | null | undefined;
      const verdict = String(craft?.verdict ?? ads?.verdict ?? (en ? 'no verdict' : 'senza verdetto'));
      const lines = en
        ? [
            `Craft verdict: **${verdict}**${craft?.overall != null ? ` (${craft.overall}/10)` : ''}`,
            craft?.judgment ? String(craft.judgment) : '',
            result.applied
              ? `The defect (${result.rewrite_from ?? 'craft'}) was FIXED in the source: the video needs to be re-rendered to deliver the right version.`
              : verdict === 'ship'
                ? 'The video is verified and ready to ship.'
                : result.note
                  ? `No correction applied: ${result.note}.`
                  : ''
          ]
        : [
            `Verdetto craft: **${verdict}**${craft?.overall != null ? ` (${craft.overall}/10)` : ''}`,
            craft?.judgment ? String(craft.judgment) : '',
            result.applied
              ? `Il difetto (${result.rewrite_from ?? 'craft'}) è stato CORRETTO nel sorgente: il video va ri-renderizzato per consegnare la versione giusta.`
              : verdict === 'ship'
                ? 'Il video è verificato e consegnabile.'
                : result.note
                  ? `Nessuna correzione applicata: ${result.note}.`
                  : ''
          ];
      return en
        ? `✅ **Motion video check complete**\n\n${lines.filter(Boolean).join('\n')}`
        : `✅ **Verifica motion video completata**\n\n${lines.filter(Boolean).join('\n')}`;
    }

    case 'subagent_run': {
      // La run di un sub-agent (delegate_task / pipeline / parallel) rientra col RAPPORTO, non con
      // un JSON: è quello che l'orchestratore del turno di rientro deve leggere per agire.
      const en2 = en;
      const kind = String(result.kind ?? 'single');
      if (kind === 'pipeline') {
        const verdict = String(result.verdict ?? 'unknown');
        const phases = (result.phases ?? []) as AnyRec[];
        const list = phases
          .map((p) => `- [${p.role}] ${p.title}: ${p.error ? `ERROR — ${p.error}` : String(p.report ?? '').slice(0, 400)}`)
          .join('\n');
        return en2
          ? `✅ **Sub-agent pipeline finished** — verdict: **${verdict}**${result.repaired ? ' (one repair round ran)' : ''}\n${list}`
          : `✅ **Pipeline di sub-agent finita** — verdetto: **${verdict}**${result.repaired ? ' (girato un giro di riparazione)' : ''}\n${list}`;
      }
      if (kind === 'parallel') {
        const tasks = (result.tasks ?? []) as AnyRec[];
        const list = tasks
          .map((t) => `- ${t.title}: ${t.error ? `ERROR — ${t.error}` : String(t.report ?? '').slice(0, 400)}`)
          .join('\n');
        return en2
          ? `✅ **Parallel sub-agents finished** (${result.failed ?? 0} of ${tasks.length} failed)\n${list}`
          : `✅ **Sub-agent in parallelo finiti** (${result.failed ?? 0} su ${tasks.length} falliti)\n${list}`;
      }
      const report = String(result.report ?? '');
      const verdictBit = result.verdict ? ` — verdict: **${result.verdict}**` : '';
      return en2
        ? `✅ **Sub-agent "${result.title ?? ''}" finished** (${result.role ?? ''})${verdictBit}\n\n${report}`
        : `✅ **Sub-agent "${result.title ?? ''}" finito** (${result.role ?? ''})${verdictBit}\n\n${report}`;
    }

    default:
      return en
        ? `✅ ${toolName} complete: ${JSON.stringify(result)}`
        : `✅ ${toolName} completato: ${JSON.stringify(result)}`;
  }
}
