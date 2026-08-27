import { env } from '$env/dynamic/private';

export function opsEmail(): string {
  return env.OPS_EMAIL || 'andrea@anomalia.so';
}

export function supportEmail(): string {
  return env.SUPPORT_EMAIL || 'hello@anomalia.so';
}

export function senderEmailDomain(): string {
  return env.SUPPORT_EMAIL_DOMAIN || 'anomalia.so';
}
