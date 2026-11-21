/**
 * Quote a value for a POSIX shell. Values made only of path-safe characters are
 * returned as-is (so ordinary commands read naturally); anything else is wrapped
 * in single quotes with embedded quotes escaped. The install dir is operator
 * supplied (`--dir`) and may contain spaces or metacharacters.
 */
export function shq(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
