// The question the capture opener asks when a capture can open more than one way (several widths:
// frames side by side or a site; a page captured before: a new file or a comparison). A small modal
// built straight in the DOM, styled like the app's other small dialogs, so the opener can ask from
// anywhere (a window message, a dropped file) without a component mounted for it.

export interface CaptureChoice {
    id: string;
    label: string;
    // One line under the button.
    hint?: string;
}

let open: { close: (value: string | null) => void } | null = null;

// Resolves with the chosen id, or null when dismissed (Escape, Cancel, a click outside).
export function chooseCaptureOpen(title: string, hint: string, choices: CaptureChoice[]): Promise<string | null> {
    open?.close(null);
    if (typeof document === "undefined") return Promise.resolve(choices[0]?.id ?? null);
    return new Promise((resolve) => {
        const backdrop = document.createElement("div");
        backdrop.className = "fixed inset-0 z-[200] flex items-center justify-center bg-black/40";
        const dialog = document.createElement("div");
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");
        dialog.setAttribute("aria-labelledby", "capture-choice-title");
        dialog.className = "w-[340px] rounded-xl border border-panel-border bg-panel p-4 text-ink shadow-2xl";
        const heading = document.createElement("h2");
        heading.id = "capture-choice-title";
        heading.className = "mb-1 text-[13px] font-semibold";
        heading.textContent = title;
        const note = document.createElement("p");
        note.className = "mb-3 text-[12px] text-ink-muted";
        note.textContent = hint;
        dialog.append(heading, note);
        const close = (value: string | null) => {
            open = null;
            backdrop.remove();
            window.removeEventListener("keydown", onKey, true);
            resolve(value);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.stopPropagation();
            close(null);
        };
        choices.forEach((choice, i) => {
            const button = document.createElement("button");
            button.type = "button";
            button.dataset.choice = choice.id;
            button.className = `mb-2 flex w-full flex-col items-start rounded-lg px-3 py-2 text-left text-[12px] ${i === 0 ? "bg-brand-500 text-white hover:bg-brand-600" : "border border-panel-border text-ink hover:bg-panel-hover"}`;
            const label = document.createElement("span");
            label.className = "font-semibold";
            label.textContent = choice.label;
            button.append(label);
            if (choice.hint) {
                const sub = document.createElement("span");
                sub.className = i === 0 ? "text-white/80" : "text-ink-muted";
                sub.textContent = choice.hint;
                button.append(sub);
            }
            button.addEventListener("click", () => close(choice.id));
            dialog.append(button);
        });
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.dataset.choice = "";
        cancel.className = "h-7 w-full rounded-md text-[12px] text-ink-muted hover:bg-panel-hover hover:text-ink";
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", () => close(null));
        dialog.append(cancel);
        backdrop.append(dialog);
        backdrop.addEventListener("pointerdown", (e) => {
            if (e.target === backdrop) close(null);
        });
        window.addEventListener("keydown", onKey, true);
        document.body.append(backdrop);
        open = { close };
        requestAnimationFrame(() => (dialog.querySelector("button") as HTMLButtonElement | null)?.focus());
    });
}
