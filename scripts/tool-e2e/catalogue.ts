/**
 * COSA FA OGNI TOOL, dichiarato in un punto solo.
 *
 * Il banco gira contro un brand VERO (`E2E_BRAND_ID`), quindi la domanda «questo tool scrive?»
 * non è una curiosità: è la differenza fra una lettura e un post nel calendario editoriale di un
 * cliente. Un tool che non compare qui NON viene eseguito — il silenzio vale «non lo so», mai
 * «è sicuro». È la stessa regola dell'eval: verde e mai-provato non si confondono.
 */

/** Input minimo valido per eseguire il tool. `null` = si chiama senza argomenti. */
export type ToolProbe = Record<string, unknown> | null;

/**
 * SOLA LETTURA: nessuna riga scritta, nessuna spesa oltre la query. Girano sul brand vero.
 * L'input è quello che un agente passerebbe davvero, non il minimo sindacale che compila.
 */
export const READ_ONLY: Record<string, ToolProbe> = {
	read_posts: { limit: 3 },
	read_brand_studio: null,
	read_brand_kit: null,
	read_strategy: null,
	read_editorial_plan: null,
	read_products: null,
	read_people: null,
	read_competitors: null,
	read_documents: null,
	read_memory: null,
	read_notifications: null,
	read_talents: null,
	read_market_references: null,
	read_seo_plan: null,
	read_backlink_network: null,
	read_site_pages: null,
	read_leads: null,
	list_articles: null,
	list_motion_videos: null,
	list_social_accounts: null,
	list_scheduled_agents: null,
	list_calendar_conflicts: null,
	list_brand_errors: null,
	list_integrations_tools: null,
	get_billing_status: null,
	show_setup_checklist: null,
	show_team: null,
	search_knowledge: { query: 'brand' },
	read_knowledge: { query: 'brand' },
	query: { table: 'posts', limit: 1 },
	ls: null,
	glob: { pattern: '**/*.md', limit: 3 },
	grep: { query: 'brand', max_matches: 3 },
	read_file: { path: 'brand/studio.md' },
	brand_ls: null,
	brand_grep: { query: 'brand', max_matches: 3 },
	brand_read: { path: 'brand/studio.md' }
};

/**
 * SCRIVONO O SPENDONO. Non girano sul brand vero e basta: hanno bisogno del brand usa-e-getta che
 * `scripts/eval/fixture.ts` crea e distrugge. Elencati perché il rapporto possa dire quanti sono
 * senza copertura, invece di tacere.
 */
export const WRITES: readonly string[] = [
	'create_post', 'update_media', 'update_product', 'update_person', 'update_document',
	'update_article', 'update_brand_kit', 'update_brand_colors', 'update_voice', 'update_logo',
	'update_editorial_plan', 'update_gtm_plan', 'update_competitor', 'update_goal',
	'add_document', 'add_memory', 'remove_memory', 'add_seo_initiatives', 'set_goal', 'close_goal',
	'generate_image', 'regenerate_image', 'generate_content', 'generate_article_cover',
	'generate_article_images', 'generate_editorial_plan', 'generate_strategy', 'generate_person',
	'generate_seo_plan', 'generate_backlink_opportunities', 'create_motion_video', 'make_video',
	'design_graphic', 'write_source', 'replace_source', 'write_motion_source',
	'replace_motion_source', 'produce_week', 'schedule_article', 'write_planned_article',
	'optimize_article', 'restructure_carousel', 'edit_slide', 'set_text', 'render',
	'create_campaign', 'create_scheduled_agent', 'update_scheduled_agent', 'create_group_chat',
	'sync_products', 'sync_social_history', 'save_social_handles', 'use_library_image',
	'publish_artifact', 'reanalyze_brand', 'run_analytics_review', 'run_seo_geo_audit',
	'update_mood_references', 'update_demo_account'
];

/**
 * MAI IN AUTOMATICO. Escono dal prodotto (pubblicano, notificano, spendono su terzi) o eseguono
 * codice arbitrario. Un banco che li lancia da solo, una volta, fa un danno che nessun verde ripaga.
 */
export const NEVER: readonly string[] = [
	'notify_user', 'call_integrations_tools', 'propose_app_connection', 'offer_upgrade',
	'sandbox_exec', 'sandbox_write_file', 'sandbox_browse', 'sandbox_device_login',
	'sandbox_save_output', 'delegate_task', 'message_agent', 'run_parallel_tasks',
	'run_task_pipeline', 'capture_website', 'research_meta_ads', 'search_web',
	'discover_competitors', 'harvest_product_ui', 'review_video', 'breakdown_reference_video'
];
