import { AnthropicError } from "@anthropic-ai/sdk";
import type { BetaJSONOutputFormat } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";

// Structured output from a zod schema, with its enums enforced by the API.
//
// The SDK's helper (betaZodOutputFormat, SDK 1.6) rewrites the zod schema for the API and,
// in doing so, moves every `enum` into the field's description as text. The API then
// doesn't hold the model to the list: a value off it reaches the SDK's own zod check, which
// throws, and the whole meal, read or wrap fails. Found by the AI efficiency lead on
// 2026-11-19 (docs/team/specs/2026-11-19-ask-ai.md §1.2, §12.5): with the helper, Ask's
// replies fell off their lists 2 times in 123; with real enums, 0 in 116.
//
// This builds the same schema the helper builds (zod's JSON Schema, every object closed,
// unsupported keywords moved into the description) but keeps `enum` and `const`, which
// structured outputs support. Parsing is unchanged: zod checks the reply, and a mismatch
// throws the same AnthropicError the helper throws.

const SUPPORTED_FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"]);
type Schema = Record<string, unknown>;

/** A JSON Schema in the form structured outputs accept, with enums kept. Exported for tests. */
export function strictJsonSchema(input: Schema): Schema {
  const src: Schema = { ...input };
  const pop = (key: string) => {
    const v = src[key];
    delete src[key];
    return v;
  };
  const out: Schema = {};
  // Meta, not a constraint (the helper put it in the root description).
  pop("$schema");
  const defs = pop("$defs") as Record<string, Schema> | undefined;
  if (defs) out.$defs = Object.fromEntries(Object.entries(defs).map(([k, v]) => [k, strictJsonSchema(v)]));
  const ref = pop("$ref");
  if (ref !== undefined) {
    out.$ref = ref;
    return out;
  }
  const type = pop("type");
  const anyOf = pop("anyOf") as Schema[] | undefined;
  const oneOf = pop("oneOf") as Schema[] | undefined;
  const allOf = pop("allOf") as Schema[] | undefined;
  if (Array.isArray(anyOf)) out.anyOf = anyOf.map(strictJsonSchema);
  else if (Array.isArray(oneOf)) out.anyOf = oneOf.map(strictJsonSchema);
  else if (Array.isArray(allOf)) out.allOf = allOf.map(strictJsonSchema);
  else {
    if (type === undefined) throw new Error("JSON schema must have a type defined if anyOf/oneOf/allOf are not used");
    out.type = type;
  }
  const description = pop("description");
  if (description !== undefined) out.description = description;
  const title = pop("title");
  if (title !== undefined) out.title = title;
  // The fix: the API enforces these, so they stay keywords.
  const values = pop("enum");
  if (values !== undefined) out.enum = values;
  const constant = pop("const");
  if (constant !== undefined) out.const = constant;

  if (type === "object") {
    const properties = (pop("properties") as Record<string, Schema> | undefined) ?? {};
    out.properties = Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, strictJsonSchema(v)]));
    pop("additionalProperties");
    out.additionalProperties = false;
    const required = pop("required");
    if (required !== undefined) out.required = required;
  } else if (type === "string") {
    const format = pop("format");
    if (typeof format === "string" && SUPPORTED_FORMATS.has(format)) out.format = format;
    else if (format !== undefined) src.format = format;
  } else if (type === "array") {
    const items = pop("items") as Schema | undefined;
    if (items !== undefined) out.items = strictJsonSchema(items);
    const minItems = pop("minItems");
    if (minItems === 0 || minItems === 1) out.minItems = minItems;
    else if (minItems !== undefined) src.minItems = minItems;
  }
  // Whatever the API can't take (lengths, bounds, patterns) goes into the description, as the helper does; zod still checks it.
  if (Object.keys(src).length) {
    const rest = `{${Object.entries(src)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join(", ")}}`;
    out.description = out.description ? `${out.description}\n\n${rest}` : rest;
  }
  return out;
}

/**
 * An output format for `output_config.format` that the beta stream parses into
 * `parsed_output`, as betaZodOutputFormat does, but with the schema's enums enforced.
 */
export function strictOutputFormat<T extends z.ZodType>(schema: T): BetaJSONOutputFormat & { parse(content: string): z.infer<T> } {
  return {
    type: "json_schema",
    schema: strictJsonSchema(z.toJSONSchema(schema, { reused: "ref" }) as Schema),
    parse: (content: string) => {
      const output = schema.safeParse(JSON.parse(content));
      if (!output.success) throw new AnthropicError(`Failed to parse structured output: ${output.error.message} cause: ${output.error.issues}`);
      return output.data;
    },
  };
}
