# I tool MCP di Anomalia

> Generato da `node scripts/mcp-inventory.mjs --write`, leggendo `tools/list` dal server vero.
> Non si modifica a mano: il prossimo che rigenera cancella le correzioni.

**84 tool** — 9 in lettura, 57 in scrittura, 18 che distruggono.
Il payload di `tools/list` pesa **90.920 caratteri**, circa **22.730 token**, ed e' il costo che ogni sessione paga prima di dire una parola.

| gruppo | tool |
|---|---:|
| Studio: chi e cosa | 13 |
| Post | 13 |
| Piano editoriale e settimana | 10 |
| Blog e articoli | 9 |
| SEO, GEO, ads | 7 |
| Account, condivisione, fatturazione | 7 |
| Media | 7 |
| Brand: identita e impostazioni | 5 |
| Radar e mercato | 4 |
| Memoria e conoscenza | 4 |
| Accesso diretto al database | 3 |
| Altro | 2 |

Legenda: **R** legge e non cambia niente · **W** scrive · **D** distrugge, e il client puo' chiedere conferma.

## Studio: chi e cosa

### `add_competitor` · W

*Add competitor*

Add a company this brand competes with, so research and posts can take it into account. update_competitor corrects one already there; research_competitors finds them for you and spends credits. Free.

| campo | tipo | |
|---|---|---|
| `name` | string |  |
| `website`? | string |  |
| `rationale`? | string |  |
| `slug` | string |  |

### `add_note` · W

*Add knowledge note*

Save something this brand knows — a note, a policy, a transcript, a document — so the AI writes from it instead of guessing. search_knowledge is how it comes back; get_knowledge_status says when it is ready to be found. Free.

| campo | tipo | |
|---|---|---|
| `text` | string |  |
| `title`? | string |  |
| `slug` | string |  |

### `add_person` · W

*Add person*

Register a real person who may appear in this brand's images and videos. Their face is withheld from every generator until consent is attested, so `consent` must be true and only the person's own operator can state it — never assume it on someone's behalf. Free.

| campo | tipo | |
|---|---|---|
| `name` | string |  |
| `role`? | string |  |
| `description`? | string |  |
| `consent` | boolean | true ONLY when the USER has stated, in their own words, that they have this person's consent to use their likeness. Never infer it. |
| `slug` | string |  |

### `create_product` · W

*Create product*

Add one offer to the brand catalog. Use it when the catalog does not come from a connected store — sync_products replaces the whole catalog from Shopify or WooCommerce and would erase a hand-made row. Free.

| campo | tipo | |
|---|---|---|
| `title` | string | What the offer is called |
| `description`? | string | What it is, in the brand’s own words |
| `pricing`? | string | Free text as the brand writes it, e.g. "18,50 €" or "Free" |
| `url`? | string | Where the offer lives |
| `kind`? | string | Catalog bucket, e.g. "product", "service", "feature" |
| `featured`? | boolean | Whether the planner may lead with it |
| `slug` | string |  |

### `delete_competitor` · D

*Delete competitor*

Remove one company from this brand's competitor list. It does not come back. Nothing already written about it is deleted.

| campo | tipo | |
|---|---|---|
| `id` | string |  |
| `slug` | string |  |

### `delete_document` · D

*Delete studio document*

Delete one uploaded document, so the AI stops writing from it. It does not come back, and search_knowledge stops returning its passages.

| campo | tipo | |
|---|---|---|
| `id` | string |  |
| `slug` | string |  |

### `delete_person` · D

*Delete person*

Remove a real person from this brand, so no generator can use their face any more. It does not come back. Their photos go with them.

| campo | tipo | |
|---|---|---|
| `id` | string |  |
| `slug` | string |  |

### `delete_product` · D

*Delete product*

Remove one offer from this brand's catalogue, so posts stop being written about it. It does not come back.

| campo | tipo | |
|---|---|---|
| `id` | string |  |
| `slug` | string |  |

### `generate_person` · W

*Generate AI person*

Invent a face for this brand — a made-up spokesperson who can appear in its images and videos, with a name, a role and a look. It spends credits: the face is drawn. For a REAL person, use add_person instead, which needs their consent and costs nothing.

| campo | tipo | |
|---|---|---|
| `slug` | string |  |
| `name` | string |  |
| `role`? | string |  |
| `gender`? | string |  |
| `vibe`? | string |  |
| `description`? | string |  |

### `research_competitors` · W

*Research competitors*

Find out who this brand competes with and file what comes back, without being told the names. It spends credits. add_competitor adds one you already know, for free.

| campo | tipo | |
|---|---|---|
| `slug` | string |  |

### `update_competitor` · W

*Update competitor*

Correct a company already on this brand's competitor list: a wrong website, a reason that no longer holds, direct versus indirect. Only the fields you send change. Free.

| campo | tipo | |
|---|---|---|
| `id` | string | Competitor id or unambiguous prefix |
| `name`? | string | Competitor name |
| `website`? | string | Site; a bare host is read as https |
| `kind`? | `direct` \| `indirect` | The only two the database accepts |
| `rationale`? | string | Why they belong in the competitive set |
| `slug` | string |  |

### `update_person` · W

*Update person*

Correct the name, role, description or attributes of a person already registered on this brand. It cannot attest consent, turn a real person into an invented one, or touch their photos — those stay with the person who owns the brand. Free.

| campo | tipo | |
|---|---|---|
| `id` | string | Person id or unambiguous prefix |
| `name`? | string | How the person is called |
| `role`? | string | What they do for the brand |
| `description`? | string | Who they are, for the generators that may depict them |
| `attributes`? | object | Descriptors of the persona, e.g. { "gender": "female", "ageRange": "30-40" } |
| `slug` | string |  |

### `update_product` · W

*Update product*

Correct one offer in place. Only the fields you send change; every other column keeps the value it had. Free.

| campo | tipo | |
|---|---|---|
| `id` | string | Product id or unambiguous prefix |
| `title`? | string | What the offer is called |
| `description`? | string | What it is, in the brand’s own words |
| `pricing`? | string | Free text as the brand writes it, e.g. "18,50 €" or "Free" |
| `url`? | string | Where the offer lives |
| `featured`? | boolean | Whether the planner may lead with it |
| `slug` | string |  |

## Post

### `approve_post` · D

*Approve post*

Say yes to one post waiting for approval, so it goes out. Read it first with get_post — approving is what authorises distribution, and it does not come back. edit_post changes the copy before you do. Free.

| campo | tipo | |
|---|---|---|
| `slug` | string |  |
| `id` | string |  |

### `approve_posts` · D

*Approve all pending posts*

Say yes to every post waiting for approval, in one go — they are published or scheduled from that moment. This is the irreversible one: ask the person first unless they clearly said "approve them all". approve_post takes one at a time. Free.

| campo | tipo | |
|---|---|---|
| `slug` | string |  |

### `create_post` · W

*Create post*

Store copy you already wrote as one pending post for review. It does not publish and does not schedule: `scheduled_for` is the proposed calendar time, and approve_post remains the action that authorizes distribution. Text-capable platforms only — instagram and tiktok need an image, youtube needs a video. Two different media failures: `media_not_found` (400) means the id is not this brand — check it with list_media, and pass the full id, never a prefix; `media_unavailable` (502) means the id is yours and Anomalia could not attach it, so retrying other ids is wasted work — retry later or leave the media out. Free.

