"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarBlank } from "../icons";
import styles from "./DateInput.module.css";
import { Icon } from "./Icon";

function displayDate(value: string) {
  return value ? value.split("-").reverse().join("/") : "";
}

function calendarDate(text: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!match || match[3] === "0000") return "";
  const value = `${match[3]}-${match[2]}-${match[1]}`;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : "";
}

/** Display a fixed day/month/year order while keeping native calendar selection. */
export function DateInput({
  id,
  value,
  onChange,
  disabled = false,
  required = false,
  "aria-describedby": describedBy,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  "aria-describedby"?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  const [draft, setDraft] = useState<{ date: string; text: string } | null>(null);
  const text = draft?.date === value ? draft.text : displayDate(value);

  useEffect(() => {
    inputRef.current?.setCustomValidity(
      text && !calendarDate(text) ? "Enter a valid date as DD/MM/YYYY (day/month/year)." : "",
    );
  }, [text]);

  return (
    <div className={styles.control}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        dir="ltr"
        autoComplete="off"
        placeholder="DD/MM/YYYY"
        maxLength={10}
        value={text}
        required={required}
        disabled={disabled || !interactive}
        aria-describedby={describedBy}
        aria-invalid={Boolean(text && !calendarDate(text)) || undefined}
        className={styles.text}
        onChange={(event) => {
          const nextText = event.target.value;
          const date = calendarDate(nextText);
          setDraft({ date, text: nextText });
          onChange(date);
        }}
      />
      <button
        type="button"
        className={styles.open}
        aria-label="Choose class date"
        disabled={disabled || !interactive}
        onClick={() => {
          const picker = pickerRef.current;
          if (!picker) return;
          if (typeof picker.showPicker === "function") picker.showPicker();
          else picker.click();
        }}
      >
        <Icon icon={CalendarBlank} size={20} />
      </button>
      <input
        ref={pickerRef}
        className={styles.picker}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled || !interactive}
        value={value}
        onChange={(event) => {
          setDraft(null);
          onChange(event.target.value);
          inputRef.current?.focus();
        }}
      />
    </div>
  );
}
