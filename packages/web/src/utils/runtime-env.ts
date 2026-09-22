// Reading Node's `process` from browser code, honestly.
//
// The dashboard bundle is browser code: `process` does not exist there. It DOES
// exist when these same modules are loaded by vitest under Node-backed jsdom,
// which is the only reason any of this code looks at it. The tempting fix — add
// `"types": ["node"]` to the application tsconfig — would make a genuine,
// unguarded `process.env.X` in a component typecheck cleanly and then throw in
// a real browser. So the application project declares no ambient Node types at
// all (see tsconfig.app.json), and the handful of places that legitimately want
// the Node environment when one happens to be present go through here, where
// the "might not exist" is in the type rather than assumed away.

type NodeProcessLike = { env?: Record<string, string | undefined> };

/** The ambient Node `process`, or `undefined` in a browser. */
export function nodeProcess(): NodeProcessLike | undefined {
  return (globalThis as { process?: NodeProcessLike }).process;
}

/** Node's environment, or `undefined` in a browser. */
export function nodeEnv(): Record<string, string | undefined> | undefined {
  return nodeProcess()?.env;
}

/** True when this module is running under vitest (or `NODE_ENV=test`). */
export function isTestEnv(): boolean {
  const env = nodeEnv();
  return Boolean(env && (env.VITEST || env.VITEST_WORKER_ID || env.NODE_ENV === 'test'));
}
