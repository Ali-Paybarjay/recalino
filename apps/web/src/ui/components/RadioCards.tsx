import styles from "./RadioCards.module.css";

export type RadioCardOption<T extends string> = {
  value: T;
  title: string;
  description?: string;
  /** Language of the title, e.g. a language's own name ("فارسی"). */
  lang?: string;
  /** Short text at the end of the row, e.g. the English name of a language. */
  meta?: string;
};

type RadioCardsProps<T extends string> = {
  name: string;
  label: string;
  options: readonly RadioCardOption<T>[];
  /** null until the learner chooses: radio cards have no default selection (components.md). */
  value: T | null;
  onChange: (value: T) => void;
};

// Radio cards for choices that need words: explanation language (A2), delete-source options
// (G3). Native radios inside a radiogroup.
export function RadioCards<T extends string>({
  name,
  label,
  options,
  value,
  onChange,
}: RadioCardsProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={styles.group}>
      {options.map((option) => (
        <label key={option.value} className={styles.card}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className={`${styles.input} rc-visually-hidden`}
          />
          <span className={styles.dot} aria-hidden="true" />
          <span className={styles.text}>
            <bdi className={styles.title} lang={option.lang} dir="auto">
              {option.title}
            </bdi>
            {option.description ? (
              <span className={styles.description}>{option.description}</span>
            ) : null}
          </span>
          {option.meta ? <span className={styles.meta}>{option.meta}</span> : null}
        </label>
      ))}
    </div>
  );
}
