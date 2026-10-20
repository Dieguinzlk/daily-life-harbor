import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppData } from "@/lib/store";

const empty: AppData = {
  version: 1,
  transactions: [],
  bills: [],
  debts: [],
  tasks: [],
  habits: [],
  plans: [],
  workoutLogs: [],
  workoutGoal: 3,
  financeGoals: [],
  healthGoals: [],
};
beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

describe("AI actions require browser confirmation", () => {
  it("does not persist a proposal until apply is called", async () => {
    const { prepareAction } = await import("@/lib/ai-actions");
    const action = prepareAction(
      "add_transaction",
      {
        type: "despesa",
        description: "Mercado",
        amount: 45,
        date: "2026-10-19",
        category: "Alimentação",
      },
      empty,
    );
    expect(localStorage.getItem("gerenciador-de-vida:v1")).toBeNull();
    action.apply();
    const stored = JSON.parse(localStorage.getItem("gerenciador-de-vida:v1") ?? "{}");
    expect(stored.transactions[0].amount).toBe(45);
    expect(stored.transactions[0].type).toBe("despesa");
  });
  it("rejects impossible dates and invalid times", async () => {
    const { prepareAction } = await import("@/lib/ai-actions");
    expect(() =>
      prepareAction("add_task", { title: "Teste", date: "2026-02-30", time: null }, empty),
    ).toThrow("Data inválida");
    expect(() =>
      prepareAction("add_task", { title: "Teste", date: "2026-10-19", time: "29:90" }, empty),
    ).toThrow("Horário inválido");
  });
});
