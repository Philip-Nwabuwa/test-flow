import { describe, expect, it } from "vitest";

import { buildCredentialHint, buildInputRequest, buildSelector } from "./selectors.js";

describe("buildSelector", () => {
  it("prefers test ids over other selector sources", () => {
    expect(
      buildSelector({
        tagName: "button",
        inputType: null,
        testId: "save-button",
        id: "save",
        name: null,
        ariaLabel: "Save",
        role: "button",
        text: "Save",
        label: null,
        placeholder: null,
        value: null,
        selectedText: null
      })
    ).toEqual({
      selector: `[data-testid="save-button"]`,
      confidence: 0.98
    });
  });
});

describe("buildInputRequest", () => {
  it("returns the normalized field metadata used by the overlay", () => {
    expect(
      buildInputRequest({
        kind: "input-request",
        url: "https://example.com/login",
        element: {
          tagName: "input",
          inputType: "email",
          testId: null,
          id: "email",
          name: "email",
          ariaLabel: null,
          role: null,
          text: null,
          label: "Email address",
          placeholder: "name@example.com",
          value: null,
          selectedText: null
        }
      })
    ).toEqual({
      selector: `[id="email"]`,
      semanticLabel: "Email address",
      inputType: "email",
      pageUrl: "https://example.com/login",
      fieldTag: "input"
    });
  });
});

describe("buildCredentialHint", () => {
  it("flags password inputs for the parent credential workflow", () => {
    expect(
      buildCredentialHint({
        selector: `[id="password"]`,
        semanticLabel: "Password",
        inputType: "password"
      })
    ).toEqual({
      kind: "password",
      selector: `[id="password"]`,
      semanticLabel: "Password"
    });
  });
});
