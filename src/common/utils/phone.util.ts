export function buildPhoneLookupCandidates(raw?: string | null): string[] {
  if (!raw || typeof raw !== 'string') {
    return [];
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  const digits = trimmed.replace(/\D/g, '');
  const candidates = new Set<string>([trimmed]);

  if (digits.length === 10) {
    const e164 = `+91${digits}`;
    const spaced = `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
    candidates.add(digits);
    candidates.add(e164);
    candidates.add(spaced);
  } else if (digits.length === 12 && digits.startsWith('91')) {
    const local10 = digits.slice(2);
    candidates.add(`+${digits}`);
    candidates.add(`+91 ${local10.slice(0, 5)} ${local10.slice(5)}`);
    candidates.add(local10);
  } else if (digits.length > 0 && !trimmed.startsWith('+')) {
    candidates.add(`+${digits}`);
  }

  return Array.from(candidates);
}

export function normalizeStoredPhone(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isNonProductionEnvironment(): boolean {
  const nodeEnv = (process.env.NODE_ENV || '').toLowerCase();
  const appEnv = (process.env.APP_ENV || '').toLowerCase();
  return nodeEnv !== 'production' && appEnv !== 'production';
}
