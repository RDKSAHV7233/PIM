export function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) {
    return [];
  }

  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");
}

export function focusFirstElement(container: HTMLElement | null) {
  const focusable = getFocusableElements(container);
  if (focusable.length > 0) {
    focusable[0]?.focus();
    return;
  }
  container?.focus();
}
