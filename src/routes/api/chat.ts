

import { createAPIFileRoute } from "@tanstack/react-start/api";
import { handleChat } from "@/lib/ai.server";

export const Route = createAPIFileRoute("/api/chat")({
  POST: async ({ request }) => {
    return handleChat(request);
  },
});
