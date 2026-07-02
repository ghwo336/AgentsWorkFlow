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

const INTERVENE_CHAT_SYSTEM = `당신은 자동 개발 팀의 리드 엔지니어 "호재"(Opus)입니다.
한 단계가 재시도와 당신의 개입에도 검증을 통과하지 못해, 지금 팀 리더(사용자)와
어떻게 할지 상의하는 중입니다.

규칙:
- 한국어로, 동료처럼 간결하고 솔직하게 대화하세요.
- 아래에 주어진 "막힌 상황"(계획/단계/실패 사유/변경)을 근거로 진단과 선택지를
  설명하세요. 근본 원인과, 취할 수 있는 실질적 행동(구체적 수정 지침 / 지금 상태로
  커밋 / 이 단계 건너뛰기 / 중단)을 알기 쉽게 제시하세요.
- 사용자가 결정을 내리도록 돕되, 필요하면 당신의 추천을 분명히 말하세요.
- 파일을 수정하지 말고 대화만 하세요. 사용자가 "지침대로 다시 시도"를 고르면 그때
  빌더가 실제로 고칩니다.`;

// The user↔호재 discussion at a needs_input gate. `context` is a prebuilt summary
// of the stuck situation (plan + stuck step + failure reasons + diff), and
// `messages` is the client-held chat history. Returns 호재's next reply.
export async function interveneChat(context: string, messages: ChatMessage[]): Promise<string> {
  const transcript = messages
    .map((m) => `${m.role === "user" ? "리더" : "호재"}: ${m.content}`)
    .join("\n\n");
  const prompt = [
    `# 막힌 상황`,
    context,
    ``,
    `# 지금까지의 대화`,
    transcript || "(아직 대화 없음 — 상황을 요약하고 어떻게 하면 좋을지 먼저 제안하세요.)",
    ``,
    `위 대화에 이어, 리드 호재로서 다음 응답을 작성하세요.`,
  ].join("\n");

  let finalText = "";
  const response = query({
    prompt,
    options: { model: config.planModel, permissionMode: "plan", systemPrompt: INTERVENE_CHAT_SYSTEM },
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
