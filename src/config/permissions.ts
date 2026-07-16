import type { AppConfig, PermissionProfile } from './env.js';

export type Capability = 'read' | 'finance' | 'webhooks' | 'support' | 'admin';

export interface ToolPolicy {
  readonly capability: Capability;
  readonly mutation: boolean;
  readonly dangerous: boolean;
}

const profileCapabilities: Readonly<Record<PermissionProfile, ReadonlySet<Capability>>> = {
  read: new Set(['read']),
  finance: new Set(['read', 'finance']),
  webhooks: new Set(['webhooks']),
  support: new Set(['support']),
  admin: new Set(['read', 'finance', 'webhooks', 'support', 'admin']),
};

export const profileHasCapability = (profile: PermissionProfile, capability: Capability): boolean =>
  profileCapabilities[profile].has(capability);

export const shouldRegisterTool = (policy: ToolPolicy, config: AppConfig): boolean => {
  if (!profileHasCapability(config.sezzle.permissionProfile, policy.capability)) {
    return false;
  }
  if (policy.mutation && config.sezzle.readOnly) {
    return false;
  }
  if (policy.dangerous && !config.sezzle.requireConfirmation) {
    return false;
  }
  return true;
};

export const getGrantedCapabilities = (profile: PermissionProfile): readonly Capability[] =>
  [...profileCapabilities[profile]].sort();
