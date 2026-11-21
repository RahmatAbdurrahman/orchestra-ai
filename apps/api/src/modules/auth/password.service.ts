import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { ARGON2_OPTIONS } from '@orchestra/database/seed';

export const PASSWORD_POLICY = Object.freeze({ minLength: 12, maxLength: 128 });

/** Argon2id password hashing (OWASP recommended parameters: m=19 MiB, t=2, p=1). */
@Injectable()
export class PasswordService {
  private dummyHash: Promise<string> | null = null;

  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  /** Spends the same time as a real verification so unknown e-mails cannot be detected by timing. */
  async verifyAgainstDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hash('dummy-password-for-timing-only');
    await this.verify(await this.dummyHash, password);
  }

  validatePolicy(password: string): string | null {
    if (password.length < PASSWORD_POLICY.minLength) {
      return `Password must be at least ${PASSWORD_POLICY.minLength} characters long`;
    }
    if (password.length > PASSWORD_POLICY.maxLength) {
      return `Password must be at most ${PASSWORD_POLICY.maxLength} characters long`;
    }
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      return 'Password must contain letters and digits';
    }
    return null;
  }
}
