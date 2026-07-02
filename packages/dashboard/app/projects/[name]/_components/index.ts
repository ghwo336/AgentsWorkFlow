// Barrel for the workspace's presentational components — one module per
// concern, so each can be read and changed in isolation (SRP). Import from
// "./_components"; the pure step-derivation logic they render lives in
// ../_plan-steps.ts.

export { AgentChat } from "./AgentChat";
export { AgentWorkSummary } from "./AgentWorkSummary";
export { ApprovalPanel } from "./ApprovalPanel";
export { FollowUpPanel } from "./FollowUpPanel";
export { InterventionPanel } from "./InterventionPanel";
export { LiveLog } from "./LiveLog";
export { NewTaskForm } from "./NewTaskForm";
export { ProjectSettings } from "./ProjectSettings";
export { RepoPicker } from "./RepoPicker";
export { RunDetailCard, RunList } from "./RunList";
export { RunProgress } from "./RunProgress";
export { ResumePanel } from "./ResumePanel";
export { StatusBadge } from "./StatusBadge";
