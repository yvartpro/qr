/** An error whose message is safe to show to the person using the tool. */
export class UserError extends Error {}

// Maximum bytes a QR code can hold in byte mode, by error correction level.
const CAPACITY = { H: 1273, Q: 1663, M: 2331, L: 2953 };

function field(fields, name, maxLength = 500) {
    const raw = fields[name];
    const value = typeof raw === "string" ? raw.trim() : "";

    if (value.length > maxLength) {
        throw new UserError(`"${name.replace(/^\w+_/, "")}" is too long.`);
    }

    return value;
}

function required(value, label) {
    if (!value) {
        throw new UserError(`${label} is required.`);
    }

    return value;
}

export function normalizeUrl(input) {
    const value = required(typeof input === "string" ? input.trim() : "", "A link");

    if (value.length > 2000) {
        throw new UserError("That link is too long.");
    }

    // A colon followed by a digit is a port (example.com:8080), not a scheme.
    const hasScheme = /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(value);
    const candidate = hasScheme ? value : `https://${value}`;

    let url;
    try {
        url = new URL(candidate);
    } catch {
        throw new UserError("That doesn't look like a valid link.");
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new UserError("Only http and https links are allowed.");
    }

    if (!url.hostname.includes(".") && url.hostname !== "localhost") {
        throw new UserError("That doesn't look like a valid link.");
    }

    return url.href;
}

function normalizePhone(input, label = "Phone number") {
    const value = required(input, label).replace(/[\s().-]/g, "");

    if (!/^(\+|00)[1-9]\d{6,14}$/.test(value)) {
        throw new UserError(`${label} must include the country code, like +257 79 000 000.`);
    }

    return `+${value.replace(/^(\+|00)/, "")}`;
}

function normalizeEmail(input) {
    const value = required(input, "Email address");

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        throw new UserError("That doesn't look like a valid email address.");
    }

    return value;
}

function buildWifi(fields) {
    const escape = (value) => value.replace(/([\\;,:"])/g, "\\$1");
    const ssid = required(field(fields, "wifi_ssid", 64), "Network name");
    const password = field(fields, "wifi_password", 128);
    const encryption = field(fields, "wifi_encryption", 10) || "WPA";

    if (!["WPA", "WEP", "nopass"].includes(encryption)) {
        throw new UserError("Unsupported Wi-Fi security type.");
    }

    if (encryption !== "nopass" && !password) {
        throw new UserError("Password is required for a secured network.");
    }

    const parts = [`T:${encryption}`, `S:${escape(ssid)}`];

    if (encryption !== "nopass") {
        parts.push(`P:${escape(password)}`);
    }

    if (fields.wifi_hidden) {
        parts.push("H:true");
    }

    return `WIFI:${parts.join(";")};;`;
}

function buildVCard(fields) {
    const escape = (value) => value.replace(/([\\,;])/g, "\\$1").replace(/\r?\n/g, "\\n");
    const name = required(field(fields, "vc_name", 100), "Name");
    const organization = field(fields, "vc_org", 100);
    const title = field(fields, "vc_title", 100);
    const phone = field(fields, "vc_phone", 30);
    const email = field(fields, "vc_email", 200);
    const website = field(fields, "vc_url", 500);

    const lines = [
        "BEGIN:VCARD",
        "VERSION:3.0",
        `N:${escape(name)};;;;`,
        `FN:${escape(name)}`
    ];

    if (organization) lines.push(`ORG:${escape(organization)}`);
    if (title) lines.push(`TITLE:${escape(title)}`);
    if (phone) lines.push(`TEL;TYPE=CELL:${normalizePhone(phone)}`);
    if (email) lines.push(`EMAIL:${escape(normalizeEmail(email))}`);
    if (website) lines.push(`URL:${escape(normalizeUrl(website))}`);
    lines.push("END:VCARD");

    return lines.join("\r\n");
}

/** Turns the submitted form fields into the exact string to encode. */
export function buildContent(type, fields) {
    switch (type) {
        case "url":
            return normalizeUrl(fields.url);

        case "text":
            return required(field(fields, "text", 3000), "Text");

        case "whatsapp": {
            const phone = normalizePhone(field(fields, "wa_phone", 30), "WhatsApp number");
            const message = field(fields, "wa_message", 1000);
            const query = message ? `?text=${encodeURIComponent(message)}` : "";
            return `https://wa.me/${phone.slice(1)}${query}`;
        }

        case "wifi":
            return buildWifi(fields);

        case "vcard":
            return buildVCard(fields);

        case "phone":
            return `tel:${normalizePhone(field(fields, "phone", 30))}`;

        case "email": {
            const address = normalizeEmail(field(fields, "email", 200));
            const params = [
                ["subject", field(fields, "email_subject", 200)],
                ["body", field(fields, "email_body", 1000)]
            ]
                .filter(([, value]) => value)
                .map(([key, value]) => `${key}=${encodeURIComponent(value)}`);

            return `mailto:${address}${params.length ? `?${params.join("&")}` : ""}`;
        }

        case "sms": {
            const phone = normalizePhone(field(fields, "sms_phone", 30));
            return `SMSTO:${phone}:${field(fields, "sms_message", 1000)}`;
        }

        default:
            throw new UserError("Unsupported QR content type.");
    }
}

/**
 * Picks the strongest error correction the content fits in. An icon covers
 * part of the code, so it always needs level H.
 */
export function chooseCorrection(content, hasIcon) {
    const bytes = Buffer.byteLength(content, "utf8");

    if (hasIcon) {
        if (bytes > CAPACITY.H) {
            throw new UserError(
                `Too long to use with an icon (${bytes} of ${CAPACITY.H} bytes). Shorten it or remove the icon.`
            );
        }

        return { level: "H", bytes, limit: CAPACITY.H };
    }

    if (bytes > CAPACITY.L) {
        throw new UserError(`Too long for a QR code (${bytes} of ${CAPACITY.L} bytes).`);
    }

    const level = ["H", "Q", "M", "L"].find((name) => bytes <= CAPACITY[name]);

    return { level, bytes, limit: CAPACITY.L };
}
