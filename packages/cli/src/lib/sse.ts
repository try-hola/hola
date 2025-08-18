import { createParser, type EventSourceMessage } from 'eventsource-parser';

export type SSEHandler = (msg: EventSourceMessage) => void;

export async function streamSSE(url: string, opts?: { headers?: Record<string, string> }, onEvent?: SSEHandler): Promise<void> {
  const res = await fetch(url, { headers: opts?.headers });
  if (!res.ok || !res.body) {
    const text = await safeText(res);
    throw new Error(`SSE connect failed: ${res.status} ${res.statusText}${text ? `: ${text}` : ''}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = createParser({
    onEvent: (msg: EventSourceMessage) => {
      onEvent?.(msg);
    },
  });
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    parser.feed(chunk);
  }
}

async function safeText(res: Response) {
  try { return await res.text(); } catch { return ''; }
}
