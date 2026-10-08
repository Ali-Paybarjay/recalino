import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconComponent } from "../components/Icon";
import { Cards, Folders, Plus, SunHorizon, UserCircle } from "../icons";
import { fill, strings } from "../strings";
import { studyCopy } from "../study-copy";
import styles from "./AppShell.module.css";
import { Wordmark } from "./Wordmark";

export { Wordmark } from "./Wordmark";

export type NavId = "today" | "classes" | "review" | "me";

const NAV: ReadonlyArray<{ id: NavId; icon: IconComponent }> = [
  { id: "today", icon: SunHorizon },
  { id: "classes", icon: Folders },
  { id: "review", icon: Cards },
  { id: "me", icon: UserCircle },
];

type AppShellProps = {
  /** The page's own section, or null on pages outside the four (aria-current="page"). */
  current: NavId | null;
  hrefs: Record<NavId, string>;
  /** "New class" in the sidebar; left out until classes can be created (ORG, M4). */
  newClassHref?: string;
  /** Cards due today; Review shows it (Design System, bottom navigation). */
  reviewDue?: number;
  /** Bottom of the desktop sidebar, e.g. the allowance summary (frame B1-desktop). */
  sidebarFooter?: ReactNode;
  children: ReactNode;
};

/**
 * Mobile: content and a bottom navigation (Today, Classes, Review, Me). From 768px a sidebar
 * replaces it, with icons only until 1024px (HANDOFF §4). Recording screens use no shell.
 */
export function AppShell({
  current,
  hrefs,
  newClassHref,
  reviewDue,
  sidebarFooter,
  children,
}: AppShellProps) {
  const due = reviewDue && reviewDue > 0 ? fill(strings.nav.reviewDue, { count: reviewDue }) : null;
  return (
    <div className={styles.shell}>
      <a href="#content" className={`btn btn-secondary ${styles.skip}`}>
        {strings.nav.skipToContent}
      </a>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <Wordmark />
        </div>
        <span className={styles.navCaption}>{studyCopy.navigation}</span>
        {newClassHref ? (
          <Link href={newClassHref} className={`btn btn-secondary ${styles.newClass}`}>
            <Icon icon={Plus} />
            <span className={styles.sidebarLabel}>{strings.nav.newClass}</span>
          </Link>
        ) : null}
        <nav className={styles.sidebarNav} aria-label={studyCopy.navigation}>
          {NAV.map(({ id, icon }) => {
            const active = id === current;
            return (
              <Link
                key={id}
                href={hrefs[id]}
                aria-current={active ? "page" : undefined}
                className={styles.sidebarItem}
              >
                <Icon
                  icon={icon}
                  weight={active ? "fill" : "regular"}
                  className={styles.sidebarIcon}
                />
                <span className={styles.sidebarLabel}>{strings.nav[id]}</span>
                {id === "review" && due ? (
                  <span className={`rc-num ${styles.count}`}>
                    <span className="rc-visually-hidden">, </span>
                    {due}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
        <div className={styles.spacer} />
        <div className={styles.sidebarNote}>
          <Icon icon={SunHorizon} size={26} />
          <strong>{studyCopy.sidebarTitle}</strong>
          <p>{studyCopy.sidebarHelp}</p>
        </div>
        {sidebarFooter ? <div className={styles.sidebarFooter}>{sidebarFooter}</div> : null}
      </aside>
      <main id="content" tabIndex={-1} className={styles.main}>
        <div className={styles.mobileBrand}>
          <Wordmark />
          <span>{studyCopy.mobileBrand}</span>
        </div>
        <div className={styles.content}>{children}</div>
      </main>
      <nav className={styles.bottomNav} aria-label={studyCopy.navigation}>
        {NAV.map(({ id, icon }) => {
          const active = id === current;
          return (
            <Link
              key={id}
              href={hrefs[id]}
              aria-current={active ? "page" : undefined}
              className={styles.bottomItem}
            >
              <Icon icon={icon} weight={active ? "fill" : "regular"} size={24} />
              {strings.nav[id]}
              {id === "review" && due ? <span className="rc-visually-hidden">, {due}</span> : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

type PageHeaderProps = {
  title: string;
  /** Small line above the title, e.g. the date on Today. */
  kicker?: string;
  subtitle?: string;
};

export function PageHeader({ title, kicker, subtitle }: PageHeaderProps) {
  return (
    <header className={styles.pageHeader}>
      {kicker ? <span className={styles.kicker}>{kicker}</span> : null}
      <h1 className={styles.pageTitle}>{title}</h1>
      {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
    </header>
  );
}
