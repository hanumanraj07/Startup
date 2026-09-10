import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * Password hashing. Argon2id only, per docs/16-security-requirements.md.
 *
 * Never store, log, or return a password or its hash in any response. This
 * service is the only place a raw password is ever touched.
 */
@Injectable()
export class PasswordService {
  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  /**
   * Verifies without throwing on a malformed hash, so a corrupted or
   * unexpected stored value fails the login rather than crashing the request.
   */
  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
}
