/**
 * <app-calculator> — a four-function calculator (manifest kind: "window").
 *
 * Digits, decimal point, + − × ÷, percent, sign toggle, clear/all-clear and
 * backspace, driven by mouse or keyboard. The whole app is the three hooks
 * below: build() renders once, onMount() wires the listeners, onUnmount()
 * takes back the only one that lives outside this element.
 *
 * Arithmetic model: the classic two-register machine — an accumulator, one
 * pending operator and the entry on screen. Chained operators fold the entry
 * into the accumulator as you go, so "2 + 3 × 4" reads left to right (5 × 4),
 * the way a pocket calculator does; repeated equals replays the last operation
 * with the last right-hand operand.
 */
(function () {
    // Parse time, top level: document.currentScript is this file only here.
    const BASE = sac.app.base();

    /* ---------------------------------------------------------------------
       Numbers. Doubles lie in the last few digits (0.1 + 0.2), so every value
       leaves the machine through format(), which keeps 12 significant digits
       and drops the noise below them. Nothing else ever calls toString().
       --------------------------------------------------------------------- */
    const PRECISION = 12;    // significant digits kept in a result
    const MAX_DIGITS = 15;   // digits a user may type into one entry

    /** A finite number as the display should show it. */
    function format(n) {
        if (typeof n !== "number" || !Number.isFinite(n)) return "Error";
        if (n === 0) return "0";                       // also folds -0 into 0
        const abs = Math.abs(n);
        if (abs >= 1e12 || abs < 1e-9) return exponential(n);
        const s = Number(n.toPrecision(PRECISION)).toString();
        return s.includes("e") ? exponential(n) : s;
    }

    /** 1.2345678e+21 → 1.234568e21, and 1.000000e-15 → 1e-15. */
    function exponential(n) {
        return n.toExponential(6).replace(/\.?0+e/, "e").replace("e+", "e");
    }

    /** Display-only thousands grouping — thin spaces, so no locale ambiguity. */
    function group(text) {
        if (text.includes("e") || !/\d/.test(text)) return text;
        const neg = text.startsWith("-");
        const body = neg ? text.slice(1) : text;
        const dot = body.indexOf(".");
        const int = dot === -1 ? body : body.slice(0, dot);
        const rest = dot === -1 ? "" : body.slice(dot);
        return (neg ? "-" : "") + int.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + rest;
    }

    function digitCount(text) {
        const m = text.match(/\d/g);
        return m ? m.length : 0;
    }

    /** One operation. Returns { value } or { error } — never throws. */
    function compute(a, op, b) {
        if (op === "div" && b === 0) return { error: "Cannot divide by zero" };
        let v;
        if (op === "add") v = a + b;
        else if (op === "sub") v = a - b;
        else if (op === "mul") v = a * b;
        else if (op === "div") v = a / b;
        else return { error: "Unknown operation" };
        if (!Number.isFinite(v)) return { error: "Out of range" };
        return { value: v };
    }

    const SYMBOL = { add: "+", sub: "−", mul: "×", div: "÷" };

    /* ---------------------------------------------------------------------
       The keypad. [action, label, class, accessible name?]
       --------------------------------------------------------------------- */
    const KEYS = [
        ["clear", "AC", "fn", "All clear"],
        ["back", "⌫", "fn", "Backspace"],
        ["percent", "%", "fn", "Percent"],
        ["div", "÷", "op", "Divide"],

        ["7", "7", "num"], ["8", "8", "num"], ["9", "9", "num"],
        ["mul", "×", "op", "Multiply"],

        ["4", "4", "num"], ["5", "5", "num"], ["6", "6", "num"],
        ["sub", "−", "op", "Subtract"],

        ["1", "1", "num"], ["2", "2", "num"], ["3", "3", "num"],
        ["add", "+", "op", "Add"],

        ["sign", "±", "fn", "Toggle sign"],
        ["0", "0", "num"],
        ["dot", ".", "num", "Decimal point"],
        ["equals", "=", "eq", "Equals"],
    ];

    /** Physical key → keypad action. */
    const KEYMAP = {
        "0": "0", "1": "1", "2": "2", "3": "3", "4": "4",
        "5": "5", "6": "6", "7": "7", "8": "8", "9": "9",
        ".": "dot", ",": "dot",
        "+": "add", "-": "sub", "*": "mul", "x": "mul", "X": "mul",
        "/": "div", ":": "div",
        "Enter": "equals", "=": "equals",
        "Backspace": "back",
        "Escape": "allclear",
        "Delete": "clear",
        "%": "percent",
        "F9": "sign",
    };

    class AppCalculator extends sac.app.Element {
        /** Once, on first connect. Light DOM, so ui.css tokens apply. */
        build() {
            sac.app.styles(BASE + "app.css", "app-calculator-css");

            // The host element owns the keyboard: focusable, and the buttons
            // never steal focus (see the mousedown handler in onMount).
            this.setAttribute("tabindex", "0");
            this.setAttribute("aria-label", "Calculator");

            const keys = KEYS.map(([action, label, cls, name]) => `
                <button type="button" class="btn key ${cls}${cls === "eq" ? " primary" : ""}"
                        data-key="${action}" aria-label="${name || label}">${label}</button>`
            ).join("");

            this.innerHTML = `
                <div class="display">
                    <div class="pending" aria-hidden="true">&nbsp;</div>
                    <output class="value" aria-live="polite">0</output>
                </div>
                <div class="pad">${keys}</div>
            `;

            this.display = this.querySelector(".display");
            this.pendingOut = this.querySelector(".pending");
            this.valueOut = this.querySelector(".value");
            this.pad = this.querySelector(".pad");
            this.clearKey = this.querySelector('[data-key="clear"]');
            this.opKeys = Array.from(this.querySelectorAll(".key.op"));

            this.reset();
            this.render();
        }

        /** Once, when the app is really on screen. */
        onMount() {
            this.pad.addEventListener("click", (e) => {
                const btn = e.target.closest("button[data-key]");
                if (btn) this.press(btn.dataset.key);
            });

            // Keep focus on the host: a button that took it would swallow
            // Enter (native activation) and turn it into "press that key".
            this.addEventListener("mousedown", (e) => {
                if (e.target.closest("button")) e.preventDefault();
                this.focus({ preventScroll: true });
            });

            this.addEventListener("keydown", (e) => this.handleKey(e));

            // Polite global fallback: only when nothing else on the page has
            // focus, so this never eats another app's typing.
            document.addEventListener("keydown", this._onDocKey = (e) => {
                if (document.activeElement && document.activeElement !== document.body) return;
                this.handleKey(e);
            });

            this.focus({ preventScroll: true });
        }

        /** Only when the host removes the app. Undo what onMount did. */
        onUnmount() {
            if (this._onDocKey) {
                document.removeEventListener("keydown", this._onDocKey);
                this._onDocKey = null;
            }
            if (this._flashTimer) {
                clearTimeout(this._flashTimer);
                this._flashTimer = null;
            }
        }

        /* ----------------------------------------------------------- input */

        handleKey(e) {
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            // A focused button activates natively on Enter/Space — let it, or
            // the key would fire twice.
            if ((e.key === "Enter" || e.key === " ") &&
                e.target && e.target.closest && e.target.closest("button")) return;

            const action = KEYMAP[e.key];
            if (!action) return;
            e.preventDefault();
            this.press(action);
            this.flash(action === "allclear" ? "clear" : action);
        }

        /** Every key — mouse or keyboard — comes through here. */
        press(action) {
            if (/^[0-9]$/.test(action)) this.digit(action);
            else if (action === "dot") this.dot();
            else if (action === "add" || action === "sub" ||
                     action === "mul" || action === "div") this.operator(action);
            else if (action === "equals") this.equals();
            else if (action === "percent") this.percent();
            else if (action === "sign") this.sign();
            else if (action === "back") this.backspace();
            else if (action === "clear") this.clearKeyPress();
            else if (action === "allclear") this.reset();
            this.render();
        }

        /** Brief highlight so a keyboard press is visible on the pad. */
        flash(action) {
            const btn = this.pad.querySelector(`[data-key="${action}"]`);
            if (!btn) return;
            if (this._flashed) this._flashed.classList.remove("is-pressed");
            clearTimeout(this._flashTimer);
            btn.classList.add("is-pressed");
            this._flashed = btn;
            this._flashTimer = setTimeout(() => btn.classList.remove("is-pressed"), 120);
        }

        /* ----------------------------------------------------------- state */

        reset() {
            this.state = {
                entry: "0",          // what the big line shows, as typed
                typing: false,       // digits append instead of replacing
                operand: false,      // the entry is a live operand, not a result
                acc: null,           // the accumulator
                op: null,            // pending operator
                lastOp: null,        // for repeated equals
                lastRhs: null,
                pending: "",         // the small line
                error: null,
            };
        }

        value() {
            const n = Number(this.state.entry);
            return Number.isFinite(n) ? n : 0;
        }

        fail(message) {
            this.reset();
            this.state.error = message;
        }

        /** True while the clear key means "wipe everything", not "clear entry". */
        clearIsAll() {
            const s = this.state;
            if (s.error) return true;
            return !s.typing && s.entry === "0";
        }

        /** A digit or the decimal point starts a new calculation after "=". */
        beginEntry() {
            if (this.state.error) this.reset();   // reset() swaps the state object
            const s = this.state;
            if (s.typing) return;
            if (s.op === null) {
                s.acc = null;
                s.lastOp = null;
                s.lastRhs = null;
                s.pending = "";
            }
            s.entry = "0";
            s.typing = true;
        }

        digit(d) {
            this.beginEntry();
            const s = this.state;
            if (digitCount(s.entry) >= MAX_DIGITS) return;
            if (s.entry === "0") s.entry = d;
            else if (s.entry === "-0") s.entry = "-" + d;
            else s.entry += d;
            s.operand = true;
        }

        dot() {
            this.beginEntry();
            const s = this.state;
            if (!s.entry.includes(".")) s.entry += ".";
            s.operand = true;
        }

        operator(op) {
            const s = this.state;
            if (s.error) return;
            if (s.op !== null && s.operand) {
                const r = compute(s.acc, s.op, this.value());
                if (r.error) return this.fail(r.error);
                s.acc = r.value;
                s.entry = format(r.value);
            } else if (s.op === null) {
                s.acc = this.value();
            }
            // else: an operator pressed twice in a row just swaps the pending one.
            s.op = op;
            s.lastOp = null;
            s.lastRhs = null;
            s.typing = false;
            s.operand = false;
            s.pending = group(format(s.acc)) + " " + SYMBOL[op];
        }

        equals() {
            const s = this.state;
            if (s.error) return;

            let lhs, op, rhs;
            if (s.op !== null) {
                lhs = s.acc;
                op = s.op;
                rhs = this.value();
            } else if (s.lastOp !== null) {
                lhs = this.value();
                op = s.lastOp;
                rhs = s.lastRhs;
            } else {
                s.typing = false;
                s.operand = false;
                return;
            }

            const r = compute(lhs, op, rhs);
            if (r.error) return this.fail(r.error);

            s.pending = group(format(lhs)) + " " + SYMBOL[op] + " " + group(format(rhs)) + " =";
            s.lastOp = op;
            s.lastRhs = rhs;
            s.acc = r.value;
            s.entry = format(r.value);
            s.op = null;
            s.typing = false;
            s.operand = false;
        }

        /** Context-sensitive, the way pocket calculators do it: after + or −
            the percentage is of the accumulator, otherwise it is a plain /100. */
        percent() {
            const s = this.state;
            if (s.error) return;
            const v = this.value();
            const relative = (s.op === "add" || s.op === "sub") && s.acc !== null;
            const result = relative ? (s.acc * v) / 100 : v / 100;
            if (!Number.isFinite(result)) return this.fail("Out of range");
            s.entry = format(result);
            s.typing = false;
            s.operand = true;
        }

        sign() {
            const s = this.state;
            if (s.error) return;
            if (s.typing) {
                if (s.entry === "0") return;            // never show a bare -0
                s.entry = s.entry.startsWith("-") ? s.entry.slice(1) : "-" + s.entry;
            } else {
                s.entry = format(-this.value());
            }
            s.operand = true;
        }

        backspace() {
            const s = this.state;
            if (s.error) return this.reset();
            if (!s.typing) return;                      // nothing to take back
            s.entry = s.entry.slice(0, -1);
            if (s.entry === "" || s.entry === "-") s.entry = "0";
            s.operand = true;
        }

        clearKeyPress() {
            const s = this.state;
            if (this.clearIsAll()) return this.reset();
            s.entry = "0";
            s.typing = false;
            s.operand = true;
        }

        /* ---------------------------------------------------------- render */

        render() {
            const s = this.state;
            const text = s.error ? "Error" : group(s.entry);

            this.pendingOut.textContent = s.error ? s.error : (s.pending || " ");
            this.valueOut.textContent = text;
            this.display.classList.toggle("is-error", !!s.error);

            // Long results shrink instead of overflowing.
            this.valueOut.classList.toggle("shrink-1", text.length > 9 && text.length <= 13);
            this.valueOut.classList.toggle("shrink-2", text.length > 13);

            const all = this.clearIsAll();
            this.clearKey.textContent = all ? "AC" : "C";
            this.clearKey.setAttribute("aria-label", all ? "All clear" : "Clear entry");

            for (const b of this.opKeys) {
                b.classList.toggle("is-armed", b.dataset.key === s.op);
            }
        }
    }

    sac.app.define("app-calculator", AppCalculator);
})();