| campo | tipo | |
|---|---|---|
| `platforms` | string[] | Text-capable platforms, e.g. ["linkedin","x"] |
| `caption` | string | The copy you wrote. Anomalia stores it as-is and writes nothing itself |
| `platform_captions`? | object | Per-platform overrides of the caption |
| `scheduled_for`? | string | Proposed publication instant, ISO. Without an offset it is read on the brand clock. It is a calendar proposal only: nothing is scheduled or published until the post is approved |
| `media_ids`? | string[] | Full ids from this brand media library (see list_media) — unlike a post id, a media id is never resolved from a prefix. An id that is not this brand is rejected: the post is never quietly created without it. At most 8: a ninth is refused, not dropped |
| `title`? | string | Required for Reddit |
| `subreddit`? | string |  |
| `link_url`? | string |  |
| `slug` | string |  |

### `edit_post` · W

*Edit post*

Change what a post says without redrawing anything: caption, title, link, platforms, the slot it sits in. `slot` IS THE CALENDAR DAY, NOT THE PUBLISH TIME — the time a post actually goes out is `scheduled_for`, and only `reschedule_post` changes it. Only the fields you send change; `media_url: null` clears the image and makes it text-only. No model, no credits. A post that is already scheduled is re-synced to the publisher automatically. It does not publish and does not approve. id accepts a short prefix.

| campo | tipo | |
|---|---|---|
| `caption`? | string |  |
| `title`? | string |  |
| `link_url`? | string,null |  |
| `subreddit`? | string |  |
| `first_comment`? | string |  |
| `image_prompt`? | string |  |
| `format`? | string |  |
| `slot`? | string |  |
| `product_name`? | string |  |
| `platforms`? | string[] |  |
| `media_url`? | string,null | Set null to clear image (text-only) |
| `platform_captions`? | object \| null |  |
| `slug` | string |  |
| `id` | string | Post id or unambiguous prefix |

### `generate_captions` · W

*Generate captions*

Write captions — text only, no media, and NO post is created: pass a caption to create_post when you want to publish it. By default every platform gets its own caption, written for that platform and inside its character limit, instead of one text cut nine ways. Pass `platforms` to get only those. `format: "thread"` lets X and Threads come back as a numbered sequence of posts rather than one — good to paste by hand, but create_post publishes a single post per platform, so a sequence is not publishable from here. It writes in the brand's voice. It spends credits.

| campo | tipo | |
|---|---|---|
| `topic` | string | What the caption is about |
| `platforms`? | string[] | Only these platforms. Omitted, every platform gets one |
| `format`? | `single` \| `thread` | "single" (default) keeps every caption inside one post. "thread" lets X and Threads run past their limit as a numbered sequence |
| `slug` | string |  |

### `generate_carousel` · W

*Generate a carousel*

To make a carousel — a SERIES of images that read as one object, not N unrelated pictures. Slide 1 is the cover and must work at thumbnail size; every later slide advances the angle one concrete step and carries exactly one idea. It spends credits: one render per slide, so a 5-slide carousel is five renders. It creates nothing in the calendar and publishes nothing: pass the ids to create_post as media_ids, in order. TO CHANGE ONE SLIDE use refine_media on that slide id, and put the `continuity_tokens` this returns back into your instruction — they are what holds the series together, and an edit that touches palette, light or the recurring motif without them takes that slide out of the set. With a slug, this brand's look is applied to every slide and there is no way to switch it off here.

| campo | tipo | |
|---|---|---|
| `brief` | string | What the carousel should say, as a whole |
| `slides`? | integer | How many slides. Each one bills a render. |
| `aspect_ratio`? | `1:1` \| `4:5` \| `9:16` \| `16:9` |  |
| `model`? | string | For THIS call only; it changes no brand setting. Omit for the brand’s choice. Ids from get_media_models (slot imageModel); anything else is refused as model_not_for_slot. |
| `title`? | string | The name the slides carry in the library |
| `slug` | string |  |

### `publish_post` · D

*Publish post*

Put one post out NOW, skipping its scheduled time. There is no undo from here: what a platform has received is on the platform. reschedule_post moves it instead. Free.

| campo | tipo | |
|---|---|---|
| `slug` | string |  |
| `id` | string |  |

### `regenerate_post_media` · W

*Regenerate post media*

Change the image already on a post, in place — give an instruction like "make it warmer", not a whole new prompt. The old image is REPLACED. It spends credits: one render. To change a library image or clip and keep the original, use refine_media, which files the result as a new asset instead.

| campo | tipo | |
|---|---|---|
| `instruction` | string | How to refine the image |
| `slug` | string |  |
| `id` | string | Post id or unambiguous prefix |

### `regenerate_slide` · W

*Regenerate carousel slide*

Redraw one slide of a carousel — index 0 is the cover. Only that slide changes. It spends credits: one render. reorder_slides moves or drops slides for free.

| campo | tipo | |
|---|---|---|
| `index` | integer | Slide index (0 = cover) |
| `instruction` | string |  |
| `slug` | string |  |
| `id` | string | Post id or unambiguous prefix |

### `reject_post` · D

*Reject / delete post*

Throw away one post that has not gone out yet. It does not come back, and its copy goes with it. A post already published cannot be deleted from here.

| campo | tipo | |
|---|---|---|
| `slug` | string |  |
| `id` | string |  |

### `render_post` · W

*Render post image*

Draw the image a post is missing, from the prompt already written on it, and attach it. It spends credits: one render. To draw a picture that is not tied to a post, use generate_image.

| campo | tipo | |
|---|---|---|
| `slug` | string |  |
| `id` | string | Post id or unambiguous prefix |

### `reorder_slides` · W

*Reorder carousel slides*

Change the order of a carousel's slides, or drop some, without redrawing anything and without spending credits. `order` lists the slides you want kept, in the order you want them: [0,2,1]. Anything left out is dropped.

| campo | tipo | |
|---|---|---|
| `order` | integer[] |  |
| `slug` | string |  |
| `id` | string | Post id or unambiguous prefix |

### `reschedule_post` · W

*Reschedule post*

Move a post to a different date and time. `scheduled_for` is an ISO datetime. It does not publish and does not approve — it only changes when. Free.

| campo | tipo | |
|---|---|---|
| `scheduled_for` | string | ISO datetime, e.g. 2026-06-20T10:00 |
| `slug` | string |  |
| `id` | string | Post id or unambiguous prefix |

## Piano editoriale e settimana

### `approve_plan` · D

*Approve editorial plan*

Make the proposed editorial plan the one this brand actually follows, replacing the active one. Ask the person before doing it unless they clearly asked. discard_plan throws the proposal away instead. Free.

| campo | tipo | |
|---|---|---|
| `slug` | string |  |

### `discard_plan` · D

*Discard editorial plan*

Throw away the proposed editorial plan and leave the active one exactly as it is. It does not come back. Free.

| campo | tipo | |
|---|---|---|
| `slug` | string |  |

### `plan_week` · W

*Generate weekly seeds*

Have the AI decide what this brand should post in one week — one seed per intended post, no copy and no images yet. `week` is 0 for the current week. It spends credits and replaces the week draft in review. save_week_seeds stores a week you planned yourself, for free.

| campo | tipo | |
|---|---|---|
| `week` | integer |  |
| `slug` | string |  |

### `produce_week` · W

*Produce weekly seeds*

