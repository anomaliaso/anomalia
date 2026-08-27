-- 0193 — Drop the connector registry: the catalog is Composio's, not ours.
--
-- The table came from Nango, where every integration needed its own OAuth app and an operator
-- decided which ones a brand could see. With Composio's managed auth there is nothing to
-- register, so an allow list only hides integrations that are already connectable — which is
-- what it was doing: brands saw four apps out of a catalog of a thousand.
--
-- `kind` (does this toolkit also feed the corpus?) is derived from the toolkit slug in code.

drop table if exists public.app_integration_registry;
