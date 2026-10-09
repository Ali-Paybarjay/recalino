// Course organisation and Goal guidance approved in product decision D39.
export const courseCopy = {
  goalHelp:
    "Your goal guides explanations. Create courses separately to organise dated classes and their materials.",
  courseHelp:
    "A course groups its dated classes and learning materials. You can have more than one course.",
} as const;

// Unit help in an InfoTip, approved by the product owner on 2026-10-09 (D48).
export const unitCopy = {
  helpLabel: "About units",
  help: [
    "Units are like the chapters of your book. Use them to keep classes about one lesson together. Units are optional. A class can have no unit.",
    "After you create a unit, you can choose it when you create a class.",
    "New units go to the end of the list. To move a unit, change its order number. Smaller numbers come first. You can delete a unit only when it has no classes.",
  ],
  namePlaceholder: "For example: Unit 3 – Travel",
} as const;