Turn this week's plan into actual posts — copy and images, one per seed. It spends credits, once per post. The posts land waiting for approval; nothing is published. plan_week or save_week_seeds is what puts the seeds there first, and get_weekly_plan shows them. row_index produces one seed only.

| campo | tipo | |
|---|---|---|
| `slug` | string |  |
| `week`? | integer | Unused for API resolve — seeds draft is auto-detected |
| `row_index`? | integer | Produce a single seed row only |

### `propose_plan` · W

*Propose editorial plan*

Have the AI decide what this brand should post about — the strategy, the platforms, the cadence and the first weeks. It spends credits. It lands as a proposal and changes nothing: the active plan stands until approve_plan. save_plan stores a plan you wrote yourself, for free.

| campo | tipo | |
|---|---|---|
| `slug` | string |  |

### `replan_week` · W

*Replan week*

Have the AI redo one week from a brief you give it — when the seeds it produced are not what you wanted. It spends credits and replaces that week. `week` is 0 for the current week.

| campo | tipo | |
|---|---|---|
| `week` | integer |  |
| `brief` | string |  |
| `slug` | string |  |

### `revise_plan` · W

*Revise editorial plan*

Ask the AI to redo the proposed plan with your feedback — what to change, what to keep. It spends credits. It replaces the pending proposal; the active plan is untouched until approve_plan.

| campo | tipo | |
|---|---|---|
| `feedback` | string |  |
| `slug` | string |  |

### `save_brief` · W

*Save week brief*

Write down what one week should be about, so whoever produces it works from your direction instead of guessing. `week` is 0 for the current week; name the products to feature if some matter. Free.

| campo | tipo | |
|---|---|---|
| `week` | integer |  |
| `brief` | string |  |
| `products`? | string[] | Exact product names to feature |
| `slug` | string |  |

### `save_plan` · W

*Save an editorial plan*

Store an editorial plan you wrote yourself. It lands as the pending proposal, exactly where propose_plan leaves a generated one: the brand active plan is left untouched and approve_plan remains the step that activates it. Saving replaces an earlier pending proposal. Free.

| campo | tipo | |
|---|---|---|
| `strategy` | string | The strategy document you wrote, in prose |
| `voice` | object |  |
| `cadence` | `3/week` \| `5/week` \| `daily` | How a week is spread across days |
| `platform_mix` | object[] |  |
| `gtm`? | object |  |
| `weeks` | object[] | Up to 4 weeks; a short cycle is padded with empty weeks |
| `slug` | string |  |

### `save_week_seeds` · W

*Save weekly content seeds*

Store the week rows you planned yourself — one per post, no copy and no image yet. The rows land as the week draft, exactly where plan_week leaves generated ones: the plan page shows them, they are editable, and produce_week is the separate (paid) step that turns them into posts. A brand keeps one draft, so saving replaces the one in review. Free.

| campo | tipo | |
|---|---|---|
| `week_index` | integer | Which week of the active editorial cycle these rows belong to |
| `theme` | string | The single editorial angle tying the week together |
| `rationale`? | string | Why this theme now |
| `do_dont`? | string | Guardrails for whoever writes the copy |
| `seeds` | object[] |  |
| `slug` | string |  |

## Blog e articoli

### `add_blog_term` · W

*Add a blog category, tag or author*

Create one entry an article can be filed under. The URL slug is derived from the name and must be unique for the brand: a name that slugs to one already there answers slug_taken rather than creating a second. `description` belongs to a category; `bio` and `role` to an author; a tag takes only a name. An author’s avatar is an image and cannot be set here — the author is created without one.

| campo | tipo | |
|---|---|---|
| `term` | `category` \| `tag` \| `author` | Which list the entry belongs to |
| `name` | string | What it is called; the slug is derived from it |
| `description`? | string | Category only, 300 chars |
| `bio`? | string | Author only, 500 chars |
| `role`? | string | Author only, e.g. "writer" or "editor", 30 chars |
| `slug` | string |  |

### `delete_article` · D

*Delete article*

Delete one blog article for good. It does not come back. To take a live article off the site without losing it, use unpublish_article instead.

| campo | tipo | |
|---|---|---|
| `id` | string |  |
| `slug` | string |  |

### `generate_article` · W

*Generate article*

Write a whole blog article from a topic, as a draft. It spends credits. It publishes nothing — publish_article is the separate step, and update_article is how you save text you wrote yourself, for free.

| campo | tipo | |
|---|---|---|
| `topic` | string |  |
| `slug` | string |  |

### `optimize_article` · W

*Optimize article*

Rewrite an article so it ranks better in search, meta title and description included. It spends credits and REPLACES the text that is there; keep a copy if you might want it back. It does not publish.

| campo | tipo | |
|---|---|---|
| `slug` | string |  |
| `id` | string | Article id or unambiguous prefix |

### `publish_article` · D

*Publish article*

Put a blog article live on the brand's site. unpublish_article takes it down again without losing it. Free.

| campo | tipo | |
|---|---|---|
| `slug` | string |  |
| `id` | string | Article id or unambiguous prefix |

### `remove_blog_term` · D

*Remove a blog category, tag or author*

Delete one entry. No article is deleted, but each kind leaves a different mark, so say which before you do it: removing a CATEGORY leaves its articles filed under nothing; removing a TAG takes that tag off every article that carried it; removing an AUTHOR clears the byline on their articles. It does not come back, and the articles keep no record of what was removed.

| campo | tipo | |
|---|---|---|
| `term` | `category` \| `tag` \| `author` | Which list the entry belongs to |
| `id` | string | Row id, verbatim from get_blog_settings |
| `slug` | string |  |

### `set_blog_settings` · W

*Change the blog settings*

Change how the blog looks and how it writes. Only the fields you send change. `articles_per_week` is CLAMPED to the plan's ceiling rather than refused, and the answer says what was actually saved — read it back instead of assuming your number was taken. `locales`, `navbar_links` and `analytics` replace their whole list. Turning `enabled` off takes the public blog down; it deletes no article. The blog icon and an author's avatar are images and cannot be set here. `analytics` takes a CLOSED list of providers with their measurement id — there is no field for arbitrary JavaScript, and asking for one is refused: a script tag here would run on every visitor's page. Those trackers load ONLY on a verified custom domain and ONLY after the visitor accepts cookies. Free.

| campo | tipo | |
|---|---|---|
| `enabled`? | boolean | Whether the public blog is live |
| `title`? | string,null | Site name, 80 chars; null falls back to the brand name |
| `description`? | string,null | Site description, 300 chars |
| `accent`? | string | Six-digit hex, e.g. "#7c5cff" |
| `font`? | `sans` \| `serif` \| `rounded` \| `mono` |  |
| `layout`? | `navbar` \| `sidebar` |  |
| `show_blog_link`? | boolean | Show the Blog link in the main site nav |
| `humanizer_enabled`? | boolean | Run the humanising pass over generated articles |
| `backlink_network`? | boolean | Take part in the cross-brand backlink network |
| `style_instructions`? | string,null | Free-text brief the article generator follows, 1500 chars |
| `articles_per_week`? | number,null | Cadence; clamped to the plan ceiling. null returns to the plan default |
| `default_locale`? | string,null | Language the bare blog URL lands on, from choices.locales |
| `locales`? | string[] | Extra languages articles are translated into. Replaces the whole list |
| `navbar_links`? | object[] | Up to 6 custom nav links. Replaces the whole list |
| `analytics`? | object[] | Third-party analytics, one entry per provider. Replaces the whole list; [] removes them all, which is how a tracker is taken off a live site without us |
| `slug` | string |  |

