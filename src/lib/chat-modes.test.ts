import { describe, expect, it } from 'vitest';
import { filterToolsForMode } from './chat-modes';

describe('filterToolsForMode', () => {
  const tools = {
    search_knowledge: 1,
    read_document: 1,
    list_integrations_tools: 1,
    call_integrations_tools: 1,
    create_post: 1
  };

  it('ask mode includes knowledge + integration list, not writes', () => {
    const ask = filterToolsForMode(tools, 'ask');
    expect(ask.search_knowledge).toBe(1);
    expect(ask.read_document).toBe(1);
    expect(ask.list_integrations_tools).toBe(1);
    expect(ask.call_integrations_tools).toBeUndefined();
    expect(ask.create_post).toBeUndefined();
  });

  it('only agent and plan can knock on the user’s inbox — ask launches nothing worth an email', () => {
    const withNotify = { ...tools, notify_user: 1 };
    expect(filterToolsForMode(withNotify, 'agent').notify_user).toBe(1);
    expect(filterToolsForMode(withNotify, 'plan').notify_user).toBe(1);
    expect(filterToolsForMode(withNotify, 'ask').notify_user).toBeUndefined();
  });

  it('plan mode can call integration tools', () => {
    const plan = filterToolsForMode(tools, 'plan');
    expect(plan.list_integrations_tools).toBe(1);
    expect(plan.call_integrations_tools).toBe(1);
    expect(plan.create_post).toBeUndefined();
  });
});
