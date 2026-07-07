import type { PlatformAdapterConfig, PrivacyMode } from './domain.js';

export interface PolicyContext {
  privacyMode: PrivacyMode;
  hasAuthorizedProfile: boolean;
}

export class AccessPolicy {
  canSearch(platform: PlatformAdapterConfig, context: PolicyContext): { allow: true } | { allow: false; reason: string } {
    if (platform.accessMode === 'public') return { allow: true };
    if (!context.hasAuthorizedProfile) {
      return { allow: false, reason: `${platform.name} requires a lawful manual-login profile before automated access` };
    }
    if (platform.accessMode === 'ca-login') {
      return { allow: false, reason: `${platform.name} requires CA/UKey interaction and is always routed to manual review` };
    }
    return { allow: true };
  }

  canSendNotification(privacyMode: PrivacyMode, markdown: string): { allow: true } | { allow: false; reason: string } {
    if (privacyMode === 'strict-local') return { allow: false, reason: 'strict-local mode prohibits outbound notifications' };
    if (/\b(cookie|authorization|bearer|secret|token)\b/i.test(markdown)) {
      return { allow: false, reason: 'notification body contains a protected credential marker' };
    }
    return { allow: true };
  }
}