### `unpublish_article` · D

*Unpublish article*

Take a live article off the site while keeping it: it becomes a draft again and nothing is deleted. This is also what you do before editing one — update_article refuses a published article.

| campo | tipo | |
|---|---|---|
| `slug` | string |  |
| `id` | string | Article id or unambiguous prefix |

### `update_article` · W

*Update article*

Write text and metadata you already have onto an article: title, markdown body, meta title, meta description, category, tags, author, language, schedule. Nothing is rewritten, regenerated or reformatted. A field you do not send is left exactly as it was, so changing the title never touches the body, the cover or the description. A published article is refused: what is live is not edited in place. Free.

| campo | tipo | |
|---|---|---|
| `id` | string | Article id, from the Site page URL or from query({ table: "brand_articles", columns: ["id","slug","title","status","created_at"] }) |
| `title`? | string |  |
| `body_md`? | string | The COMPLETE new markdown body: a replacement, not a diff. Stored exactly as sent — the public blog escapes any raw HTML in it, so markdown is the only markup that renders |
| `meta_title`? | string \| null | null clears it |
| `meta_description`? | string \| null | null clears it |
| `category_id`? | string,null | A category of THIS brand. null clears it; a category of another brand is rejected |
| `author_id`? | string,null | An author of THIS brand. null clears the byline; an author of another brand is rejected |
| `tag_ids`? | string[] | The COMPLETE tag set of this brand — it replaces the current one. [] clears every tag |
| `language`? | string | ISO 639-1 code, e.g. "it". Refused on a translation row: its locale is its identity |
| `scheduled_for`? | string,null | Publication instant, ISO. Without an offset it is read on the brand clock. Dating a draft approves it, and an approved article auto-publishes at that time — this is the consequential half of the tool. null clears the schedule back to a plain draft |
| `slug` | string |  |

## SEO, GEO, ads

### `ads_action` · D

*Ads action*

Change the brand's paid campaigns. `sync` pulls the current state from the advertising account and `propose` has the AI draft new ads; `create` adds one by hand. `approve` IS WHAT SPENDS THE BRAND'S MONEY — it launches the campaign for real — while `reject` turns a proposal down. `pause`, `resume` and `toggle` govern what is already running, `duplicate` makes a paused copy as a new proposal (approving that copy is what launches it), and `delete` removes a campaign for good. Pass `campaignId`, and `adId` in `extra` when it is one creative (`next` is active or paused for `toggle`). Read get_ads first: `ads_not_on_plan` means this brand's plan has no advertising at all.

| campo | tipo | |
|---|---|---|
| `action` | `sync` \| `propose` \| `create` \| `approve` \| `reject` \| `pause` \| `resume` \| `toggle` \| `duplicate` \| `delete` |  |
| `campaignId`? | string |  |
| `extra`? | object | Additional action payload fields |
| `slug` | string |  |

### `ads_remix` · W

*Ads remix*

Find the ads that are working — competitors' and the ones trending in this market — look at them, and come back with ranked briefs for ads of your own: hook, headline, body, call to action, product, and a prompt for the picture. It spends credits, and it replaces the briefs from last time. It creates no ad and launches nothing: ads_action is what does that. `no_competitor_ads` means there was nothing to learn from — add competitors first.

| campo | tipo | |
|---|---|---|
| `slug` | string |  |

### `geo_action` · W

*GEO action*

Do something about whether AI assistants name this brand when someone asks: `audit` puts questions to ChatGPT, Perplexity and Google's AI and records what came back, `fix` writes the pages and blocks that would get it cited. Both spend credits. get_geo reads the last result for free, and list_audit_citations shows the questions and answers behind the number.

| campo | tipo | |
|---|---|---|
| `action` | `audit` \| `fix` |  |
| `slug` | string |  |

### `get_ads` · R

*Ads overview*

The brand's paid campaigns: what is running, what has been proposed and is waiting, and which advertising accounts are connected. ads_action is what changes any of it. Free.

| campo | tipo | |
|---|---|---|
| `slug` | string |  |

### `get_gsc` · R

*Search Console*

How this brand's website does in Google search over the last 28 days: clicks, impressions, the queries people arrived on, the pages they landed on, and whether the property is connected at all. Website traffic, not post engagement — that one is get_analytics. Free.

| campo | tipo | |
|---|---|---|
| `slug` | string |  |

### `refresh_keywords` · W

*Refresh keywords*

Redo the keyword research from scratch: which search terms this brand should write for, how hard each one is, and what to do about it. It spends credits and replaces the current set. get_keywords reads what is there now, for free.

| campo | tipo | |
|---|---|---|
| `slug` | string |  |

### `seo_action` · W

*SEO action*

Do something about the brand's search ranking: `run` audits the website's technical health, `plan` drafts the improvements worth making, `more` appends further ones (say what you want in `guidance`), and `asset` or `article` writes one of them out — those two need the `initiativeId` they belong to. Every action here spends credits. get_seo reads the last result for free.

| campo | tipo | |
|---|---|---|
| `action` | `run` \| `plan` \| `more` \| `asset` \| `article` |  |
| `initiativeId`? | string |  |
| `guidance`? | string | Optional guidance when action=more |
| `slug` | string |  |

## Account, condivisione, fatturazione

### `create_billing_portal_link` · W

*Billing portal link*

Mint a one-time link to this organization's Stripe billing portal and hand it to the account owner. On that page THEY can read invoices, change the card, switch plan and CANCEL the subscription — you never open it and never act inside it. Treat the URL as a credential: whoever holds it reaches that customer's billing, so give it to the owner once, in the reply, and never store or repeat it. Only the organization owner can mint one. Free: it works precisely when credits are gone.

| campo | tipo | |
|---|---|---|
| `slug` | string |  |

### `create_checkout_link` · W

*Checkout link*

Mint a one-time link where the human picks a paid plan and pays, on Stripe's own hosted page. You never pay, never change a plan and never apply a discount: you return the URL, they complete it. The same page can also CANCEL the subscription, so treat the URL as the owner credential — whoever holds it reaches that customer's billing — and hand it over once, never stored, never repeated. Only the organization owner can mint one. Free: it works precisely when credits are gone. An organization that never subscribed has no Stripe customer to check out against: the refusal carries app_billing_url, which is where the human starts.

| campo | tipo | |
|---|---|---|
| `plan`? | string | Plan key the human wants, e.g. "pro". Refused if the org cannot move up to it |
| `slug` | string |  |

### `create_share` · W

*Create a public client link*

Freeze one view as a snapshot and return a public link a client can open without an account. The link grants that snapshot and nothing else: no brand account, no live data, no connectors, notes, prompts, costs, settings or member data. The token is shown once and never stored in readable form — save it now or revoke and create another.

| campo | tipo | |
|---|---|---|
| `view` | `calendar` \| `dashboard` \| `monthly_report` \| `strategy` \| `workspace` | calendar = the month plan; dashboard = the month at a glance (what went out, what is planned, reach); monthly_report = what that month published; strategy = the agreed plan behind it (statement, cadence, platforms, weeks, current phase); workspace = all of the above behind one link |
| `month`? | string | Month YYYY-MM. Defaults to the current month on the brand clock |
| `expires_in_days`? | integer | Days before the link stops working. Omit for a link that lasts until revoked |
| `slug` | string |  |

### `create_social_connect_link` · W

*Social connect link*

