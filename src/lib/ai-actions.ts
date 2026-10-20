import {
  brl,
  fmtDate,
  today,
  uid,
  update,
  type AppData,
  type Exercise,
  type Priority,
} from "@/lib/store";
import { validDate } from "@/lib/data-validation";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Input = any;

const isDate = (v: unknown): v is string => validDate.safeParse(v).success;
const dateOr = (v: unknown) =>
  v == null || v === "" ? today() : isDate(v) ? v : bad("Data inválida");
const str = (v: unknown, label: string) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : bad(`${label} vazio`);
const pos = (v: unknown, label: string) =>
  typeof v === "number" && isFinite(v) && v > 0
    ? Math.round(v * 100) / 100
    : bad(`${label} deve ser maior que zero`);
const nonneg = (v: unknown, label: string) =>
  typeof v === "number" && isFinite(v) && v >= 0 ? v : bad(`${label} inválido`);
function bad(msg: string): never {
  throw new Error(msg);
}

function exerciseOf(v: unknown): Exercise {
  const e: Input = v ?? {};
  const sets = pos(e.sets, "Séries");
  const reps = pos(e.reps, "Repetições");
  if (!Number.isInteger(sets) || !Number.isInteger(reps))
    bad("Séries e repetições devem ser inteiros positivos");
  const weight = e.weight == null ? undefined : nonneg(e.weight, "Carga");
  return {
    id: uid(),
    name: str(e.name, "Nome do exercício"),
    sets: Math.round(sets),
    reps: Math.round(reps),
    ...(weight ? { weight } : {}),
  };
}

export type PreparedAction = { summary: string; apply: () => string };

/** Valida a ação proposta pela IA e descreve o que será feito. Lança erro se a entrada for inválida. */
export function prepareAction(name: string, input: Input, data: AppData): PreparedAction {
  switch (name) {
    case "add_transaction": {
      const type =
        input.type === "receita"
          ? "receita"
          : input.type === "despesa"
            ? "despesa"
            : bad("Tipo inválido");
      const tx = {
        id: uid(),
        type,
        description: str(input.description, "Descrição"),
        amount: pos(input.amount, "Valor"),
        category:
          typeof input.category === "string" && input.category.trim()
            ? input.category.trim()
            : "Outros",
        date: dateOr(input.date),
      } as const;
      return {
        summary: `Registrar ${tx.type} "${tx.description}" de ${brl(tx.amount)} (${tx.category}) em ${fmtDate(tx.date)}`,
        apply: () => (
          update((d) => ({ ...d, transactions: [tx, ...d.transactions] })),
          "Lançamento salvo"
        ),
      };
    }
    case "add_bill": {
      const bill = {
        id: uid(),
        description: str(input.description, "Descrição"),
        amount: pos(input.amount, "Valor"),
        dueDate: isDate(input.dueDate) ? input.dueDate : bad("Vencimento inválido"),
        paid: false,
      };
      return {
        summary: `Cadastrar conta "${bill.description}" de ${brl(bill.amount)}, vence ${fmtDate(bill.dueDate)}`,
        apply: () => (update((d) => ({ ...d, bills: [...d.bills, bill] })), "Conta salva"),
      };
    }
    case "add_task": {
      const time =
        input.time == null
          ? undefined
          : typeof input.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)
            ? input.time
            : bad("Horário inválido");
      const priority =
        input.priority === "alta" || input.priority === "media" || input.priority === "baixa"
          ? (input.priority as Priority)
          : undefined;
      const task = {
        id: uid(),
        title: str(input.title, "Título"),
        done: false,
        date: dateOr(input.date),
        ...(time ? { time } : {}),
        ...(priority ? { priority } : {}),
      };
      return {
        summary: `Criar tarefa "${task.title}" em ${fmtDate(task.date)}${time ? ` às ${time}` : ""}${priority ? ` (prioridade ${priority})` : ""}`,
        apply: () => (update((d) => ({ ...d, tasks: [...d.tasks, task] })), "Tarefa criada"),
      };
    }
    case "complete_task":
    case "delete_task": {
      const t = data.tasks.find((x) => x.id === input.taskId) ?? bad("Tarefa não encontrada");
      const del = name === "delete_task";
      return {
        summary: `${del ? "Excluir" : "Concluir"} a tarefa "${t.title}"`,
        apply: () => {
          update((d) => ({
            ...d,
            tasks: del
              ? d.tasks.filter((x) => x.id !== t.id)
              : d.tasks.map((x) => (x.id === t.id ? { ...x, done: true } : x)),
          }));
          return del ? "Tarefa excluída" : "Tarefa concluída";
        },
      };
    }
    case "add_habit": {
      const habit = { id: uid(), name: str(input.name, "Nome"), doneDates: [] };
      return {
        summary: `Criar hábito "${habit.name}"`,
        apply: () => (update((d) => ({ ...d, habits: [...d.habits, habit] })), "Hábito criado"),
      };
    }
    case "add_finance_goal": {
      const deadline =
        input.deadline == null
          ? undefined
          : isDate(input.deadline)
            ? input.deadline
            : bad("Prazo inválido");
      const g = {
        id: uid(),
        name: str(input.name, "Nome"),
        targetAmount: pos(input.targetAmount, "Valor da meta"),
        currentAmount:
          input.currentAmount == null ? 0 : nonneg(input.currentAmount, "Valor guardado"),
        createdAt: today(),
        ...(deadline ? { deadline } : {}),
      };
      return {
        summary: `Criar meta financeira "${g.name}": ${brl(g.targetAmount)}${deadline ? ` até ${fmtDate(deadline)}` : ""}`,
        apply: () => (
          update((d) => ({ ...d, financeGoals: [...d.financeGoals, g] })),
          "Meta criada"
        ),
      };
    }
    case "add_health_goal": {
      const cats = ["peso", "treinos", "habito", "outra"] as const;
      const category = cats.find((c) => c === input.category) ?? "outra";
      const deadline =
        input.deadline == null
          ? undefined
          : isDate(input.deadline)
            ? input.deadline
            : bad("Prazo inválido");
      const currentValue = nonneg(input.currentValue, "Valor atual");
      const g = {
        id: uid(),
        name: str(input.name, "Nome"),
        category,
        currentValue,
        startValue: currentValue,
        targetValue: nonneg(input.targetValue, "Meta"),
        unit: typeof input.unit === "string" ? input.unit.slice(0, 20) : "",
        createdAt: today(),
        ...(deadline ? { deadline } : {}),
      };
      return {
        summary: `Criar meta de saúde "${g.name}": de ${g.currentValue} para ${g.targetValue} ${g.unit}`,
        apply: () => (update((d) => ({ ...d, healthGoals: [...d.healthGoals, g] })), "Meta criada"),
      };
    }
    case "create_workout_plan": {
      const list = Array.isArray(input.exercises) ? input.exercises.map(exerciseOf) : [];
      if (list.length === 0) bad("Plano sem exercícios");
      const plan = { id: uid(), name: str(input.name, "Nome do plano"), exercises: list };
      return {
        summary: `Criar plano "${plan.name}" com: ${list.map((e: Exercise) => `${e.name} ${e.sets}x${e.reps}`).join(", ")}`,
        apply: () => (update((d) => ({ ...d, plans: [...d.plans, plan] })), "Plano criado"),
      };
    }
    case "add_exercise_to_plan": {
      const plan = data.plans.find((p) => p.id === input.planId) ?? bad("Plano não encontrado");
      const ex = exerciseOf(input.exercise);
      return {
        summary: `Adicionar ${ex.name} ${ex.sets}x${ex.reps}${ex.weight ? ` (${ex.weight} kg)` : ""} ao plano "${plan.name}"`,
        apply: () => (
          update((d) => ({
            ...d,
            plans: d.plans.map((p) =>
              p.id === plan.id ? { ...p, exercises: [...p.exercises, ex] } : p,
            ),
          })),
          "Exercício adicionado"
        ),
      };
    }
    case "log_workout": {
      const plan = data.plans.find((p) => p.id === input.planId) ?? bad("Plano não encontrado");
      const notes =
        typeof input.notes === "string" && input.notes.trim() ? input.notes.trim() : undefined;
      const log = {
        id: uid(),
        planId: plan.id,
        planName: plan.name,
        date: dateOr(input.date),
        exercises: plan.exercises.map((e) => ({ ...e })),
        ...(notes ? { notes } : {}),
      };
      return {
        summary: `Registrar treino "${plan.name}" em ${fmtDate(log.date)}`,
        apply: () => (
          update((d) => ({ ...d, workoutLogs: [log, ...d.workoutLogs] })),
          "Treino registrado"
        ),
      };
    }
    default:
      bad("Ação desconhecida");
  }
}

