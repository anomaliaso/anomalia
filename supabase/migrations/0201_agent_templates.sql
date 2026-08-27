-- 0201 agent_templates: the public Agent Library.
--
-- Custom Agents (Automations › Custom Agents) starts from an empty list and a blank prompt box,
-- which is the worst possible first screen: the feature only pays off once you know what to ask
-- for. This table is the answer — a catalogue of ready-made agents (prompt + schedule + hub
-- specialist already chosen) that a user installs in one click, and that doubles as a public,
-- indexable directory at /agents and /agents/{slug}.
--
-- Global, not brand-scoped: one library, read by everyone (anon included — the directory is a
-- marketing surface). Writes are service-role only.
--
-- Deploys do NOT run migrations. Apply before shipping code that selects these columns.
-- Applied to Supabase kszazivzwievqixcnanp via MCP.

create table if not exists public.agent_templates (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  -- One line on the card. The long copy lives in `description`.
  tagline text not null,
  description text,
  category text not null check (
    category in ('content', 'growth', 'seo', 'sales', 'ops', 'brand')
  ),
  tags text[] not null default '{}',
  -- Composio toolkit slugs shown as badges (empty = works with Anomalia's own data only).
  integrations text[] not null default '{}',
  -- What gets copied into custom_agent_schedules.prompt on install.
  prompt text not null,
  -- Built-in hub specialist: publish | brand | grow | web. null = Anomalia auto (full tool set).
  agent text check (agent is null or agent in ('publish', 'brand', 'grow', 'web')),
  -- Filled by the seed below with a scattered face/colour per slug. See $lib/agent-templates.ts:
  -- a row without one still renders, from a seeded pick, so this is never load-bearing.
  avatar_face text check (
    avatar_face is null
    or avatar_face in ('wide', 'dot', 'wink', 'sleepy', 'smile', 'happy', 'visor', 'surprise')
  ),
  avatar_color text check (avatar_color is null or avatar_color ~ '^#[0-9a-f]{6}$'),
  days_of_week int[] not null default '{1,2,3,4,5}',
  times text[] not null default '{09:00}',
  reuse_thread boolean not null default false,
  -- Bullets on the detail page: what the run actually does, and what it leaves behind.
  highlights text[] not null default '{}',
  outputs text[] not null default '{}',
  featured boolean not null default false,
  sort_order int not null default 0,
  status text not null default 'published' check (status in ('published', 'draft', 'archived')),
  install_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_templates_status_idx
  on public.agent_templates (status, sort_order);
create index if not exists agent_templates_category_idx
  on public.agent_templates (category) where status = 'published';

alter table public.agent_templates enable row level security;

-- The directory is public: anon reads it too (that is the whole point of /agents).
drop policy if exists "agent_templates read published" on public.agent_templates;
create policy "agent_templates read published"
  on public.agent_templates for select to anon, authenticated
  using (status = 'published');

-- Provenance: which library agent a scheduled agent came from (null = written from scratch).
alter table public.custom_agent_schedules
  add column if not exists template_slug text;

create index if not exists custom_agent_schedules_template_idx
  on public.custom_agent_schedules (template_slug) where template_slug is not null;

-- Install counter, bumped from the app with the service role.
create or replace function public.bump_agent_template_installs(p_slug text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.agent_templates
  set install_count = install_count + 1, updated_at = now()
  where slug = p_slug;
$$;

-- security definer + a public catalogue is a bad combination unless the grant is narrowed:
-- only the server (service role) may bump the counter, never a browser session.
revoke all on function public.bump_agent_template_installs(text) from public, anon, authenticated;
grant execute on function public.bump_agent_template_installs(text) to service_role;

-- ── Seed ─────────────────────────────────────────────────────────────────────
-- Idempotent: re-running refreshes the copy but never resets install_count, and never
-- overwrites an avatar an editor pinned by hand.

insert into public.agent_templates
  (slug, name, tagline, description, category, tags, integrations, prompt, agent,
   days_of_week, times, reuse_thread, highlights, outputs, featured, sort_order)
values
  -- ── Content ────────────────────────────────────────────────────────────────
  ('queue-guardian', 'Queue Guardian',
   'Reviews every pending post each morning and fixes what drifted off-brand.',
   'The agent that makes the approval queue stop being a chore. Every morning it opens the posts waiting for you, reads them against the brand voice and the editorial plan, rewrites the captions that drifted, flags the ones that need a human call, and leaves a short recap so you can approve the batch in a minute instead of half an hour.',
   'content', '{queue,captions,review}', '{}',
   'Open the posts currently pending approval. For each one: check the caption against the brand voice and the editorial plan, fix anything that drifted (tone, claims, CTA, hashtags), and make sure the visual brief still matches the caption. Leave posts that need a human decision untouched and list them separately. End with a short recap: how many you fixed, what you changed, what needs my call.',
   'publish', '{1,2,3,4,5}', '{08:30}', false,
   '{"Reads every pending post against your brand voice","Rewrites captions that drifted off-brand","Separates what it fixed from what needs your call"}',
   '{"A fixed, ready-to-approve queue","A one-screen recap in chat"}', true, 10),

  ('caption-doctor', 'Caption Doctor',
   'Rewrites weak captions with a stronger hook and a clearer CTA.',
   'Most posts die in the first line. This agent goes through the captions you have scheduled, rewrites the openers that will not stop a thumb, tightens the middle, and makes sure every post ends with one clear next step instead of three vague ones.',
   'content', '{captions,copywriting,hooks}', '{}',
   'Go through the captions scheduled for the next 7 days. For each one, judge the first line as a scroll-stopper: if it is weak, rewrite it. Tighten the body, remove filler, and make sure there is exactly one clear CTA. Keep the brand voice. Apply the rewrites and report the before/after of the three biggest improvements.',
   'publish', '{1,3,5}', '{10:00}', false,
   '{"Judges every opening line as a scroll-stopper","Cuts filler and enforces one clear CTA","Shows you the biggest before/after wins"}',
   '{"Rewritten captions saved on the posts","A before/after digest"}', false, 20),

  ('carousel-factory', 'Carousel Factory',
   'Turns this week''s plan into finished carousels, slide by slide.',
   'Carousels are the highest-effort format and the first thing that slips. This agent produces them for you: it takes the themes from the editorial plan, writes each slide, keeps the arc tight, and hands you a full carousel ready for design review.',
   'content', '{carousel,production,plan}', '{}',
   'Look at the editorial plan for this week and pick the themes best suited to a carousel. Produce two complete carousels: for each, write every slide (cover hook, 5-7 body slides, closing CTA), keep one idea per slide, and add the visual brief for the designer. Save them as drafts and tell me which theme you picked and why.',
   'publish', '{1,4}', '{09:00}', false,
   '{"Picks the themes that actually suit a carousel","Writes every slide plus the visual brief","Saves finished drafts, not outlines"}',
   '{"Two carousel drafts per run","A note on the themes chosen"}', true, 30),

  ('hook-lab', 'Hook Lab',
   'Ships ten fresh hooks a day, built on what is working in your niche.',
   'A hook bank that refills itself. The agent studies what performed in your feed and your competitors'', then writes ten new openers you can drop straight onto a post — no generic "did you know" filler.',
   'content', '{hooks,ideas,copywriting}', '{}',
   'Look at my best performing posts of the last 30 days and at what my competitors published this week. Write 10 new hooks I could use, each tied to a concrete angle from my brand (not generic). For each hook, add one line on why it works and which format it suits. Save them to the knowledge base so we can reuse them.',
   'publish', '{1,2,3,4,5}', '{07:30}', true,
   '{"Grounded in your own top performers","Ten usable openers, never generic filler","Stored in the knowledge base for reuse"}',
   '{"10 hooks a day, saved as a note"}', false, 40),

  ('repurpose-machine', 'Repurpose Machine',
   'Turns every new blog article into a week of social posts.',
   'You wrote the long thing once. This agent mines it: each new article becomes a thread, a carousel, two short-form scripts and a set of quote cards, all in the brand voice and scheduled into the gaps in your plan.',
   'content', '{repurposing,blog,multiformat}', '{}',
   'Find the blog articles published since your last run. For each one, produce: a text thread, a carousel outline, two short-form video scripts, and three quote cards. Keep every piece standalone (no "as I wrote in the article"). Save them as drafts on the days the editorial plan has room, and give me the list.',
   'publish', '{2,5}', '{11:00}', false,
   '{"One article becomes five social assets","Every piece stands on its own","Dropped into the free slots in your plan"}',
   '{"Drafted posts across formats","A mapping of article → assets"}', true, 50),

  ('story-planner', 'Story Planner',
   'Plans the day''s stories before you open the app.',
   'Stories are where consistency dies first. Every morning this agent lays out the day''s sequence — the opener, the value beat, the proof, the ask — with the copy written and the asset brief attached.',
   'content', '{stories,daily,planning}', '{}',
   'Plan today''s Instagram stories: a 4-6 frame sequence with a clear arc (hook, value, proof, ask). Write the on-screen copy for each frame, note what to film or which asset to reuse, and add the poll/question sticker where it helps. Keep it to something I can shoot in ten minutes.',
   'publish', '{1,2,3,4,5}', '{08:00}', true,
   '{"A full frame-by-frame sequence","On-screen copy already written","Shootable in ten minutes"}',
   '{"Today''s story plan in chat"}', false, 60),

  ('reels-scripter', 'Reels Scripter',
   'Writes short-form scripts with the beats timed out.',
   'Not a caption with line breaks — a real script. Hook in the first two seconds, the beats timed, the b-roll named, the on-screen text written, and a CTA that fits the format.',
   'content', '{video,reels,tiktok,scripts}', '{}',
   'Write three short-form video scripts (25-45 seconds) from the themes in the editorial plan. For each: the hook line for the first 2 seconds, the beats with timings, the on-screen text, the b-roll or shot list, and the spoken CTA. Ground them in my product and my audience, not generic advice. Save as drafts.',
   'publish', '{1,3}', '{09:30}', false,
   '{"Timed beats, not a wall of text","Shot list and on-screen text included","Three scripts per run"}',
   '{"Three short-form scripts, saved as drafts"}', false, 70),

  ('evergreen-recycler', 'Evergreen Recycler',
   'Finds your best old posts and reissues them, rewritten.',
   'Your best post is nine months old and nobody has seen it since. This agent digs it out, checks it is still true, rewrites it so it does not read as a repost, and schedules it into a quiet slot.',
   'content', '{evergreen,recycling,archive}', '{}',
   'Find posts older than 90 days that performed in the top 20% and are still accurate. Pick two. Rewrite each one properly — new hook, new framing, updated numbers — so it reads as a new post, not a repost. Schedule them into slots the editorial plan leaves empty and tell me what you picked.',
   'publish', '{4}', '{15:00}', false,
   '{"Only reissues posts that still hold up","Rewrites rather than reposts","Fills the gaps in the plan"}',
   '{"Two rewritten evergreen posts, scheduled"}', false, 80),

  ('ugc-brief-writer', 'UGC Brief Writer',
   'Writes creator briefs your collaborators can actually shoot.',
   'A brief that says "make it feel authentic" wastes everyone''s week. This agent writes the real thing: the angle, the hook, the must-say lines, the shot list, the do-nots, and the deliverable spec.',
   'content', '{ugc,creators,briefs}', '{}',
   'Write two UGC creator briefs based on the products and angles in the editorial plan. Each brief: the concept in one line, the target viewer, the hook, the three must-say points, the shot list, the do-nots, the deliverable spec (length, ratio, captions), and the usage terms placeholder. Keep them shootable by one person with a phone.',
   'publish', '{2}', '{10:30}', false,
   '{"Concrete angle, not a vibe","Shot list, must-says and do-nots","Shootable solo with a phone"}',
   '{"Two creator briefs per run"}', false, 90),

  -- ── Growth ─────────────────────────────────────────────────────────────────
  ('competitor-watchdog', 'Competitor Watchdog',
   'Reports what your competitors shipped, and what it means for you.',
   'Not a feed dump. Every morning the agent reads what your tracked competitors posted, separates the noise from the moves that matter, and tells you what to copy, what to counter, and what to ignore.',
   'growth', '{competitors,monitoring,intel}', '{}',
   'Check what my tracked competitors published in the last 24 hours. Ignore routine posts. For anything that signals a move (new positioning, a launch, a format that is working, a price change), tell me: what they did, why it matters to us, and the one thing I should do about it this week. Keep it under ten lines.',
   'grow', '{1,2,3,4,5}', '{08:00}', true,
   '{"Filters routine posts out of the report","Names the move, not just the post","One recommended action per signal"}',
   '{"A daily under-ten-lines intel brief"}', true, 100),

  ('trend-radar', 'Trend Radar',
   'Catches the trends in your field early enough to be useful.',
   'The agent watches the sources that actually move your niche, and pings you only when something is rising and relevant — with the angle you could take on it while it is still early.',
   'growth', '{trends,radar,timing}', '{}',
   'Scan what is moving in my field right now (topics, formats, conversations, news). Discard anything that does not fit my brand. For the two or three that do: what is rising, how early we are, and a specific angle I could post this week. If nothing is worth it, say so in one line instead of padding.',
   'grow', '{1,2,3,4,5}', '{09:00}', true,
   '{"Only reports what fits your brand","Tells you how early you are","Says ''nothing today'' when that is true"}',
   '{"A short trend brief with post-ready angles"}', true, 110),

  ('engagement-coach', 'Engagement Coach',
   'Tells you where to spend your 20 minutes of engagement.',
   'Commenting everywhere is not a strategy. This agent picks the specific accounts and threads where your reply will be seen by the right people, and drafts openers you can post as they are.',
   'growth', '{engagement,community,comments}', '{}',
   'Find the ten conversations happening right now where a comment from us would reach the right audience: accounts our buyers follow, threads on our topics, posts with momentum and few good replies. For each, draft a comment that adds something real (no "great post"). Rank them so I can do the top five in ten minutes.',
   'grow', '{1,2,3,4,5}', '{12:00}', true,
   '{"Picks threads by audience overlap, not size","Drafts comments that add something","Ranked so the top five is enough"}',
   '{"Ten ranked engagement targets with drafted replies"}', false, 120),

  ('audience-listener', 'Audience Listener',
   'Mines comments and DMs for the things your audience keeps asking.',
   'Your next ten posts are already written — in your replies. The agent reads incoming comments and messages, clusters the recurring questions and objections, and turns each cluster into a content angle.',
   'growth', '{audience,research,comments}', '{}',
   'Read the comments and messages we received this week. Cluster them into recurring questions, objections and misunderstandings. For each cluster: how often it came up, the exact words people use, and the post that would answer it. Save the vocabulary to the knowledge base so our copy uses their words.',
   'grow', '{5}', '{16:00}', false,
   '{"Clusters what people actually ask","Captures their exact vocabulary","Turns each cluster into a post angle"}',
   '{"A weekly audience-voice digest","Vocabulary saved to the brand knowledge base"}', false, 130),

  ('weekly-growth-report', 'Weekly Growth Report',
   'One honest page on what grew, what flopped, and what to change.',
   'Every Monday: the numbers, what caused them, and the one change worth making. No vanity charts, no "engagement is up 3%" with no explanation.',
   'growth', '{analytics,reporting,weekly}', '{slack}',
   'Pull last week''s performance across channels. Write one page: what grew and why, what flopped and why, the single best post and what made it work, the single worst and what to learn. End with exactly one change to make this week. Compare against the previous two weeks so the numbers have context.',
   'grow', '{1}', '{08:00}', false,
   '{"Explains the numbers instead of listing them","Names one change, not a wishlist","Three weeks of context, always"}',
   '{"A Monday one-pager in chat"}', true, 140),

  ('collab-scout', 'Collab Scout',
   'Finds the accounts worth a collaboration, with the pitch written.',
   'Finds creators and brands whose audience overlaps yours without competing, checks they are actually active, and writes the opening message for each.',
   'growth', '{partnerships,creators,outreach}', '{}',
   'Find eight accounts in or adjacent to my niche worth collaborating with: real audience overlap, no direct competition, posting consistently in the last 30 days. For each: who they are, why the overlap works, the format the collaboration should take, and a two-line opening DM in my voice.',
   'grow', '{3}', '{11:00}', false,
   '{"Overlap without competition","Filters out dormant accounts","A written opener for each"}',
   '{"Eight collaboration targets with drafted DMs"}', false, 150),

  ('hashtag-curator', 'Hashtag Curator',
   'Keeps your tag sets current instead of copy-pasted forever.',
   'Tag sets rot. The agent re-checks the ones you use, drops the ones that went dead or generic, and proposes fresh mixes sized for where you actually are.',
   'growth', '{hashtags,discovery,reach}', '{}',
   'Review the hashtag sets we are using. Drop tags that are dead, too broad for our size, or off-topic. Propose three refreshed sets (one per content pillar), each mixing large, mid and niche tags appropriate to our follower count. Explain each swap in a few words.',
   'grow', '{4}', '{14:00}', false,
   '{"Re-checks the tags you already use","Sizes the mix to your account","Explains every swap"}',
   '{"Three refreshed tag sets with reasoning"}', false, 160),

  -- ── SEO & GEO ──────────────────────────────────────────────────────────────
  ('seo-nightwatch', 'SEO Nightwatch',
   'Works your SEO backlog overnight, one initiative at a time.',
   'The SEO grade is full of open initiatives nobody gets to. Every night this agent takes the highest-impact one it can finish alone, does it, and reports what moved.',
   'seo', '{seo,backlog,technical}', '{}',
   'Open the SEO grade and the initiative list. Pick the highest-impact initiative you can complete on your own tonight, do it end to end, and verify the fix. Then report: what you did, what it should move, and what the next-best initiative is. Do not start something you cannot finish in this run.',
   'web', '{1,2,3,4,5}', '{02:00}', false,
   '{"One finished initiative per night","Verifies the fix before reporting","Always names the next-best move"}',
   '{"A completed SEO initiative","A morning report on what changed"}', true, 170),

  ('keyword-hunter', 'Keyword Hunter',
   'Brings back keywords you can actually rank for.',
   'No 40k-volume head terms you will never win. The agent hunts the long tail your site has a real shot at, checks the SERP is beatable, and hands you the brief.',
   'seo', '{keywords,research,longtail}', '{}',
   'Find fifteen new keyword opportunities for my site: real search intent, difficulty we can realistically beat, and no cannibalisation with pages we already rank for. Check the current SERP for each and say what kind of page wins it. Rank by opportunity and add a one-line content brief for the top five.',
   'web', '{2,4}', '{07:00}', false,
   '{"Only keywords you can realistically win","Reads the SERP before recommending","Content brief for the top five"}',
   '{"Fifteen ranked keyword opportunities","Five short content briefs"}', false, 180),

  ('geo-visibility-tracker', 'GEO Visibility Tracker',
   'Tracks whether the AI answers mention you — and why not.',
   'People ask an assistant before they ask a search engine. This agent runs your key prompts, records who gets cited, and tells you the specific gap keeping you out of the answer.',
   'seo', '{geo,ai-visibility,citations}', '{}',
   'Run our tracked prompts through the AI answer engines. Record which brands get cited and where we appear. When we are missing, diagnose why: is the source missing, is the claim uncited, is a competitor owning the definition? Give me the three fixes most likely to get us cited, in priority order.',
   'web', '{1,4}', '{06:00}', false,
   '{"Runs your real prompts, not proxies","Diagnoses why you are missing","Three prioritised fixes"}',
   '{"A citation snapshot per run","Three ranked GEO fixes"}', true, 190),

  ('blog-drafter', 'Blog Drafter',
   'Writes the next article from the keyword plan, end to end.',
   'Takes the top opportunity from the keyword strategy and writes the whole article — structured for the SERP that already exists, internally linked, and saved as a draft you can edit.',
   'seo', '{blog,writing,content}', '{}',
   'Take the highest-priority keyword from our strategy that has no article yet. Study the SERP, then write the full article: a structure that beats what ranks, real substance from our knowledge base (not generic filler), internal links to our existing pages, meta title and description. Save it as a draft and tell me the keyword and the angle.',
   'web', '{1,3,5}', '{05:00}', false,
   '{"Structured against the live SERP","Grounded in your own knowledge base","Internal links and metadata included"}',
   '{"A complete article draft per run"}', true, 200),

  ('broken-link-patrol', 'Broken Link Patrol',
   'Crawls the site and fixes what is broken before users find it.',
   'Dead links, redirect chains, orphan pages, missing metadata. The agent sweeps weekly, fixes what it safely can and reports the rest with the exact remedy.',
   'seo', '{technical,crawl,maintenance}', '{}',
   'Crawl the site and find: broken internal and external links, redirect chains, orphan pages, missing or duplicate titles and descriptions. Fix what is unambiguous and safe. For everything else, give me the page, the problem and the exact fix. Sort by how much traffic each affected page gets.',
   'web', '{6}', '{04:00}', false,
   '{"Fixes the unambiguous problems itself","Sorted by traffic at risk","Exact remedy for the rest"}',
   '{"A repaired site","A weekly technical report"}', false, 210),

  ('internal-link-builder', 'Internal Link Builder',
   'Wires new articles into the pages that need the authority.',
   'Every new page arrives an orphan. The agent finds the natural anchors across the existing site and links them properly, in both directions.',
   'seo', '{internal-links,authority,structure}', '{}',
   'Find pages published in the last 30 days with too few internal links pointing at them. For each, locate the existing pages where a link would be genuinely relevant, and add it with a natural anchor. Also link the new page out to our cornerstone content. Report every link you added.',
   'web', '{3}', '{05:30}', false,
   '{"Finds genuinely relevant anchors","Links in both directions","Reports every edit"}',
   '{"New internal links live on the site","A log of what was linked"}', false, 220),

  ('backlink-prospector', 'Backlink Prospector',
   'Finds linkable prospects and writes the pitch.',
   'Looks at who links to your competitors and not to you, filters for sites that actually pass value, and drafts a pitch tied to a specific page of theirs.',
   'seo', '{backlinks,outreach,authority}', '{}',
   'Find ten sites that link to our competitors but not to us and that would plausibly link to a page we already have. Skip link farms and dead blogs. For each: the site, the page of ours they should link to, the page of theirs that makes the link natural, and a short pitch email referencing their actual content.',
   'web', '{2}', '{10:00}', false,
   '{"Competitor link gap, filtered for quality","Matches their page to yours","A specific, non-templated pitch"}',
   '{"Ten backlink prospects with drafted pitches"}', false, 230),

  ('serp-drop-alarm', 'SERP Drop Alarm',
   'Notices a ranking fall the day it happens, not next quarter.',
   'Daily position check on the keywords that matter, with a cause attached: a competitor moved, the SERP changed shape, or something on your page broke.',
   'seo', '{rankings,monitoring,alerts}', '{}',
   'Check today''s positions for our tracked keywords against the last 7 and 30 days. Report only meaningful drops (ignore one-position noise). For each drop, diagnose the likely cause: a competitor gained, the SERP layout changed, or our page changed. Recommend the fix. If nothing dropped, say so in one line.',
   'web', '{1,2,3,4,5}', '{07:00}', true,
   '{"Ignores one-position noise","Attaches a cause to every drop","One line when all is well"}',
   '{"A daily ranking alert, only when it matters"}', false, 240),

  ('llms-txt-keeper', 'llms.txt Keeper',
   'Keeps your llms.txt honest as the site changes.',
   'The file you generated once and never touched again. The agent re-checks it against the live site, adds what shipped, removes what died, and validates the syntax.',
   'seo', '{llms-txt,ai,maintenance}', '{}',
   'Compare our llms.txt against the site as it is today. Add pages worth exposing that are missing, remove entries that 404 or moved, tighten the descriptions so an assistant can tell pages apart, and validate the format. Report the diff.',
   'web', '{6}', '{06:00}', false,
   '{"Diffed against the live site","Descriptions written for assistants","Format validated"}',
   '{"An updated llms.txt","A diff report"}', false, 250),

  -- ── Sales & Leads ──────────────────────────────────────────────────────────
  ('lead-finder-daily', 'Daily Lead Finder',
   'Brings you people showing buying intent today.',
   'Runs the radar every morning, filters out the tyre-kickers, and hands you a short list of people with a real reason to talk — each with the context and an opener.',
   'sales', '{leads,intent,prospecting}', '{}',
   'Run the lead radar and bring back today''s best prospects. Discard anyone without a concrete signal. For each keeper: who they are, the exact signal (what they said or did and when), why we fit, and a two-line first message referencing their own words. Rank by how warm they are.',
   'grow', '{1,2,3,4,5}', '{08:30}', false,
   '{"Only prospects with a concrete signal","Quotes the signal, with a date","A first message written per lead"}',
   '{"A ranked daily prospect list"}', true, 260),

  ('inbound-triager', 'Inbound Triager',
   'Sorts the inbox into buyers, noise and things on fire.',
   'Reads what came in overnight, tells you which three messages actually matter, and drafts the replies. Never sends anything on its own.',
   'sales', '{inbox,triage,replies}', '{gmail,slack}',
   'Go through the messages that arrived since your last run. Sort them: real buying interest, needs a human answer, can wait, ignore. For the first two groups, draft a reply in my voice. Never send anything — leave everything as a draft. Start the recap with the three messages that matter most today.',
   null, '{1,2,3,4,5}', '{07:45}', true,
   '{"Sorts by intent, not by sender","Drafts replies in your voice","Never sends — drafts only"}',
   '{"A triaged inbox summary","Drafted replies waiting for you"}', false, 270),

  ('outreach-writer', 'Outreach Writer',
   'Writes cold messages that reference something real.',
   'Takes your prospect list and writes each message from that person''s own activity — no merge-field templates that everyone recognises on sight.',
   'sales', '{outreach,cold-email,personalisation}', '{gmail}',
   'Take the prospects in our list that have not been contacted. For each, research what they recently published, launched or complained about, and write a short outreach message that opens on that specific thing. One clear ask, no flattery, no template language. Save each as a draft and flag any prospect where you could not find anything real to reference.',
   null, '{2,4}', '{09:30}', false,
   '{"Opens on something the prospect actually did","One ask, no template language","Flags prospects with nothing to reference"}',
   '{"Drafted outreach messages per prospect"}', false, 280),

  ('follow-up-keeper', 'Follow-up Keeper',
   'Chases the conversations that went quiet.',
   'Deals do not die from rejection, they die from silence. The agent tracks who owes a reply, drafts the nudge with a new reason to respond, and keeps the cadence sane.',
   'sales', '{follow-up,pipeline,nudges}', '{gmail,hubspot}',
   'Find every conversation waiting on a reply for more than four days. For each, draft a follow-up that adds a new reason to respond (a resource, a relevant update, a specific question) instead of "just checking in". Respect a sane cadence — never more than three follow-ups. List who to drop.',
   null, '{1,3,5}', '{10:00}', false,
   '{"Tracks silence, not just replies","Every nudge adds a new reason","Caps the cadence at three"}',
   '{"Drafted follow-ups","A drop list"}', false, 290),

  ('crm-hygienist', 'CRM Hygienist',
   'Keeps the pipeline honest so the numbers mean something.',
   'Stale deals, missing fields, duplicates, contacts with no next step. The agent cleans what it can and hands you the decisions only you can make.',
   'sales', '{crm,hygiene,pipeline}', '{hubspot,googlesheets}',
   'Audit the CRM: deals with no activity in 30 days, records missing key fields, duplicates, contacts with no next step scheduled. Fix what is mechanical (deduplicate, fill from other records, correct formats). For the judgement calls — which stale deals to close-lost — give me the list with your recommendation.',
   null, '{5}', '{17:00}', false,
   '{"Fixes the mechanical problems itself","Escalates only real judgement calls","Weekly, so it never piles up"}',
   '{"A cleaned CRM","A close-lost recommendation list"}', false, 300),

  -- ── Ops & Reporting ────────────────────────────────────────────────────────
  ('morning-brief', 'Morning Brief',
   'Everything that happened while you slept, on one screen.',
   'Publishing, performance, leads, errors, and what needs you today — merged into a single short brief instead of six dashboards.',
   'ops', '{brief,daily,overview}', '{slack}',
   'Give me one short morning brief: what published overnight and how it performed, anything that failed and why, new leads and messages worth my attention, and the three things that need a decision from me today. Lead with anything broken. Keep it under fifteen lines.',
   null, '{1,2,3,4,5}', '{07:00}', true,
   '{"Merges six dashboards into one brief","Leads with anything broken","Under fifteen lines, always"}',
   '{"A daily morning brief in chat"}', true, 310),

  ('publishing-watchdog', 'Publishing Watchdog',
   'Catches failed publishes and expired tokens the same hour.',
   'A post that silently failed at 9am is a whole day lost. The agent checks the pipeline several times a day, retries what is safe, and shouts about what is not.',
   'ops', '{monitoring,publishing,errors}', '{slack}',
   'Check the publishing pipeline: posts that failed, accounts with expired or expiring tokens, scheduled posts missing an asset, and anything stuck in a queue. Retry what is safe to retry. For everything else, tell me exactly what broke, which account, and what I have to do. If everything is healthy, reply with one line.',
   null, '{1,2,3,4,5,6,0}', '{09:15,14:15,19:15}', true,
   '{"Runs three times a day, every day","Retries what is safe automatically","One line when everything is fine"}',
   '{"An incident report when something breaks"}', false, 320),

  ('weekly-recap-mailer', 'Weekly Recap',
   'The Friday summary you can forward without editing.',
   'Written for someone who was not in the room: what shipped, what it produced, what is next, and what needs a decision. Clean enough to send to a client or a founder as it is.',
   'ops', '{reporting,weekly,stakeholders}', '{gmail,slack,notion}',
   'Write this week''s recap for a stakeholder who was not involved: what we published, how it performed against the previous week, what we learned, what is planned for next week, and any decision I need from them. Plain language, no jargon, no internal shorthand. Make it forwardable as is.',
   null, '{5}', '{16:00}', false,
   '{"Written for someone outside the team","Compared against last week","Forwardable without editing"}',
   '{"A stakeholder-ready weekly recap"}', false, 330),

  ('content-health-audit', 'Content Health Audit',
   'Monthly check that the plan and the reality still match.',
   'Pillars drifting, formats overused, a channel quietly abandoned, promises in the strategy nobody is keeping. The agent audits it and says what to change.',
   'ops', '{audit,strategy,monthly}', '{}',
   'Audit the last 30 days of published content against the editorial strategy: are we hitting the pillars in the intended mix, is any format overused, has a channel gone quiet, are we still talking to the audience the strategy names? Show the gap between plan and reality, and recommend the three adjustments worth making.',
   null, '{1}', '{09:00}', false,
   '{"Plan versus reality, in numbers","Catches quietly abandoned channels","Three concrete adjustments"}',
   '{"A monthly content health report"}', false, 340),

  ('credit-watchdog', 'Credit Watchdog',
   'Warns you before the automations run out of fuel.',
   'Tracks consumption against the plan, projects the run-out date, and points at whatever is burning more than it should.',
   'ops', '{credits,billing,monitoring}', '{}',
   'Check credit consumption against the plan: how much is left, the burn rate over the last 7 days, and the projected run-out date. If anything is consuming more than usual, name it. Warn me only when the projection falls inside the current billing period — otherwise reply with one line.',
   null, '{1,4}', '{08:00}', true,
   '{"Projects the run-out date","Names what is burning credits","Quiet unless it matters"}',
   '{"A credit projection, and a warning when it is close"}', false, 350),

  -- ── Brand & Research ───────────────────────────────────────────────────────
  ('brand-voice-guard', 'Brand Voice Guard',
   'Keeps everything published sounding like you.',
   'Voice drifts one post at a time. The agent reads what actually went out, measures it against the voice guide, and either corrects the guide or corrects the writing.',
   'brand', '{voice,consistency,quality}', '{}',
   'Read everything we published this week and compare it against the brand voice guide. Point out where the tone drifted, with the exact sentences. Decide, for each drift, whether the post was wrong or the guide is out of date — and say which. Update the voice guide where reality has legitimately moved.',
   'brand', '{5}', '{15:00}', false,
   '{"Quotes the exact drifting sentences","Decides whether the post or the guide is wrong","Keeps the guide alive"}',
   '{"A voice drift report","An updated voice guide when warranted"}', false, 360),

  ('knowledge-harvester', 'Knowledge Harvester',
   'Turns scattered documents into brand knowledge the agents can use.',
   'Connected Drive, Notion or Gmail is full of things the agents should know and do not. This agent reads what is new, extracts the facts worth keeping, and files them.',
   'brand', '{knowledge,ingest,documents}', '{googledrive,notion,gmail}',
   'Check the connected sources for documents added or changed since your last run. Extract what is genuinely useful for content and sales — product facts, positioning, pricing, case studies, objections and their answers — and save it to the brand knowledge base with a clear title. Skip drafts and duplicates. Report what you filed and what you skipped.',
   'brand', '{2,5}', '{06:30}', false,
   '{"Reads only what changed","Extracts facts, not whole documents","Reports what it skipped, too"}',
   '{"New notes in the brand knowledge base"}', false, 370),

  ('review-miner', 'Review Miner',
   'Mines reviews and support threads for proof and objections.',
   'The best copy you will ever write is already in your reviews. The agent extracts the exact phrases, sorts them into proof points and objections, and hands them to the writers.',
   'brand', '{reviews,social-proof,messaging}', '{}',
   'Go through recent reviews, testimonials and support conversations. Pull out: the phrases customers use for the problem we solve, the specific results they mention, and the objections that keep appearing. Save them as messaging material with the source quoted verbatim, and suggest the three posts they most obviously support.',
   'brand', '{3}', '{14:00}', false,
   '{"Keeps the customer''s exact words","Separates proof from objections","Suggests the posts they support"}',
   '{"A messaging bank of verbatim quotes"}', false, 380),

  ('positioning-sparring', 'Positioning Sparring',
   'Argues with your positioning until it holds up.',
   'A weekly adversarial pass: the agent takes your positioning, attacks it the way a sceptical buyer or a competitor would, and shows you where it breaks.',
   'brand', '{positioning,strategy,critique}', '{}',
   'Take our current positioning and attack it. Where would a sceptical buyer stop believing us? Which claims could a competitor make just as truthfully? What are we saying that says nothing? Be specific and quote our own copy. End with the single sharpest version of our positioning you can write.',
   'brand', '{4}', '{16:00}', false,
   '{"Adversarial, not encouraging","Quotes your own copy back at you","Ends with a sharper version"}',
   '{"A critique plus a rewritten positioning line"}', false, 390),

  ('launch-scout', 'Launch Scout',
   'Preps the ground before every product launch.',
   'Two weeks out, the agent starts the drumbeat: the angles, the objections to pre-answer, the assets needed and the sequence — checked against what competitors did on their last launch.',
   'brand', '{launch,campaign,planning}', '{}',
   'Look at what we have coming up (products, features, events) in the next 30 days. For the nearest one, build the pre-launch plan: the three angles worth leading with, the objections to pre-answer, the asset list, and a week-by-week posting sequence. Check how comparable competitors handled their last launch and tell me what to do differently.',
   'brand', '{1}', '{10:00}', false,
   '{"Starts the drumbeat two weeks out","Pre-answers the objections","Benchmarked against competitor launches"}',
   '{"A week-by-week pre-launch plan"}', false, 400)

on conflict (slug) do update set
  name = excluded.name,
  tagline = excluded.tagline,
  description = excluded.description,
  category = excluded.category,
  tags = excluded.tags,
  integrations = excluded.integrations,
  prompt = excluded.prompt,
  agent = excluded.agent,
  days_of_week = excluded.days_of_week,
  times = excluded.times,
  reuse_thread = excluded.reuse_thread,
  highlights = excluded.highlights,
  outputs = excluded.outputs,
  featured = excluded.featured,
  sort_order = excluded.sort_order,
  updated_at = now();

-- Give every seeded agent its own face and its own colour. Derived from the slug rather than
-- random() so the library looks the same in every environment, but scattered enough that no two
-- neighbouring cards wear the same avatar. Neutrals are left out — a directory wants colour.
update public.agent_templates
set
  avatar_face = (
    array['wide', 'dot', 'wink', 'sleepy', 'smile', 'happy', 'visor', 'surprise']
  )[1 + ((hashtext(slug) % 8) + 8) % 8],
  avatar_color = (
    array[
      '#7f1d1d', '#9a3412', '#854d0e', '#14532d', '#155e75', '#1e3a8a', '#4c1d95', '#831843',
      '#ef4444', '#f97316', '#eab308', '#22c55e', '#10b981', '#06b6d4', '#0ea5e9', '#2563eb',
      '#6366f1', '#8b5cf6', '#d946ef', '#ec4899',
      '#fca5a5', '#fdba74', '#fde047', '#86efac', '#67e8f9', '#93c5fd', '#c4b5fd', '#f9a8d4'
    ]
  )[1 + ((hashtext(slug || ':color') % 28) + 28) % 28]
where avatar_face is null or avatar_color is null;
