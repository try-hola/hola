// Command runner used by `hola bootstrap`. Shells out to the system `ssh` so it
// inherits the user's ssh-agent, known_hosts, and ~/.ssh/config (ProxyJump etc.)
// — no SSH library is bundled. Injectable so tests use a fake that records calls.

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  /** Written to the child's stdin (e.g. the .env piped to `cat`), then closed. */
  input?: string;
  /** Called with each complete output line as it arrives. */
  stream?: (line: string) => void;
}

export interface Runner {
  /** Run a command on a remote host over SSH. `remoteCmd` is executed by the remote shell. */
  ssh(host: string, remoteCmd: string, opts?: RunOptions): Promise<RunResult>;
  /** Run a command locally. */
  local(cmd: string, args: string[], opts?: RunOptions): Promise<RunResult>;
}

/** Production runner backed by child_process.spawn of the system ssh/local binaries. */
export function systemRunner(extraSshArgs: string[] = []): Runner {
  const run = (cmd: string, args: string[], opts?: RunOptions): Promise<RunResult> =>
    new Promise((resolve, reject) => {
      import('node:child_process').then(({ spawn }) => {
        const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        const onOut = lineEmitter((l) => opts?.stream?.(l));
        const onErr = lineEmitter((l) => opts?.stream?.(l));
        child.stdout?.on('data', (d) => { const s = String(d); stdout += s; onOut(s); });
        child.stderr?.on('data', (d) => { const s = String(d); stderr += s; onErr(s); });
        child.on('error', reject);
        child.on('close', (code) => { onOut('\n'); onErr('\n'); resolve({ code: code ?? 1, stdout, stderr }); });
        if (opts?.input != null) child.stdin?.write(opts.input);
        child.stdin?.end();
      }, reject);
    });

  return {
    ssh: (host, remoteCmd, opts) =>
      run('ssh', [...extraSshArgs, '-o', 'ConnectTimeout=10', host, remoteCmd], opts),
    local: (cmd, args, opts) => run(cmd, args, opts),
  };
}

/** Buffer partial chunks and emit each complete line (trailing newline flushes). */
function lineEmitter(emit: (line: string) => void): (chunk: string) => void {
  let buf = '';
  return (chunk: string) => {
    buf += chunk;
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      const line = buf.slice(0, nl);
      if (line) emit(line);
      buf = buf.slice(nl + 1);
      nl = buf.indexOf('\n');
    }
  };
}
