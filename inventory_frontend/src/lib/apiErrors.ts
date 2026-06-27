type ErrorMap = Record<string, string[] | string>;

function humanizeFieldKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-]+/g, " ")
    .replace(/\bid\b/gi, "ID")
    .replace(/\btrn\b/gi, "TRN")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

function cleanValidationMessage(key: string, message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return "";
  if (!key) return trimmed;

  const label = humanizeFieldKey(key);
  const keyPattern = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const normalized = trimmed.replace(keyPattern, label);

  return normalized === trimmed && !trimmed.toLowerCase().startsWith(label.toLowerCase())
    ? `${label}: ${trimmed}`
    : normalized;
}

function pushMessages(out: string[], key: string, value: unknown) {
  if (Array.isArray(value)) {
    value.forEach((v) => pushMessages(out, key, v));
    return;
  }
  if (typeof value === "string" && value.trim()) {
    out.push(cleanValidationMessage(key, value));
  } else if (value && typeof value === "object") {
    Object.entries(value as ErrorMap).forEach(([k, v]) => {
      pushMessages(out, k, v);
    });
  }
}

export function getApiErrorMessages(err: unknown): string[] {
  const out: string[] = [];
  const anyErr: any = err;
  const body = anyErr?.body ?? anyErr?.response ?? anyErr;

  if (body?.errors && typeof body.errors === "object") {
    Object.entries(body.errors as ErrorMap).forEach(([k, v]) =>
      pushMessages(out, k, v),
    );
  }
  if (body?.fieldErrors && typeof body.fieldErrors === "object") {
    Object.entries(body.fieldErrors as ErrorMap).forEach(([k, v]) =>
      pushMessages(out, k, v),
    );
  }
  if (Array.isArray(body?.itemErrors)) {
    body.itemErrors.forEach((v: unknown) => pushMessages(out, "", v));
  }

  if (body?.error && typeof body.error === "string") {
    out.push(body.error);
  } else if (body?.detail && typeof body.detail === "string") {
    out.push(body.detail);
  } else if (Array.isArray(body)) {
    body.forEach((v) => pushMessages(out, "", v));
  } else if (typeof body === "string") {
    out.push(body);
  }

  if (!out.length && anyErr?.message && typeof anyErr.message === "string") {
    out.push(anyErr.message);
  }

  return Array.from(new Set(out));
}

export function getApiErrorMessage(err: unknown): string {
  return getApiErrorMessages(err)[0] || "Something went wrong.";
}

export function getApiErrorSummary(err: unknown, limit = 3): string {
  const messages = getApiErrorMessages(err).filter(Boolean);
  if (!messages.length) return "Something went wrong.";
  if (messages.length <= limit) return messages.join(" ");
  return `${messages.slice(0, limit).join(" ")} +${messages.length - limit} more issue(s).`;
}

export function getApiFieldErrors(err: unknown): Record<string, string> {
  const anyErr: any = err;
  const body = anyErr?.body ?? anyErr?.response ?? anyErr;
  const source = body?.fieldErrors ?? body?.errors;
  if (!source || typeof source !== "object") return {};

  const result: Record<string, string> = {};
  Object.entries(source as Record<string, unknown>).forEach(([key, value]) => {
    const bucket: string[] = [];
    pushMessages(bucket, key, value);
    if (bucket.length) result[key] = bucket[0];
  });
  return result;
}

export function getApiItemErrors(err: unknown): string[] {
  const anyErr: any = err;
  const body = anyErr?.body ?? anyErr?.response ?? anyErr;
  const itemErrors = body?.itemErrors;
  if (!Array.isArray(itemErrors)) return [];
  const result: string[] = [];
  itemErrors.forEach((value) => pushMessages(result, "", value));
  return Array.from(new Set(result));
}