Mint the link a HUMAN opens to authorise one social platform for this brand, and stop there. You never run the OAuth, never see a token and never connect anything: the person clicks, signs in on that platform, and the account appears. The URL is a page of our own app behind their login, not a credential, but it is useless to anyone who cannot already reach the brand. Call list_social_accounts first: this refuses when the plan connects no accounts (plan_cannot_connect) or every slot is taken (account_limit), two different problems with two different remedies. Minting a link for a platform already connected is allowed and returns already_connected: it is how an expired account is re-authorised, or a second one added. Free: it works precisely when credits are gone.

| campo | tipo | |
|---|---|---|
| `platform` | `instagram` \| `tiktok` \| `facebook` \| `linkedin` \| `x` \| `threads` \| `youtube` \| `bluesky` \| `reddit` | The platform to authorise, from platform_choices |
| `slug` | string |  |

### `revoke_share` · D

*Revoke a public client link*

Turn one public link off. From then on it answers exactly like a link that never existed. Brand membership is untouched: revoking removes nobody from the brand.

| campo | tipo | |
|---|---|---|
| `id` | string | Share id from list_shares |
| `slug` | string |  |

### `set_automation` · W

*Turn a recurring job on or off*

Turn one recurring job on or off for this brand. Turning one ON is a spending decision, not a preference: from that moment the job runs BY ITSELF on its cadence, and every run calls AI models and spends the brand's credits, with nobody looking. Say which job, how often it will run, and that it spends — before you turn it on, and to the person whose credits they are. Turning one OFF spends nothing and is the safe direction: it takes effect at the next tick and destroys nothing. A brand without a paid plan runs none of them, however many are on. Free.

| campo | tipo | |
|---|---|---|
| `job` | `autopilot` \| `analytics_review` \| `weekly_recap` \| `seo` \| `geo` \| `radar_recap` \| `market_refs` \| `strategy_review` \| `library` | Which recurring job |
| `enabled` | boolean | true starts it running by itself |
| `slug` | string |  |

### `sync_history` · W

*Sync social history*

Import this brand's past social posts so the AI can imitate how it already writes. It reads the connected accounts — list_social_accounts says which of them still work, and a brand with none imports nothing.

| campo | tipo | |
|---|---|---|
| `slug` | string |  |

## Media

### `generate_image` · W

*Generate an image*

To draw a picture from a description — "an image of a cat", a product shot, a background for a slide. With a slug, this brand's own look is applied by default — its colours, its fonts, its visual direction — so you do not have to describe them; brand_style: ignore leaves them out. Without a slug there is no brand and none of that reaches the model, so name the style you want in the prompt. WITHOUT slug this is a one-off drawing: no brand, nothing filed anywhere, id comes back null and there is nothing to hand to create_post. WITH slug the image lands in that brand's library and its id is what create_post takes as media_ids. Do NOT call list_brands to decide where to draw — if nobody named a brand there is no brand, and guessing one spends a real organisation's credits and litters a real library. It spends credits: one render per image, and `renders` in the answer says how many were billed, cost_usd what they cost. It creates nothing in the calendar and publishes nothing, so ask for two or three with `count`, look at them, keep one. To CHANGE a picture that already exists use refine_media — correcting one drawing beats redrawing until it is right. To pick the model read get_media_models and pass `model`, for this call only; set_media_model changes the brand from now on.

| campo | tipo | |
|---|---|---|
| `prompt` | string | What the image should show |
| `count`? | integer | How many alternatives to draw, 1-4. Each one bills a render. Defaults to 1. |
| `aspect_ratio`? | `1:1` \| `4:5` \| `9:16` \| `16:9` |  |
| `model`? | string | For THIS call only; it changes no brand setting. Omit for the brand’s choice. Ids from get_media_models (slot imageModel); anything else is refused as model_not_for_slot. |
| `brand_style`? | `apply` \| `ignore` | Whether this brand's own look — colours, fonts, visual direction — is applied. Omit it and it is. Send `ignore` when the picture must take nothing from the brand: a UI screenshot, an illustration about somebody else, a neutral background. Without a slug there is no brand to apply or ignore: refused as brand_style_needs_a_brand. |
| `title`? | string | The name the asset carries in the library |
| `slug`? | string | Brand URL slug. Optional here: omit it to run without a brand — the tool description says what changes. |

### `generate_video` · W

*Generate a video*

To make a video: animate a photo you already have, or film a clip from a prompt alone. "Animate this photo", "a 5 second video of this image" — that is `base_media_id` pointing at a library image plus a prompt for the movement, and it needs NO post. It spends credits, and the model moves that bill by more than an order of magnitude, so read get_media_models (slot videoModel from a prompt, videoImageModel when animating an image) and pass `model` for this call only. A clip takes minutes: this returns a job_id with status rendering, and check_media_job says when it landed — calling this again for the same clip bills a second one. It creates nothing in the calendar and publishes nothing; when the clip lands, pass its media_id to create_post as media_ids. To animate the cover of a post you already have, make_video does it in one step.

| campo | tipo | |
|---|---|---|
| `prompt` | string | What the clip should show, or how the image should move |
| `base_media_id`? | string | A library IMAGE to animate, from list_media — an id or an unambiguous prefix. Omit to film from the prompt alone. |
| `duration`? | integer | Seconds. Each model accepts its own window and most will not go below 10 — a duration outside it is refused as duration_out_of_range naming the nearest it accepts, rather than quietly rounded up, because a clip is billed per second. |
| `aspect_ratio`? | `1:1` \| `9:16` \| `16:9` |  |
| `model`? | string | For THIS call only; it changes no brand setting. Omit for the brand’s choice. Ids from get_media_models (slot videoModel, or videoImageModel when base_media_id is set); anything else is refused as model_not_for_slot. |
| `title`? | string | The name the clip carries in the library |
| `slug` | string |  |

### `get_media_models` · R

*Media models*

Which model draws and which model films for this brand, one job at a time, with the models each job actually accepts. Read it before set_media_model: a model that cannot do a job is refused, and this is where the accepted ids come from. A null model means the brand made no choice and the platform default renders.

| campo | tipo | |
|---|---|---|
| `slug` | string |  |

### `import_media_url` · W

*Import media from a URL*

Copy an image or video you produced elsewhere into the brand media library, then use the id it returns as media_ids on create_post. The file is copied, not generated. The URL must be public https and stay public across every redirect; jpeg, png, webp and gif up to 12MB, mp4, mov and webm up to 64MB. Anything else is refused and nothing is stored. Free.

| campo | tipo | |
|---|---|---|
| `url` | string | Public https URL of an image (jpeg, png, webp, gif) or video (mp4, mov, webm) |
| `title`? | string | The name the asset carries in the library |
| `slug` | string |  |

### `make_video` · W

*Animate post to video*

To turn a post you already have into a video: this animates that post's cover image and attaches the clip back to the same post (it also retries a video that fell back to a photo). It needs an existing post. To animate a photo on its own, or make any clip that is not going on a post, use generate_video — that one needs no post at all. It spends credits: one clip. It does not publish, and the post keeps the status it had.

| campo | tipo | |
|---|---|---|
| `duration`? | number | Duration in seconds, e.g. 6 |
| `script`? | string |  |
| `instruction`? | string |  |
| `slug` | string |  |
| `id` | string | Post id or unambiguous prefix |

### `refine_media` · W

*Refine media you already made*

