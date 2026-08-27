import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
  createCustomAgentSchedule,
  deleteCustomAgent,
  hireCustomAgent,
  deleteCustomAgentSchedule,
  fireCustomAgentSchedule,
  formDataToScheduleRaw,
  listCustomAgentSchedules,
  listCustomAgents,
  parseCustomAgent,
  parseCustomAgentSchedule,
  setCustomAgentEnabled,
  setCustomAgentScheduleEnabled,
  updateCustomAgent,
  updateCustomAgentSchedule,
  type CustomAgentScheduleRow
} from '$lib/server/custom-agents';
import { createAdminClient } from '$lib/server/supabase-admin';
import { formatInZone } from '$lib/server/schedule';
import {
  bumpAgentTemplateInstalls,
  getAgentTemplate,
  listAgentTemplates
} from '$lib/server/agent-templates';
import { randomAgentAvatar } from '$lib/agent-templates';
import { PENDING_AGENT_INSTALL_COOKIE } from '$lib/agent-install';
import { brandRoster, setJobEnabled } from '$lib/server/job-roster';

export const load: PageServerLoad = async ({ parent, url, cookies, locals: { supabase } }) => {
  const { brand } = await parent();
  const admin = createAdminClient();
  // The library is the answer to the empty state: an agent someone already wrote, next to the
  // ones this brand runs. Global catalogue → admin client, same as the public /agents pages.
  // Sulla pagina i custom e gli inclusi sono la stessa squadra: cambia solo chi li ha assunti, e
  // quindi cosa ci puoi fare sopra.
  // Quattro letture in parallelo. `agents` e `schedules` sono due cose diverse dalla 0210:
  // CHI lavora per il brand, e COSA fa ognuno ogni tot. Prima erano la stessa riga.
  const [agents, schedules, templates, jobs] = await Promise.all([
    listCustomAgents(supabase, brand.id),
    listCustomAgentSchedules(supabase, brand.id),
    listAgentTemplates(admin),
    brandRoster(admin, brand.id)
  ]);
  const tz = (brand.timezone as string) || 'Europe/Rome';

  // Which library agent to open on arrival: the query param from /app/install-agent/[slug],
  // or the cookie it parked there when the click happened logged out.
  const parked = cookies.get(PENDING_AGENT_INSTALL_COOKIE)?.trim() ?? '';
  const installSlug = (url.searchParams.get('install') ?? parked).trim();
  if (parked) cookies.delete(PENDING_AGENT_INSTALL_COOKIE, { path: '/' });

  return {
    timezone: tz,
    agents,
    templates,
    jobs: jobs.map((j) => ({ ...j, lastRunLabel: j.lastRunAt ? formatInZone(j.lastRunAt, tz) : null })),
    installSlug: installSlug && templates.some((t) => t.slug === installSlug) ? installSlug : null,
    schedules: schedules.map((s) => ({
      ...s,
      nextRunLabel: s.next_run_at ? formatInZone(s.next_run_at, tz) : null,
      lastRunLabel: s.last_run_at ? formatInZone(s.last_run_at, tz) : null
    }))
  };
};

type BrandTz = { id: string; timezone: string; slug: string };

