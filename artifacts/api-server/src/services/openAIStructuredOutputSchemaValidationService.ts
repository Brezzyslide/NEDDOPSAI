export function validateOpenAIStructuredOutputStrictSchema(
  schemaName: string,
  schema: Record<string, unknown>,
): void {
  const errors: string[] = [];
  walkOpenAIStrictSchemaNode(schema, schemaName, errors);
  if (errors.length > 0) {
    throw new Error(`Invalid OpenAI strict structured output schema "${schemaName}": ${errors.join("; ")}`);
  }
}

function walkOpenAIStrictSchemaNode(value: unknown, path: string, errors: string[]): void {
  if (!value || typeof value !== "object") return;
  const node = value as Record<string, unknown>;
  const properties = node.properties;
  if (properties && typeof properties === "object" && !Array.isArray(properties)) {
    const propertyKeys = Object.keys(properties as Record<string, unknown>);
    const required = Array.isArray(node.required) ? node.required.map(String) : [];
    const missing = propertyKeys.filter((key) => !required.includes(key));
    if (missing.length > 0) {
      errors.push(`${path}.required missing ${missing.join(", ")}`);
    }
    for (const [key, child] of Object.entries(properties as Record<string, unknown>)) {
      walkOpenAIStrictSchemaNode(child, `${path}.properties.${key}`, errors);
    }
  }
  if (node.items) {
    walkOpenAIStrictSchemaNode(node.items, `${path}.items`, errors);
  }
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const variants = node[key];
    if (Array.isArray(variants)) {
      variants.forEach((variant, index) => walkOpenAIStrictSchemaNode(variant, `${path}.${key}[${index}]`, errors));
    }
  }
}