To change a photo or a video you already have — "make it red", "warmer background", "remove the cup on the left", "keep the movement but make it night" — instead of making a new one. base_media_id is any asset in this brand’s library, image or video alike; list_media finds it, and a short prefix works. It starts FROM that asset: the picture you already made comes back changed, not redrawn. Say what should CHANGE, not what the whole thing should be. The result is filed as a NEW asset, so a wrong edit costs one render and never your original. Do NOT reach for generate_image or generate_video to alter something: those two start from nothing and give you a different subject, which is the mistake this tool exists to end. It spends credits, and the answer says how many renders were billed. It creates nothing in the calendar and publishes nothing; pass the id it returns to create_post as media_ids when you want a post. Each kind has its own model — get_media_models, slot imageRefineModel for a picture and videoRefineModel for a clip — and model here applies to this call only. A clip has no refine model until the brand picks one, and until then a video comes back no_refine_model rather than quietly redrawn. The brand look is applied as it is on generate_image; brand_style: ignore leaves it out, pictures only.

| campo | tipo | |
|---|---|---|
| `base_media_id` | string | The library asset to start from — an id from list_media, or an unambiguous prefix. Its own kind decides how it is refined: you do not say whether it is a picture or a clip. |
| `instruction` | string | What should change about it |
| `count`? | integer | How many alternatives to draw, 1-4. Each one bills a render. Defaults to 1. |
| `model`? | string | For THIS call only; it changes no brand setting. Omit for the brand’s choice. Ids from get_media_models (slot imageRefineModel for a picture, videoRefineModel for a clip); anything else is refused as model_not_for_slot. |
| `brand_style`? | `apply` \| `ignore` | Whether this brand's own look — colours, fonts, visual direction — is applied. Omit it and it is. Send `ignore` when the picture must take nothing from the brand: a UI screenshot, an illustration about somebody else, a neutral background. Without a slug there is no brand to apply or ignore: refused as brand_style_needs_a_brand. |
| `title`? | string | The name the new asset carries in the library |
| `slug` | string |  |

### `set_media_model` · W

*Choose a media model*

Pin the model that serves one job for this brand — image generation, image refinement, video from text, animating a still, video refinement, motion transfer. Only the models that job accepts are taken: anything else comes back as model_not_for_slot with the list that would have been accepted. Send model: null to drop the choice and go back to the platform default. Free; it takes effect on the next render.

| campo | tipo | |
|---|---|---|
| `slot` | `imageModel` \| `imageRefineModel` \| `videoModel` \| `videoImageModel` \| `videoRefineModel` \| `videoMotionModel` | Which job the model is chosen for |
| `model` | string \| null | A model id from get_media_models for this slot, or null to clear the choice |
| `slug` | string |  |

## Brand: identita e impostazioni

### `diagnose_brand` · R

*Brand doctor*

Why this brand receives nothing from the AI. Per recurring cycle: the FIRST gate it fails, what has to happen for that gate to pass, and the last recorded outcome. Says which cycles it does not cover.

| campo | tipo | |
|---|---|---|
| `slug` | string |  |

### `list_brands` · R

*List brands*

Which brands this person can work on, and the slug each one is called by — every other tool needs that slug. Each row says the plan it is on, how many posts wait for approval, and whether its recurring jobs are running. Start here when you do not know the slug. Free.

_nessun parametro._

### `set_bio` · W

*Set link in bio*

Store the link in bio for the brand. It records the value only: no publishing API exposes a profile bio, so a person still pastes it on the profile by hand. Empty string clears it.

| campo | tipo | |
|---|---|---|
| `bio_url` | string | http(s) URL, max 500 chars; "" clears the bio |
| `platform`? | string | Defaults to the first active account |
| `slug` | string |  |

### `set_brand_settings` · W

*Change how the brand works*

Change the posting timezone, the target platforms, the per-platform hashtags, or the voice examples. Only the fields you send change. `hashtags` and `voice_examples` REPLACE the whole list, so send the full list you want, not a delta; `[]` and `{}` clear one. Changing `timezone` does NOT move posts that already have a time: they keep firing at the same absolute instant, so their local hour shifts by the offset difference. Only new scheduling uses the new zone. Removing a platform from `platforms` does NOT cancel posts already scheduled on it: the target list decides what NEW posts are made for, never what publishes. Free.

| campo | tipo | |
|---|---|---|
| `timezone`? | string | IANA zone, e.g. "Europe/Rome". Decides the local hour of every future slot |
| `platforms`? | string[] | Platforms new posts are made for. An empty list leaves the planner no target |
| `hashtags`? | object | Hashtags per platform. When set for a platform, the AI uses ONLY these |
| `voice_examples`? | string[] | Real past posts of the brand, one per entry, that the AI imitates for tone |
| `slug` | string |  |

### `update_brand_identity` · W

*Change what the brand is, how it sounds and how it looks*

Change what this brand IS, how it SOUNDS and how it LOOKS: its facts and language, its voice, its colours, its logo, its fonts and its visual brief. One door for all of it — it replaces `update_brand_kit`, `update_voice`, `set_colors` and `set_appearance`, which are gone. Only the fields you send change, and at least one is required. `colors` REPLACES the whole palette, so send every colour you want to keep: three or six hex digits, up to 8. `logo_url` and `favicon_url` are DOWNLOADED and re-hosted, not linked, so a private, redirecting or oversized address is refused rather than half-saved, and the answer carries the address we stored; `remove_logo` clears it. `display_font` and `body_font` go together and must be families Google Fonts actually serves — a name it will not serve renders as Inter with nothing said, so they are checked before anything is written. Setting `visual_style` LOCKS it: the nightly rebuild stops rewriting the brand’s visual brief until someone regenerates it from the browser. Sending any voice field switches the brand OFF automatic voice: from then on nobody rewrites it for you. The past posts the writer imitates are `voice_examples` on `set_brand_settings`, not here. To read the look it has NOW: query({ table: "brand_kit" }). Calls no model and spends nothing.

| campo | tipo | |
|---|---|---|
| `about`? | string |  |
| `category`? | string |  |
| `target_audience`? | string |  |
| `brand_style`? | string |  |
| `language`? | string |  |
| `mood`? | string |  |
| `tone`? | string |  |
| `register`? | number |  |
| `emotion`? | string |  |
| `character`? | string |  |
| `syntax`? | string |  |
| `avoid`? | string[] |  |
| `platform_instructions`? | object |  |
| `colors`? | string[] |  |
| `logo_url`? | string | Public http(s) image address; downloaded and re-hosted, max 4MB |
| `favicon_url`? | string | Same rules as logo_url |
| `remove_logo`? | boolean | Clear the logo. Cannot be combined with logo_url |
| `display_font`? | string | Google Fonts family for headings, e.g. "Playfair Display" |
| `body_font`? | string | Google Fonts family for body text |
| `graphic_instructions`? | string | Art direction the composer follows |
| `visual_style`? | string | The visual brief every image render follows. Setting it locks it against the nightly rebuild |
| `slug` | string |  |

## Radar e mercato

### `add_radar_source` · W

*Add a Radar source*

Add one place for Radar to watch: a Google News query, an RSS feed, a subreddit, a Reddit / Threads / X / LinkedIn search. A source already there is left as it is rather than duplicated — the pair (kind, value) is its identity, and it is what remove_radar_source takes. Read get_radar first: the plan decides which kinds are allowed (plan_required) and how many sources fit (source_limit). Radar reads the source on every run from then on. Free.

