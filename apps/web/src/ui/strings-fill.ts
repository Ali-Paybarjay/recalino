// PERF-06: placeholder filling without the strings themselves, for client components.

/** Replaces each {name} in a template with its value. A missing value is an error, not a gap. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new Error(`Missing value for {${name}}`);
    }
    return String(value);
  });
}
