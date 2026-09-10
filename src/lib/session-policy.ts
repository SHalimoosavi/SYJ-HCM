export const SESSION_ABSOLUTE_TTL_MS = 1000 * 60 * 60 * 24 * 7;
export const SESSION_IDLE_TTL_MS = 1000 * 60 * 60 * 24;
export const SESSION_TOUCH_INTERVAL_MS = 1000 * 60 * 5;

export function isSessionActive(nowMs: number, lastActiveAt: string, expiresAt: string): boolean {
  const absoluteExpiry = new Date(expiresAt).getTime();
  const lastActive = new Date(lastActiveAt).getTime();
  if (!Number.isFinite(absoluteExpiry) || !Number.isFinite(lastActive)) return false;
  return absoluteExpiry > nowMs && nowMs - lastActive < SESSION_IDLE_TTL_MS;
}