| campo | tipo | |
|---|---|---|
| `kind` | `gnews_query` \| `rss` \| `subreddit` \| `reddit_query` \| `threads_query` \| `x_community` \| `linkedin_query` | What sort of source this is |
| `value` | string | The query, the feed URL, or the subreddit name. rss must be an http(s) URL; a subreddit is stored without its "r/" |
| `lang`? | string | Language hint, e.g. "it" or "en". "auto" by default |
| `slug` | string |  |

### `diagnose_radar` · R

*Radar diagnosis*

Why Radar finds nothing: fetches every configured source live and reports, per source, how many items came back or why it was skipped — source off, plan, platform toggle, endpoint error. It can take seconds per source. Free.

| campo | tipo | |
|---|---|---|
| `slug` | string |  |

### `remove_radar_source` · D

*Remove a Radar source*

Delete one source, named by the same (kind, value) pair that added it. It does not come back, and Radar stops reading it. What it already found stays. A pair that is not there answers not_found rather than reporting a success that removed nothing.

| campo | tipo | |
|---|---|---|
| `kind` | `gnews_query` \| `rss` \| `subreddit` \| `reddit_query` \| `threads_query` \| `x_community` \| `linkedin_query` | What sort of source this is |
| `value` | string | The query, the feed URL, or the subreddit name. rss must be an http(s) URL; a subreddit is stored without its "r/" |
| `slug` | string |  |

### `set_radar_platform` · W

*Turn a Radar platform on or off*

Switch one platform on or off for this brand’s Radar. Turning one off narrows what Radar finds; it deletes no source and no result already found. Threads, X and LinkedIn need the Pro plan and answer plan_required below it. Free.

| campo | tipo | |
|---|---|---|
| `platform` | `gnews` \| `reddit` \| `threads` \| `x` \| `linkedin` | Which platform Radar may search |
| `enabled` | boolean |  |
| `slug` | string |  |

## Memoria e conoscenza

### `get_writing_skills` · R

*Writing skills*

READ THIS BEFORE WRITING ANY COPY FOR THE BRAND — a caption, a carousel, a script, an article, a bio. It returns the craft text Anomalia writes with: `humanizer` and `stop-slop` always, plus `social` or `seo-audit` depending on `agent`. It also returns the built-in production skills for that agent — the ones naming the gates that refuse a render — and this brand's OWN procedures, and a brand procedure overrules a product skill when they disagree. Bodies come inline; each skill lists its `references` by path without sending them, and `reference: "<skill>/<path>"` returns that one file alone. Free.

| campo | tipo | |
|---|---|---|
| `agent`? | `content` \| `analyst` \| `web` \| `ugc` \| `motion` \| `auto` | Whose deck: content and ugc add `social`, web adds `seo-audit`. Omit for the writing deck alone |
| `reference`? | string | Fetch one reference file instead of the deck, e.g. "social/references/platform-limits.md" |
| `slug` | string |  |

### `record_memory_used` · W

*Report memory you used*

Say which memory entries actually shaped what you just produced. Call it after acting, with the ids you actually read — a handful, not everything. Read what the brand knows with query({ table: "brand_memory", columns: ["id","key","value","category","confidence"], where: [{column:"layer",op:"neq",value:"session"},{column:"agent",op:"is",value:null}], order: {column:"confidence",ascending:false} }). This is what keeps a working entry alive: entries that are never reported decay out of the prompts they were helping. Ids that do not belong to this brand are ignored. At most 50 per call.

| campo | tipo | |
|---|---|---|
| `ids` | string[] | Ids of the entries you actually used |
| `slug` | string |  |

### `save_memory` · W

*Save to brand memory*

Record something you learned about this brand so the next conversation starts from it. Writable categories: fact, preference, insight, skill. `voice` and `constraint` are NOT writable here — they govern everything downstream and only the brand's own people set them. A `key` that already holds a DIFFERENT value answers 409 with both values and writes nothing: take it to the person. Sending the same value again reinforces it. Entries land as brand knowledge, never scoped to a chat.

| campo | tipo | |
|---|---|---|
| `key` | string | Stable slug, e.g. "shipping_threshold" — reusing it reinforces |
| `value` | string | The knowledge itself. For a skill: first line = when to use it, then the steps |
| `category` | `fact` \| `preference` \| `insight` \| `skill` |  |
| `slug` | string |  |

### `search_knowledge` · R

*Search brand knowledge*

Ask the brand's own documents a question and get back the passages that answer it, each with the document and heading it came from. Hybrid retrieval over what is already indexed: keywords first, one embedding of the question only when keywords come up short. Each passage is cut at 1500 characters (`truncated` says when there is more). Narrow with `collection` when you know the shelf. Empty `hits` means the INDEXED corpus has no answer, which is not the same as the brand not knowing it — read `get_knowledge_status` before concluding anything: a document still queued has nothing to find. Free.

| campo | tipo | |
|---|---|---|
| `query` | string | The question, phrased in the brand's own language |
| `limit`? | integer | How many passages, 6 by default, 20 at most |
| `collection`? | `brand` \| `product` \| `commercial` \| `legal` \| `operations` \| `research` | Restrict to one shelf of the corpus |
| `slug` | string |  |

## Accesso diretto al database

### `insert_row` · W

*Insert a row*

Add ONE row to any table, AS YOU: anon key plus your own session, so Postgres RLS decides whether that row may exist at all — there is no way to write into a brand you do not belong to. Table names are the ones `query` takes: call `query` with no `table` to list them, and with only a `table` to get a real row back, whose keys are the columns you can name here. `brand_id` is filled in with this brand for you; naming a different one is refused, not quietly corrected. It NEVER replaces anything: a row that already exists comes back as a collision that names the key you hit, and changing it is `update_row`. Use it for the things that have no tool of their own — an idea, a note, a row in a table nothing else writes. Free, and nothing is published.

| campo | tipo | |
|---|---|---|
| `table` | string | Table name, bare. The same names `query` reads. |
| `values` | object | Column name → value. Only the columns you name are written. |
| `slug` | string |  |

### `query` · W

*Query the database*

READ THE BRAND: this is the read tool. Posts, media, articles, memory, competitors, products, plans, settings, audits — every table, AS YOU. The request runs with the anon key plus your own session, so Postgres RLS returns exactly the rows you would see in the app, and nothing more. READ ONLY: there is no SQL here. You name a table, columns and filters, and it issues one PostgREST read, so a write has nowhere to go. Omit `table` to list every table you can name. Ask for a table with no `columns` to get real rows with every column: the keys of a row ARE the schema. THEN NAME THE COLUMNS YOU NEED — the one rule that decides whether the answer is whole. Without `columns` every column comes back, the character cap drops whole rows to fit, and a long question gets a short answer; with five columns named the same read returns every row. NOTHING IS OUT OF REACH: `offset` is the next page and the reply tells you which offset resumes where it stopped, `count: "exact"` counts the matching rows for real when the number IS the answer, `negate` on a filter turns `is null` into `is not null`, `order` takes several columns with `nullsFirst`, and `embed` brings a related table along through its foreign key (RLS applies to it too) — an article with its category, author and tags in one call. Every cap that bites is named in `limits` on the way back; none of them is silent. ONE ROW IS A DOCUMENT: with `limit: 1` long text comes back whole, which is how you read an article before rewriting it. With many rows long values are cut at 2,000 chars and `limits` says in which columns. What this brand SELLS is the `products` table: one row per offer, with `title`, `kind`, `pricing`, `url`, `featured` and the `images` it carries. Free.