/** Resumo compacto enviado à IA somente quando o usuário autoriza. */
export function buildSnapshot(d: AppData) {
  const month = today().slice(0, 7);
  const monthTx = d.transactions.filter((t) => t.date.startsWith(month));
  return {
    mes: month,
    receitasMes: monthTx.filter((t) => t.type === "receita").reduce((s, t) => s + t.amount, 0),
    despesasMes: monthTx.filter((t) => t.type === "despesa").reduce((s, t) => s + t.amount, 0),
    ultimosLancamentos: d.transactions
      .slice(0, 30)
      .map(({ type, description, amount, category, date }) => ({
        type,
        description,
        amount,
        category,
        date,
      })),
    contasPendentes: d.bills
      .filter((b) => !b.paid)
      .map(({ description, amount, dueDate }) => ({ description, amount, dueDate })),
    dividas: d.debts.map(({ name, total, paid }) => ({ name, total, paid })),
    tarefasPendentes: d.tasks
      .filter((t) => !t.done)
      .slice(0, 50)
      .map(({ id, title, date, time, priority }) => ({ id, title, date, time, priority })),
    habitos: d.habits.map((h) => h.name),
    planos: d.plans.map((p) => ({
      id: p.id,
      name: p.name,
      exercises: p.exercises.map(
        (e: Exercise) => `${e.name} ${e.sets}x${e.reps}${e.weight ? ` ${e.weight}kg` : ""}`,
      ),
    })),
    treinosRecentes: d.workoutLogs
      .slice(0, 10)
      .map((l) => ({ planName: l.planName, date: l.date })),
    metaTreinosSemana: d.workoutGoal,
    metasFinanceiras: d.financeGoals.map(({ name, targetAmount, currentAmount, deadline }) => ({
      name,
      targetAmount,
      currentAmount,
      deadline,
    })),
    metasSaude: d.healthGoals.map(({ name, currentValue, targetValue, unit }) => ({
      name,
      currentValue,
      targetValue,
      unit,
    })),
  };
}
