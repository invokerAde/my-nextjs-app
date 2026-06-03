import crypto from 'crypto';

export function computeDocHash(content: string, metadata?: Record<string, unknown>): string {
  const payload = JSON.stringify({ content, metadata: metadata ?? {} });
  return crypto.createHash('sha256').update(payload).digest('hex');
}
