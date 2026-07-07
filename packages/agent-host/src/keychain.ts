import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SERVICE = 'com.huqi.tender-screenshot-agent';

export interface SecretStore {
  set(account: string, value: string): Promise<void>;
  get(account: string): Promise<string | undefined>;
  delete(account: string): Promise<void>;
}

export class MacOSKeychainStore implements SecretStore {
  private ensurePlatform(): void {
    if (process.platform !== 'darwin') throw new Error('OS Keychain adapter currently supports macOS only');
  }

  async set(account: string, value: string): Promise<void> {
    this.ensurePlatform();
    await execFileAsync('security', ['add-generic-password', '-U', '-s', SERVICE, '-a', account, '-w', value]);
  }

  async get(account: string): Promise<string | undefined> {
    this.ensurePlatform();
    try {
      const { stdout } = await execFileAsync('security', ['find-generic-password', '-s', SERVICE, '-a', account, '-w']);
      return stdout.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  async delete(account: string): Promise<void> {
    this.ensurePlatform();
    try {
      await execFileAsync('security', ['delete-generic-password', '-s', SERVICE, '-a', account]);
    } catch {
      // Deleting a missing credential is idempotent.
    }
  }
}

export const WECOM_BOT_ID = 'wecom-bot-id';
export const WECOM_BOT_SECRET = 'wecom-bot-secret';

export function modelApiKeyAccount(profile: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(profile)) throw new Error('invalid model profile name');
  return `llm-api-key:${profile}`;
}
