export type PlaybookPhase = {
  title: string;
  desc: string;
  steps: string[];
  legacy: string;
  winning: string;
};

export type Playbook = {
  slug: string;
  category: string;
  kd: number;
  searchVol: string;
  phases: PlaybookPhase[];
  takeaways: string[];
  relatedSlugs: string[];
};

const PHASES: PlaybookPhase[] = [
  {
    title: 'Map your content pillars',
    desc: 'Define the 4–5 topics your brand owns. Everything you post ties back to one of these pillars.',
    steps: [
      'List your core products/services — these become your content pillars',
      'Research what your audience searches for around each pillar',
      'Identify 3 content formats that work for each pillar (carousel, reel, blog, story)',
      'Map seasonal moments and events relevant to each pillar'
    ],
    legacy: 'Posting whatever comes to mind with no strategy',
    winning: 'Every post serves a purpose within a structured content system'
  },
  {
    title: 'Build your social presence',
    desc: 'Optimize your profiles, set up highlights, and create the visual foundation that makes people follow.',
    steps: [
      'Write a bio that explains what you do and who you serve in one line',
      'Design highlight covers that match your brand and organize your best content',
      'Set up a link-in-bio page that drives traffic to your money pages',
      'Pin your 3 best-performing posts to the top of your profile'
    ],
    legacy: 'A half-filled profile with no clear message',
    winning: 'A profile that converts visitors into followers in 3 seconds'
  },
  {
    title: 'Create the content engine',
    desc: 'Start producing weekly content — captions, visuals, hashtags — all in your brand voice.',
    steps: [
      'Batch-create 7 posts per week across your platforms',
      'Write captions with hooks that stop the scroll',
      'Design on-brand visuals using your colors, fonts and products',
      'Research and rotate hashtags by reach and niche relevance'
    ],
    legacy: 'Posting inconsistently when you "find the time"',
    winning: 'A week of content ready every Monday, approved in 10 minutes'
  },
  {
    title: 'Launch the blog',
    desc: 'Start publishing SEO-optimized articles that drive organic traffic and establish authority.',
    steps: [
      'Identify 10 keywords your audience searches for',
      'Write (or generate) your first 4 long-form articles',
      'Add internal links from articles to your product/service pages',
      'Implement JSON-LD schema for FAQ, HowTo and Organization'
    ],
    legacy: 'No blog, or a blog with 2 posts from 2022',
    winning: 'A living blog that ranks on Google and gets cited by AI'
  },
  {
    title: 'Engage and grow',
    desc: 'Turn followers into customers with community engagement, DMs and strategic interactions.',
    steps: [
      'Reply to every comment within 2 hours during your first 90 days',
      'Engage with 10 accounts in your niche daily (comment, not just like)',
      'Use stories and polls to drive interaction and gather feedback',
      'Start conversations in DMs with high-intent followers'
    ],
    legacy: 'Posting and ghosting — never engaging with your audience',
    winning: 'A community that trusts you and buys from you regularly'
  },
  {
    title: 'Analyze and optimize',
    desc: 'Track what works, kill what doesn\'t, and double down on your winning formats.',
    steps: [
      'Review your analytics weekly — what got the most saves, shares, clicks?',
      'Identify your top 3 performing posts and understand why they worked',
      'A/B test caption lengths, posting times and content formats',
      'Adjust your content calendar based on real data, not guesses'
    ],
    legacy: 'Posting blindly with no idea what actually works',
    winning: 'Data-driven decisions that compound your growth month over month'
  },
  {
    title: 'Scale with autopilot',
    desc: 'Hand off the routine to Anomalia — it plans, writes, designs and publishes while you focus on your business.',
    steps: [
      'Connect your CMS and social accounts to Anomalia',
      'Set your content pillars and brand voice in the onboarding',
      'Review and approve the weekly editorial plan',
      'Let the autopilot run — you just approve from chat or email'
    ],
    legacy: 'Spending 20+ hours a week on content creation',
    winning: '10 minutes a week. The rest runs itself.'
  },
  {
    title: 'Compound with AI visibility',
    desc: 'Get cited by ChatGPT, Perplexity and Gemini — the new frontier of organic discovery.',
    steps: [
      'Add TL;DR summaries to every blog article',
      'Create FAQ pages that AI loves to quote',
      'Generate and publish your llms.txt file',
      'Track your AI visibility score and improve month over month'
    ],
    legacy: 'Invisible to AI search engines — your competitors get cited instead',
    winning: 'AI assistants recommend your brand by name in their answers'
  }
];

