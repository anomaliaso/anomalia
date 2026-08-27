export type HowLocale = 'en' | 'it';

export type HowGuideCopy = {
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  title: string;
  titleEm: string;
  deck: string;
  sections: {
    id: string;
    kicker: string;
    heading: string;
    body: string[];
    link?: { href: string; label: string; external?: boolean };
    bullets?: string[];
    image?: { src: string; alt: string };
  }[];
};

export const HOW_GUIDE = {
  publishedAt: '2026-08-12',
  related: [
    { path: '/docs/mcp', en: 'Anomalia MCP docs', it: 'Docs MCP Anomalia' },
    { path: '/ads', en: 'Anomalia Ads', it: 'Anomalia Ads' },
    { path: '/pricing', en: 'Pricing', it: 'Prezzi' }
  ] as const,
  en: {
    metaTitle: 'Cursor + Anomalia MCP — motion video, socials & ads',
    metaDescription:
      'Connect Anomalia to Cursor, run it from your phone, create motion videos, schedule socials and launch ads — short playbook.',
    eyebrow: 'You commented HOW',
    title: 'Cursor + Anomalia MCP.',
    titleEm: 'Motion, socials, ads.',
    deck: 'Your brand in Cursor. Work from the phone. Videos that go live. Here’s the short version.',
    sections: [
      {
        id: 'mcp',
        kicker: '01 · The bridge',
        heading: 'What Anomalia MCP is',
        body: [
          'It’s the plug that lets Cursor talk to Anomalia. After you connect it once, Cursor already knows your brand — posts, calendar, content, ads.',
          'So you don’t re-explain everything. You just say what you want: make a video, schedule it, start an ad.'
        ],
        link: { href: '/docs/mcp', label: 'How to connect it →' }
      },
      {
        id: 'ios',
        kicker: '02 · Phone',
        heading: 'Cursor on iOS: keep going from your phone',
        body: [
          'With the Cursor iOS app you can start work from anywhere, check progress with notifications, and keep steering from the couch or the cafe.',
          'Ask for a video or a schedule from your phone — then approve the final publish in Anomalia with one tap.'
        ],
        link: {
          href: 'https://cursor.com/blog/ios-mobile-app',
          label: 'Cursor for iOS →',
          external: true
        },
        image: {
          src: '/cursor-mcp/phone-agent.png',
          alt: 'Founder directing work from an iPhone in a cafe'
        }
      },
      {
        id: 'motion',
        kicker: '03 · Video',
        heading: 'Motion video, without the editing marathon',
        body: [
          'Soon you’ll also get Motion video inside Anomalia: describe the clip you want, tweak it, export it ready for socials and ads.',
          'Already today you can turn a still post into a short moving video — then put it on the calendar like anything else.'
        ],
        bullets: [
          'Describe the video → get a draft',
          'Turn a photo post into a short motion clip',
          'Schedule it when you’re happy'
        ],
        image: {
          src: '/cursor-mcp/motion-desk.png',
          alt: 'Creative desk with motion graphics on screen and phone'
        }
      },
      {
        id: 'ship',
        kicker: '04 · Ship',
        heading: 'Schedule socials. Push ads.',
        body: [
          'Approve once and publish across your connected accounts — Instagram, TikTok, LinkedIn and more. From the phone, email, or Cursor: same simple yes.',
          'Want more reach? Anomalia can propose Meta and Google ads around that creative. You approve the budget. It handles the rest.'
        ],
        link: { href: '/ads', label: 'See Anomalia Ads →' },
        image: {
          src: '/cursor-mcp/schedule-glow.png',
          alt: 'Evening apartment with glowing content calendar on a tablet'
        }
      }
    ]
  } satisfies HowGuideCopy,
  it: {
    metaTitle: 'Cursor + Anomalia MCP — motion video, social e ads',
    metaDescription:
      'Collega Anomalia a Cursor, usala dal telefono, crea motion video, schedula i social e lancia le ads — playbook corto.',
    eyebrow: 'Hai commentato HOW',
    title: 'Cursor + Anomalia MCP.',
    titleEm: 'Motion, social, ads.',
    deck: 'Il tuo brand in Cursor. Lavori dal telefono. Video che partono. Versione corta.',
    sections: [
      {
        id: 'mcp',
        kicker: '01 · Il ponte',
        heading: 'Cos’è Anomalia MCP',
        body: [
          'È la spina che fa parlare Cursor con Anomalia. Una volta collegata, Cursor conosce già il tuo brand — post, calendario, contenuti, ads.',
          'Non rispieghi tutto ogni volta. Chiedi cosa vuoi: fai un video, schedulalo, parti con un’ad.'
        ],
        link: { href: '/docs/mcp', label: 'Come collegarlo →' }
      },
      {
        id: 'ios',
        kicker: '02 · Telefono',
        heading: 'Cursor su iOS: continua dal telefono',
        body: [
          'Con l’app iOS di Cursor puoi partire da ovunque, seguire i progressi con le notifiche e guidare il lavoro dal divano o dal caffè.',
          'Chiedi un video o uno schedule dal telefono — poi approva la pubblicazione finale in Anomalia con un tap.'
        ],
        link: {
          href: 'https://cursor.com/blog/ios-mobile-app',
          label: 'Cursor per iOS →',
          external: true
        },
        image: {
          src: '/cursor-mcp/phone-agent.png',
          alt: 'Founder che lavora da iPhone in un caffè'
        }
      },
      {
        id: 'motion',
        kicker: '03 · Video',
        heading: 'Motion video, senza la maratona di montaggio',
        body: [
          'Presto avrai anche Motion video dentro Anomalia: descrivi il clip che vuoi, ritoccalo, esportalo pronto per social e ads.',
          'Già oggi puoi far muovere un post statico in un video corto — e metterlo in calendario come tutto il resto.'
        ],
        bullets: [
          'Descrivi il video → ricevi una bozza',
          'Trasforma un post foto in un clip motion',
          'Schedulalo quando ti convince'
        ],
        image: {
          src: '/cursor-mcp/motion-desk.png',
          alt: 'Scrivania creativa con motion graphics e telefono'
        }
      },
      {
        id: 'ship',
        kicker: '04 · Ship',
        heading: 'Schedula i social. Spingi le ads.',
        body: [
          'Approvi una volta e pubblica sugli account collegati — Instagram, TikTok, LinkedIn e altri. Dal telefono, email o Cursor: stesso sì semplice.',
          'Vuoi più reach? Anomalia propone ads Meta e Google sul creative. Tu approvi il budget. Il resto lo fa lei.'
        ],
        link: { href: '/ads', label: 'Vedi Anomalia Ads →' },
        image: {
          src: '/cursor-mcp/schedule-glow.png',
          alt: 'Appartamento la sera con calendario contenuti sul tablet'
        }
      }
    ]
  } satisfies HowGuideCopy
} as const;

export function howGuideCopy(lang: HowLocale): HowGuideCopy {
  return HOW_GUIDE[lang];
}
