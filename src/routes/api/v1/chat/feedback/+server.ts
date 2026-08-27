import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Record thumbs up/down on an assistant chat message.
 * Feedback is stored only — never written to brand memory or used as training.
 *
 * Body: { messageId: string, value: 1 | -1 | null, note?: string }
 */
export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    messageId?: unknown;
    value?: unknown;
    note?: unknown;
  } | null;

  const messageId = typeof body?.messageId === 'string' ? body.messageId : '';
  if (!messageId) return json({ error: 'messageId required' }, { status: 400 });

  const value = body?.value;
  if (value !== 1 && value !== -1 && value !== null) {
    return json({ error: 'value must be 1, -1, or null' }, { status: 400 });
  }

  const note =
    typeof body?.note === 'string' && body.note.trim()
      ? body.note.trim().slice(0, 500)
      : null;

  const { data: row } = await supabase
    .from('chat_messages')
    .select('id, role, user_id')
    .eq('id', messageId)
    .eq('user_id', user.id)
    .eq('superseded', false)
    .maybeSingle();

  if (!row) return json({ error: 'Message not found' }, { status: 404 });
  if (row.role !== 'assistant') {
    return json({ error: 'Feedback only applies to assistant messages' }, { status: 400 });
  }

  const { error } = await supabase
    .from('chat_messages')
    .update({
      feedback: value,
      feedback_note: value === -1 ? note : null,
      feedback_at: value == null ? null : new Date().toISOString()
    })
    .eq('id', messageId)
    .eq('user_id', user.id);

  if (error) {
    console.error('[chat/feedback]', error.message);
    return json({ error: 'Failed to save feedback' }, { status: 500 });
  }

  return json({ ok: true, messageId, value });
};
