import { z } from "zod";

import { ModelAdapterError } from "./model-error.js";
import {
  buildRepairJsonPrompt,
  repairJsonSystemPrompt,
} from "./prompts/repair-json.v1.js";
import {
  assertSuccessfulResponse,
  mapRequestError,
  requestSignal,
} from "./request-control.js";

const chatResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({ content: z.string() }),
    }),
  ),
});

interface JsonTransport {
  endpoint: string;
  headers: HeadersInit;
  supportsJsonSchema: boolean;
  fetchImplementation: typeof fetch;
}

interface JsonRequest<T> {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  schema: z.ZodType<T>;
  schemaName: string;
  schemaInstructions: string;
  timeoutMs: number;
  signal: AbortSignal;
}

function stripMarkdownFences(value: string): string {
  const trimmed = value.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match?.[1] ?? trimmed;
}

function parseJson<T>(raw: string, schema: z.ZodType<T>): T {
  try {
    return schema.parse(JSON.parse(stripMarkdownFences(raw)));
  } catch (error) {
    throw new ModelAdapterError(
      "MODEL_MALFORMED_OUTPUT",
      "The model returned JSON that does not match the required schema.",
      { cause: error },
    );
  }
}

async function requestText<T>(
  transport: JsonTransport,
  input: Omit<JsonRequest<T>, "schemaInstructions">,
): Promise<string> {
  const activeSignal = requestSignal(input.signal, input.timeoutMs);
  try {
    const response = await transport.fetchImplementation(transport.endpoint, {
      method: "POST",
      headers: transport.headers,
      body: JSON.stringify({
        model: input.model,
        messages: [
          { role: "system", content: input.systemPrompt },
          { role: "user", content: input.userPrompt },
        ],
        stream: false,
        ...(transport.supportsJsonSchema
          ? {
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: input.schemaName,
                  strict: true,
                  schema: z.toJSONSchema(input.schema),
                },
              },
            }
          : {}),
      }),
      signal: activeSignal.signal,
    });
    assertSuccessfulResponse(response);
    const parsed = chatResponseSchema.parse(await response.json());
    const content = parsed.choices[0]?.message.content;
    if (content === undefined) {
      throw new ModelAdapterError(
        "MODEL_MALFORMED_OUTPUT",
        "The model response did not contain message content.",
      );
    }
    return content;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ModelAdapterError(
        "MODEL_MALFORMED_OUTPUT",
        "The model returned a malformed response envelope.",
        { cause: error },
      );
    }
    throw mapRequestError(error, activeSignal, input.signal);
  } finally {
    activeSignal.cleanup();
  }
}

export async function requestStructuredJson<T>(
  transport: JsonTransport,
  input: JsonRequest<T>,
): Promise<T> {
  const invalidOutput = await requestText(transport, input);
  try {
    return parseJson(invalidOutput, input.schema);
  } catch (error) {
    if (
      !(error instanceof ModelAdapterError) ||
      error.code !== "MODEL_MALFORMED_OUTPUT"
    ) {
      throw error;
    }
  }

  const repairedOutput = await requestText(transport, {
    ...input,
    systemPrompt: repairJsonSystemPrompt,
    userPrompt: buildRepairJsonPrompt(invalidOutput, input.schemaInstructions),
  });
  return parseJson(repairedOutput, input.schema);
}
