"use client";
import { createContext, type ReactNode, useContext } from "react";

/** What the signed-in account still lacks before new work can be processed (FR-ACC-007). */
export interface AccountGate {
  setupComplete: boolean;
  termsPending: boolean;
  /** The date the Terms last changed, as the Terms notice shows it; null without a server page. */
  termsChangedOn: string | null;
}

// Without a provider (design pages), a stop for `acceptance_required` is read as new Terms.
const Gate = createContext<AccountGate>({
  setupComplete: true,
  termsPending: true,
  termsChangedOn: null,
});

export function AccountGateProvider({
  value,
  children,
}: {
  value: AccountGate;
  children?: ReactNode;
}) {
  return <Gate.Provider value={value}>{children}</Gate.Provider>;
}

export function useAccountGate(): AccountGate {
  return useContext(Gate);
}
