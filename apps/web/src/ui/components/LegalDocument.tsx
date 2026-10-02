import type { ReactNode } from "react";
import { LEGAL_TEXTS, type LegalTextId } from "../../legal/texts.generated";
import { type Block, fillPlaceholders, type Inline, parseMarkdown } from "../markdown";
import styles from "./LegalDocument.module.css";

type LegalDocumentProps = {
  id: LegalTextId;
  /** Values for {{operator_email}} and {{operator_name}} (docs/legal/README.md). */
  values: Record<string, string>;
};

/**
 * The Terms of Use or the Privacy Notice, rendered as React text (no HTML injection). The
 * document title is left out: the sheet that shows it already has one.
 */
export function LegalDocument({ id, values }: LegalDocumentProps) {
  const blocks = parseMarkdown(fillPlaceholders(LEGAL_TEXTS[id].markdown, values));
  return (
    <div className={styles.document}>
      {blocks
        .filter((block) => !(block.kind === "heading" && block.level === 1))
        .map((block, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed document; blocks never reorder.
          <BlockView key={index} block={block} />
        ))}
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "heading":
      return block.level === 2 ? (
        <h3 className={styles.h2}>
          <Inlines items={block.content} />
        </h3>
      ) : (
        <h4 className={styles.h3}>
          <Inlines items={block.content} />
        </h4>
      );
    case "paragraph":
      return (
        <p className={styles.p}>
          <Inlines items={block.content} />
        </p>
      );
    case "quote":
      return (
        <blockquote className={styles.quote}>
          <Inlines items={block.content} />
        </blockquote>
      );
    case "list": {
      const items = block.items.map((item, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed document; items never reorder.
        <li key={index}>
          <Inlines items={item} />
        </li>
      ));
      return block.ordered ? (
        <ol className={styles.list}>{items}</ol>
      ) : (
        <ul className={styles.list}>{items}</ul>
      );
    }
    case "table":
      return (
        <table className={styles.table}>
          <thead>
            <tr>
              {block.head.map((cell, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed columns.
                <th key={index} scope="col">
                  <Inlines items={cell} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed document.
              <tr key={rowIndex}>
                {row.map((cell, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed columns.
                  <td key={index}>
                    <Inlines items={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
  }
}

function Inlines({ items }: { items: Inline[] }): ReactNode {
  return items.map((item, index) => {
    switch (item.kind) {
      case "strong":
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed inline runs.
        return <strong key={index}>{item.text}</strong>;
      case "code":
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed inline runs.
        return <code key={index}>{item.text}</code>;
      case "link":
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed inline runs.
          <a key={index} href={item.href} target="_blank" rel="noreferrer">
            {item.text}
          </a>
        );
      default:
        return item.text;
    }
  });
}
