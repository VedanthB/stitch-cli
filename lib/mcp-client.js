export class MCPClient {
  #url;
  #headers;
  #sessionId;
  #nextId = 1;

  constructor(url, headers = {}) {
    this.#url = url;
    this.#headers = headers;
  }

  async connect() {
    const res = await this.#send({
      jsonrpc: '2.0',
      id: this.#nextId++,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        clientInfo: { name: 'stitch-cli', version: '1.0.0' },
        capabilities: {},
      },
    });

    // Capture session ID from response headers (set by #send's raw path)
    // Already captured in #send — just send the notification now
    await this.#send({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
  }

  async callTool(name, args = {}) {
    const result = await this.#send({
      jsonrpc: '2.0',
      id: this.#nextId++,
      method: 'tools/call',
      params: { name, arguments: args },
    });
    // Extract text content shortcut
    if (result?.content?.[0]?.text !== undefined) {
      return result.content[0].text;
    }
    return result;
  }

  async listTools() {
    const result = await this.#send({
      jsonrpc: '2.0',
      id: this.#nextId++,
      method: 'tools/list',
    });
    return result.tools;
  }

  close() {
    this.#sessionId = undefined;
  }

  async #send(message) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'x-goog-user-project': process.env.GCLOUD_PROJECT || 'gen-lang-client-0968808426',
      ...this.#headers,
    };
    if (this.#sessionId) {
      headers['Mcp-Session-Id'] = this.#sessionId;
    }

    const res = await fetch(this.#url, {
      method: 'POST',
      headers,
      body: JSON.stringify(message),
    });

    // Capture session ID from any response
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.#sessionId = sid;

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    // Notifications get no meaningful body
    if (!message.id) return undefined;

    const contentType = res.headers.get('content-type') || '';

    if (contentType.includes('text/event-stream')) {
      const text = await res.text();
      const events = text
        .split('\n\n')
        .filter(Boolean)
        .map((chunk) => {
          const dataLine = chunk.split('\n').find((l) => l.startsWith('data:'));
          return dataLine ? JSON.parse(dataLine.slice(5).trim()) : null;
        })
        .filter(Boolean);
      // Return the result from the last event that has one
      const last = events.findLast((e) => e.result !== undefined);
      if (last?.error) throw new Error(last.error.message);
      return last?.result;
    }

    // Default: JSON response
    const json = await res.json();
    if (json.error) throw new Error(json.error.message);
    return json.result;
  }
}
