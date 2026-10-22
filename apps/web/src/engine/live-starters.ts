import type { LivePropSchema, LiveSource } from "./types";

// The Live frames Insert offers: small self-contained pieces of HTML, CSS and JavaScript, or a
// React component (bundled like a Make app, engine/live-app.ts), each declaring its props (so the
// Inspector shows them) and the events it sends.

export interface LiveStarter {
    id: string;
    name: string;
    // One line for menus.
    description: string;
    w: number;
    h: number;
    // HTML, CSS and JavaScript; or a project's files (a React component), run as an app frame.
    source?: LiveSource;
    files?: Record<string, string>;
    schema: LivePropSchema[];
    events?: string[];
}

const COUNTER: LiveStarter = {
    id: "counter",
    name: "Counter button",
    description: "A button that counts its clicks",
    w: 240,
    h: 120,
    schema: [
        { name: "label", type: "text", label: "Label", default: "Clicked" },
        { name: "color", type: "color", label: "Colour", default: "#3B5BDB" },
        { name: "start", type: "number", label: "Start", default: 0, min: 0, step: 1 },
    ],
    events: ["change"],
    source: {
        html: `<button id="count" type="button"></button>`,
        css: `body {
    display: grid;
    place-items: center;
    font-family: Inter, system-ui, sans-serif;
}
button {
    border: 0;
    border-radius: 12px;
    padding: 14px 22px;
    font: 600 16px/1 Inter, system-ui, sans-serif;
    color: #fff;
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18);
}
button:active {
    transform: translateY(1px);
}`,
        js: `nagma.declare({
    props: [
        { name: "label", type: "text", label: "Label", default: "Clicked" },
        { name: "color", type: "color", label: "Colour", default: "#3B5BDB" },
        { name: "start", type: "number", label: "Start", default: 0, min: 0, step: 1 },
    ],
    events: ["change"],
});

const button = document.getElementById("count");
let count = Number(nagma.props.start) || 0;

function render(props) {
    button.style.background = props.color;
    button.textContent = props.label + " " + count + (count === 1 ? " time" : " times");
}

nagma.on("props", (props) => {
    count = Number(props.start) || 0;
    render(props);
});

button.addEventListener("click", () => {
    count += 1;
    render(nagma.props);
    nagma.emit("change", { count });
});

render(nagma.props);`,
    },
};

const CHART: LiveStarter = {
    id: "chart",
    name: "Chart",
    description: "Bars drawn from a list of numbers",
    w: 360,
    h: 220,
    schema: [
        { name: "values", type: "numbers", label: "Values", default: [12, 19, 7, 15, 24, 10] },
        { name: "color", type: "color", label: "Colour", default: "#0CA678" },
        { name: "title", type: "text", label: "Title", default: "Weekly signups" },
    ],
    events: ["select"],
    source: {
        html: `<figure>
    <figcaption id="title"></figcaption>
    <svg id="chart" role="img"></svg>
</figure>`,
        css: `body {
    font-family: Inter, system-ui, sans-serif;
    color: #1f2933;
}
figure {
    margin: 0;
    padding: 14px 16px;
    height: 100%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
figcaption {
    font-size: 13px;
    font-weight: 600;
}
svg {
    flex: 1;
    width: 100%;
}
rect {
    cursor: pointer;
}
text {
    font-size: 10px;
    fill: #6b7280;
}`,
        js: `nagma.declare({
    props: [
        { name: "values", type: "numbers", label: "Values", default: [12, 19, 7, 15, 24, 10] },
        { name: "color", type: "color", label: "Colour", default: "#0CA678" },
        { name: "title", type: "text", label: "Title", default: "Weekly signups" },
    ],
    events: ["select"],
});

const svg = document.getElementById("chart");
const NS = "http://www.w3.org/2000/svg";

function draw(props) {
    document.getElementById("title").textContent = props.title;
    const values = Array.isArray(props.values) && props.values.length ? props.values : [0];
    const w = svg.clientWidth || 300;
    const h = svg.clientHeight || 150;
    const top = Math.max(...values, 1);
    const gap = 8;
    const bar = (w - gap * (values.length - 1)) / values.length;
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    svg.replaceChildren();
    values.forEach((v, i) => {
        const height = Math.max(1, (v / top) * (h - 16));
        const rect = document.createElementNS(NS, "rect");
        rect.setAttribute("x", String(i * (bar + gap)));
        rect.setAttribute("y", String(h - 14 - height));
        rect.setAttribute("width", String(bar));
        rect.setAttribute("height", String(height));
        rect.setAttribute("rx", "4");
        rect.setAttribute("fill", props.color);
        rect.addEventListener("click", () => nagma.emit("select", { index: i, value: v }));
        const label = document.createElementNS(NS, "text");
        label.setAttribute("x", String(i * (bar + gap) + bar / 2));
        label.setAttribute("y", String(h - 2));
        label.setAttribute("text-anchor", "middle");
        label.textContent = String(v);
        svg.append(rect, label);
    });
}

nagma.on("props", draw);
window.addEventListener("resize", () => draw(nagma.props));
draw(nagma.props);`,
    },
};

