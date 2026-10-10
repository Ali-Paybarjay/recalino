import { z } from "../../../packages/core/node_modules/zod";

/**
 * Mock-fetch answers for the evaluation's zero-cost wiring check. Nothing here comes from a
 * model and nothing reaches the network: a code-written content-contract lesson built from the
 * request's own evidence rows, the HTTP 400 grammar refusal OpenRouter relays from a provider,
 * and the provider deadline (AbortSignal.timeout rejects with a TimeoutError).
 */

/** One short explanation per holdout-5 explanation language, in its own script. */
const syntheticExplanations: Record<string, { claim: string; meaning: string; coverage: string }> =
  {
    en: {
      claim: "This class point appears in the class material.",
      meaning: "A class example shown for recognition.",
      coverage: "A synthetic lesson with one class example.",
    },
    fa: {
      claim: "این نکته در منبع کلاس آمده است.",
      meaning: "یک مثال کلاس برای شناختن.",
      coverage: "یک درس آزمایشی با یک مثال کلاس.",
    },
    ar: {
      claim: "هذه النقطة واردة في مادة الدرس.",
      meaning: "مثال من الدرس للتعرف عليه.",
      coverage: "درس تجريبي بمثال واحد من الدرس.",
    },
    es: {
      claim: "Este punto aparece en el material de la clase.",
      meaning: "Un ejemplo de la clase para reconocer.",
      coverage: "Una lección de prueba con un ejemplo de la clase.",
    },
    ja: {
      claim: "この点は授業の資料にあります。",
      meaning: "授業の例文です。",
      coverage: "授業の例文を一つ含む試験用のレッスンです。",
    },
    uk: {
      claim: "Цей пункт є в матеріалі заняття.",
      meaning: "Приклад із заняття для впізнавання.",
      coverage: "Тестовий урок з одним прикладом із заняття.",
    },
  };

const evidenceInputSchema = z
  .object({
    format: z.literal("knowledge_generation_keys_v5"),
    explanationLanguage: z.string().min(1),
    sources: z.array(z.object({ evidence: z.array(z.array(z.unknown())) }).passthrough()),
  })
  .passthrough();

/**
 * A complete content-contract lesson (proc/knowledge-generation.ts schema) written by code: one
 * recognition item whose example is the first plain English class sentence, cited by its
 * evidence key, with explanations in the request's explanation language.
 */
export function syntheticContentLesson(input: string) {
  const parsed = evidenceInputSchema.parse(JSON.parse(input));
  const prose = syntheticExplanations[parsed.explanationLanguage.split("-")[0] ?? ""];
  if (!prose) throw new Error("synthetic_language_unsupported");
  for (const row of parsed.sources.flatMap((source) => source.evidence)) {
    const [key, kind] = row;
    // [key,"text",blockId,start,end,text,meta], [key,"page",page,blockId,text,meta] or
    // [key,"time",startMs,endMs,text,meta]; an empty row has a null key and is never cited.
    const text = row[kind === "text" ? 5 : 4];
    if (typeof key !== "string" || typeof text !== "string") continue;
    const sentence = text
      .split(/(?<=[.!?])\s+/u)
      .map((part) => part.trim())
      .find(
        (part) => /^[A-Z][A-Za-z ,'’-]*[a-z][.!?]$/u.test(part) && part.split(/\s+/u).length >= 4,
      );
    if (!sentence) continue;
    const en = sentence
      .replace(/[.!?]$/u, "")
      .split(/\s+/u)
      .slice(-2)
      .join(" ");
    return {
      lessonPlan: [{ concept: en, evidenceKeys: [key], teachAs: "card" }],
      title: "Synthetic mock lesson",
      learningItems: [
        {
          type: "recognition",
          kind: "example",
          claim: { text: prose.claim, evidenceKeys: [key], uncertain: false },
          meaning: { en, faMeaning: prose.meaning, topic: "class example" },
          practice: { example: sentence },
        },
      ],
      classNotes: { coverage: prose.coverage },
    };
  }
  throw new Error("synthetic_lesson_has_no_sentence");
}

const requestSchema = z
  .object({
    model: z.string(),
    messages: z.tuple(
      [
        z.unknown(),
        z.object({
          role: z.literal("user"),
          content: z.tuple([z.object({ type: z.literal("text"), text: z.string() })], z.unknown()),
        }),
      ],
      z.unknown(),
    ),
  })
  .passthrough();

/**
 * A 200 chat completion carrying the synthetic lesson. The mock bills nothing, so it reports
 * usage.cost 0; the provider label marks it as synthetic in every receipt.
 */
export function syntheticLessonResponse(serializedBody: string, index: number): Response {
  const body = requestSchema.parse(JSON.parse(serializedBody));
  const lesson = syntheticContentLesson(body.messages[1].content[0].text);
  return new Response(
    JSON.stringify({
      id: `synthetic-mock-${index}`,
      model: body.model,
      provider: "synthetic-mock-no-network",
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(lesson) } }],
      usage: { prompt_tokens: 0, completion_tokens: 0, cost: 0 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/** The HTTP 400 OpenRouter relays when a provider refuses a strict json_schema grammar. */
export function grammarRejectionResponse(): Response {
  return new Response(
    JSON.stringify({
      error: {
        message: "Provider returned error",
        code: 400,
        metadata: {
          raw: JSON.stringify({
            type: "error",
            error: {
              type: "invalid_request_error",
              message:
                "Synthetic mock: the compiled grammar is too large; nothing was sent to a provider.",
            },
          }),
        },
      },
    }),
    { status: 400, headers: { "Content-Type": "application/json" } },
  );
}

/** What fetch rejects with when the provider's AbortSignal.timeout deadline passes. */
export function providerDeadline(): never {
  throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
}
