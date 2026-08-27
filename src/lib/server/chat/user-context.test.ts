import { describe, it, expect } from 'vitest';
import { buildUserSection } from './user-context';

describe('buildUserSection', () => {
  it('uses full name and org-owner access', () => {
    const s = buildUserSection(
      {
        userId: 'u-1',
        name: 'Marco Rossi',
        email: 'marco@example.com',
        locale: 'it',
        orgRole: 'owner',
        isOrgOwner: true,
        brandAccess: 'org_owner'
      },
      'Italian'
    );
    expect(s).toContain('Name: Marco Rossi');
    expect(s).toContain('Email: marco@example.com');
    expect(s).toContain('organization owner');
    expect(s).toContain('Address them naturally by first name when it fits ("Marco")');
  });

  it('falls back to email local-part when name is missing', () => {
    const s = buildUserSection(
      {
        userId: 'u-2',
        name: null,
        email: 'sara.bianchi@studio.it',
        locale: null,
        orgRole: 'manager',
        isOrgOwner: false,
        brandAccess: 'org_member'
      },
      'Italian'
    );
    expect(s).toContain('Name: sara.bianchi');
    expect(s).toContain('organization member (manager)');
  });

  it('labels shared collaborators', () => {
    const s = buildUserSection(
      {
        userId: 'u-3',
        name: 'Guest User',
        email: 'guest@agency.com',
        locale: 'en',
        orgRole: null,
        isOrgOwner: false,
        brandAccess: 'shared'
      },
      'English'
    );
    expect(s).toContain('shared collaborator');
  });
});
