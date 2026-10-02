import "server-only";

/**
 * Values for the placeholders of the legal texts (docs/legal/README.md). The operator's address
 * lives only in server configuration; until G11 names the operator, a visible marker stands in.
 */
export function legalValues(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  return {
    operator_email: env.PILOT_OPERATOR_EMAIL || "⟨operator email⟩",
    operator_name: env.PILOT_OPERATOR_NAME || "⟨operator name⟩",
  };
}
