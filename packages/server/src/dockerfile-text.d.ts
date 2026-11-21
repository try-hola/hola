/**
 * A `Dockerfile` imported with `with { type: 'text' }` is its contents as a
 * string (Bun's text loader, at runtime and in `bun build`). Used for the
 * never-built pin files under `packages/server/platform-images/`.
 */
declare module '*/Dockerfile' {
  const text: string;
  export default text;
}
