import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chat: vi.fn(() => ({ provider: "groq", modelId: "llama-3.3-70b-versatile" })),
  createOpenAI: vi.fn(),
  streamText: vi.fn(),
}));

vi.mock("@ai-sdk/openai", () => ({ createOpenAI: mocks.createOpenAI }));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  convertToModelMessages: vi.fn(async () => []),
  streamText: mocks.streamText,
}));

import { handleChat } from "@/lib/ai.server";

function request() {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    body: JSON.stringify({
      messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "Olá" }] }],
    }),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("Groq server configuration", () => {
  it("rejects malformed, empty and oversized requests before contacting Groq", async () => {
    for (const body of [
      null,
      { messages: [] },
      { messages: [{ id: "1", role: "user", parts: [{ type: "text", text: " " }] }] },
    ]) {
      const response = await handleChat(
        new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify(body) }),
      );
      expect(response.status).toBe(400);
    }
    const oversized = await handleChat(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: "x".repeat(128 * 1024 + 1),
      }),
    );
    expect(oversized.status).toBe(413);
    expect(mocks.createOpenAI).not.toHaveBeenCalled();
  });
  it("rejects a cross-origin request", async () => {
    const response = await handleChat(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { origin: "https://other.example" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(403);
  });
  it("requires GROQ_API_KEY even when a legacy Gemini key exists", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "test-only-legacy-key");
    const response = await handleChat(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "AI_NOT_CONFIGURED" });
    expect(mocks.createOpenAI).not.toHaveBeenCalled();
  });

  it("uses the Groq Chat Completions base URL with the server key", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-only-not-a-credential");
    mocks.createOpenAI.mockReturnValue({ chat: mocks.chat });
    mocks.streamText.mockReturnValue({ toUIMessageStreamResponse: () => new Response("test") });
    const response = await handleChat(request());
    expect(mocks.createOpenAI).toHaveBeenCalledWith({
      apiKey: "test-only-not-a-credential",
      baseURL: "https://api.groq.com/openai/v1",
      name: "groq",
    });
    expect(response.status).toBe(200);
  });
  it("uses exactly llama-3.3-70b-versatile regardless of legacy Gemini model configuration", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-only-not-a-credential");
    vi.stubEnv("GEMINI_MODEL", "test-model-override");
    mocks.createOpenAI.mockReturnValue({ chat: mocks.chat });
    mocks.streamText.mockReturnValue({ toUIMessageStreamResponse: () => new Response("test") });
    const response = await handleChat(request());
    expect(mocks.chat).toHaveBeenCalledWith("llama-3.3-70b-versatile");
    const options = mocks.streamText.mock.calls[0]?.[0];
    expect(options.instructions).toContain("português do Brasil");
    expect(
      Object.values(options.tools).every(
        (entry: unknown) => typeof entry === "object" && entry !== null && !("execute" in entry),
      ),
    ).toBe(true);
    expect(response.status).toBe(200);
  });
});

import { APICallError } from "ai";
import { errorText as _errorText } from "@/lib/ai.server";
import { describe as _d, expect as _e, it as _it } from "vitest";

_d("Groq error helpers", () => {
  _it("maps 503 and timeouts to retry-later messages", () => {
    const err = new APICallError({
      message: "x",
      url: "u",
      requestBodyValues: {},
      statusCode: 503,
    });
    _e(_errorText(err)).toMatch(/indisponível/);
    const retry = new (require("ai").RetryError)({
      message: "r",
      reason: "maxRetriesExceeded",
      errors: [
        new APICallError({ message: "q", url: "u", requestBodyValues: {}, statusCode: 429 }),
      ],
    });
    _e(_errorText(retry)).toMatch(/Limite de uso/);
    _e(_errorText(new DOMException("t", "TimeoutError"))).toMatch(/demorou/);
  });
});
