-- DA APPLICARE A MANO: i deploy di questo repo non eseguono le migration.
--
-- Tre vincoli CHECK rifiutavano valori che il codice scrive DAVVERO da mesi. Il sintomo e' il
-- peggiore possibile: la scrittura fallisce con 23514 e, dove l'errore non e' letto, l'utente
-- vede un successo finto. Qui il codice ha ragione e il vincolo e' rimasto indietro — sono
-- capacita' nate dopo il vincolo, non valori sbagliati.
--
-- 1. brand_media.source = 'agent' (agent/bridge/attach.ts): l'agente che carica un file dalla
--    propria VM nella galleria del brand. Senza questo, OGNI allegato prodotto dall'agente
--    veniva rifiutato — il lavoro fatto e mai consegnato in chat.
alter table public.brand_media drop constraint if exists brand_media_source_check;
alter table public.brand_media add constraint brand_media_source_check
  check (source = any (array['upload','chat_drop','shoot','generate','remotion_export','post_render','website_capture','agent']));

-- 2/3. gtm_plans.source e editorial_plans.source: 'analytics_review' (analytics-review-agent.ts)
--      e 'autopilot' (scheduler.ts) sono i due generatori automatici di piani nati dopo 0034/0036.
alter table public.gtm_plans drop constraint if exists gtm_plans_source_check;
alter table public.gtm_plans add constraint gtm_plans_source_check
  check (source = any (array['manual','revision','phase_review','onboarding','analytics_review','autopilot']));

alter table public.editorial_plans drop constraint if exists editorial_plans_source_check;
alter table public.editorial_plans add constraint editorial_plans_source_check
  check (source = any (array['onboarding','revision','rollover','manual','analytics_review','autopilot']));
