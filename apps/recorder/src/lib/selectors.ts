import type {
  AuthoringCredentialHint,
  AuthoringInputRequest,
  AuthoringStepSuggestion,
  FlowStep
} from "@automation/shared";

export interface CapturedElement {
  tagName: string;
  inputType: string | null;
  testId: string | null;
  id: string | null;
  name: string | null;
  ariaLabel: string | null;
  role: string | null;
  text: string | null;
  label: string | null;
  placeholder: string | null;
  value: string | null;
  selectedText: string | null;
}

export interface DomCaptureEvent {
  kind: "click" | "select-change" | "input-request";
  url: string;
  element: CapturedElement;
}

function escapeSelectorValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function normalizeText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 120) : null;
}

function readableTag(tagName: string) {
  return tagName.charAt(0).toUpperCase() + tagName.slice(1);
}

function deriveRole(element: CapturedElement) {
  if (element.role) {
    return element.role;
  }

  switch (element.tagName) {
    case "button":
      return "button";
    case "a":
      return "link";
    default:
      return null;
  }
}

export function buildSelector(element: CapturedElement) {
  const accessibleName =
    normalizeText(element.label) ??
    normalizeText(element.ariaLabel) ??
    normalizeText(element.placeholder) ??
    normalizeText(element.text);

  if (element.testId) {
    return {
      selector: `[data-testid="${escapeSelectorValue(element.testId)}"]`,
      confidence: 0.98
    };
  }

  const role = deriveRole(element);
  if (role && accessibleName) {
    return {
      selector: `role=${role}[name="${escapeSelectorValue(accessibleName)}"]`,
      confidence: 0.92
    };
  }

  if (element.id) {
    return {
      selector: `[id="${escapeSelectorValue(element.id)}"]`,
      confidence: 0.88
    };
  }

  if (element.name && ["input", "textarea", "select"].includes(element.tagName)) {
    return {
      selector: `${element.tagName}[name="${escapeSelectorValue(element.name)}"]`,
      confidence: 0.82
    };
  }

  if (element.ariaLabel) {
    return {
      selector: `[aria-label="${escapeSelectorValue(element.ariaLabel)}"]`,
      confidence: 0.74
    };
  }

  if (element.text && ["button", "a"].includes(element.tagName)) {
    return {
      selector: `${element.tagName}:has-text("${escapeSelectorValue(element.text)}")`,
      confidence: 0.66
    };
  }

  return {
    selector: element.tagName,
    confidence: 0.4
  };
}

function buildSemanticLabel(element: CapturedElement) {
  return (
    normalizeText(element.label) ??
    normalizeText(element.ariaLabel) ??
    normalizeText(element.placeholder) ??
    normalizeText(element.text) ??
    normalizeText(element.name) ??
    normalizeText(element.id) ??
    readableTag(element.tagName)
  );
}

function baseStep(actionType: FlowStep["actionType"], semanticLabel: string, selector: string | null): FlowStep {
  return {
    sortOrder: 0,
    actionType,
    semanticLabel,
    selector,
    value: null,
    expectedOutcome: null,
    timeoutMs: null
  };
}

export function buildClickSuggestion(event: DomCaptureEvent, createdAt: string): AuthoringStepSuggestion {
  const { selector, confidence } = buildSelector(event.element);
  const semanticLabel = buildSemanticLabel(event.element);
  const step = baseStep("click", semanticLabel, selector);

  return {
    step,
    draftStep: step,
    selector,
    pageUrl: event.url,
    confidence,
    rawEventType: "click",
    createdAt
  };
}

export function buildSelectSuggestion(event: DomCaptureEvent, createdAt: string): AuthoringStepSuggestion {
  const { selector, confidence } = buildSelector(event.element);
  const semanticLabel = buildSemanticLabel(event.element);
  const step: FlowStep = {
    ...baseStep("select", semanticLabel, selector),
    value: event.element.value ?? event.element.selectedText ?? null
  };

  return {
    step,
    draftStep: step,
    selector,
    pageUrl: event.url,
    confidence,
    rawEventType: "select",
    createdAt
  };
}

export function buildInputSuggestion(
  selector: string | null,
  semanticLabel: string,
  pageUrl: string,
  value: string,
  createdAt: string
): AuthoringStepSuggestion {
  const step: FlowStep = {
    ...baseStep("input", semanticLabel, selector),
    value
  };

  return {
    step,
    draftStep: step,
    selector,
    pageUrl,
    confidence: selector ? 0.9 : 0.5,
    rawEventType: "input",
    createdAt
  };
}

export function buildInputRequest(event: DomCaptureEvent): AuthoringInputRequest {
  const { selector } = buildSelector(event.element);

  return {
    selector,
    semanticLabel: buildSemanticLabel(event.element),
    inputType: event.element.inputType,
    pageUrl: event.url,
    fieldTag: event.element.tagName
  };
}

export function buildCredentialHint(input: Pick<AuthoringInputRequest, "selector" | "semanticLabel" | "inputType">) {
  const semanticLabel = input.semanticLabel.toLowerCase();
  if (input.inputType === "email" || semanticLabel.includes("email")) {
    const hint: AuthoringCredentialHint = {
      kind: "email",
      selector: input.selector,
      semanticLabel: input.semanticLabel
    };
    return hint;
  }

  if (input.inputType === "password" || semanticLabel.includes("password")) {
    const hint: AuthoringCredentialHint = {
      kind: "password",
      selector: input.selector,
      semanticLabel: input.semanticLabel
    };
    return hint;
  }

  return null;
}
