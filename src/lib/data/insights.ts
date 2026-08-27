export type InsightLocale = 'en' | 'it';

export type InsightFigure = {
  src: string;
  alt: string;
  width?: number;
  height?: number;
};

export type InsightSection = {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
  /** Optional in-article still (Nano Banana). Same src in EN/IT; alt is localized. */
  image?: InsightFigure;
};

export type InsightArticle = {
  slug: string;
  publishedAt: string; // ISO date
  readingMinutes: number;
  category: { en: string; it: string };
  title: { en: string; it: string };
  description: { en: string; it: string };
  /** Short teaser for index cards */
  excerpt: { en: string; it: string };
  /** Optional cover used on the index card and as og:image. */
  cover?: {
    src: string;
    alt: { en: string; it: string };
    width?: number;
    height?: number;
  };
  sections: { en: InsightSection[]; it: InsightSection[] };
  relatedPaths: string[];
};

export const INSIGHTS: InsightArticle[] = [
  {
    slug: 'gemini-3-7-flash',
    publishedAt: '2026-08-14',
    readingMinutes: 7,
    category: { en: 'Product', it: 'Prodotto' },
    title: {
      en: 'Gemini 3.7 Flash inside Anomalia: the model that actually looks',
      it: 'Gemini 3.7 Flash dentro Anomalia: il modello che guarda davvero'
    },
    description: {
      en: 'Google just shipped Gemini 3.7 Flash. Here is where Anomalia uses it — looking at brands, creatives, video and scheduled posts — and why that matters more than another caption generator.',
      it: 'Google ha appena rilasciato Gemini 3.7 Flash. Ecco dove Anomalia lo usa — su brand, creative, video e post in programma — e perché conta più di un altro generatore di caption.'
    },
    excerpt: {
      en: 'A social post is not a paragraph. If the model never looks at the image, it is guessing.',
      it: 'Un post social non è un paragrafo. Se il modello non guarda l’immagine, sta indovinando.'
    },
    relatedPaths: ['/autoposts', '/ai-vs-human', '/pricing'],
    cover: {
      src: '/insights/gemini-37-glance.webp',
      alt: {
        en: 'Glancing at a product photo on a phone — the post is what you see, not the caption',
        it: 'Uno sguardo a una foto prodotto sul telefono: il post è quello che vedi, non la caption'
      },
      width: 1376,
      height: 768
    },
    sections: {
      en: [
        {
          heading: 'A post is something people see',
          paragraphs: [
            'Most “AI for social” still treats a post as text. Write a caption, sprinkle hashtags, ship. That is how you get a sharp line next to a muddy product shot, or a reel whose first second does nothing.',
            'People do not read a feed. They glance. Color, product, face, type on the image, the first beat of a video — that is the post. The caption is the aftertaste.',
            'So the model that matters is not the one that talks the most. It is the one that can look at what a stranger would see, then judge it against your brand.'
          ],
          image: {
            src: '/insights/gemini-37-glance.webp',
            alt: 'A person in a cafe glancing at a product photograph on their phone — the picture is the post',
            width: 1376,
            height: 768
          }
        },
        {
          heading: 'What Gemini 3.7 Flash is — without the launch-speak',
          paragraphs: [
            'On 13 August 2026 Google released Gemini 3.7 Flash: a workhorse model built to see and reason together. Pictures, clips, a block of copy, a page from your site — in one pass, not as three disconnected jobs.',
            'Flash, here, is the point. It is fast enough to sit in a daily loop: review, adjust, review again. Not a once-a-week luxury call. Not a chatbot you paste screenshots into.',
            'We do not use it as a personality. We use it as eyes.'
          ]
        },
        {
          heading: 'Where it sits in Anomalia',
          paragraphs: [
            'You will not see a “powered by Gemini” badge on every screen. You will notice that the work looks at the work. A few places that is true:'
          ],
          bullets: [
            'When we first meet a brand: the site, the colors, the products, the people in the photos — so the studio is grounded in what you actually look like, not a generic “modern SaaS” moodboard.',
            'When a creative comes out of the studio: is the product readable, does the on-image type fight the caption, would a stranger know this is you.',
            'On video: the first second, the craft, whether it would stop a thumb or just fill a slot.',
            'Minutes before something scheduled goes live: empty caption, missing media, a placeholder that slipped through.',
            'When you chat about a post: you point at the cover; it is looking at the cover, not at a filename.'
          ],
          image: {
            src: '/insights/gemini-37-look.webp',
            alt: 'Printed social stills and a video freeze-frame spread on a desk, being looked at rather than read',
            width: 1376,
            height: 768
          }
        },
        {
          heading: 'Speed is the product',
          paragraphs: [
            'An autopilot that takes overnight to notice a broken slide is not an autopilot. It is a batch job with a nicer UI.',
            'Gemini 3.7 Flash is in those loops because it is quick enough to look, say no, and let the work continue — still with you as editor-in-chief. Nothing publishes because a model liked it. Things get held because a model saw a problem a human would have caught at 11pm.',
            'That is the bar. Not “AI made content.” AI looked at the content the way your customer will.'
          ],
          image: {
            src: '/insights/gemini-37-hold.webp',
            alt: 'Late evening, a quiet last look at a scheduled post before it goes live',
            width: 1376,
            height: 768
          }
        },
        {
          heading: 'What we are not claiming',
          paragraphs: [
            'This is not a model review, and it is not a promise that every sentence on Anomalia is written by Gemini. Different jobs want different tools. Looking is one job. Planning a quarter, writing a long article, picking a keyword — those are others.',
            'Gemini 3.7 Flash is the pair of eyes in the newsroom. You stay the editor. The autopilot still waits for your OK.',
            'If you want the loop — plan, make, look, approve, ship — that is what Anomalia is for.'
          ]
        }
      ],
      it: [
        {
          heading: 'Un post è una cosa che si vede',
          paragraphs: [
            'La maggior parte dell’“AI per i social” tratta ancora un post come testo. Scrivi una caption, metti gli hashtag, pubblica. È così che finisci con una frase tagliente accanto a uno scatto illeggibile, o un reel il cui primo secondo non fa niente.',
            'Nessuno legge un feed. Si dà un’occhiata. Colore, prodotto, viso, testo sull’immagine, il primo beat di un video: quello è il post. La caption è il retrogusto.',
            'Quindi il modello che conta non è quello che parla di più. È quello che sa guardare quello che vedrebbe uno sconosciuto, e giudicarlo rispetto al tuo brand.'
          ],
          image: {
            src: '/insights/gemini-37-glance.webp',
            alt: 'Una persona al bar che guarda una foto prodotto sul telefono: l’immagine è il post',
            width: 1376,
            height: 768
          }
        },
        {
          heading: 'Cos’è Gemini 3.7 Flash — senza il comunicato',
          paragraphs: [
            'Il 13 agosto 2026 Google ha rilasciato Gemini 3.7 Flash: un modello da lavoro, fatto per vedere e ragionare insieme. Foto, clip, un blocco di copy, una pagina del sito — in un passaggio solo, non come tre mestieri staccati.',
            'Flash, qui, è il punto. È abbastanza veloce da stare in un loop quotidiano: rivedi, aggiusta, rivedi. Non una chiamata da lusso una volta a settimana. Non un chatbot in cui incolli screenshot.',
            'Non lo usiamo come personalità. Lo usiamo come occhi.'
          ]
        },
        {
          heading: 'Dove sta, in Anomalia',
          paragraphs: [
            'Non troverai un badge “powered by Gemini” su ogni schermata. Noterai che il lavoro guarda il lavoro. Qualche punto in cui è vero:'
          ],
          bullets: [
            'Quando incontriamo un brand: il sito, i colori, i prodotti, le persone nelle foto — così lo studio parte da come appari davvero, non da un moodboard “modern SaaS” generico.',
            'Quando una creative esce dallo studio: il prodotto si legge? Il testo sull’immagine combatte con la caption? Uno sconosciuto capirebbe che sei tu?',
            'Sul video: il primo secondo, il mestiere, se fermerebbe un pollice o riempirebbe solo uno slot.',
            'Pochi minuti prima che un post programmato vada live: caption vuota, media mancante, un placeholder passato inosservato.',
            'Quando parli di un post in chat: indichi la copertina; sta guardando la copertina, non un nome file.'
          ],
          image: {
            src: '/insights/gemini-37-look.webp',
            alt: 'Stampe di still social e un fotogramma video sul tavolo, da guardare più che da leggere',
            width: 1376,
            height: 768
          }
        },
        {
          heading: 'La velocità è il prodotto',
          paragraphs: [
            'Un autopilot che ci mette una notte a notare una slide rotta non è un autopilot. È un batch con una UI più carina.',
            'Gemini 3.7 Flash sta in quei loop perché è abbastanza rapido da guardare, dire di no, e far continuare il lavoro — sempre con te come editor-in-chief. Niente si pubblica perché a un modello è piaciuto. Qualcosa si ferma perché un modello ha visto un problema che un umano avrebbe preso alle 23.',
            'Quella è l’asticella. Non “l’AI ha fatto contenuti.” L’AI ha guardato i contenuti come li guarderà il cliente.'
          ],
          image: {
            src: '/insights/gemini-37-hold.webp',
            alt: 'Sera tardi, un ultimo sguardo calmo a un post in programma prima che vada live',
            width: 1376,
            height: 768
          }
        },
        {
          heading: 'Cosa non stiamo dicendo',
          paragraphs: [
            'Non è una recensione del modello, e non è la promessa che ogni frase su Anomalia sia scritta da Gemini. Mestieri diversi vogliono strumenti diversi. Guardare è un mestiere. Pianificare un trimestre, scrivere un articolo lungo, scegliere una keyword — sono altri.',
            'Gemini 3.7 Flash è il paio di occhi in redazione. Tu resti l’editor. L’autopilot aspetta ancora il tuo OK.',
            'Se vuoi il loop — pianifica, fai, guarda, approva, pubblica — Anomalia è fatta per quello.'
          ]
        }
      ]
    }
  },
  {
    slug: 'ai-social-media-autopilot',
    publishedAt: '2026-07-28',
    readingMinutes: 8,
    category: { en: 'Product', it: 'Prodotto' },
    title: {
      en: 'What is an AI social media autopilot — and when do you need one?',
      it: 'Cos’è un autopilot AI per i social — e quando ti serve davvero?'
    },
    description: {
      en: 'An AI social media autopilot plans, writes, designs and schedules posts across platforms. You approve; it ships. Here’s how it differs from schedulers and agencies.',
      it: 'Un autopilot AI per i social pianifica, scrive, disegna e programma i post. Tu approvi; pubblica lui. Ecco come differisce da scheduler e agenzie.'
    },
    excerpt: {
      en: 'Schedulers wait for you to create. Agencies need briefs. An autopilot runs the whole loop — with you still in control.',
      it: 'Gli scheduler aspettano che tu crei. Le agenzie chiedono brief. Un autopilot gira l’intero ciclo — con te ancora al comando.'
    },
    relatedPaths: ['/autoposts', '/playbooks', '/pricing'],
    sections: {
      en: [
        {
          heading: 'The gap between “should post” and “posted”',
          paragraphs: [
            'Most small teams know they should show up on Instagram, TikTok and LinkedIn every week. The hard part is not strategy — it is production: ideas, captions, visuals, scheduling, and doing it again next Monday.',
            'An AI social media autopilot closes that gap. It learns your brand, proposes a weekly plan, generates on-brand posts, and waits for one-tap approval before anything goes live.'
          ]
        },
        {
          heading: 'Autopilot vs scheduler vs agency',
          paragraphs: [
            'A scheduler (Buffer, Later, Meta’s native tools) is a calendar. You still write and design everything. An agency can produce content, but you pay for hours, rounds of feedback, and slow turnaround.',
            'An autopilot sits in between: it produces the work continuously, but you keep editorial control. Nothing publishes without your OK.'
          ],
          bullets: [
            'Scheduler: you create → it posts',
            'Agency: you brief → humans create → you revise',
            'Autopilot: AI plans & creates → you approve → it posts'
          ]
        },
        {
          heading: 'When an autopilot is the right fit',
          paragraphs: [
            'It fits founders and lean teams who need consistency more than a creative department — local businesses, ecommerce brands, coaches, SaaS, agencies running multiple clients.',
            'If you already have a content team shipping daily and only need a calendar, a scheduler may be enough. If you want volume plus brand voice without hiring, autopilot wins.'
          ]
        },
        {
          heading: 'What “good” looks like',
          paragraphs: [
            'A useful autopilot is grounded in your real products, tone and knowledge base — not generic ChatGPT captions. It should support multiple platforms, keep a content calendar, and let you edit before publish.',
            'Anomalia was built for that loop: brand studio → editorial plan → posts & blog → radar for news and leads — all with human approval.'
          ]
        }
      ],
      it: [
        {
          heading: 'Il vuoto tra “dovrei postare” e “ho postato”',
          paragraphs: [
            'Quasi tutte le piccole team sanno che dovrebbero essere presenti su Instagram, TikTok e LinkedIn ogni settimana. Il problema non è la strategia — è la produzione: idee, caption, visual, programmazione, e rifarlo il lunedì dopo.',
            'Un autopilot AI per i social chiude quel vuoto. Impara il brand, propone un piano settimanale, genera post on-brand e aspetta la tua approvazione con un tap prima di pubblicare.'
          ]
        },
        {
          heading: 'Autopilot vs scheduler vs agenzia',
          paragraphs: [
            'Uno scheduler (Buffer, Later, tool nativi Meta) è un calendario. Scrivi e disegni ancora tutto tu. Un’agenzia produce contenuti, ma paghi ore, feedback e tempi lunghi.',
            'Un autopilot sta in mezzo: produce in continuo, ma tu resti in controllo editoriale. Nulla va online senza il tuo OK.'
          ],
          bullets: [
            'Scheduler: tu crei → pubblica lui',
            'Agenzia: tu briefi → umani creano → tu rivedi',
            'Autopilot: AI pianifica e crea → tu approvi → pubblica'
          ]
        },
        {
          heading: 'Quando l’autopilot è la scelta giusta',
          paragraphs: [
            'Serve a founder e team snelli che hanno bisogno di costanza più che di un dipartimento creativo — attività locali, ecommerce, coach, SaaS, agenzie con più clienti.',
            'Se hai già un team che pubblica ogni giorno e ti serve solo un calendario, basta uno scheduler. Se vuoi volume e tono di brand senza assumere, vince l’autopilot.'
          ]
        },
        {
          heading: 'Come si riconosce uno “buono”',
          paragraphs: [
            'Un autopilot utile è ancorato a prodotti reali, tone of voice e knowledge base — non a caption generiche da ChatGPT. Deve supportare più piattaforme, tenere un calendario e farti editare prima della pubblicazione.',
            'Anomalia è costruita per quel ciclo: studio brand → piano editoriale → post e blog → radar per news e lead — sempre con approvazione umana.'
          ]
        }
      ]
    }
  },
  {
    slug: 'geo-generative-engine-optimization',
    publishedAt: '2026-07-25',
    readingMinutes: 9,
    category: { en: 'SEO & GEO', it: 'SEO & GEO' },
    title: {
      en: 'GEO explained: how to get cited by ChatGPT, Perplexity and Gemini',
      it: 'GEO spiegata: come farsi citare da ChatGPT, Perplexity e Gemini'
    },
    description: {
      en: 'Generative Engine Optimization (GEO) is how brands show up inside AI answers. Practical steps: structure, citations, freshness, and content that models can quote.',
      it: 'La Generative Engine Optimization (GEO) è come i brand compaiono nelle risposte AI. Passi pratici: struttura, citazioni, freschezza e contenuti quotabili.'
    },
    excerpt: {
      en: 'Search is no longer only ten blue links. If AI assistants answer without naming you, you are invisible to a growing share of buyers.',
      it: 'La ricerca non è più solo dieci link blu. Se gli assistenti AI rispondono senza nominarti, sei invisibile a una fetta crescente di buyer.'
    },
    relatedPaths: ['/ai-seo-agent', '/autoblog', '/docs/geo-audit'],
    sections: {
      en: [
        {
          heading: 'SEO still matters. GEO is the new layer.',
          paragraphs: [
            'Classic SEO gets you ranked on Google. GEO (Generative Engine Optimization) increases the chance that ChatGPT, Perplexity, Gemini and similar tools cite your brand when someone asks a question in your category.',
            'The two reinforce each other: clear, authoritative pages that rank well are also easier for models to retrieve and quote.'
          ]
        },
        {
          heading: 'What AI engines tend to cite',
          paragraphs: [
            'Models favor content that is specific, structured and attributable — not keyword stuffing. Practical signals include:'
          ],
          bullets: [
            'Clear definitions and TL;DR blocks near the top',
            'FAQ sections that match real questions',
            'Original data, process detail, or founder expertise',
            'Internal links to product and pricing pages',
            'Fresh updates (dates, changelogs, current stats)'
          ]
        },
        {
          heading: 'A simple GEO checklist for SMBs',
          paragraphs: [
            'Start with a GEO audit of your site (meta, structure, llms.txt, schema). Then publish a steady stream of long-form articles grounded in your products — comparisons, how-tos, and category explainers.',
            'Add an llms.txt so crawlers know which pages matter. Keep key facts consistent across homepage, docs and blog so models do not invent conflicting details.'
          ]
        },
        {
          heading: 'How Anomalia approaches GEO',
          paragraphs: [
            'Anomalia’s SEO agent and autoblog write articles optimized for both Google and AI citation patterns: intent-led topics, schema, internal links, and publishing to your CMS or hosted blog.',
            'Pair that with the free GEO Audit tool to see technical readiness before you scale content.'
          ]
        }
      ],
      it: [
        {
          heading: 'La SEO conta ancora. La GEO è il nuovo layer.',
          paragraphs: [
            'La SEO classica ti fa rankare su Google. La GEO (Generative Engine Optimization) aumenta la probabilità che ChatGPT, Perplexity, Gemini e strumenti simili citino il tuo brand quando qualcuno chiede qualcosa nella tua categoria.',
            'Le due si rafforzano: pagine chiare e autorevoli che rankano bene sono anche più facili da recuperare e quotare per i modelli.'
          ]
        },
        {
          heading: 'Cosa tendono a citare i motori AI',
          paragraphs: [
            'I modelli preferiscono contenuti specifici, strutturati e attribuibili — non keyword stuffing. Segnali pratici:'
          ],
          bullets: [
            'Definizioni chiare e blocchi TL;DR in alto',
            'FAQ allineate a domande reali',
            'Dati originali, dettagli di processo o expertise del founder',
            'Link interni a prodotto e pricing',
            'Aggiornamenti freschi (date, changelog, stats attuali)'
          ]
        },
        {
          heading: 'Una checklist GEO semplice per PMI',
          paragraphs: [
            'Parti da un GEO audit del sito (meta, struttura, llms.txt, schema). Poi pubblica un flusso costante di articoli long-form ancorati ai tuoi prodotti — confronti, how-to e guide di categoria.',
            'Aggiungi un llms.txt così i crawler sanno quali pagine contano. Mantieni i fatti chiave coerenti tra homepage, docs e blog così i modelli non inventano dettagli conflittuali.'
          ]
        },
        {
          heading: 'Come Anomalia affronta la GEO',
          paragraphs: [
            'L’agente SEO e l’autoblog di Anomalia scrivono articoli ottimizzati per Google e per i pattern di citazione AI: topic sull’intent, schema, link interni e pubblicazione sul CMS o sul blog ospitato.',
            'Abbinalo al tool gratuito GEO Audit per vedere la readiness tecnica prima di scalare i contenuti.'
          ]
        }
      ]
    }
  },
  {
    slug: 'from-teta-to-anomalia',
    publishedAt: '2026-07-20',
    readingMinutes: 7,
    category: { en: 'Story', it: 'Storia' },
    title: {
      en: 'From Teta to Anomalia: how 30M views shaped an AI marketing autopilot',
      it: 'Da Teta ad Anomalia: come 30M di views hanno dato forma a un autopilot AI'
    },
    description: {
      en: 'We grew Teta to 30 million views, 80K users and 350K followers with a four-person team and zero ad spend. That operating system became Anomalia.',
      it: 'Con Teta siamo arrivati a 30 milioni di views, 80K utenti e 350K follower con un team di quattro e zero ads. Quel sistema operativo è diventato Anomalia.'
    },
    excerpt: {
      en: 'We did not start with a marketing tool. We started by needing one — then built what we wished we had.',
      it: 'Non siamo partiti da un tool di marketing. Siamo partiti dal bisogno — poi abbiamo costruito quello che avremmo voluto avere.'
    },
    relatedPaths: ['/', '/usecases', '/pricing'],
    sections: {
      en: [
        {
          heading: 'Growth without a media team',
          paragraphs: [
            'At Teta we experimented with organic marketing until the numbers forced a system: 30 million views in three months, roughly 80,000 users, and 350,000 followers across social — with four people and no paid ads.',
            'The constraint was time. Every post, every angle, every follow-up had to compound. Manual chaos did not scale.'
          ]
        },
        {
          heading: 'What we learned the hard way',
          paragraphs: [
            'Consistency beats sporadic brilliance. Brand voice is a system, not a vibe. News and conversations on Reddit or social are lead engines if you react in minutes, not days.',
            'And long-form content is not optional if you want durable traffic — but nobody on a four-person team can write a blog every day by hand.'
          ]
        },
        {
          heading: 'Why we built Anomalia',
          paragraphs: [
            'Anomalia packages that operating system: brand memory, weekly editorial plans, on-brand posts, SEO/GEO articles, a news radar, and lead detection — with human approval so quality does not slip.',
            'We built it for ourselves first. Now it runs distribution for brands that face the same constraint we did: big ambition, small team.'
          ]
        }
      ],
      it: [
        {
          heading: 'Crescita senza un media team',
          paragraphs: [
            'Con Teta abbiamo sperimentato il marketing organico finché i numeri non hanno imposto un sistema: 30 milioni di views in tre mesi, circa 80.000 utenti e 350.000 follower sui social — in quattro e senza ads.',
            'Il vincolo era il tempo. Ogni post, ogni angolo, ogni follow-up doveva compoundare. Il caos manuale non scala.'
          ]
        },
        {
          heading: 'Cosa abbiamo imparato a nostre spese',
          paragraphs: [
            'La costanza batte la genialità sporadica. Il tone of voice è un sistema, non una vibe. News e conversazioni su Reddit o social sono motori di lead se reagisci in minuti, non in giorni.',
            'E il long-form non è opzionale se vuoi traffico duraturo — ma nessuno in un team di quattro scrive un blog ogni giorno a mano.'
          ]
        },
        {
          heading: 'Perché abbiamo costruito Anomalia',
          paragraphs: [
            'Anomalia impacchetta quel sistema operativo: brand memory, piani editoriali settimanali, post on-brand, articoli SEO/GEO, radar news e detection di lead — con approvazione umana così la qualità non scivola.',
            'L’abbiamo costruita prima per noi. Ora gira la distribution per brand con lo stesso vincolo: ambizione grande, team piccolo.'
          ]
        }
      ]
    }
  },
  {
    slug: 'agency-vs-ai-social-media',
    publishedAt: '2026-07-15',
    readingMinutes: 8,
    category: { en: 'Comparison', it: 'Confronto' },
    title: {
      en: 'Marketing agency vs AI social media tool: which should you pick?',
      it: 'Agenzia marketing vs tool AI per i social: cosa scegliere?'
    },
    description: {
      en: 'Agencies bring strategy and craft. AI autopilots bring speed and cost leverage. A practical comparison for founders choosing how to run social and content.',
      it: 'Le agenzie portano strategy e craft. Gli autopilot AI portano velocità e leva di costo. Un confronto pratico per founder che devono far girare social e content.'
    },
    excerpt: {
      en: 'It is not agency or AI forever. It is which bottleneck you are buying your way out of this quarter.',
      it: 'Non è agenzia o AI per sempre. È da quale collo di bottiglia ti stai liberando questo quarter.'
    },
    relatedPaths: ['/pricing', '/ai-vs-human', '/cant-afford'],
    sections: {
      en: [
        {
          heading: 'What you are really buying',
          paragraphs: [
            'With an agency you buy senior taste, campaign thinking, and someone to blame in the Slack channel. With an AI social tool you buy throughput: plans, drafts, visuals, and publishing workflows that run every week.',
            'Confusion starts when you expect one to fully replace the other. They solve different bottlenecks.'
          ]
        },
        {
          heading: 'Where agencies still win',
          paragraphs: [
            'Brand repositioning, multi-channel launches, influencer deals, and high-stakes creative still benefit from experienced humans in the loop. If budget is €3–10K+/month and you need strategy workshops, an agency (or fractional CMO) is often right.'
          ]
        },
        {
          heading: 'Where AI autopilots win',
          paragraphs: [
            'Ongoing presence: weekly posts, blog articles, reacting to news, drafting replies to warm conversations. That work is repetitive, measurable, and brutal on small teams.',
            'If your problem is “we disappear for three weeks whenever sales gets busy,” an autopilot with approval gates is usually the better buy than another retainer that still needs briefs from you.'
          ]
        },
        {
          heading: 'A hybrid that actually works',
          paragraphs: [
            'Many teams keep a human for quarterly strategy and brand judgment, and run Anomalia for the weekly machine: content calendar, posts, SEO articles, radar.',
            'You stay the editor-in-chief. The AI is the newsroom that never sleeps.'
          ]
        }
      ],
      it: [
        {
          heading: 'Cosa stai comprando davvero',
          paragraphs: [
            'Con un’agenzia compri gusto senior, pensiero da campagna e qualcuno a cui dare la colpa su Slack. Con un tool AI per i social compri throughput: piani, draft, visual e workflow di pubblicazione che girano ogni settimana.',
            'La confusione nasce quando ti aspetti che uno sostituisca del tutto l’altro. Risolvono colli di bottiglia diversi.'
          ]
        },
        {
          heading: 'Dove le agenzie vincono ancora',
          paragraphs: [
            'Riposizionamento di brand, launch multi-canale, influencer e creative ad alto rischio beneficiano ancora di umani esperti nel loop. Se il budget è €3–10K+/mese e ti servono workshop di strategy, un’agenzia (o un fractional CMO) è spesso la scelta giusta.'
          ]
        },
        {
          heading: 'Dove vincono gli autopilot AI',
          paragraphs: [
            'Presenza continua: post settimanali, articoli blog, reazione alle news, draft di reply a conversazioni calde. È lavoro ripetitivo, misurabile e micidiale per i team piccoli.',
            'Se il problema è “spariamo per tre settimane quando le vendite si accendono”, un autopilot con gate di approvazione è di solito l’acquisto migliore di un altro retainer che continua a chiederti brief.'
          ]
        },
        {
          heading: 'Un ibrido che funziona',
          paragraphs: [
            'Molti team tengono un umano per strategy trimestrale e giudizio di brand, e fanno girare Anomalia per la macchina settimanale: calendario, post, articoli SEO, radar.',
            'Tu resti editor-in-chief. L’AI è la redazione che non dorme.'
          ]
        }
      ]
    }
  }
];

export const INSIGHT_SLUGS = INSIGHTS.map((a) => a.slug);

export function getInsight(slug: string): InsightArticle | undefined {
  return INSIGHTS.find((a) => a.slug === slug);
}

export function insightLocales(article: InsightArticle, lang: InsightLocale) {
  return {
    title: article.title[lang],
    description: article.description[lang],
    excerpt: article.excerpt[lang],
    category: article.category[lang],
    cover: article.cover
      ? { src: article.cover.src, alt: article.cover.alt[lang], width: article.cover.width, height: article.cover.height }
      : undefined,
    sections: article.sections[lang]
  };
}
