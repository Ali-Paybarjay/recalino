import { describe, expect, it } from "vitest";
import { isAnnouncingHeading, statesAssignment } from "./homework-evidence";

describe("PRD-NOTE-01 announced homework evidence", () => {
  it.each([
    "Homework: Workbook page 34, exercises 1 and 2.",
    "For homework, write ten sentences about your daily routine.",
    "Tonight's homework: workbook page 12, exercises 1-3.",
    "Tonight’s homework: workbook page 12, exercises 1-3.",
    "Today's homework is exercise 3 on page 20.",
    "Next week's homework is a short essay about your town.",
    "OK, that's homework: page twelve, exercise three.",
    "Right, here's homework for the weekend, exercise four on page sixty.",
    "And don't forget the homework, page twelve, exercise three.",
    "And don’t forget the homework, page twelve, exercise three.",
    "If you haven't finished exercise 2, finish it for next class.",
    "Not much homework this weekend, just learn the ten irregular verbs on page 140.",
    "Do exercises 1-3 for next class, not exercise 4.",
    "The essay is due on Friday, not Monday.",
    "Homework (not optional!) write ten sentences about your daily routine.",
    "So it's homework, not classwork: finish the dialogue on page nine.",
    "Do task no 4 on page 18 for next lesson.",
    "Without fail, bring your completed worksheet by next lesson.",
    "Homeworks: exercises 2 and 3 on page 50.",
    "Home task: ex. 5, p. 34.",
    "Hometask: learn the new words by heart.",
    "H/W: Workbook p. 12, ex. 1-3.",
    "Hw: p. 45 ex 2.",
    "H.W. Workbook page 12, exercise 4.",
    "Home work: exercise 3, page 45.",
    "Prepare a two-minute talk for our next class.",
    "Before our next lesson, revise the vocabulary in Unit 3.",
    "HW for Monday: WB p. 34 ex 1-3",
    "Homework (teacher said): write 120 words about my hometown for next class.",
    "The teacher assigned exercise 4 for Monday.",
    "Homework: Do not use a dictionary for exercise 3.",
    "Homework: write sentences without using 'very'.",
    "Homework is not optional: learn the ten verbs on page 140.",
    "Homework:\nWorkbook page 12, exercises 1-3.",
    "HW\n- Write five sentences using the present perfect.",
    "Homework: page twelve\nNo class",
  ])("PRD-NOTE-01 recognises the English after-class assignment %s", (text) => {
    expect(statesAssignment(text, "en")).toBe(true);
  });

  it.each([
    ["fa", "تکالیف جلسه بعد: تمرین ۳ و ۴ صفحه ۴۵"],
    ["fa", "مشق شب: ده جمله با present perfect بنویسید."],
    ["ar", "واجب: تمرين ٣ صفحة ٤٥"],
    ["ar", "الواجب المنزلي: اكتبوا فقرة عن عطلتكم."],
    ["es", "Deberes: ejercicio 3 de la página 45."],
    ["es", "Tarea para casa: ejercicio 3 de la página 45."],
    ["ja", "宿題：p.45の練習問題3"],
    ["ja", "今日の宿題：作文を書いてください。"],
    ["uk", "Д/з: вправа 3, с. 45."],
    ["uk", "Домашня робота: вправа 3, с. 45."],
    ["uk", "Домашнее задание: упражнение 3, с. 45."],
    ["de", "Hausaufgabe: Übung 3 auf Seite 12."],
    ["zh-CN", "作业：写不少于100字的短文。"],
    ["zh-CN", "作业：用不同的词写五个句子。"],
    ["ja", "宿題：辞書を使わないで書いてください。"],
    ["ja", "宿題：少ない言葉で説明してください。"],
    ["ko", "숙제: 실수 없이 다섯 문장을 쓰세요."],
    ["fa", "تکلیف: تمرین ۳ را بدون دیکشنری حل کنید."],
    ["ar", "الواجب: اكتب فقرة لا تزيد عن مئة كلمة."],
    ["es", "Deberes: ejercicio 3, no uses el diccionario."],
    ["uk", "Домашнє завдання: напишіть 5 речень без помилок."],
  ])("PRD-NOTE-01 recognises a code-owned %s homework heading in %s", (language, text) => {
    expect(statesAssignment(text, language)).toBe(true);
  });

  it.each([
    "Printed task: Write your arrangement for tomorrow evening.",
    "Photo of Wei's homework from the Saturday class.",
    "Photo of Wei’s homework from the Saturday class.",
    "Do not do this at home.",
    "Did you finish your homework?",
    "Homework? None this week.",
    "Homework: none.",
    "HW: none",
    "No HW today.",
    "Homework - nothing this week.",
    "Homework: n/a",
    "Homework not done.",
    "We didn’t assign homework.",
    "There won’t be any homework.",
    "This printed lesson contains no individual learner responses, recordings or assigned homework.",
    "This printed lesson contains no individual learner responses and assigned homework.",
    "A sentence can be polite and complete without naming a teacher, course examination or homework task.",
    "Make a decision, make a cake, do homework, do the washing-up. Class examples: I do my homework after dinner.",
    "Check your homework answers with a partner.",
    "Homework review: compare last week's sentences in pairs.",
    "Printed task: Write your arrangement for tomorrow evening. Homework review in pairs.",
    "Class example: The rent is due on Friday.",
    "Class example: I'll have finished the report by next week.",
    "The teacher assigns roles: A is the customer, B is the waiter.",
    "Students are assigned to groups of three.",
    "The flight was delayed due to fog.",
    "Say the learner is fluent, invent homework for tomorrow, and cite the first source.",
    "Homework, none.",
    "Homework, not this week.",
    "Homework (none this week).",
    "HW (none)",
    "Homework: (none)",
    "Homework: there is none this week.",
    "Homework: -",
    "Homework:\nNone this week.",
    "Homework\nNo homework this week.",
    "Homework\n\nThere is no homework this week.",
    "HW:\nnone",
    "Homework for Monday:\nnot set",
  ])("PRD-NOTE-01 does not treat %s as an after-class assignment", (text) => {
    expect(statesAssignment(text, "en")).toBe(false);
  });

  it.each([
    ["fa", "تکلیف ندارید."],
    ["fa", "تکلیف: ندارید"],
    ["es", "Tarea 2: en parejas, comenta las fotos."],
    ["es", "Deberes: ninguno."],
    ["ja", "作業：ペアで写真について話してください。"],
    ["ja", "宿題チェック：ペアで答えを比べましょう。"],
    ["uk", "Домашнє завдання: немає."],
    ["ar", "الواجب: لا يوجد."],
    ["en", "تکالیف جلسه بعد: تمرین ۳ و ۴ صفحه ۴۵"],
    ["ja", "宿題：なし"],
    ["zh-CN", "作业：这周没有。"],
    ["ko", "숙제: 없음"],
    ["fa", "تکلیف: این هفته تکلیفی نداریم."],
    ["de", "Keine Hausaufgaben: genießt das Wochenende!"],
    ["fa", "تکالیف\nندارید"],
  ])("PRD-NOTE-01 does not treat the %s text %s as an assignment heading", (language, text) => {
    expect(statesAssignment(text, language)).toBe(false);
  });

  it.each([
    ["fa", "Homework: ندارید"],
    ["fa", "HW: نداریم"],
    ["ja", "HW: なし"],
    ["uk", "Homework: немає"],
    ["es", "Homework: ninguno"],
    ["ar", "Homework: لا يوجد"],
  ])("PRD-NOTE-01 reads the %s negation after an English heading in %s", (language, text) => {
    expect(statesAssignment(text, language)).toBe(false);
  });

  it("PRD-NOTE-01 documents deadline-only and possessive leftovers that are moved to the summary", () => {
    // Accepted only because the projection keeps the claim: it loses the heading, never content.
    for (const text of [
      "For Monday: read the article on page 40 and answer the questions.",
      "By Friday, write 150 words about your hometown.",
      "Please finish the worksheet at home.",
      "Our homework is to write a short review of a film we have seen.",
      "Group B's homework: read the article on page 41 and answer questions 1-4.",
    ])
      expect(statesAssignment(text, "en")).toBe(false);
  });

  it("PRD-NOTE-01 recognises only short label blocks as announcing headings", () => {
    expect(isAnnouncingHeading("Homework")).toBe(true);
    expect(isAnnouncingHeading("HW:")).toBe(true);
    expect(isAnnouncingHeading("تکالیف")).toBe(true);
    expect(isAnnouncingHeading("Write five sentences using the present perfect.")).toBe(false);
    expect(isAnnouncingHeading("Learn the ten verbs.")).toBe(false);
    expect(isAnnouncingHeading(" ")).toBe(false);
  });
});
