import { tool } from 'ai';
import { z } from 'zod';
import type { ChatToolCtx } from './shared';
import { startLongToolJob, type AnyRec } from './shared';

export function integrationTools(ctx: ChatToolCtx) {
  const { supabase, brandId, userId } = ctx;

  const MAX_INTEGRATION_CALLS = 8;
  let integrationCallsUsed = 0;
  function integrationCallBudget(): { error: string } | null {
    if (integrationCallsUsed >= MAX_INTEGRATION_CALLS) {
      return {
        error: `Integration call limit reached this turn (max ${MAX_INTEGRATION_CALLS}). Summarize what you have and continue without more connector calls.`
      };
    }
    integrationCallsUsed++;
    return null;
  }

  return {
    list_integrations_tools: tool({
      description:
        'List connected integrations for this brand, or the live tools of one integration. Omit integration to see what is connected. Then call call_integrations_tools with a tool slug. A toolkit can expose hundreds of tools — pass query to search inside it. If not_connected, propose_open_tab /settings/connectors.',
      inputSchema: z.object({
        integration: z
          .string()
          .optional()
          .describe('Toolkit slug (e.g. GOOGLEDRIVE, NOTION, HUBSPOT). Omit to list connections.'),
        query: z
          .string()
          .optional()
          .describe('Search inside the toolkit, e.g. "create page", "send email".')
      }),
      execute: async ({ integration, query }: { integration?: string; query?: string }) => {
        const capped = integrationCallBudget();
        if (capped) return capped;
        const { listBrandComposioTools } = await import('$lib/server/composio-agent');
        return listBrandComposioTools(supabase, brandId, integration, query);
      }
    }),

    call_integrations_tools: tool({
      description:
        'Call one tool on a connected integration (from list_integrations_tools). Pass the toolkit slug, the tool slug, and JSON arguments. The server injects the brand connection — never pass tokens. If not_connected, propose_open_tab /settings/connectors.',
      inputSchema: z.object({
        integration: z.string().min(1).describe('Toolkit slug (e.g. GOOGLEDRIVE, NOTION)'),
        name: z.string().min(1).describe('Tool slug from list_integrations_tools (e.g. NOTION_CREATE_PAGE)'),
        arguments: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('JSON arguments for the tool, matching its input schema.')
      }),
      execute: async ({
        integration,
        name,
        arguments: args
      }: {
        integration: string;
        name: string;
        arguments?: Record<string, unknown>;
      }) => {
        const capped = integrationCallBudget();
        if (capped) return capped;
        const { callBrandComposioTool } = await import('$lib/server/composio-agent');
        return callBrandComposioTool(supabase, brandId, { integration, name, arguments: args });
      }
    }),

    /**
     * `expand_knowledge` — SMONTATO dal registro della chat il 23/8/2026.
     *
     * Camminava il grafo della conoscenza da un nodo (memory|document|chunk|product|…) restituendo
     * i vicini a 1-2 salti. NON stava in `SHARED_TOOL_KEYS` né nelle `toolKeys` di nessuno dei
     * cinque mestieri: lo montava solo l'agente nullo (onboarding e legacy), e nessun blocco di
     * prompt l'ha mai nominato. **0 chiamate in 60 giorni**, lette da `chat_messages.tool_calls`
     * filtrando `type = 'tool-call'`.
     *
     * La domanda prima di cancellare è «qualcuno avrebbe dovuto chiamarlo e non l'ha fatto?», e
     * qui la risposta è no: il tool pretende un `id` uuid che l'agente può avere solo da un'altra
     * lettura, e per «trovare quello che c'è scritto su X» esistono già `search_knowledge` (23
     * chiamate) e `read_document` (7). Era una scorciatoia per un percorso che nessuno percorre.
     *
     * RITORNO: `expandKnowledge()` era il suo unico chiamante ed è stata rimossa da
     * `$lib/server/knowledge` nella fase cancellazioni del 23/8/2026 (con `labelNeighbors` e
     * `NODE_LABEL_SOURCES`, usate solo da lei). Riportarla richiede riscriverla da zero.
     */

    capture_website: tool({
      description: [
        'Capture a website screenshot via Browserless (cloud Chrome) and save it to the Media library.',
        'Use when the brief needs a real UI / page look and no library asset fits — then pass the returned media_id into create_post(graphic_brief) or design_graphic as background/in-stack photo.',
        'AGENTIC: this is a loop, not a one-shot. If it fails, you get diagnostic_image_url + page_url + body_preview + hints (visible buttons/inputs) + failed_step. Look at those, fix wait_for_selector / click_text / url / steps, and retry capture_website in THIS turn (up to ~3 tries). Do not ask the user to continue for a selector or login miss.',
        'Simple mode: pass url (+ optional wait_for_selector / full_page).',
        'Workflow mode: pass steps to log in, click, navigate, then screenshot — NEVER invent Puppeteer code; only the allowed step actions (goto, wait, click, click_text, type, press, screenshot).',
        'If a Product demo account is saved in Settings, pass use_demo_account:true (or just the app URL) — the server injects email/password. NEVER ask for or type the password. NEVER invent login steps when a demo account exists.',
        'If Browserless is not configured, ask the user to upload a screenshot instead.'
      ].join('\n'),
      inputSchema: z.object({
        url: z.string().optional().describe('Page URL for a one-shot screenshot (https). Ignored when steps are provided.'),
        full_page: z.boolean().optional().describe('Capture the full scrollable page (default false = viewport)'),
        wait_for_selector: z.string().optional().describe('CSS selector to wait for before capture (e.g. "main", "[data-ready]")'),
        wait_ms: z.number().int().min(0).max(15000).optional().describe('Extra wait in ms after load (max 15000)'),
        title: z.string().optional().describe('Title for the Media library entry'),
        save_to_library: z.boolean().optional().describe('Save into Media library (default true). Set false for a disposable image_url only.'),
        use_demo_account: z
          .boolean()
          .optional()
          .describe(
            'Log in with the brand’s saved Product demo account before capturing. Default auto (same host as the login URL). true = always; false = never. Do not pass passwords — the server injects them.'
          ),
        cookies: z
          .array(
            z.object({
              name: z.string(),
              value: z.string(),
              domain: z.string().optional(),
              path: z.string().optional()
            })
          )
          .optional()
          .describe('Session cookies when the user pastes an authenticated session (rare — prefer steps with type/click login).'),
        steps: z
          .array(
            z.union([
              z.object({
                action: z.literal('goto'),
                url: z.string(),
                waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle0', 'networkidle2']).optional()
              }),
              z.object({
                action: z.literal('wait'),
                ms: z.number().optional(),
                selector: z.string().optional(),
                visible: z.boolean().optional()
              }),
              z.object({ action: z.literal('click'), selector: z.string() }),
              z.object({
                action: z.literal('click_text'),
                text: z.string().describe('Click the first button/link whose visible text contains this (e.g. "Sign in", "Accedi"). Use when CSS selectors hit the wrong control.')
              }),
              z.object({
                action: z.literal('type'),
                selector: z.string(),
                text: z.string(),
                clear: z.boolean().optional()
              }),
              z.object({ action: z.literal('press'), key: z.string() }),
              z.object({
                action: z.literal('screenshot'),
                fullPage: z.boolean().optional(),
                selector: z.string().optional()
              })
            ])
          )
          .optional()
          .describe(
            'Ordered workflow: goto → wait/click/click_text/type/press → screenshot. Prefer use_demo_account instead of typing passwords. Only use type/click login when no demo account is saved. On failure, retry with click_text or a tighter selector from hints.'
          )
      }),
      execute: async (args: {
        url?: string;
        full_page?: boolean;
        wait_for_selector?: string;
        wait_ms?: number;
        title?: string;
        save_to_library?: boolean;
        use_demo_account?: boolean;
        cookies?: Array<{ name: string; value: string; domain?: string; path?: string }>;
        steps?: import('$lib/server/website-capture').CaptureStep[];
      }) => {
        const { captureWebsite } = await import('$lib/server/website-capture');
        const result = await captureWebsite({
          supabase,
          brandId,
          userId,
          url: args.url,
          fullPage: args.full_page,
          waitForSelector: args.wait_for_selector,
          waitMs: args.wait_ms,
          title: args.title,
          saveToLibrary: args.save_to_library,
          useDemoAccount: args.use_demo_account,
          cookies: args.cookies,
          steps: args.steps
        });
        if (!result.ok) return result;
        return {
          success: true,
          media_id: result.media_id,
          image_url: result.image_url,
          width: result.width,
          height: result.height,
          source_url: result.source_url,
          page_url: result.page_url,
          page_title: result.page_title,
          saved_to_library: result.saved_to_library,
          hint: result.media_id
            ? 'Pass media_id as media_ids to create_post(graphic_brief) or design_graphic — use as background or in-stack image.'
            : 'Pass image_url as image_urls to create_post(graphic_brief) or design_graphic.'
        };
      }
    }),

    harvest_product_ui: tool({
      description: [
        'Log into the brand’s saved Product demo account and capture authenticated app screens into the Media library.',
        'Use for SaaS / logged-in product UI when the user wants real dashboards, settings, or feature screens in posts.',
        'Honor Product demo custom instructions (which screens to capture, what to push). Prefer pages named there.',
        'AGENTIC: if some (or all) pages fail, inspect diagnostic_image_url / hints / failed_step on those shots. Then capture_website on the failed URL with a better wait_for_selector or click_text, or update_demo_account selectors, and retry in THIS turn. Do not stop after the first error.',
        'The server injects credentials — NEVER ask for or pass the password.',
        'If no demo account is saved, tell the user to add one at Settings → Product demo (email/password, not Google SSO).'
      ].join('\n'),
      inputSchema: z.object({
        pages: z
          .array(z.string())
          .optional()
          .describe('App URLs or paths to capture (e.g. /dashboard). Default: pages saved in Settings, paths named in custom instructions, or nav discovery after login.'),
        discover: z
          .boolean()
          .optional()
          .describe('Also collect same-origin nav links after login (default true when no pages are saved).')
      }),
      execute: async (args: { pages?: string[]; discover?: boolean }) => {
        const { createAdminClient } = await import('$lib/server/supabase-admin');
        const { harvestProductUi } = await import('$lib/server/demo-account');
        let admin;
        try {
          admin = createAdminClient();
        } catch {
          return { error: 'Demo account vault is not configured on this environment.' };
        }
        const result = await harvestProductUi({
          supabase,
          admin,
          brandId,
          userId,
          pages: args.pages,
          discover: args.discover
        });
        if (!result.ok) {
          if (result.error === 'no_demo_account') {
            return {
              error: 'no_demo_account',
              message:
                'No product demo account saved. Ask the user to add login URL + email + password in Settings → Product demo, then retry. Do not ask them to paste the password in chat.'
            };
          }
          return {
            error: result.error,
            captured: result.captured,
            pages: result.pages,
            discovered: result.discovered,
            hint: 'Some or all pages failed. Inspect diagnostic_image_url, body_preview, and hints on failed shots. Then capture_website those URLs with a better wait_for_selector / click_text, or update_demo_account, and retry in this turn.'
          };
        }
        const ok = result.captured.filter((c) => c.ok);
        return {
          success: true,
          captured: ok.length,
          failed: result.captured.filter((c) => !c.ok).length,
          discovered: result.discovered,
          media_ids: ok.map((c) => c.media_id).filter(Boolean),
          shots: result.captured.map((c) => ({
            url: c.url,
            ok: c.ok,
            media_id: c.media_id,
            error: c.error,
            page_url: c.page_url,
            page_title: c.page_title,
            body_preview: c.body_preview,
            failed_step: c.failed_step,
            hints: c.hints,
            diagnostic_image_url: c.diagnostic_image_url,
            diagnostic_media_id: c.diagnostic_media_id,
            retry_hint: c.retry_hint
          })),
          hint: result.captured.some((c) => !c.ok)
            ? 'Some pages failed. Inspect diagnostic_image_url / hints / failed_step on those shots, then capture_website those URLs or update_demo_account selectors, and retry in this turn. Do not use Capture debug images as product UI.'
            : 'Pass media_ids to create_post(graphic_brief) or design_graphic as background / in-stack product UI.'
        };
      }
    }),

    update_demo_account: tool({
      description: [
        'Patch the saved Product demo account (CSS selectors, pages to capture, product-usage notes) WITHOUT touching the password.',
        'Use during an agentic capture loop when diagnostic hints show a better submit/email/success selector, or when you discover the right app pages.',
        'NEVER pass a password. NEVER ask the user to paste credentials in chat.'
      ].join('\n'),
      inputSchema: z.object({
        pages: z
          .array(z.string())
          .optional()
          .describe('App URLs or paths to capture on the next harvest (e.g. /dashboard). Replaces the saved list.'),
        instructions: z
          .string()
          .optional()
          .describe('How to use the product — which screens matter, what to push. Replaces saved notes.'),
        email_selector: z.string().optional().describe('CSS selector for the login email/username field.'),
        password_selector: z.string().optional().describe('CSS selector for the login password field.'),
        submit_selector: z
          .string()
          .optional()
          .describe('CSS selector for the email/password submit button. Keep it scoped to the password form so OAuth buttons are not clicked.'),
        success_selector: z
          .string()
          .optional()
          .describe('CSS selector that appears after a successful login (e.g. [data-sidebar]).')
      }),
      execute: async (args: {
        pages?: string[];
        instructions?: string;
        email_selector?: string;
        password_selector?: string;
        submit_selector?: string;
        success_selector?: string;
      }) => {
        const { patchDemoAccount } = await import('$lib/server/demo-account');
        const patched = await patchDemoAccount(supabase, brandId, {
          pages: args.pages,
          instructions: args.instructions,
          emailSelector: args.email_selector,
          passwordSelector: args.password_selector,
          submitSelector: args.submit_selector,
          successSelector: args.success_selector
        });
        if (!patched.ok) {
          if (patched.error === 'no_demo_account') {
            return {
              error: 'no_demo_account',
              message:
                'No product demo account saved. Ask the user to add login URL + email + password in Settings → Product demo. Do not ask them to paste the password in chat.'
            };
          }
          return { error: patched.error };
        }
        return {
          success: true,
          hint: 'Selectors/pages saved. Retry harvest_product_ui or capture_website(use_demo_account: true) in this turn.'
        };
      }
    }),
  };
}
