// The owner's test checklist and notes. The list of things to test is config/checklist.json;
// the owner's answers and free notes are saved in data/feedback.json so Claude can read them in a later session.
import { join } from "node:path";
import { ROOT, DATA, readJson, writeJson } from "./config";

export interface CheckItem { id: string; screen: string; title: string; how: string }
export interface Feedback { answers: Record<string, { status: "ok" | "problem"; note: string; at: string }>; notes: { at: string; text: string }[] }
const file = () => join(DATA, "feedback.json");
export const readFeedback = () => ({ checklist: readJson<CheckItem[]>(join(ROOT, "config", "checklist.json"), []), ...readJson<Feedback>(file(), { answers: {}, notes: [] }) });

export function saveFeedback(body: unknown): { ok: true } {
  const b = (body ?? {}) as { id?: unknown; status?: unknown; note?: unknown; text?: unknown }; const fb = readJson<Feedback>(file(), { answers: {}, notes: [] }); const at = new Date().toISOString();
  const clip = (v: unknown) => String(v ?? "").slice(0, 4000);
  if (typeof b.id === "string" && (b.status === "ok" || b.status === "problem")) {
    if (!readJson<CheckItem[]>(join(ROOT, "config", "checklist.json"), []).some(c => c.id === b.id)) throw new Error("Unknown checklist item.");
    fb.answers[b.id] = { status: b.status, note: clip(b.note), at };
  } else if (typeof b.text === "string" && b.text.trim()) fb.notes.push({ at, text: clip(b.text) });
  else throw new Error("Nothing to save: send a checklist answer or a note.");
  writeJson(file(), fb); return { ok: true };
}
