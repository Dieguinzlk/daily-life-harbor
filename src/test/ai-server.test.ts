import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  google: vi.fn(() => ({ provider: "google", modelId: "models/gemini-3.8-flash" })),
  createGoogle: vi.fn(),
  streamText: vi.fn(),
}));

vi.mock("@ai-sdk/google", () => ({ createGoogleGenerativeAI: mocks.createGoogle }));
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

describe("Gemini server configuration", () => {
  it("rejects malformed, empty and oversized requests before contacting Gemini", async () => {
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
    expect(mocks.createGoogle).not.toHaveBeenCalled();
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
  it("rejects missing GEMINI_API_KEY without contacting the provider", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const response = await handleChat(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "AI_NOT_CONFIGURED" });
    expect(mocks.createGoogle).not.toHaveBeenCalled();
  });

  it("passes the server key explicitly and preserves the configured default model", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-only-not-a-credential");
    vi.stubEnv("GEMINI_MODEL", "");
    mocks.createGoogle.mockReturnValue(mocks.google);
    mocks.streamText.mockReturnValue({ toUIMessageStreamResponse: () => new Response("test") });
    const response = await handleChat(request());
    expect(mocks.createGoogle).toHaveBeenCalledWith({ apiKey: "test-only-not-a-credential" });
    expect(mocks.google).toHaveBeenCalledWith("models/gemini-3.8-flash");
    expect(response.status).toBe(200);
  });
  it("gives GEMINI_MODEL precedence over the default", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-only-not-a-credential");
    vi.stubEnv("GEMINI_MODEL", "test-model-override");
    mocks.createGoogle.mockReturnValue(mocks.google);
    mocks.streamText.mockReturnValue({ toUIMessageStreamResponse: () => new Response("test") });
    const response = await handleChat(request());
    expect(mocks.google).toHaveBeenCalledWith("test-model-override");
    expect(response.status).toBe(200);
  });
});

import { APICallError } from "ai";
import { errorText as _errorText, resolveModel as _resolveModel } from "@/lib/ai.server";
import { describe as _d, expect as _e, it as _it } from "vitest";

_d("gemini config helpers", () => {
  _it("keeps valid names and falls back on empty or invalid names", () => {
    _e(_resolveModel("models/gemini-x-flash")).toBe("models/gemini-x-flash");
    _e(_resolveModel("")).toBe("models/gemini-3.8-flash");
    _e(_resolveModel("bad name!")).toBe("models/gemini-3.8-flash");
  });
  _it("maps 503 and timeouts to retry-later messages", () => {
    const err = new APICallError({ message: "x", url: "u", requestBodyValues: {}, statusCode: 503 });
    _e(_errorText(err)).toMatch(/indisponível/);
    const retry = new (require("ai").RetryError)({ message: "r", reason: "maxRetriesExceeded", errors: [new APICallError({ message: "q", url: "u", requestBodyValues: {}, statusCode: 429 })] });
    _e(_errorText(retry)).toMatch(/Limite de uso/);
    _e(_errorText(new DOMException("t", "TimeoutError"))).toMatch(/demorou/);
  });
});