function formDataModel(fd: FormData): unknown {
  const raw = String(fd.get('model') ?? '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function brandOf(supabase: any, slug: string): Promise<BrandTz | null> {
  const { data } = await supabase
    .from('brands')
    .select('id, timezone, slug')
    .eq('slug', slug)
    .maybeSingle();
  return data as BrandTz | null;
}

export const actions: Actions = {
  save: async ({ request, params, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'auth' });
    const brand = await brandOf(supabase, params.brand);
    if (!brand) return fail(404, { error: 'missing' });
    const fd = await request.formData();
    const parsed = parseCustomAgentSchedule(formDataToScheduleRaw(fd));
    if (!parsed.ok) return fail(400, { error: parsed.error });
    const id = String(fd.get('id') ?? '').trim();
    const tz = brand.timezone || 'Europe/Rome';
    if (id) {
      const updated = await updateCustomAgentSchedule(supabase, {
        brandId: brand.id,
        id,
        timezone: tz,
        input: parsed.value
      });
      if (!updated.ok) return fail(updated.error === 'missing' ? 404 : 500, { error: updated.error });
      return { ok: true, saved: true };
    }
    const created = await createCustomAgentSchedule(supabase, {
      brandId: brand.id,
      userId: user.id,
      timezone: tz,
      input: parsed.value
    });
    if (!created.ok) return fail(created.error === 'limit' ? 400 : 500, { error: created.error });
    return { ok: true, saved: true };
  },

  /**
   * One-click install from the Agent Library. Everything the template carries is copied as a
   * starting point — the user owns it from here on, so nothing links back to the catalogue
   * except `template_slug` for the install count.
   *
   * The avatar is drawn fresh at random rather than copied: two brands installing the same
   * agent should not end up with the same face, and a list of installs should look like a
   * team, not a batch.
   */
  install: async ({ request, params, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'auth' });
    const brand = await brandOf(supabase, params.brand);
    if (!brand) return fail(404, { error: 'missing' });

    const fd = await request.formData();
    const slug = String(fd.get('slug') ?? '').trim();
    const admin = createAdminClient();
    const template = await getAgentTemplate(admin, slug);
    if (!template) return fail(404, { error: 'missing' });

    const avatar = randomAgentAvatar();
    // Installare è ASSUMERE + DARGLI IL PRIMO INCARICO: il template porta sia chi è (nome, brief,
    // specialista) sia quando lavora, e dalla 0210 quelle due cose vivono su due righe.
    const created = await hireCustomAgent(supabase, {
      brandId: brand.id,
      userId: user.id,
      timezone: brand.timezone || 'Europe/Rome',
      agent: {
        name: template.name,
        prompt: template.prompt,
        agent: template.agent,
        avatarFace: avatar.face,
        avatarColor: avatar.color,
        enabled: true,
        templateSlug: template.slug
      },
      routine: {
        name: template.name,
        prompt: template.prompt,
        agent: null,
        avatarFace: avatar.face,
        avatarColor: avatar.color,
        daysOfWeek: template.days_of_week,
        times: template.times,
        enabled: true,
        reuseThread: template.reuse_thread,
        templateSlug: template.slug
      }
    });
    if (!created.ok) return fail(created.error === 'limit' ? 400 : 500, { error: created.error });

    await bumpAgentTemplateInstalls(admin, template.slug);
    return { ok: true, installed: true, name: template.name };
  },

  /**
   * L'interruttore di un lavoro incluso. È volutamente un'azione separata da `toggle` (che agisce
   * su una riga di `custom_agent_schedules`): l'archiviazione è diversa — qui si scrive un
   * rifiuto in `brand_job_optouts`, non si aggiorna un booleano — anche se il gesto a schermo è
   * lo stesso.
   */
  toggleJob: async ({ request, params, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'auth' });
    const brand = await brandOf(supabase, params.brand);
    if (!brand) return fail(404, { error: 'missing' });
    const fd = await request.formData();
    const res = await setJobEnabled(createAdminClient(), {
      brandId: brand.id,
      jobKey: String(fd.get('job') ?? ''),
      enabled: String(fd.get('enabled') ?? '') === 'on',
      userId: user.id
    });
    if (!res.ok) return fail(res.error === 'unknown_job' ? 400 : 500, { error: res.error });
    return { ok: true };
  },

  /**
   * ASSUMERE / RISCRIVERE UN AGENTE. Nome, faccia, consegna permanente e specialista: nessuna
   * cadenza. Un agente non ha giorni e orari — quelli appartengono alle sue routine, che sono
   * righe separate con il loro interruttore (0210). Prima erano la stessa riga, e per questo un
   * custom agent poteva avere esattamente una routine e mai zero, né due.
   */
  saveAgent: async ({ request, params, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'auth' });
    const brand = await brandOf(supabase, params.brand);
    if (!brand) return fail(404, { error: 'missing' });
    const fd = await request.formData();
    const parsed = parseCustomAgent({
      name: fd.get('name'),
      prompt: fd.get('prompt'),
      agent: fd.get('agent'),
      avatarFace: fd.get('avatar_face'),
      avatarColor: fd.get('avatar_color'),
      // Assente sul form di creazione: nasce in servizio (l'interruttore sta sulla card).
      enabled: fd.has('enabled') ? fd.get('enabled') : undefined,
      // '' = Default (null resetta); altrimenti il JSON {family, thinking} che il select porta.
      model: formDataModel(fd)
    });
    if (!parsed.ok) return fail(400, { error: parsed.error });

    const id = String(fd.get('id') ?? '').trim();
    if (id) {
      const updated = await updateCustomAgent(supabase, { brandId: brand.id, id, input: parsed.value });
      if (!updated.ok) return fail(updated.error === 'missing' ? 404 : 500, { error: updated.error });
      return { ok: true, saved: true };
    }

    // ASSUMERE INCLUDE IL PRIMO INCARICO: il form di creazione porta anche giorni e orari, e un
    // agente che nasce senza niente da fare è l'altro modo di sbagliare questa pagina. Da qui in
    // poi gli incarichi si aggiungono uno per uno (`?/save` con `agent = custom:<id>`).
    const first = parseCustomAgentSchedule(formDataToScheduleRaw(fd));
    if (!first.ok) return fail(400, { error: first.error });

    const created = await hireCustomAgent(supabase, {
      brandId: brand.id,
      userId: user.id,
      timezone: brand.timezone || 'Europe/Rome',
      agent: parsed.value,
      routine: first.value
    });
    if (!created.ok) return fail(created.error === 'limit' ? 400 : 500, { error: created.error });
    return { ok: true, saved: true, agentId: created.agentId };
  },

  /**
   * L'interruttore dell'AGENTE: sospende tutte le sue routine senza cancellarne nessuna e senza
   * toccare il loro stato — riaccendendolo riparte esattamente quello che girava prima. È il
   * gesto che prima non esisteva: c'era un solo interruttore per l'agente e la sua unica routine.
   */
  toggleAgent: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandOf(supabase, params.brand);
    if (!brand) return fail(404, { error: 'missing' });
    const fd = await request.formData();
    const ok = await setCustomAgentEnabled(supabase, {
      brandId: brand.id,
      id: String(fd.get('id') ?? ''),
      enabled: String(fd.get('enabled') ?? '') === 'on'
    });
    if (!ok) return fail(404, { error: 'missing' });
    return { ok: true };
  },

  deleteAgent: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandOf(supabase, params.brand);
    if (!brand) return fail(404, { error: 'missing' });
    const fd = await request.formData();
    const ok = await deleteCustomAgent(supabase, {
      brandId: brand.id,
      id: String(fd.get('id') ?? '')
    });
    if (!ok) return fail(404, { error: 'missing' });
    return { ok: true, deleted: true };
  },

  toggle: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandOf(supabase, params.brand);
    if (!brand) return fail(404, { error: 'missing' });
    const fd = await request.formData();
    const id = String(fd.get('id') ?? '');
    const enabled = String(fd.get('enabled') ?? '') === 'on';
    const ok = await setCustomAgentScheduleEnabled(supabase, {
      brandId: brand.id,
      id,
      enabled,
      timezone: brand.timezone || 'Europe/Rome'
    });
    if (!ok) return fail(404, { error: 'missing' });
    return { ok: true };
  },

  delete: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandOf(supabase, params.brand);
    if (!brand) return fail(404, { error: 'missing' });
    const fd = await request.formData();
    const ok = await deleteCustomAgentSchedule(supabase, {
      brandId: brand.id,
      id: String(fd.get('id') ?? '')
    });
    if (!ok) return fail(404, { error: 'missing' });
    return { ok: true, deleted: true };
  },

  runNow: async ({ request, params, url, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'auth' });
    const brand = await brandOf(supabase, params.brand);
    if (!brand) return fail(404, { error: 'missing' });
    const fd = await request.formData();
    const id = String(fd.get('id') ?? '');
    const { data: row } = await supabase
      .from('custom_agent_schedules')
      .select('*')
      .eq('id', id)
      .eq('brand_id', brand.id)
      .maybeSingle();
    if (!row) return fail(404, { error: 'missing' });
    const fired = await fireCustomAgentSchedule(
      createAdminClient(),
      row as CustomAgentScheduleRow,
      url.origin
    );
    if (!fired.ok) return fail(409, { error: fired.error });
    return { ok: true, ran: true, threadId: fired.threadId };
  }
};
