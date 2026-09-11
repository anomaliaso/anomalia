/**
 * GENERATO — non si modifica a mano: `node scripts/query-tables-from-migrations.mjs --write`.
 *
 * Le due risposte che uno SQLSTATE nudo non dà a chi scrive: quali valori un CHECK ammette (23514)
 * e quali colonne un grant lascia scrivere (42501). Vengono dalle migrazioni, come l'elenco delle
 * tabelle, e per la stessa ragione. `write-tool.test.ts` rigenera e confronta: una migrazione che
 * aggiunge un vincolo o stringe un grant fa fallire il test finché questo file non è rigenerato,
 * e l'agente non si trova davanti a un rifiuto che nessuno sa spiegare.
 */
export const TABLE_CHECKS: Record<string, string> = {
  "agent_templates_avatar_face_check": "avatar_face is null or avatar_face in ( 'wide', 'dot', 'wink', 'sleepy', 'squint', 'curious', 'smile', 'grin', 'happy', 'laugh', 'sad', 'visor', 'focus', 'surprise' )",
  "benchmark_runs_kind_check": "kind in ('live', 'golden', 'market')",
  "brand_app_connections_status_check": "status in ('active', 'pending', 'error', 'disconnected')",
  "brand_articles_cover_image_check": "cover_image ~ '^https?://'",
  "brand_articles_slug_check": "slug ~ '^[a-z0-9-]+$' and length(slug) <= 200",
  "brand_articles_source_check": "source in ('plan', 'radar', 'seo', 'ai', 'manual')",
  "brand_articles_status_check": "status in ('planned', 'draft', 'approved', 'published')",
  "brand_articles_text_len": "length(body_md) <= 500000 and length(meta_title) <= 300 and length(meta_description) <= 1000 and length(language) <= 60",
  "brand_articles_title_check": "btrim(title) <> '' and length(title) <= 500",
  "brand_articles_version_seq_check": "version_seq >= 0",
  "brand_documents_kind_check": "kind in ('note', 'document', 'image', 'plan')",
  "brand_documents_status_check": "status in ('pending','processing','ready','failed')",
  "brand_kit_favicon_url_check": "favicon_url ~ '^(https?://|data:)'",
  "brand_kit_json_shape": "jsonb_typeof(brand_colors) = 'array' and jsonb_typeof(logos) = 'array' and jsonb_typeof(fonts) = 'array' and jsonb_typeof(images) = 'array' and jsonb_typeof(content_pillars) = 'array' and jsonb_typeof(ai_character) = 'object' and jsonb_typeof(graphic_style) = 'object'",
  "brand_kit_site_type_check": "site_type in ( 'ecommerce', 'saas', 'portfolio', 'local_service', 'creator', 'media', 'mobile_app', 'service', 'generic' )",
  "brand_kit_source_url_check": "source_url ~ '^https?://'",
  "brand_kit_text_len": "length(category) <= 200 and length(about) <= 20000 and length(brand_style) <= 5000 and length(target_audience) <= 5000 and length(visual_style) <= 50000 and length(ai_context) <= 200000",
  "brand_kit_theme_color_check": "theme_color ~ '^#[0-9a-fA-F]{3,8}$'",
  "brand_media_catalog_status_check": "catalog_status in ('pending', 'ready', 'failed')",
  "brand_media_source_check": "source = any (array['upload','chat_drop','shoot','generate','remotion_export','post_render','website_capture','agent'])",
  "brand_memory_category_check": "category in ('voice', 'constraint', 'fact', 'preference', 'insight', 'skill')",
  "brand_memory_counters_check": "times_reinforced >= 0 and times_used >= 0",
  "brand_memory_importance_check": "importance between 1 and 5",
  "brand_memory_key_check": "btrim(key) <> '' and length(key) <= 200",
  "brand_memory_session_scope": "layer <> 'session' or thread_id is not null",
  "brand_memory_value_check": "btrim(value) <> '' and length(value) <= 50000",
  "brand_news_sources_kind_check": "kind in ('gnews_query', 'rss', 'subreddit', 'threads_query', 'x_community', 'reddit_query', 'linkedin_query')",
  "brand_news_sources_lang_check": "lang ~ '^[A-Za-z-]{2,5}$'",
  "brand_news_sources_value_check": "btrim(value) <> '' and length(value) <= 500",
  "brand_sites_host_check": "host ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' and length(host) <= 253",
  "brands_chat_default_tier_check": "chat_default_tier is null or chat_default_tier ~ '^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._:-]*$'",
  "chat_jobs_status_check": "status in ('pending', 'running', 'done', 'failed', 'cancelled')",
  "chat_messages_feedback_check": "feedback in (-1, 1)",
  "competitors_json_shape": "jsonb_typeof(handles) = 'array' and jsonb_typeof(top_posts) = 'array' and jsonb_typeof(top_ads) = 'array' and jsonb_typeof(benchmark) = 'object'",
  "competitors_name_check": "btrim(name) <> '' and length(name) <= 300",
  "competitors_rationale_len": "length(rationale) <= 20000",
  "competitors_website_check": "website ~ '^https?://'",
  "content_plans_editorial_week_check": "editorial_week >= 0 and editorial_week <= 52",
  "content_plans_seeds_shape": "jsonb_typeof(seeds) = 'object'",
  "content_plans_source_check": "source in ('manual', 'manual_single', 'manual_trigger', 'scheduled_cron', 'radar')",
  "content_plans_status_check": "status in ('draft', 'proposed', 'produced')",
  "content_plans_title_len": "length(title) <= 300",
  "content_quality_samples_anchored": "post_id is not null or run_id is not null",
  "credit_grants_one_target": "(brand_id is null) <> (org_id is null)",
  "custom_agent_schedules_avatar_color_chk": "avatar_color is null or avatar_color ~ '^#[0-9a-f]{6}$'",
  "custom_agent_schedules_avatar_face_chk": "avatar_face is null or avatar_face in ( 'wide', 'dot', 'wink', 'sleepy', 'squint', 'curious', 'smile', 'grin', 'happy', 'laugh', 'sad', 'visor', 'focus', 'surprise' )",
  "custom_agent_schedules_days": "cardinality(days_of_week) between 1 and 7 and days_of_week <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]",
  "custom_agent_schedules_name_len": "char_length(btrim(name)) between 1 and 80",
  "custom_agent_schedules_prompt_len": "char_length(btrim(prompt)) between 1 and 8000",
  "custom_agent_schedules_times_len": "cardinality(times) between 1 and 12",
  "custom_agents_avatar_color_chk": "avatar_color is null or avatar_color ~ '^#[0-9a-f]{6}$'",
  "custom_agents_avatar_face_chk": "avatar_face is null or avatar_face in ('wide', 'dot', 'wink', 'sleepy', 'smile', 'happy', 'visor', 'surprise')",
  "custom_agents_name_len": "char_length(btrim(name)) between 1 and 80",
  "custom_agents_prompt_len": "char_length(btrim(prompt)) between 1 and 8000",
  "editorial_plans_source_check": "source = any (array['onboarding','revision','rollover','manual','analytics_review','autopilot'])",
  "gtm_plans_horizon_check": "horizon in ('90d', '6m')",
  "gtm_plans_source_check": "source = any (array['manual','revision','phase_review','onboarding','analytics_review','autopilot'])",
  "onboarding_step_jobs_kind_check": "kind in ('competitors', 'research', 'plan_posts', 'preview_images')",
  "people_consent_source_check": "consent_source in ('owner_attested', 'ai_generated', 'legacy_assumed', 'import_unattested')",
  "people_images_shape": "jsonb_typeof(images) = 'array'",
  "people_name_check": "btrim(name) <> '' and length(name) <= 200",
  "people_text_len": "length(role) <= 200 and length(description) <= 20000",
  "posts_content_type_check": "content_type in ( 'generated_image', 'generated_video', 'generated_graphic', 'uploaded_image', 'uploaded_video', 'text', 'link' )",
  "posts_media_url_check": "media_url ~ '^https?://'",
  "posts_media_urls_shape": "jsonb_typeof(media_urls) = 'array'",
  "posts_revisions_count_check": "revisions_count >= 0",
  "posts_source_check": "source in ('plan', 'manual', 'radar', 'guest_preview', 'cross_post', 'founder', 'external')",
  "posts_status_check": "status in ('pending_user', 'approved', 'scheduled', 'published', 'failed')",
  "posts_text_len": "length(caption) <= 10000 and length(title) <= 500 and length(image_prompt) <= 20000 and length(first_comment) <= 5000 and length(slot) <= 100 and length(pillar) <= 500 and length(angle) <= 1000 and length(format) <= 60 and length(attention_reason) <= 2000 and length(campaign_name) <= 200 and length(campaign_step) <= 200 and length(product_name) <= 500 and length(subreddit) <= 100",
  "posts_video_duration_check": "video_duration_seconds > 0 and video_duration_seconds <= 3600",
  "posts_video_render_status_check": "video_render_status in ('rendering', 'done', 'failed')",
  "posts_video_resolution_check": "video_resolution ~ '^[0-9]{3,4}p$'",
  "products_images_shape": "jsonb_typeof(images) = 'array'",
  "products_text_len": "length(description) <= 50000 and length(pricing) <= 200 and length(external_id) <= 200 and length(kind) <= 200",
  "products_title_check": "btrim(title) <> '' and length(title) <= 500",
  "products_url_check": "url ~ '^https?://'",
  "referral_codes_code_format": "code ~ '^[a-z0-9]{6,12}$'",
  "shared_views_view_type_check": "view_type in ('calendar', 'dashboard', 'monthly_report', 'strategy', 'workspace')",
  "talents_body_type_check": "body_type is null or body_type in ('slim', 'athletic', 'athletic_slim', 'average', 'curvy', 'plus', 'muscular')",
  "talents_gender_check": "gender is null or gender in ('man', 'woman', 'trans_man', 'trans_woman', 'nonbinary')",
  "talents_height_band_check": "height_band is null or height_band in ('short', 'average', 'tall')",
  "video_renders_one_payer": "num_nonnulls(brand_id, org_id) = 1"
};

export const WRITABLE_COLUMNS: Record<string, { insert: string[]; update: string[] }> = {
  "brands": {
    "insert": [
      "id",
      "org_id",
      "created_by",
      "name",
      "website",
      "slug",
      "target_platforms",
      "content_prefs",
      "onboarding_completed_at"
    ],
    "update": [
      "name",
      "website",
      "timezone",
      "target_platforms",
      "content_prefs",
      "ads_settings",
      "chat_default_tier",
      "launched_at",
      "setup_step",
      "setup_completed_at",
      "onboarding_state",
      "onboarding_completed_at",
      "own_history_at"
    ]
  },
  "organizations": {
    "insert": [
      "name",
      "owner_id"
    ],
    "update": []
  },
  "profiles": {
    "insert": [],
    "update": [
      "full_name",
      "avatar_url",
      "locale"
    ]
  }
};
