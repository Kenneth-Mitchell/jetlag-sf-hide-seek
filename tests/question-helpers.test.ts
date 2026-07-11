import { describe, expect, it } from "vitest";
import { buildDraftConstraint } from "../src/lib/draftConstraint";
import { answerPastedQuestion } from "../src/lib/pastedQuestion";
import { formatQuestionDraft } from "../src/lib/questionText";
import { vanNessMarket } from "../src/lib/snapshot";

describe("question helper modules", () => {
  it("builds draft constraints outside the React component", () => {
    const draft = buildDraftConstraint({
      kind: "radius",
      id: "draft",
      label: "Radar / radius",
      enabled: true,
      color: "#7c3aed",
      point: vanNessMarket,
      from: vanNessMarket,
      to: vanNessMarket,
      category: "museums",
      radiusMiles: 1.25,
      radiusAnswer: "inside",
      measureAnswer: "closer",
      yesNoAnswer: "yes",
      thermoAnswer: "warmer",
      tentacleRadius: 1.5,
      selectedPoiId: "unused",
      transitLine: "N",
    });

    expect(draft).toMatchObject({
      kind: "radius",
      miles: 1.25,
      answer: "inside",
      color: "#7c3aed",
    });
  });

  it("answers pasted app-generated radius questions", () => {
    const question = formatQuestionDraft({
      kind: "radius",
      point: vanNessMarket,
      radiusMiles: 0.5,
      category: "museums",
      tentacleRadius: 1.5,
      transitLine: "N",
      from: vanNessMarket,
      to: vanNessMarket,
    });

    const answer = answerPastedQuestion(question, vanNessMarket);

    expect(answer).toMatchObject({
      title: "Radar / radius",
      answer: "Yes",
    });
  });
});
