// A client's email field can hold several addresses ("a@x.com, b@y.com").
// Outreach always sends to the first valid one.
const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

export function primaryEmail(value) {
  return String(value || '')
    .split(/[\s,;]+/)
    .map((part) => part.trim().toLowerCase())
    .find((part) => EMAIL.test(part)) || null;
}
