import { COUNTRIES, MAIN_COUNTRY } from "/countries.js";

const DEFAULT_COUNTRY = "BI";
const STORAGE_KEY = "giraso-qr-country";
// Countries where the leading 0 is part of the number, not a trunk prefix to drop.
const KEEP_LEADING_ZERO = new Set(["IT", "SM", "VA", "CI"]);

const regionNames = (() => {
    try {
        return new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
        return null;
    }
})();

const countries = COUNTRIES
    .map(([iso, dial]) => ({ iso, dial, name: regionNames?.of(iso) || iso }))
    .sort((a, b) => a.name.localeCompare(b.name));

const byIso = new Map(countries.map((country) => [country.iso, country]));
const byDial = new Map();

for (const country of countries) {
    if (!byDial.has(country.dial)) byDial.set(country.dial, []);
    byDial.get(country.dial).push(country);
}

function readSaved() {
    try {
        const iso = localStorage.getItem(STORAGE_KEY);
        return byIso.has(iso) ? iso : null;
    } catch {
        return null;
    }
}

function save(iso) {
    try {
        localStorage.setItem(STORAGE_KEY, iso);
    } catch {
        // Private mode or blocked storage: the picker still works, it just won't remember.
    }
}

function flag(iso) {
    const image = document.createElement("img");
    image.className = "phone-flag";
    image.src = `/flags/${iso}.svg`;
    image.alt = "";
    image.width = 21;
    image.height = 14;
    image.loading = "lazy";
    image.decoding = "async";
    return image;
}

/** Calling codes are prefix-free, so the first match on "+digits" is the only one. */
function matchDial(digits, current) {
    for (let length = 1; length <= 3 && length <= digits.length; length++) {
        const group = byDial.get(digits.slice(0, length));

        if (group) {
            const country = group.find((c) => c.iso === current)
                || byIso.get(MAIN_COUNTRY[group[0].dial])
                || group[0];
            return { country, rest: digits.slice(length) };
        }
    }

    return null;
}

/** Drops "+" or "00" and the calling code from the start, keeping the user's own spacing after it. */
function stripDial(value, dial) {
    const rest = value.replace(/^(\+|00)/, "");
    let remaining = dial.length;
    let index = 0;

    while (index < rest.length && remaining > 0) {
        if (/\d/.test(rest[index])) remaining--;
        index++;
    }

    return rest.slice(index).replace(/^[\s().-]+/, "");
}

let openPicker = null;

class PhoneField {
    constructor(input) {
        this.input = input;
        this.country = byIso.get(readSaved() || DEFAULT_COUNTRY);
        this.active = 0;
        this.results = [];

        // The visible box holds the local number; a hidden field carries the full +number to the server.
        this.hidden = document.createElement("input");
        this.hidden.type = "hidden";
        this.hidden.name = input.name;
        input.removeAttribute("name");

        this.wrap = document.createElement("div");
        this.wrap.className = "phone-field";
        input.before(this.wrap);

        this.button = document.createElement("button");
        this.button.type = "button";
        this.button.className = "phone-country";
        this.button.setAttribute("aria-haspopup", "listbox");
        this.button.setAttribute("aria-expanded", "false");

        this.popover = document.createElement("div");
        this.popover.className = "phone-popover";
        this.popover.hidden = true;

        this.search = document.createElement("input");
        this.search.type = "search";
        this.search.className = "phone-search";
        this.search.placeholder = "Search country or code";
        this.search.autocomplete = "off";
        this.search.setAttribute("aria-label", "Search countries");

        this.list = document.createElement("ul");
        this.list.className = "phone-list";
        this.list.setAttribute("role", "listbox");
        this.list.id = `${input.id}Countries`;
        this.search.setAttribute("aria-controls", this.list.id);

        this.popover.append(this.search, this.list);
        this.wrap.append(this.button, input, this.hidden, this.popover);

        this.button.addEventListener("click", () => (this.popover.hidden ? this.open() : this.close()));
        this.button.addEventListener("keydown", (event) => {
            if (event.key === "ArrowDown") {
                event.preventDefault();
                this.open();
            }
        });
        input.addEventListener("input", () => this.handleInput());

        // Keep the search box from triggering the form's live preview.
        this.search.addEventListener("input", (event) => {
            event.stopPropagation();
            this.filter();
        });
        this.search.addEventListener("keydown", (event) => this.handleKeys(event));
        this.list.addEventListener("click", (event) => {
            const item = event.target.closest("[data-iso]");
            if (item) this.choose(item.dataset.iso, true);
        });
        this.list.addEventListener("mousemove", (event) => {
            const item = event.target.closest("[data-index]");
            if (item) this.highlight(Number(item.dataset.index), false);
        });

        this.renderButton();
        this.sync();
    }