const TAKEAWAYS_BY_CATEGORY: Record<string, string[]> = {
  food: [
    'Food content is 3× more engaging when it shows the process, not just the final dish',
    'Posting at meal times (11am, 6pm) drives 40% more engagement than off-hours',
    'Behind-the-scenes content builds more trust than polished product shots',
    'User-generated content (customer photos) converts 2× better than branded posts',
    'Seasonal menus and limited-time offers create urgency that fills tables'
  ],
  retail: [
    'Product posts with lifestyle context convert 3× better than plain product shots',
    'User-generated content drives 4× more trust than brand-created content',
    'Limited drops and scarcity messaging create urgency and FOMO',
    'Blog articles about "how to choose [product]" capture high-intent search traffic',
    'Consistent posting builds the brand familiarity that drives repeat purchases'
  ],
  health: [
    'Patients search by symptom ("back pain relief"), not by treatment — your content should match',
    'Before/after content (where ethical) builds more trust than any other format',
    'Educational content positions you as the expert and reduces consultation friction',
    'Google Business Profile reviews mentioning specific conditions double as ranking fuel',
    'Consistent publishing signals authority to both Google and AI search engines'
  ],
  beauty: [
    'Transformation content (before/after) drives 5× more saves than any other format',
    'Reels and TikToks showing the process outperform static images 3:1',
    'Seasonal content (prom looks, summer skin) creates predictable engagement spikes',
    'Tagging products in posts turns your feed into a shoppable catalog',
    'Client testimonials in video format convert better than written reviews'
  ],
  fitness: [
    'Workout demos and exercise tutorials are the #1 content format for fitness brands',
    'Transformation posts (with permission) drive the most DMs and sign-ups',
    'Posting class schedules and reminders fills spots that would otherwise go empty',
    'Community content (member spotlights) builds belonging and reduces churn',
    'Blog articles targeting "best workout for [goal]" capture high-intent search traffic'
  ],
  services: [
    'Educational content that answers real questions builds trust before the first call',
    'Case studies and results (anonymized) convert better than any other content type',
    'Local SEO content ("best [service] in [city]") captures high-intent search traffic',
    'Consistent posting signals stability and reliability to potential clients',
    'FAQ blog articles reduce consultation time by pre-answering common questions'
  ],
  creative: [
    'Portfolio showcases drive more inquiries than any other content format',
    'Behind-the-scenes content (your process) builds perceived value and justifies pricing',
    'Personal brand content (your story, your why) differentiates you from competitors',
    'Blog articles about your craft establish authority and capture search traffic',
    'Client testimonials in video format convert 3× better than text reviews'
  ],
  local: [
    'Local content (neighborhood guides, local events) captures "near me" search traffic',
    'Google Business Profile is your #1 asset — more important than your website',
    'Consistent posting keeps you top-of-mind when locals need your service',
    'Before/after project content drives more inquiries than any other format',
    'Reviews mentioning your specific service double as ranking fuel and social proof'
  ]
};

const RELATED_MAP: Record<string, string[]> = {
  restaurant: ['cafe', 'bakery', 'pizzeria'],
  cafe: ['restaurant', 'bakery', 'pizzeria'],
  bakery: ['restaurant', 'cafe', 'pizzeria'],
  pizzeria: ['restaurant', 'cafe', 'bakery'],
  ecommerce: ['fashion-brand', 'jewelry-store', 'pet-shop'],
  'fashion-brand': ['ecommerce', 'jewelry-store', 'hair-salon'],
  'jewelry-store': ['ecommerce', 'fashion-brand', 'nail-studio'],
  'pet-shop': ['ecommerce', 'veterinary', 'dog-groomer'],
  'dental-clinic': ['chiropractor', 'nutritionist', 'mental-health'],
  chiropractor: ['dental-clinic', 'nutritionist', 'personal-trainer'],
  nutritionist: ['chiropractor', 'personal-trainer', 'yoga-studio'],
  'mental-health': ['nutritionist', 'yoga-studio', 'coach'],
  'hair-salon': ['nail-studio', 'barbershop', 'spa'],
  'nail-studio': ['hair-salon', 'spa', 'esthetician'],
  spa: ['hair-salon', 'nail-studio', 'yoga-studio'],
  barbershop: ['hair-salon', 'personal-trainer', 'gym'],
  gym: ['personal-trainer', 'crossfit-box', 'yoga-studio'],
  'yoga-studio': ['gym', 'personal-trainer', 'spa'],
  'personal-trainer': ['gym', 'crossfit-box', 'nutritionist'],
  'crossfit-box': ['gym', 'personal-trainer', 'nutritionist'],
  'law-firm': ['accountant', 'real-estate', 'agency'],
  'real-estate': ['law-firm', 'accountant', 'cleaning-service'],
  accountant: ['law-firm', 'real-estate', 'agency'],
  'cleaning-service': ['real-estate', 'plumber', 'electrician'],
  photographer: ['agency', 'freelancer', 'coach'],
  agency: ['freelancer', 'photographer', 'coach'],
  freelancer: ['agency', 'photographer', 'coach'],
  coach: ['freelancer', 'agency', 'personal-trainer'],
  hotel: ['restaurant', 'spa', 'photographer'],
  'auto-shop': ['plumber', 'electrician', 'cleaning-service'],
  plumber: ['electrician', 'cleaning-service', 'auto-shop'],
  electrician: ['plumber', 'cleaning-service', 'auto-shop']
};

