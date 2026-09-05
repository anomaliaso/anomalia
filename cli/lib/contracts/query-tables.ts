/**
 * GENERATO — non si modifica a mano: `node scripts/query-tables-from-migrations.mjs --write`.
 *
 * Ogni tabella di `public` che una migrazione crea, cioè ogni tabella che esiste anche da
 * un'installazione da zero. La regola e il perché stanno nello script; `query-tool.test.ts`
 * rigenera e confronta, quindi una migrazione che aggiunge una tabella fa fallire il test finché
 * questo file non viene rigenerato — e l'agente non resta cieco su una tabella nuova.
 */
export const QUERY_TABLES =
  'ad_campaigns ad_metrics admins ads_remix_briefs agent_computers agent_kit_approval_requests agent_kit_effects ' +
  'agent_kit_runs agent_notifications agent_runs agent_sessions agent_templates ai_calls api_keys app_flags ' +
  'article_views benchmark_runs blog_authors blog_categories blog_integrations blog_month_jobs blog_tags ' +
  'brand_app_connections brand_article_tags brand_article_versions brand_articles brand_backlink_opportunities ' +
  'brand_backlink_orders brand_backlink_placements brand_community_profiles brand_crawl_runs brand_demo_accounts ' +
  'brand_design_templates brand_doc_chunks brand_documents brand_field_posts brand_geo_artifacts brand_geo_audits ' +
  'brand_geo_opportunities brand_geo_prompts brand_gsc_connections brand_gsc_metrics brand_internal_links ' +
  'brand_invites brand_job_optouts brand_kit brand_knowledge_edges brand_knowledge_sources brand_market_references ' +
  'brand_media brand_members brand_memory brand_news_items brand_news_sources brand_pages brand_rank_snapshots ' +
  'brand_seo_keyword_strategy brand_seo_plans brand_site_pages brand_sites brand_social_handles brand_strategy ' +
  'brand_tracked_keywords brand_triggers brand_usage brand_visual_insights brand_webhooks brands chat_artifacts ' +
  'chat_goal_events chat_goals chat_jobs chat_messages chat_model_catalog chat_thread_reads chat_threads ' +
  'competitors content_plans content_quality_samples credit_grants custom_agent_schedules custom_agent_thread_runs ' +
  'custom_agents disruptive_ideas editorial_plans expert_requests graphic_designs gtm_plans incidents ' +
  'lead_outcomes lead_suppressions lifecycle_emails loop_cursors loop_ticks market_account_baselines ' +
  'market_account_fetch_attempts market_harvest_errors market_harvest_runs market_post_observations market_posts ' +
  'market_teardowns market_video_analyses media_generator_items media_generator_prompts motion_craft_scores ' +
  'motion_reference_specs motion_video_prompts motion_video_references motion_videos onboarding_drafts ' +
  'onboarding_errors onboarding_jobs onboarding_step_jobs org_members org_usage organizations people ' +
  'post_links post_revisions post_verdicts post_visual_meta posts products profiles publish_logs push_subscriptions ' +
  'radar_feed_cache radar_jobs radar_searches referral_codes referrals rubrics sandbox_holders scheduler_runs ' +
  'scrapecreators_cache shared_views social_accounts social_post_history social_thumb_cache talent_views ' +
  'talents thread_events tool_usage video_renders video_requests video_reviews waitlist webhook_deliveries ' +
  'zernio_ad_accounts';
