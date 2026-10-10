// Course organisation and Goal guidance approved in product decision D39.
export const courseCopy = {
  goalHelp:
    "Your goal guides explanations. Create courses separately to organise dated sessions and their materials.",
  courseHelp:
    "A course groups its dated sessions and learning materials. You can have more than one course.",
} as const;

// Unit help in an InfoTip, approved by the product owner on 2026-10-09 (D52), with the
// dated item called a session (D50).
export const unitCopy = {
  helpLabel: "About units",
  help: [
    "Units are like the chapters of your book. Use them to keep sessions about one lesson together. Units are optional. A session can have no unit.",
    "After you create a unit, you can choose it when you create a session.",
    "New units go to the end of the list. To move a unit, change its order number. Smaller numbers come first. You can delete a unit only when it has no sessions.",
  ],
  namePlaceholder: "For example: Unit 3 – Travel",
} as const;
