import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "./config.js";

// A pre-plan requirements conversation. Before any run exists, the user chats
// with Opus to nail down what they actually want; the resulting transcript
// becomes the run's brief. This is deliberately stateless — the client owns the
// message history and sends the whole thread each turn — so no run/reporter is
// involved and the endpoint stays a thin request→reply.
export type ChatMessage = { role: "user" | "assistant"; content: string };

const CLARIFY_SYSTEM = `당신은 자동 개발 파이프라인의 "요구사항 정리" 도우미입니다.
사용자가 만들고 싶은 것을 대화로 구체화하도록 돕는 것이 목표입니다.

규칙:
- 한국어로, 짧고 친근하게 대화하세요.
- 한 번에 1~3개의 핵심 질문만 하세요. 모호한 부분(범위, 대상 사용자, 기술 선택,
  완료 기준)을 좁히는 질문에 집중하세요.
- 요구사항이 이미 충분히 명확하면 질문을 반복하지 말고, 정리된 요구사항을 짧은
  요약으로 제시한 뒤 "이대로 계획을 시작할까요?"라고 확인하세요.
- 파일을 읽거나 명령을 실행하지 말고 대화만으로 진행하세요. 코드를 작성하거나
  구현 계획을 길게 늘어놓지 마세요 — 그건 다음 단계(계획)에서 합니다.`;

// Turn the client-held history into a single transcript prompt and return
// Opus's next reply. Read-only (permissionMode "plan") and no cwd, so it never
// touches the filesystem — purely conversational.
export async function clarify(messages: ChatMessage[]): Promise<string> {
  const transcript = messages
    .map((m) => `${m.role === "user" ? "사용자" : "도우미"}: ${m.content}`)
    .join("\n\n");
  const prompt = `지금까지의 대화:\n\n${transcript}\n\n위 대화에 이어, 도우미로서 다음 응답을 작성하세요.`;

  let finalText = "";
  const response = query({
    prompt,
    options: {
      model: config.planModel,
      permissionMode: "plan",
      systemPrompt: CLARIFY_SYSTEM,
    },
  });

  for await (const msg of response as AsyncIterable<any>) {
    if (msg.type === "assistant") {
      for (const block of msg.message?.content ?? []) {
        if (block.type === "text" && block.text.trim()) finalText = block.text;
      }
    } else if (msg.type === "result") {
      if (typeof msg.result === "string" && msg.result.trim()) finalText = msg.result;
    }
  }

  return finalText.trim();
}
