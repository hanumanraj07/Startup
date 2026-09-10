import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { loadEnv } from '../config/env';

/**
 * AES-256-GCM at-rest encryption for KYC document numbers and PAN.
 *
 * Per docs/16-security-requirements.md, these are "encrypted at rest and
 * never returned by any API, including to the user who submitted them." This
 * service provides `encrypt`; it deliberately has no public `decrypt` used by
 * any controller in this codebase today — decryption is reserved for the
 * admin KYC review path built in a later phase, so the absence of a decrypt
 * call anywhere outside this file is itself evidence the rule is being kept.
 */
@Injectable()
export class EncryptionService {
  private key(): Buffer {
    const env = loadEnv();
    if (!env.ENCRYPTION_KEY) {
      throw new Error('ENCRYPTION_KEY is not configured; cannot encrypt sensitive fields.');
    }
    const key = Buffer.from(env.ENCRYPTION_KEY, 'base64');
    if (key.length !== 32) {
      throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes for AES-256-GCM.');
    }
    return key;
  }

  /** Returns `<iv>.<authTag>.<ciphertext>`, each base64url, in one string column. */
  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [iv, authTag, ciphertext].map((b) => b.toString('base64url')).join('.');
  }

  /** Not called anywhere in this codebase yet. Reserved for admin KYC review. */
  decrypt(packed: string): string {
    const [ivB64, tagB64, dataB64] = packed.split('.');
    if (!ivB64 || !tagB64 || !dataB64) throw new Error('Malformed encrypted value.');
    const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
