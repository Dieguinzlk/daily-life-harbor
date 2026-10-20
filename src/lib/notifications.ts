import { AppData } from "./store";

// Regista o Service Worker PWA
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    return registration;
  } catch (error) {
    console.error("Falha ao registrar Service Worker:", error);
    return null;
  }
}

// Solicita permissão para exibir notificações nativas do Android
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "denied";
  }

  if (Notification.permission === "granted") {
    return "granted";
  }

  const permission = await Notification.requestPermission();
  return permission;
}

// Dispara uma notificação local imediatamente
export async function sendLocalNotification(title: string, options?: NotificationOptions) {
  if (typeof window === "undefined" || Notification.permission !== "granted") {
    return;
  }

  const reg = await registerServiceWorker();
  const defaultOptions: NotificationOptions = {
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    vibrate: [100, 50, 100],
    ...options,
  };

  if (reg && reg.showNotification) {
    await reg.showNotification(title, defaultOptions);
  } else {
    new Notification(title, defaultOptions);
  }
}

// Verifica contas ou tarefas pendentes para notificar no app
export function checkAndNotifyDueItems(data: AppData) {
  if (typeof window === "undefined" || Notification.permission !== "granted") {
    return;
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  // Notificar contas a pagar que vencem hoje
  const dueBillsToday = data.bills.filter((bill) => !bill.paid && bill.dueDate === todayStr);
  dueBillsToday.forEach((bill) => {
    sendLocalNotification("Conta a Vencer Hoje", {
      body: `${bill.description} - R$ ${bill.amount.toFixed(2)}`,
      tag: `bill-${bill.id}`,
    });
  });

  // Notificar tarefas marcadas para hoje não concluídas
  const pendingTasksToday = data.tasks.filter((task) => !task.done && task.date === todayStr);
  if (pendingTasksToday.length > 0) {
    sendLocalNotification("Tarefas da Rotina", {
      body: `Você tem ${pendingTasksToday.length} tarefa(s) pendente(s) para hoje!`,
      tag: `tasks-${todayStr}`,
    });
  }
}
