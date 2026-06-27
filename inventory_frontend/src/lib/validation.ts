export function isBlank(v: string | null | undefined) {
  return !v || v.trim().length === 0;
}

export function isEmail(v: string) {
  const value = v.trim();
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isPhone(v: string) {
  const value = v.trim();
  if (!value) return false;
  return /^\+?[0-9][0-9\s-]{6,14}$/.test(value);
}

export function isGstin(v: string) {
  const value = v.trim();
  if (!value) return false;
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i.test(
    value,
  );
}

export function isPan(v: string) {
  const value = v.trim();
  if (!value) return false;
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(value);
}

export function isIfsc(v: string) {
  const value = v.trim();
  if (!value) return false;
  return /^[A-Z]{4}0[A-Z0-9]{6}$/i.test(value);
}

export function parseNumber(value: string | number) {
  if (typeof value === "number") return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

export function isNonNegativeNumber(value: string | number) {
  const n = parseNumber(value);
  return Number.isFinite(n) && n >= 0;
}

export function isPositiveNumber(value: string | number) {
  const n = parseNumber(value);
  return Number.isFinite(n) && n > 0;
}

export function isPositiveInt(value: string | number) {
  const n = parseNumber(value);
  return Number.isFinite(n) && n > 0 && Number.isInteger(n);
}
