import type { AdminLocale, AdminResult, AdminSnapshot, AdminView } from "./contracts";

export type PanelMode = AdminView | "compose";
export type AdminScreenProps = {
  data: AdminSnapshot;
  locale: AdminLocale;
  t: (en: string, fa: string) => string;
  mode: PanelMode;
  userId: string;
  threadId: string;
  selected: string[];
  setSelected: (ids: string[]) => void;
  navigate: (view: PanelMode, id?: string) => void;
  compose: (ids: string[]) => void;
  act: (action: string, input: unknown, success?: string) => Promise<AdminResult | null>;
  busy: boolean;
  search: string;
  setSearch: (search: string) => void;
  reload: () => void;
  localeChange: (value: AdminLocale) => void;
  theme: "system" | "light" | "dark";
  themeChange: (value: "system" | "light" | "dark") => void;
};
