
type L = { en: string; it: string };

export type Comparison = {
  slug: string;
  a: string;
  b: string;
  title: L;
  description: L;
  excerpt: L;
  bestForA: L;
  bestForB: L;
  rows: { feature: L; a: L; b: L }[];
  aPros: L[];
  aCons: L[];
  bPros: L[];
  bCons: L[];
  /** Where both tools still leave a gap that Anomalia fills */
  gap: { title: L; points: L[] };
  anomalia: { title: L; sub: L; points: L[] };
};

export const COMPARISONS: Comparison[] = [
  {
    slug: 'buffer-vs-hootsuite',
    a: 'Buffer',
    b: 'Hootsuite',
    title: {
      en: 'Buffer vs Hootsuite (2026) — which social scheduler wins?',
      it: 'Buffer vs Hootsuite (2026) — quale scheduler social vince?'
    },
    description: {
      en: 'A practical Buffer vs Hootsuite comparison: pricing, AI features, analytics and who each tool is really for — plus why an AI autopilot beats both.',
      it: 'Confronto pratico Buffer vs Hootsuite: prezzi, AI, analytics e a chi serve davvero ciascuno — e perché un autopilot AI batte entrambi.'
    },
    excerpt: {
      en: 'Buffer wins on simplicity and price. Hootsuite wins on enterprise workflows. Neither runs your content loop end to end.',
      it: 'Buffer vince su semplicità e prezzo. Hootsuite vince su workflow enterprise. Nessuno dei due gestisce l’intero ciclo dei contenuti.'
    },
    bestForA: {
      en: 'Solo founders and small teams who want clean scheduling without enterprise bloat.',
      it: 'Founder e team piccoli che vogliono scheduling pulito, senza complessità enterprise.'
    },
    bestForB: {
      en: 'Mid-market teams that need approvals, listening and deeper analytics in one place.',
      it: 'Team mid-market che servono approval, listening e analytics più profondi in un unico posto.'
    },
    rows: [
      {
        feature: { en: 'Starting price', it: 'Prezzo di partenza' },
        a: { en: 'Free tier + ~$6/channel/mo', it: 'Piano free + ~$6/canale/mese' },
        b: { en: 'From ~$99/mo', it: 'Da ~$99/mese' }
      },
      {
        feature: { en: 'AI help', it: 'Aiuto AI' },
        a: { en: 'Caption drafts in-queue', it: 'Bozze caption in coda' },
        b: { en: 'OwlyWriter captions & hashtags', it: 'Caption e hashtag con OwlyWriter' }
      },
      {
        feature: { en: 'Analytics', it: 'Analytics' },
        a: { en: 'Clear basics', it: 'Basi chiare' },
        b: { en: 'Deeper, team-oriented reporting', it: 'Report più profondi, orientati al team' }
      },
      {
        feature: { en: 'Team workflows', it: 'Workflow di team' },
        a: { en: 'Lightweight', it: 'Leggeri' },
        b: { en: 'Approvals & multi-seat ops', it: 'Approval e operazioni multi-seat' }
      },
      {
        feature: { en: 'Content creation', it: 'Creazione contenuti' },
        a: { en: 'You still invent the ideas', it: 'Le idee le inventi ancora tu' },
        b: { en: 'You still invent the ideas', it: 'Le idee le inventi ancora tu' }
      }
    ],
    aPros: [
      { en: 'Genuinely usable free plan', it: 'Piano free davvero utilizzabile' },
      { en: 'Fast, calm UI', it: 'UI veloce e sobria' },
      { en: 'Affordable per-channel pricing', it: 'Prezzo accessibile per canale' }
    ],
    aCons: [
      { en: 'Thin AI beyond captions', it: 'AI sottile oltre le caption' },
      { en: 'No real strategy / calendar brain', it: 'Niente strategia o cervello editoriale' },
      { en: 'You still produce every asset', it: 'Produci ancora tu ogni asset' }
    ],
    bPros: [
      { en: 'Listening + inbox + analytics together', it: 'Listening, inbox e analytics insieme' },
      { en: 'Strong approval workflows', it: 'Workflow di approval solidi' },
      { en: 'Broad integrations', it: 'Tante integrazioni' }
    ],
    bCons: [
      { en: 'Expensive for small teams', it: 'Caro per team piccoli' },
      { en: 'Heavier UI', it: 'UI più pesante' },
      { en: 'Still a scheduler, not an autopilot', it: 'Resta uno scheduler, non un autopilot' }
    ],
    gap: {
      title: {
        en: 'What neither Buffer nor Hootsuite does',
        it: 'Cosa non fanno né Buffer né Hootsuite'
      },
      points: [
        {
          en: 'Build a GTM / editorial plan from your brand, competitors and goals',
          it: 'Costruire un piano GTM / editoriale dal brand, competitor e obiettivi'
        },
        {
          en: 'Generate on-brand visuals and articles, not just captions',
          it: 'Generare visual e articoli on-brand, non solo caption'
        },
        {
          en: 'Run the loop: research → draft → design → schedule → learn',
          it: 'Far girare il ciclo: ricerca → bozza → design → schedule → apprendimento'
        }
      ]
    },
    anomalia: {
      title: {
        en: 'Anomalia is the third option',
        it: 'Anomalia è la terza opzione'
      },
      sub: {
        en: 'Not another queue. An AI that plans, writes, designs and publishes — you approve.',
        it: 'Non un’altra coda. Un’AI che pianifica, scrive, disegna e pubblica — tu approvi.'
      },
      points: [
        {
          en: 'Strategy + social + SEO blog in one autopilot',
          it: 'Strategia + social + blog SEO in un unico autopilot'
        },
        {
          en: 'Learns from your brand kit, products and past posts',
          it: 'Impara da brand kit, prodotti e post passati'
        },
        {
          en: 'You stay in control with one-tap approvals',
          it: 'Restate al comando con approval in un tap'
        }
      ]
    }
  },
  {
    slug: 'buffer-vs-later',
    a: 'Buffer',
    b: 'Later',
    title: {
      en: 'Buffer vs Later (2026) — scheduling vs visual planning',
      it: 'Buffer vs Later (2026) — scheduling vs pianificazione visuale'
    },
    description: {
      en: 'Buffer vs Later compared: who wins for multi-platform posting, Instagram calendars, AI features — and what still missing for real autopilot.',
      it: 'Buffer vs Later a confronto: chi vince su multi-platform, calendari Instagram, AI — e cosa manca ancora per un vero autopilot.'
    },
    excerpt: {
      en: 'Pick Buffer for breadth and simplicity. Pick Later for Instagram/TikTok visual calendars. Pick Anomalia if you want the work done.',
      it: 'Scegli Buffer per ampiezza e semplicità. Later per calendari visuali IG/TikTok. Anomalia se vuoi che il lavoro sia fatto.'
    },
    bestForA: {
      en: 'Teams posting across many networks with a simple queue.',
      it: 'Team che postano su tante reti con una coda semplice.'
    },
    bestForB: {
      en: 'Visual-first brands living on Instagram and TikTok.',
      it: 'Brand visual-first che vivono su Instagram e TikTok.'
    },
    rows: [
      {
        feature: { en: 'Core strength', it: 'Punto di forza' },
        a: { en: 'Clean multi-platform queues', it: 'Code multi-platform pulite' },
        b: { en: 'Drag-and-drop visual calendar', it: 'Calendario visuale drag-and-drop' }
      },
      {
        feature: { en: 'Best platforms', it: 'Piattaforme migliori' },
        a: { en: 'Broad (incl. Threads, Bluesky)', it: 'Ampie (incl. Threads, Bluesky)' },
        b: { en: 'Instagram & TikTok first', it: 'Instagram e TikTok first' }
      },
      {
        feature: { en: 'AI', it: 'AI' },
        a: { en: 'Caption assistant', it: 'Assistente caption' },
        b: { en: 'Hashtags + best time to post', it: 'Hashtag + best time to post' }
      },
      {
        feature: { en: 'Link tools', it: 'Tool link' },
        a: { en: 'Basic', it: 'Base' },
        b: { en: 'Linkin.bio landing page', it: 'Landing Linkin.bio' }
      },
      {
        feature: { en: 'Content production', it: 'Produzione contenuti' },
        a: { en: 'Manual / bring your own', it: 'Manuale / porta i tuoi' },
        b: { en: 'Manual / bring your own', it: 'Manuale / porta i tuoi' }
      }
    ],
    aPros: [
      { en: 'Simple pricing mental model', it: 'Prezzi facili da capire' },
      { en: 'Great for multi-network coverage', it: 'Ottimo per copertura multi-rete' },
      { en: 'Low learning curve', it: 'Curva di apprendimento bassa' }
    ],
    aCons: [
      { en: 'Weaker visual planning grid', it: 'Pianificazione visuale più debole' },
      { en: 'AI doesn’t create campaigns', it: 'L’AI non crea campagne' }
    ],
    bPros: [
      { en: 'Best-in-class IG/TikTok calendar', it: 'Calendario IG/TikTok top di categoria' },
      { en: 'Linkin.bio for profile traffic', it: 'Linkin.bio per traffico dal profilo' }
    ],
    bCons: [
      { en: 'Less ideal as a pure multi-platform HQ', it: 'Meno ideale come HQ multi-platform puro' },
      { en: 'Still expects you to make the content', it: 'Si aspetta ancora che tu faccia i contenuti' }
    ],
    gap: {
      title: {
        en: 'The shared gap',
        it: 'Il gap comune'
      },
      points: [
        {
          en: 'Neither owns brand strategy or competitor research',
          it: 'Nessuno gestisce strategia brand o ricerca competitor'
        },
        {
          en: 'Neither generates full posts + images in your voice',
          it: 'Nessuno genera post + immagini nella tua voce'
        },
        {
          en: 'Neither ships SEO blog articles alongside social',
          it: 'Nessuno pubblica anche articoli blog SEO insieme ai social'
        }
      ]
    },
    anomalia: {
      title: {
        en: 'Why teams switch to Anomalia',
        it: 'Perché i team passano ad Anomalia'
      },
      sub: {
        en: 'Schedulers organize work. Anomalia does the work — then asks you to approve.',
        it: 'Gli scheduler organizzano il lavoro. Anomalia lo fa — poi ti chiede di approvare.'
      },
      points: [
        {
          en: 'Editorial plan + posts + blog from one brand brain',
          it: 'Piano editoriale + post + blog da un unico cervello brand'
        },
        {
          en: 'Visuals generated to match your brand kit',
          it: 'Visual generati sul tuo brand kit'
        },
        {
          en: 'Built for founders who refuse another “content day”',
          it: 'Pensato per founder che non vogliono un altro “content day”'
        }
      ]
    }
  },
  {
    slug: 'later-vs-predis-ai',
    a: 'Later',
    b: 'Predis.ai',
    title: {
      en: 'Later vs Predis.ai (2026) — calendar vs AI creatives',
      it: 'Later vs Predis.ai (2026) — calendario vs creatività AI'
    },
    description: {
      en: 'Later vs Predis.ai: visual scheduling versus AI-generated posts and creatives. See who fits — and when you need a full social autopilot instead.',
      it: 'Later vs Predis.ai: scheduling visuale contro post e creatività AI. Chi conviene — e quando serve invece un autopilot social completo.'
    },
    excerpt: {
      en: 'Later plans the grid. Predis generates the assets. Anomalia connects strategy, creation and publishing.',
      it: 'Later pianifica la griglia. Predis genera gli asset. Anomalia collega strategia, creazione e pubblicazione.'
    },
    bestForA: {
      en: 'Social managers who already have creatives and need a visual calendar.',
      it: 'Social manager che hanno già i creativi e servono un calendario visuale.'
    },
    bestForB: {
      en: 'Ecommerce and creators who need image+caption pairs fast.',
      it: 'Ecommerce e creator che servono coppie immagine+caption in fretta.'
    },
    rows: [
      {
        feature: { en: 'Primary job', it: 'Job primario' },
        a: { en: 'Plan & schedule visuals', it: 'Pianificare e schedulare visual' },
        b: { en: 'Generate creatives + captions', it: 'Generare creativi + caption' }
      },
      {
        feature: { en: 'Output quality focus', it: 'Focus qualità output' },
        a: { en: 'Your uploaded assets', it: 'Gli asset che carichi tu' },
        b: { en: 'AI image/video + copy pairs', it: 'Coppie AI immagine/video + copy' }
      },
      {
        feature: { en: 'Strategy depth', it: 'Profondità strategica' },
        a: { en: 'Light (best times, hashtags)', it: 'Leggera (best time, hashtag)' },
        b: { en: 'Prompt/brief driven', it: 'Guidata da prompt/brief' }
      },
      {
        feature: { en: 'Publishing', it: 'Pubblicazione' },
        a: { en: 'Strong native scheduling', it: 'Scheduling nativo forte' },
        b: { en: 'Scheduler attached to generation', it: 'Scheduler agganciato alla generazione' }
      }
    ],
    aPros: [
      { en: 'Excellent visual planning UX', it: 'UX di pianificazione visuale eccellente' },
      { en: 'Linkin.bio for conversion', it: 'Linkin.bio per la conversione' }
    ],
    aCons: [
      { en: 'Doesn’t invent the creative system', it: 'Non inventa il sistema creativo' },
      { en: 'Weak on long-form / SEO', it: 'Debole su long-form / SEO' }
    ],
    bPros: [
      { en: 'Fast volume of on-feed creatives', it: 'Volume rapido di creativi da feed' },
      { en: 'Image and caption arrive together', it: 'Immagine e caption arrivano insieme' }
    ],
    bCons: [
      { en: 'Brand consistency needs heavy review', it: 'La coerenza brand richiede tanta review' },
      { en: 'Not a full GTM / editorial system', it: 'Non è un sistema GTM / editoriale completo' }
    ],
    gap: {
      title: {
        en: 'Both still leave strategy on your desk',
        it: 'Entrambi lasciano la strategia sulla tua scrivania'
      },
      points: [
        {
          en: 'No competitor benchmarking loop',
          it: 'Niente loop di benchmark competitor'
        },
        {
          en: 'No persistent brand memory across weeks',
          it: 'Niente memoria di brand persistente nelle settimane'
        },
        {
          en: 'No SEO blog + social operating as one channel mix',
          it: 'Niente blog SEO + social come un unico mix di canali'
        }
      ]
    },
    anomalia: {
      title: {
        en: 'Anomalia bridges calendar and generation',
        it: 'Anomalia unisce calendario e generazione'
      },
      sub: {
        en: 'One agent that researches, plans, creates and ships — social and blog — in your brand voice.',
        it: 'Un agente che ricerca, pianifica, crea e pubblica — social e blog — nella voce del tuo brand.'
      },
      points: [
        {
          en: 'Brand kit, people and products inform every draft',
          it: 'Brand kit, people e prodotti informano ogni bozza'
        },
        {
          en: 'You approve; Anomalia publishes on schedule',
          it: 'Tu approvi; Anomalia pubblica in schedule'
        },
        {
          en: 'Built as distribution autopilot, not a single feature',
          it: 'Nato come autopilot di distribuzione, non come singola feature'
        }
      ]
    }
  },
  {
    slug: 'predis-ai-vs-taplio',
    a: 'Predis.ai',
    b: 'Taplio',
    title: {
      en: 'Predis.ai vs Taplio (2026) — visual AI vs LinkedIn growth',
      it: 'Predis.ai vs Taplio (2026) — AI visuale vs crescita LinkedIn'
    },
    description: {
      en: 'Predis.ai vs Taplio compared: Instagram/Facebook creatives versus LinkedIn-first growth tools — and the case for a cross-channel AI autopilot.',
      it: 'Predis.ai vs Taplio a confronto: creativi Instagram/Facebook contro tool LinkedIn-first — e il caso per un autopilot AI cross-channel.'
    },
    excerpt: {
      en: 'Different jobs. Predis fills the feed. Taplio grows LinkedIn. Anomalia runs the whole distribution stack.',
      it: 'Job diversi. Predis riempie il feed. Taplio fa crescere LinkedIn. Anomalia gestisce tutto lo stack di distribuzione.'
    },
    bestForA: {
      en: 'Visual social volume for IG/FB-heavy brands.',
      it: 'Volume social visuale per brand IG/FB-heavy.'
    },
    bestForB: {
      en: 'Founders and consultants obsessed with LinkedIn.',
      it: 'Founder e consultant ossessionati da LinkedIn.'
    },
    rows: [
      {
        feature: { en: 'Home platform', it: 'Piattaforma di casa' },
        a: { en: 'Instagram / Facebook creatives', it: 'Creativi Instagram / Facebook' },
        b: { en: 'LinkedIn only (deep)', it: 'Solo LinkedIn (in profondità)' }
      },
      {
        feature: { en: 'AI specialty', it: 'Specialità AI' },
        a: { en: 'Image + caption + short video', it: 'Immagine + caption + short video' },
        b: { en: 'LinkedIn posts, hooks, leads', it: 'Post LinkedIn, hook, lead' }
      },
      {
        feature: { en: 'Lead workflows', it: 'Workflow lead' },
        a: { en: 'Limited', it: 'Limitati' },
        b: { en: 'Built-in LinkedIn CRM-ish tools', it: 'Tool CRM-ish LinkedIn integrati' }
      },
      {
        feature: { en: 'Multi-channel brand ops', it: 'Ops brand multi-canale' },
        a: { en: 'Partial', it: 'Parziali' },
        b: { en: 'No (by design)', it: 'No (di proposito)' }
      }
    ],
    aPros: [
      { en: 'Strong generative creative throughput', it: 'Alto throughput creativo generativo' },
      { en: 'Good for promo-heavy calendars', it: 'Buono per calendari promo-heavy' }
    ],
    aCons: [
      { en: 'Not built for LinkedIn thought leadership', it: 'Non pensato per thought leadership LinkedIn' },
      { en: 'Brand voice can drift without guardrails', it: 'La voce brand può driftare senza guardrail' }
    ],
    bPros: [
      { en: 'Best LinkedIn-native workflow', it: 'Miglior workflow nativo LinkedIn' },
      { en: 'Inspiration + analytics for personal brands', it: 'Ispirazione + analytics per personal brand' }
    ],
    bCons: [
      { en: 'Useless if LinkedIn isn’t your channel', it: 'Inutile se LinkedIn non è il tuo canale' },
      { en: 'Doesn’t cover IG/TikTok/blog', it: 'Non copre IG/TikTok/blog' }
    ],
    gap: {
      title: {
        en: 'Single-channel tools leave growth fragmented',
        it: 'I tool single-channel frammentano la crescita'
      },
      points: [
        {
          en: 'Your audience doesn’t live on one network',
          it: 'Il tuo pubblico non vive su una sola rete'
        },
        {
          en: 'SEO blog and social should reinforce each other',
          it: 'Blog SEO e social dovrebbero rafforzarsi a vicenda'
        },
        {
          en: 'Strategy should be shared, not reinvented per tool',
          it: 'La strategia dovrebbe essere condivisa, non reinventata per tool'
        }
      ]
    },
    anomalia: {
      title: {
        en: 'One autopilot across channels',
        it: 'Un autopilot su tutti i canali'
      },
      sub: {
        en: 'Anomalia plans and produces for the platforms you choose — including LinkedIn, Instagram and your blog.',
        it: 'Anomalia pianifica e produce per le piattaforme che scegli — LinkedIn, Instagram e il blog inclusi.'
      },
      points: [
        {
          en: 'Cross-channel editorial plan from one brand context',
          it: 'Piano editoriale cross-channel da un unico contesto brand'
        },
        {
          en: 'Leads finder + news radar + SEO blog in the same product',
          it: 'Leads finder + news radar + blog SEO nello stesso prodotto'
        },
        {
          en: 'Approve once, ship everywhere that matters',
          it: 'Approva una volta, pubblica ovunque conti'
        }
      ]
    }
  },
  {
    slug: 'hootsuite-vs-sprout-social',
    a: 'Hootsuite',
    b: 'Sprout Social',
    title: {
      en: 'Hootsuite vs Sprout Social (2026) — enterprise social suites',
      it: 'Hootsuite vs Sprout Social (2026) — suite social enterprise'
    },
    description: {
      en: 'Hootsuite vs Sprout Social for enterprise teams: analytics, listening, inbox and price — then why lean brands often choose an AI autopilot instead.',
      it: 'Hootsuite vs Sprout Social per team enterprise: analytics, listening, inbox e prezzo — e perché i brand lean spesso scelgono un autopilot AI.'
    },
    excerpt: {
      en: 'Both are powerful ops suites. Neither replaces a content engine that actually creates the week’s work.',
      it: 'Entrambe sono suite ops potenti. Nessuna sostituisce un motore di contenuti che crea davvero il lavoro della settimana.'
    },
    bestForA: {
      en: 'Teams that want a broad social command center with many integrations.',
      it: 'Team che vogliono un command center social ampio, con tante integrazioni.'
    },
    bestForB: {
      en: 'Teams that prioritize reporting polish and customer care workflows.',
      it: 'Team che danno priorità a report curati e workflow di customer care.'
    },
    rows: [
      {
        feature: { en: 'Positioning', it: 'Posizionamento' },
        a: { en: 'All-in-one social HQ', it: 'HQ social all-in-one' },
        b: { en: 'Intelligence + care + publishing', it: 'Intelligence + care + publishing' }
      },
      {
        feature: { en: 'Price band', it: 'Fascia prezzo' },
        a: { en: 'High (enterprise-leaning)', it: 'Alta (enterprise-leaning)' },
        b: { en: 'Very high (enterprise)', it: 'Molto alta (enterprise)' }
      },
      {
        feature: { en: 'Analytics & listening', it: 'Analytics & listening' },
        a: { en: 'Strong', it: 'Forti' },
        b: { en: 'Excellent / polished', it: 'Eccellenti / curati' }
      },
      {
        feature: { en: 'Content creation', it: 'Creazione contenuti' },
        a: { en: 'Assistive AI writing', it: 'Scrittura AI assistiva' },
        b: { en: 'Assistive AI writing', it: 'Scrittura AI assistiva' }
      }
    ],
    aPros: [
      { en: 'Wide feature surface', it: 'Superficie funzionale ampia' },
      { en: 'Familiar to large orgs', it: 'Familiare alle grandi organizzazioni' }
    ],
    aCons: [
      { en: 'Costly for SMBs', it: 'Costoso per PMI' },
      { en: 'Complexity tax', it: 'Tassa di complessità' }
    ],
    bPros: [
      { en: 'Best-in-class reporting feel', it: 'Feeling da report top di categoria' },
      { en: 'Strong care / inbox ops', it: 'Ops care / inbox forti' }
    ],
    bCons: [
      { en: 'Premium pricing', it: 'Prezzi premium' },
      { en: 'Overkill if you just need content shipped', it: 'Overkill se ti serve solo far uscire i contenuti' }
    ],
    gap: {
      title: {
        en: 'Enterprise suites still assume a content team exists',
        it: 'Le suite enterprise danno ancora per scontato che esista un content team'
      },
      points: [
        {
          en: 'They organize people; they don’t replace missing headcount',
          it: 'Organizzano le persone; non sostituiscono headcount mancante'
        },
        {
          en: 'AI features draft text — they don’t own the weekly plan',
          it: 'Le feature AI abbozzano testo — non possiedono il piano settimanale'
        },
        {
          en: 'SMBs pay for ops tools they never fully staff',
          it: 'Le PMI pagano tool ops che non staffano mai del tutto'
        }
      ]
    },
    anomalia: {
      title: {
        en: 'Anomalia for brands that need output, not another suite',
        it: 'Anomalia per brand che servono output, non un’altra suite'
      },
      sub: {
        en: 'If your bottleneck is creation — not inbox triage — start with an autopilot.',
        it: 'Se il collo di bottiglia è la creazione — non il triage inbox — parti da un autopilot.'
      },
      points: [
        {
          en: 'Plans the week from brand + competitors + goals',
          it: 'Pianifica la settimana da brand + competitor + obiettivi'
        },
        {
          en: 'Writes and designs posts (and blog articles) for approval',
          it: 'Scrive e disegna post (e articoli blog) da approvare'
        },
        {
          en: 'Priced and shaped for lean teams, not enterprise seats',
          it: 'Prezzo e forma pensati per team lean, non seat enterprise'
        }
      ]
    }
  }
];

export function getComparison(slug: string): Comparison | undefined {
  return COMPARISONS.find((c) => c.slug === slug);
}

export function t(l: L, lang: string): string {
  return lang === 'it' ? l.it : l.en;
}
