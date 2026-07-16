import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: string;
}

export interface MockResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

export type MockHandler = (
  request: RecordedRequest,
  requestNumber: number,
) => MockResponse | Promise<MockResponse>;

export interface MockSezzleServer {
  readonly baseUrl: string;
  readonly requests: readonly RecordedRequest[];
  close(): Promise<void>;
}

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request as AsyncIterable<unknown>) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
    } else if (chunk instanceof Uint8Array) {
      chunks.push(chunk);
    } else {
      throw new TypeError('Unexpected request body chunk.');
    }
  }
  return Buffer.concat(chunks).toString('utf8');
};

const sendResponse = (response: ServerResponse, mockResponse: MockResponse): void => {
  response.statusCode = mockResponse.status;
  for (const [name, value] of Object.entries(mockResponse.headers ?? {})) {
    response.setHeader(name, value);
  }
  if (mockResponse.body === undefined) {
    response.end();
    return;
  }
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(mockResponse.body));
};

export const startMockSezzleServer = async (handler: MockHandler): Promise<MockSezzleServer> => {
  const requests: RecordedRequest[] = [];
  const handleRequest = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    try {
      const recorded: RecordedRequest = {
        method: request.method ?? 'GET',
        url: request.url ?? '/',
        headers: request.headers,
        body: await readBody(request),
      };
      requests.push(recorded);
      sendResponse(response, await handler(recorded, requests.length));
    } catch {
      sendResponse(response, { status: 500, body: [{ code: 'mock_server_error' }] });
    }
  };
  const server = createServer((request, response) => {
    void handleRequest(request, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('Mock server did not bind to a TCP port.');
  }
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    requests,
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      }),
  };
};
