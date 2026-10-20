import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  APICallError,
  convertToModelMessages,
  streamText,
  tool,
  validateUIMessages,
  type UIMessage,
} from "ai";
import { z } from "zod";

const date = z.string().nullable().describe("Data no formato AAAA-MM-DD, ou null para hoje");
const exercise = z.object({
  name: z.string(),
  sets: z.number(),
  reps: z.number(),
  weight: z.number().nullable().describe("Carga em kg ou null"),
});

const out = z.object({ ok: z.boolean(), message: z.string() });

// Ferramentas sem `execute`: o celular mostra uma confirmação e só então altera os dados locais.
export const tools = {
  add_transaction: tool({
    description: "Registrar uma receita ou despesa",
    inputSchema: z.object({
      type: z.enum(["receita", "despesa"]),
      description: z.string(),
      amount: z.number().describe("Valor positivo em reais"),
      category: z.string(),
      date,
    }),
    outputSchema: out,
  }),
  add_bill: tool({
    description: "Cadastrar uma conta a pagar",
    inputSchema: z.object({
      description: z.string(),
      amount: z.number(),
      dueDate: z.string().describe("AAAA-MM-DD"),
    }),
    outputSchema: out,
  }),
  add_task: tool({
    description: "Criar uma tarefa na rotina",
    inputSchema: z.object({
      title: z.string(),
      date,
      time: z.string().nullable().describe("HH:MM ou null"),
      priority: z.enum(["alta", "media", "baixa"]).nullable(),
    }),
    outputSchema: out,
  }),
  complete_task: tool({
    description:
      "Marcar uma tarefa existente como concluída (precisa do id dos dados compartilhados)",
    inputSchema: z.object({ taskId: z.string() }),
    outputSchema: out,
  }),
  delete_task: tool({
    description: "Excluir uma tarefa existente (precisa do id dos dados compartilhados)",
    inputSchema: z.object({ taskId: z.string() }),
    outputSchema: out,
  }),
  add_habit: tool({
    description: "Criar um novo hábito",
    inputSchema: z.object({ name: z.string() }),
    outputSchema: out,
  }),
  add_finance_goal: tool({
    description: "Criar uma meta financeira",
    inputSchema: z.object({
      name: z.string(),
      targetAmount: z.number(),
      currentAmount: z.number().nullable(),
      deadline: z.string().nullable().describe("AAAA-MM-DD ou null"),
    }),
    outputSchema: out,
  }),
  add_health_goal: tool({
    description: "Criar uma meta de saúde (peso, treinos, hábito ou outra)",
    inputSchema: z.object({
      name: z.string(),
      category: z.enum(["peso", "treinos", "habito", "outra"]),
      currentValue: z.number(),
      targetValue: z.number(),
      unit: z.string(),
      deadline: z.string().nullable(),
    }),
    outputSchema: out,
  }),
  create_workout_plan: tool({
    description: "Criar um plano de treino com exercícios",
    inputSchema: z.object({ name: z.string(), exercises: z.array(exercise) }),
    outputSchema: out,
  }),
  add_exercise_to_plan: tool({
    description: "Adicionar exercício a um plano existente (precisa do id do plano)",
    inputSchema: z.object({ planId: z.string(), exercise }),
    outputSchema: out,
  }),
  log_workout: tool({
    description: "Registrar um treino concluído de um plano existente",
    inputSchema: z.object({ planId: z.string(), date, notes: z.string().nullable() }),
    outputSchema: out,
  }),
};

function errorText(error: unknown): string {
  const status = APICallError.isInstance(error) ? error.statusCode : undefined;
  if (status === 429)
    return "Limite de uso atingido no momento. Aguarde alguns instantes e tente de novo.";
  if (status === 401 || status === 403)
    return "O Gemini recusou o acesso. Verifique a chave e as permissões no servidor.";
  if (status === 400)
    return "O Gemini não aceitou a solicitação. Verifique o modelo configurado no servidor.";
  if (status === 404)
    return "O modelo configurado não está disponível no Gemini. Verifique GEMINI_MODEL no ambiente do deploy.";
  return "Não foi possível falar com a IA agora. Verifique a conexão e tente de novo.";
}

export async function handleChat(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json({ error: "Origem da solicitação não permitida." }, { status: 403 });
  const maxBytes = 128 * 1024;
  if (Number(request.headers.get("content-length")) > maxBytes)
    return Response.json({ error: "Solicitação muito grande." }, { status: 413 });
  let raw = "";
  if (request.body) {
    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        return Response.json({ error: "Solicitação muito grande." }, { status: 413 });
      }
      raw += decoder.decode(chunk.value, { stream: true });
    }
    raw += decoder.decode();
  }
  let body: { messages: UIMessage[]; snapshot?: unknown; today?: string | undefined };
  try {
    const parsed = z
      .object({
        messages: z.array(z.unknown()).min(1).max(40),
        snapshot: z.unknown().optional(),
        today: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
      .parse(JSON.parse(raw));
    const messages = await validateUIMessages({ messages: parsed.messages, tools });
    const last = messages.at(-1);
    if (!last || last.role === "system" || messages.some((message) => message.role === "system"))
      throw new Error("Invalid role");
    if (
      last.role === "user" &&
      !last.parts.some((part) => part.type === "text" && part.text.trim().length > 0)
    )
      throw new Error("Empty message");
    if (
      messages.some((message) =>
        message.parts.some((part) => part.type === "text" && part.text.length > 8000),
      )
    )
      throw new Error("Long message");
    body = { ...parsed, messages };
  } catch {
    return Response.json(
      { error: "Requisição inválida: verifique a mensagem e o tamanho da conversa." },
      { status: 400 },
    );
  }
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey)
    return Response.json(
      {
        code: "AI_NOT_CONFIGURED",
        error:
          "O Gemini ainda não está configurado neste ambiente. Configure GEMINI_API_KEY no servidor e tente novamente.",
      },
      { status: 409 },
    );
  const google = createGoogleGenerativeAI({ apiKey });

  // Atualizado para o modelo correto recomendado
  const model = process.env["GEMINI_MODEL"] || "models/gemini-3.8-flash";

  const messages = body.messages;

  const today =
    typeof body.today === "string"
      ? body.today.slice(0, 10)
      : new Date().toISOString().slice(0, 10);
  const snapshot = body.snapshot ? JSON.stringify(body.snapshot).slice(0, 20000) : null;

  const instructions = [
    "Você é o assistente do app Gerenciador de Vida. Responda sempre em português do Brasil, de forma curta e prática.",
    "Ajude com rotina, tarefas, finanças (valores em BRL), hábitos, metas e treinos.",
    "Quando o usuário pedir para criar/registrar/alterar algo, use as ferramentas. Cada ação é confirmada pelo usuário no aparelho antes de ser salva; não diga que salvou antes de receber o resultado.",
    "Se faltar uma informação essencial (ex.: valor de uma despesa), pergunte antes de chamar a ferramenta.",
    `Hoje é ${today}. Use datas no formato AAAA-MM-DD.`,
    snapshot
      ? `Dados atuais do usuário: ${snapshot}`
      : "Dados atuais do usuário disponíveis para consulta no app.",
  ].join("\n");

  try {
    const result = streamText({
      model: google(model),
      instructions,
      messages: await convertToModelMessages(messages),
      tools,
      abortSignal: request.signal,
    });

    return result.toUIMessageStreamResponse({ originalMessages: messages, onError: errorText });
  } catch (error) {
    return Response.json({ error: errorText(error) }, { status: 502 });
  }
}
