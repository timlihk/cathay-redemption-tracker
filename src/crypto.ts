import crypto from 'crypto';

const SECRET = process.env.SECRET_KEY || '';

function getKey(): Buffer {
  if (!SECRET || SECRET.length < 16) {
    throw new Error('SECRET_KEY is required (min 16 chars)');
  }
  // Derive 32-byte key from secret
  return crypto.createHash('sha256').update(SECRET).digest();
}

export function encryptString(plain: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

export function decryptString(blob: string): string {
  const key = getKey();
  const [ivB64, tagB64, dataB64] = blob.split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Invalid encrypted payload');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString('utf8');
}