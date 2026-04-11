export function buildRecorderInitScript() {
  return `
    (() => {
      const readLabel = (element) => {
        const ariaLabel = element.getAttribute("aria-label");
        if (ariaLabel) return ariaLabel.trim();

        const labelledBy = element.getAttribute("aria-labelledby");
        if (labelledBy) {
          const text = labelledBy
            .split(/\\s+/)
            .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
            .filter(Boolean)
            .join(" ");
          if (text) return text;
        }

        if ("labels" in element && element.labels && element.labels.length > 0) {
          const labelText = Array.from(element.labels)
            .map((label) => label.textContent?.trim() ?? "")
            .filter(Boolean)
            .join(" ");
          if (labelText) return labelText;
        }

        const placeholder = element.getAttribute("placeholder");
        if (placeholder) return placeholder.trim();

        const text = element.textContent?.trim();
        if (text) return text.slice(0, 120);

        return null;
      };

      const snapshot = (rawTarget) => {
        const element = rawTarget.closest("input, textarea, select, button, a, [role], [data-testid]") ?? rawTarget;
        const tagName = element.tagName.toLowerCase();
        return {
          tagName,
          inputType: "type" in element ? element.type ?? null : null,
          testId: element.getAttribute("data-testid"),
          id: element.getAttribute("id"),
          name: element.getAttribute("name"),
          ariaLabel: element.getAttribute("aria-label"),
          role: element.getAttribute("role"),
          text: element.textContent?.trim()?.slice(0, 120) ?? null,
          label: readLabel(element),
          placeholder: element.getAttribute("placeholder"),
          value: "value" in element ? element.value ?? null : null,
          selectedText:
            element instanceof HTMLSelectElement
              ? element.options[element.selectedIndex]?.text?.trim() ?? null
              : null
        };
      };

      const emit = (payload) => {
        if (typeof window.__codexAuthoringEmit === "function") {
          window.__codexAuthoringEmit(payload);
        }
      };

      document.addEventListener("click", (event) => {
        if (!event.isTrusted || !(event.target instanceof Element)) return;
        const details = snapshot(event.target);

        if (details.tagName === "input" || details.tagName === "textarea") {
          emit({
            kind: "input-request",
            url: window.location.href,
            element: details
          });
          return;
        }

        if (details.tagName === "select") {
          return;
        }

        window.setTimeout(() => {
          emit({
            kind: "click",
            url: window.location.href,
            element: details
          });
        }, 150);
      }, true);

      document.addEventListener("change", (event) => {
        if (!event.isTrusted || !(event.target instanceof Element)) return;
        const details = snapshot(event.target);
        if (details.tagName !== "select") return;

        emit({
          kind: "select-change",
          url: window.location.href,
          element: details
        });
      }, true);
    })();
  `;
}
