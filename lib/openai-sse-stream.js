/**
 * 消费 OpenAI 兼容的 chat/completions SSE（data: {...} 行），汇总 assistant 文本。
 * @param {ReadableStreamDefaultReader<Uint8Array>} reader
 * @param {(delta: string) => void} [onDelta]
 * @returns {Promise<string>}
 */
export async function consumeOpenAiChatSse(reader, onDelta) {
  const dec = new TextDecoder();
  let buf = '';
  let full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      const t = line.trimEnd();
      if (!t.startsWith('data:')) continue;
      const payload = t.slice(5).trimStart();
      if (payload === '[DONE]') continue;
      try {
        const obj = JSON.parse(payload);
        const piece = obj.choices?.[0]?.delta?.content;
        if (typeof piece === 'string' && piece.length) {
          full += piece;
          if (onDelta) onDelta(piece);
        }
      } catch {
        /* 忽略非 JSON 行 */
      }
    }
  }
  if (buf.trim()) {
    const t = buf.trimEnd();
    if (t.startsWith('data:')) {
      const payload = t.slice(5).trimStart();
      if (payload !== '[DONE]') {
        try {
          const obj = JSON.parse(payload);
          const piece = obj.choices?.[0]?.delta?.content;
          if (typeof piece === 'string' && piece.length) {
            full += piece;
            if (onDelta) onDelta(piece);
          }
        } catch {
          /* ignore */
        }
      }
    }
  }
  return full;
}