    renderButton() {
        const code = document.createElement("span");
        code.className = "phone-dial";
        code.textContent = `+${this.country.dial}`;

        const caret = document.createElement("span");
        caret.className = "phone-caret";
        caret.setAttribute("aria-hidden", "true");

        this.button.replaceChildren(flag(this.country.iso), code, caret);
        this.button.setAttribute("aria-label", `Country: ${this.country.name} (+${this.country.dial}). Change`);
        this.input.placeholder = this.country.iso === "BI" ? "79 000 000" : "Phone number";
    }

    handleInput() {
        const value = this.input.value.trim();

        if (/^(\+|00)/.test(value)) {
            const digits = value.replace(/^(\+|00)/, "").replace(/\D/g, "");
            const match = matchDial(digits, this.country.iso);

            if (match) {
                this.input.value = stripDial(value, match.country.dial);
                this.setCountry(match.country.iso);
            }
        } else if (/^\s/.test(this.input.value)) {
            this.input.value = this.input.value.trimStart();
        }

        this.sync();
    }

    /** Builds the international number the server expects. */
    sync() {
        let digits = this.input.value.replace(/[^\d+]/g, "");

        if (!digits) {
            this.hidden.value = "";
            return;
        }

        if (/^(\+|00)/.test(digits)) {
            this.hidden.value = `+${digits.replace(/^(\+|00)/, "").replace(/\+/g, "")}`;
            return;
        }

        digits = digits.replace(/\+/g, "");

        if (!KEEP_LEADING_ZERO.has(this.country.iso)) {
            digits = digits.replace(/^0/, "");
        }

        this.hidden.value = `+${this.country.dial}${digits}`;
    }

    setCountry(iso) {
        if (iso === this.country.iso) return;
        this.country = byIso.get(iso);
        save(iso);
        this.renderButton();
    }

    choose(iso, focusInput) {
        this.setCountry(iso);

        // Other phone fields the user hasn't filled yet follow the latest choice.
        for (const field of fields) {
            if (field !== this && !field.input.value.trim()) {
                field.setCountry(iso);
                field.sync();
            }
        }

        this.close();
        this.sync();
        // Let the form know so the preview refreshes.
        this.input.dispatchEvent(new Event("input", { bubbles: true }));
        if (focusInput) this.input.focus();
    }

    open() {
        openPicker?.close();
        openPicker = this;
        this.popover.hidden = false;
        this.button.setAttribute("aria-expanded", "true");
        this.search.value = "";
        this.filter();
        this.search.focus();
    }

    close() {
        if (this.popover.hidden) return;
        this.popover.hidden = true;
        this.button.setAttribute("aria-expanded", "false");
        if (openPicker === this) openPicker = null;
    }

    filter() {
        const query = this.search.value.trim().toLowerCase();
        const dialQuery = query.replace(/^\+/, "");

        this.results = !query ? countries : countries.filter((c) =>
            c.name.toLowerCase().includes(query)
            || c.iso.toLowerCase() === query
            || (/^\d+$/.test(dialQuery) && c.dial.startsWith(dialQuery))
        );

        const items = this.results.map((country, index) => {
            const item = document.createElement("li");
            item.className = "phone-option";
            item.id = `${this.list.id}-${country.iso}`;
            item.dataset.iso = country.iso;
            item.dataset.index = String(index);
            item.setAttribute("role", "option");
            item.setAttribute("aria-selected", String(country.iso === this.country.iso));

            const name = document.createElement("span");
            name.className = "phone-option-name";
            name.textContent = country.name;

            const dial = document.createElement("span");
            dial.className = "phone-option-dial";
            dial.textContent = `+${country.dial}`;

            item.append(flag(country.iso), name, dial);
            return item;
        });

        if (!items.length) {
            const empty = document.createElement("li");
            empty.className = "phone-empty";
            empty.textContent = "No country found";
            items.push(empty);
        }

        this.list.replaceChildren(...items);

        const current = query ? 0 : Math.max(0, this.results.indexOf(this.country));
        this.highlight(current, true);
    }

    highlight(index, scroll) {
        if (!this.results.length) {
            this.search.removeAttribute("aria-activedescendant");
            return;
        }

        this.active = Math.min(Math.max(index, 0), this.results.length - 1);
        this.list.querySelector(".is-active")?.classList.remove("is-active");

        const item = this.list.children[this.active];
        item.classList.add("is-active");
        this.search.setAttribute("aria-activedescendant", item.id);

        if (scroll) item.scrollIntoView({ block: "nearest" });
    }

    handleKeys(event) {
        const moves = { ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8 };

        if (event.key in moves) {
            event.preventDefault();
            this.highlight(this.active + moves[event.key], true);
        } else if (event.key === "Enter") {
            event.preventDefault();
            const country = this.results[this.active];
            if (country) this.choose(country.iso, true);
        } else if (event.key === "Escape") {
            event.preventDefault();
            this.close();
            this.button.focus();
        } else if (event.key === "Tab") {
            this.close();
        }
    }
}

const fields = [...document.querySelectorAll("input[data-phone]")].map((input) => new PhoneField(input));

document.addEventListener("pointerdown", (event) => {
    if (openPicker && !openPicker.wrap.contains(event.target)) {
        openPicker.close();
    }
});