const SEARCH_VOL: Record<string, string> = {
  restaurant: '12.1K', cafe: '8.4K', bakery: '6.2K', pizzeria: '5.8K',
  ecommerce: '45.2K', 'fashion-brand': '18.7K', 'jewelry-store': '9.3K', 'pet-shop': '7.1K',
  'dental-clinic': '22.4K', chiropractor: '14.8K', nutritionist: '11.2K', 'mental-health': '16.5K',
  'hair-salon': '19.3K', 'nail-studio': '8.9K', spa: '15.6K', barbershop: '7.2K',
  gym: '28.1K', 'yoga-studio': '12.4K', 'personal-trainer': '21.7K', 'crossfit-box': '9.8K',
  'law-firm': '31.5K', 'real-estate': '38.2K', accountant: '17.9K', 'cleaning-service': '13.4K',
  photographer: '16.8K', agency: '24.3K', freelancer: '19.1K', coach: '14.6K',
  hotel: '42.7K', 'auto-shop': '11.9K', plumber: '18.3K', electrician: '12.7K'
};

const CATEGORY_MAP: Record<string, string> = {
  restaurant: 'food', cafe: 'food', bakery: 'food', pizzeria: 'food',
  ecommerce: 'retail', 'fashion-brand': 'retail', 'jewelry-store': 'retail', 'pet-shop': 'retail',
  'dental-clinic': 'health', chiropractor: 'health', nutritionist: 'health', 'mental-health': 'health',
  'hair-salon': 'beauty', 'nail-studio': 'beauty', spa: 'beauty', barbershop: 'beauty',
  gym: 'fitness', 'yoga-studio': 'fitness', 'personal-trainer': 'fitness', 'crossfit-box': 'fitness',
  'law-firm': 'services', 'real-estate': 'services', accountant: 'services', 'cleaning-service': 'services',
  photographer: 'creative', agency: 'creative', freelancer: 'creative', coach: 'creative',
  hotel: 'local', 'auto-shop': 'local', plumber: 'local', electrician: 'local'
};

export function getPlaybook(slug: string): Playbook | null {
  const category = CATEGORY_MAP[slug];
  if (!category) return null;

  return {
    slug,
    category,
    kd: getKd(slug),
    searchVol: SEARCH_VOL[slug] || '10K',
    phases: PHASES,
    takeaways: TAKEAWAYS_BY_CATEGORY[category] || TAKEAWAYS_BY_CATEGORY['services'],
    relatedSlugs: RELATED_MAP[slug] || ['restaurant', 'ecommerce', 'gym']
  };
}

function getKd(slug: string): number {
  const kdMap: Record<string, number> = {
    restaurant: 52, cafe: 44, bakery: 41, pizzeria: 48,
    ecommerce: 68, 'fashion-brand': 58, 'jewelry-store': 49, 'pet-shop': 42,
    'dental-clinic': 64, chiropractor: 54, nutritionist: 52, 'mental-health': 61,
    'hair-salon': 47, 'nail-studio': 39, spa: 45, barbershop: 43,
    gym: 64, 'yoga-studio': 51, 'personal-trainer': 56, 'crossfit-box': 52,
    'law-firm': 72, 'real-estate': 69, accountant: 58, 'cleaning-service': 46,
    photographer: 54, agency: 62, freelancer: 48, coach: 55,
    hotel: 61, 'auto-shop': 49, plumber: 52, electrician: 47
  };
  return kdMap[slug] || 50;
}

