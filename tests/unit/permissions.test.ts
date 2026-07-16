import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config/env.js';
import {
  getGrantedCapabilities,
  profileHasCapability,
  shouldRegisterTool,
  type ToolPolicy,
} from '../../src/config/permissions.js';

const financeMutation: ToolPolicy = {
  capability: 'finance',
  mutation: true,
  dangerous: true,
};

describe('permission policy', () => {
  it('does not grant finance capabilities to the default read profile', () => {
    expect(profileHasCapability('read', 'finance')).toBe(false);
    expect(getGrantedCapabilities('read')).toEqual(['read']);
  });

  it('removes mutation tools while the server is read-only', () => {
    const config = loadConfig({ SEZZLE_PERMISSION_PROFILE: 'finance' });

    expect(shouldRegisterTool(financeMutation, config)).toBe(false);
  });

  it('registers an approved mutation only for a matching write profile', () => {
    const config = loadConfig({
      SEZZLE_PERMISSION_PROFILE: 'finance',
      SEZZLE_READ_ONLY: 'false',
      SEZZLE_REQUIRE_CONFIRMATION: 'true',
    });

    expect(shouldRegisterTool(financeMutation, config)).toBe(true);
  });

  it('keeps profile boundaries even when write mode is enabled', () => {
    const config = loadConfig({
      SEZZLE_PERMISSION_PROFILE: 'webhooks',
      SEZZLE_READ_ONLY: 'false',
      SEZZLE_REQUIRE_CONFIRMATION: 'true',
    });

    expect(shouldRegisterTool(financeMutation, config)).toBe(false);
  });
});