const FORM: LiveStarter = {
    id: "form",
    name: "Form",
    description: "Fields with validation that send a submit event",
    w: 320,
    h: 260,
    schema: [
        { name: "fields", type: "text", label: "Fields", default: "Name, Email" },
        { name: "buttonText", type: "text", label: "Button text", default: "Sign up" },
        { name: "color", type: "color", label: "Colour", default: "#7048E8" },
    ],
    events: ["submit"],
    source: {
        html: `<form id="form" novalidate>
    <div id="fields"></div>
    <button id="send" type="button"></button>
    <p id="note" role="status"></p>
</form>`,
        css: `body {
    font-family: Inter, system-ui, sans-serif;
    color: #1f2933;
}
form {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
}
label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    font-weight: 600;
}
input {
    font: 14px Inter, system-ui, sans-serif;
    padding: 8px 10px;
    border: 1px solid #cbd2d9;
    border-radius: 8px;
}
input[aria-invalid="true"] {
    border-color: #e03131;
}
button {
    border: 0;
    border-radius: 8px;
    padding: 10px;
    font: 600 14px Inter, system-ui, sans-serif;
    color: #fff;
    cursor: pointer;
}
#note {
    margin: 0;
    min-height: 16px;
    font-size: 12px;
    color: #e03131;
}
#note.ok {
    color: #2b8a3e;
}`,
        js: `nagma.declare({
    props: [
        { name: "fields", type: "text", label: "Fields", default: "Name, Email" },
        { name: "buttonText", type: "text", label: "Button text", default: "Sign up" },
        { name: "color", type: "color", label: "Colour", default: "#7048E8" },
    ],
    events: ["submit"],
});

const holder = document.getElementById("fields");
const send = document.getElementById("send");
const note = document.getElementById("note");

function render(props) {
    const names = String(props.fields || "").split(",").map((s) => s.trim()).filter(Boolean);
    holder.replaceChildren(...names.map((name) => {
        const label = document.createElement("label");
        const input = document.createElement("input");
        input.name = name;
        input.required = true;
        input.type = /mail/i.test(name) ? "email" : "text";
        input.placeholder = name;
        label.append(name, input);
        return label;
    }));
    send.textContent = props.buttonText;
    send.style.background = props.color;
    note.textContent = "";
}

function submit() {
    const inputs = [...holder.querySelectorAll("input")];
    let ok = true;
    for (const input of inputs) {
        const bad = !input.value.trim() || (input.type === "email" && !/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(input.value));
        input.setAttribute("aria-invalid", String(bad));
        if (bad) ok = false;
    }
    note.className = ok ? "ok" : "";
    note.textContent = ok ? "Thanks, you're in." : "Fill in every field.";
    if (ok) nagma.emit("submit", Object.fromEntries(inputs.map((i) => [i.name, i.value])));
}

send.addEventListener("click", submit);
holder.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
});
nagma.on("props", render);
render(nagma.props);`,
    },
};

const REACT: LiveStarter = {
    id: "react",
    name: "React component",
    description: "A React component whose props are the Inspector's",
    w: 320,
    h: 220,
    schema: [
        { name: "title", type: "text", label: "Title", default: "Pick a plan" },
        { name: "options", type: "text", label: "Options", default: "Free, Pro, Team" },
        { name: "color", type: "color", label: "Colour", default: "#7048E8" },
        { name: "rounded", type: "boolean", label: "Rounded", default: true },
    ],
    events: ["select"],
    files: {
        "src/App.jsx": `import { useState } from "react";

// The frame shows this file's default export; its props are the Inspector's (nagma.props).
nagma.declare({
    props: [
        { name: "title", type: "text", label: "Title", default: "Pick a plan" },
        { name: "options", type: "text", label: "Options", default: "Free, Pro, Team" },
        { name: "color", type: "color", label: "Colour", default: "#7048E8" },
        { name: "rounded", type: "boolean", label: "Rounded", default: true },
    ],
    events: ["select"],
});

export default function App({ title = "Pick a plan", options = "Free, Pro, Team", color = "#7048E8", rounded = true }) {
    const [picked, setPicked] = useState(null);
    const items = String(options).split(",").map((s) => s.trim()).filter(Boolean);
    const radius = rounded ? 10 : 2;
    return (
        <div style={{ fontFamily: "Inter, system-ui, sans-serif", padding: 16, display: "grid", gap: 10 }}>
            <strong style={{ fontSize: 16 }}>{title}</strong>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {items.map((item) => (
                    <button
                        key={item}
                        type="button"
                        onClick={() => {
                            setPicked(item);
                            nagma.emit("select", { option: item });
                        }}
                        style={{ border: \`1.5px solid \${color}\`, borderRadius: radius, padding: "8px 14px", font: "600 13px Inter, system-ui, sans-serif", cursor: "pointer", background: picked === item ? color : "#fff", color: picked === item ? "#fff" : color }}
                    >
                        {item}
                    </button>
                ))}
            </div>
            <span style={{ fontSize: 12, color: "#6b6b6b" }}>{picked ? \`Picked: \${picked}\` : "Nothing picked yet"}</span>
        </div>
    );
}
`,
    },
};

export const LIVE_STARTERS: LiveStarter[] = [COUNTER, CHART, FORM, REACT];