| campo | tipo | |
|---|---|---|
| `table`? | `ad_campaigns` \| `ad_metrics` \| `admins` \| `ads_remix_briefs` \| `agent_computers` \| `agent_kit_approval_requests` \| `agent_kit_effects` \| `agent_kit_runs` \| `agent_notifications` \| `agent_runs` \| `agent_sessions` \| `agent_templates` \| `ai_calls` \| `api_keys` \| `app_flags` \| `article_views` \| `benchmark_runs` \| `blog_authors` \| `blog_categories` \| `blog_integrations` \| `blog_month_jobs` \| `blog_tags` \| `brand_app_connections` \| `brand_article_tags` \| `brand_article_versions` \| `brand_articles` \| `brand_backlink_opportunities` \| `brand_backlink_orders` \| `brand_backlink_placements` \| `brand_community_profiles` \| `brand_crawl_runs` \| `brand_demo_accounts` \| `brand_design_templates` \| `brand_doc_chunks` \| `brand_documents` \| `brand_field_posts` \| `brand_geo_artifacts` \| `brand_geo_audits` \| `brand_geo_opportunities` \| `brand_geo_prompts` \| `brand_gsc_connections` \| `brand_gsc_metrics` \| `brand_internal_links` \| `brand_invites` \| `brand_job_optouts` \| `brand_kit` \| `brand_knowledge_edges` \| `brand_knowledge_sources` \| `brand_market_references` \| `brand_media` \| `brand_members` \| `brand_memory` \| `brand_news_items` \| `brand_news_sources` \| `brand_pages` \| `brand_rank_snapshots` \| `brand_seo_keyword_strategy` \| `brand_seo_plans` \| `brand_site_pages` \| `brand_sites` \| `brand_social_handles` \| `brand_strategy` \| `brand_tracked_keywords` \| `brand_triggers` \| `brand_usage` \| `brand_visual_insights` \| `brand_webhooks` \| `brands` \| `chat_artifacts` \| `chat_goal_events` \| `chat_goals` \| `chat_jobs` \| `chat_messages` \| `chat_model_catalog` \| `chat_thread_reads` \| `chat_threads` \| `competitors` \| `content_plans` \| `content_quality_samples` \| `credit_grants` \| `custom_agent_schedules` \| `custom_agent_thread_runs` \| `custom_agents` \| `disruptive_ideas` \| `editorial_plans` \| `expert_requests` \| `graphic_designs` \| `gtm_plans` \| `incidents` \| `lead_outcomes` \| `lead_suppressions` \| `lifecycle_emails` \| `loop_cursors` \| `loop_ticks` \| `market_account_baselines` \| `market_account_fetch_attempts` \| `market_harvest_errors` \| `market_harvest_runs` \| `market_post_observations` \| `market_posts` \| `market_teardowns` \| `market_video_analyses` \| `media_generator_items` \| `media_generator_prompts` \| `motion_craft_scores` \| `motion_reference_specs` \| `motion_video_prompts` \| `motion_video_references` \| `motion_videos` \| `onboarding_drafts` \| `onboarding_errors` \| `onboarding_jobs` \| `onboarding_step_jobs` \| `org_members` \| `org_usage` \| `organizations` \| `people` \| `post_links` \| `post_revisions` \| `post_verdicts` \| `post_visual_meta` \| `posts` \| `products` \| `profiles` \| `publish_logs` \| `push_subscriptions` \| `radar_feed_cache` \| `radar_jobs` \| `radar_searches` \| `referral_codes` \| `referrals` \| `rubrics` \| `sandbox_holders` \| `scheduler_runs` \| `scrapecreators_cache` \| `shared_views` \| `social_accounts` \| `social_post_history` \| `social_thumb_cache` \| `talent_views` \| `talents` \| `thread_events` \| `tool_usage` \| `video_renders` \| `video_requests` \| `video_reviews` \| `waitlist` \| `webhook_deliveries` \| `zernio_ad_accounts` | Table to read. Omit to list every table instead. |
| `columns`? | string[] | Bare column names. Omit for all columns — which is also how you discover them. |
| `where`? | object[] | Filters, ANDed together. `in` takes an array; `is` takes null/true/false. |
| `order`? | object \| array | Sort, one column or several in order. Descending when `ascending` is omitted. |
| `embed`? | object[] | Related tables to bring along, followed through their foreign key. RLS applies to each. |
| `offset`? | integer | Rows to skip — the next page. `limits` tells you the offset that resumes the read. |
| `count`? | `estimated` \| `exact` | `exact` counts the matching rows for real. Default is the planner estimate. |
| `limit`? | integer | Rows to return. 200 at most. |
| `slug` | string |  |

### `update_row` · D

*Update rows*

Change columns on rows that ALREADY EXIST, as you. ONLY the columns you send are touched — the rest of the row is left exactly as it was, so a partial change is safe by construction and you never have to resend fields you are not changing. `where` is REQUIRED and may not be empty: an update with no filter rewrites every row you can reach. At most 50 rows per call, counted BEFORE anything is written and reported back to you. THE OLD VALUES ARE GONE — read the rows with `query` first when you are not certain which ones you are about to hit. It cannot delete a row: deleting has its own named tools. Free.

| campo | tipo | |
|---|---|---|
| `table` | string | Table name, bare. The same names `query` reads. |
| `where` | object[] | Filters, ANDed. Required: without one this would rewrite the whole table. |
| `values` | object | Column name → value. Only the columns you name are written. |
| `slug` | string |  |

## Altro

### `check_content` · W

*Check content*

Run the checks Anomalia runs on its own copy against a spec you wrote, before you create anything. Returns blocking errors, warnings and a 0-100 quality score per platform, each naming the field to repair. Deterministic: it writes nothing, and the same spec always returns the same verdict. Perceptual review of an image or a video is a separate, explicitly paid action — this never looks at pixels. Free.

| campo | tipo | |
|---|---|---|
| `platforms` | string[] | Where this would be published, e.g. ["instagram","x"] |
| `caption` | string | The copy you wrote. It is read, scored and returned untouched |
| `platform_captions`? | object | Per-platform overrides: each platform is checked against the copy IT would publish |
| `media_ids`? | string[] | Full ids from this brand media library (see list_media) — unlike a post id, a media id is never resolved from a prefix. An id that is not this brand is reported |
| `title`? | string | Required for Reddit |
| `scheduled_for`? | string | Proposed publication instant, ISO. Without an offset it is read on the brand clock |
| `slug` | string |  |

### `get_creation_kit` · R

*Creation kit*

The smallest brief you need before writing one post: what the platform allows, the brand's own facts and its approved voice, the checklist your copy will be judged against, ONE worked example chosen for this goal and format, the rewrites this brand's own team wrote, what has already worked here, and which calendar minutes are taken. It is a SELECTION, not the whole library: empty sections are absent, and the whole thing is capped so it never floods your context. Pictures live in list_media; checking a draft before you create it is check_content. Free.

| campo | tipo | |
|---|---|---|
| `goal` | string | What this post has to achieve, in one line. It selects the template and ranks the products and examples |
| `platforms` | string | Where it would be published, comma-separated: "instagram,linkedin" |
| `format` | `single_image` \| `carousel` \| `text_post` \| `link_post` \| `video` | The format you intend to write |
| `slug` | string |  |

