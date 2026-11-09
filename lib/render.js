import { readFileSync } from "fs";
import { createRequire } from "module";
import opentype from "opentype.js";
import QRCode from "qrcode";
import sharp from "sharp";
import { UserError } from "./content.js";

const require = createRequire(import.meta.url);
const fontFile = readFileSync(
    require.resolve("@fontsource/inter/files/inter-latin-700-normal.woff")
);

// Frame text is drawn as vector outlines, so it looks the same whether or not
// the server or the viewer has any fonts installed.
const font = opentype.parse(
    fontFile.buffer.slice(fontFile.byteOffset, fontFile.byteOffset + fontFile.byteLength)
);

const QUIET_ZONE = 4;
const MAX_ICON_PIXELS = 4096 * 4096;
const MIN_CONTRAST = 4.5;

export const FORMATS = {
    png: "image/png",
    jpeg: "image/jpeg",
    svg: "image/svg+xml"
};

export const SIZES = [480, 1000, 2000];

function luminance(hex) {
    const channel = (start) => {
        const value = parseInt(hex.slice(start, start + 2), 16) / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };

    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function validateColors(dark, light) {
    const hex = /^#[0-9a-f]{6}$/i;

    if (!hex.test(dark) || !hex.test(light)) {
        throw new UserError("Colors must be 6-digit hex values.");
    }

    const darkLuminance = luminance(dark);
    const lightLuminance = luminance(light);

    if (darkLuminance >= lightLuminance) {
        throw new UserError("The code color must be darker than the background, or it may not scan.");
    }

    const contrast = (lightLuminance + 0.05) / (darkLuminance + 0.05);

    if (contrast < MIN_CONTRAST) {
        throw new UserError("Those colors are too close together and may not scan. Increase the contrast.");
    }
}

export function validateFrameText(text) {
    if (text.length > 30) {
        throw new UserError("Frame text can be at most 30 characters.");
    }

    if (!/^[\x20-\x7E -ÿ]*$/.test(text)) {
        throw new UserError("Frame text can only use Latin letters, numbers and punctuation.");
    }
}

export function validateSVG(buffer) {
    const svg = buffer.toString("utf8");

    const dangerous = [
        /<script\b/i,
        /<foreignObject\b/i,
        /\bon\w+\s*=/i,
        /<!ENTITY/i,
        /<!DOCTYPE/i,
        /@import/i,
        /url\(\s*["']?\s*(?:https?:|\/\/|file:)/i,
        /(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/|file:)/i
    ];

    if (!/<svg[\s>]/i.test(svg) || dangerous.some((pattern) => pattern.test(svg))) {
        throw new UserError("Invalid or unsafe SVG image.");
    }
}

async function prepareIcon(buffer, shape) {
    const open = () => sharp(buffer, { limitInputPixels: MAX_ICON_PIXELS });

    let metadata;
    try {
        metadata = await open().metadata();
    } catch {
        throw new UserError("That icon could not be read.");
    }

    if (!["png", "webp", "svg"].includes(metadata.format)) {
        throw new UserError("Unsupported icon format.");
    }

    const side = 256;
    const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

    let image = open().resize(side, side, {
        fit: shape === "circle" ? "cover" : "contain",
        background: transparent
    });

    if (shape === "circle") {
        // Masking needs a finished bitmap, so resize before compositing.
        image = sharp(await image.png().toBuffer()).composite([{
            input: Buffer.from(
                `<svg width="${side}" height="${side}"><circle cx="${side / 2}" cy="${side / 2}" r="${side / 2}" fill="#fff"/></svg>`
            ),
            blend: "dest-in"
        }]);
    }

    return (await image.png().toBuffer()).toString("base64");
}

function modulesPath(modules) {
    let path = "";

    for (let y = 0; y < modules.size; y += 1) {
        let x = 0;

        while (x < modules.size) {
            if (!modules.get(y, x)) {
                x += 1;
                continue;
            }

            const start = x;

            while (x < modules.size && modules.get(y, x)) {
                x += 1;
            }

            path += `M${start + QUIET_ZONE} ${y + QUIET_ZONE}h${x - start}v1h${start - x}z`;
        }
    }

    return path;
}

function iconMarkup(icon, shape, canvas, background) {
    const plate = canvas * 0.176;
    const size = shape === "circle" ? canvas * 0.135 : canvas * 0.14;
    const center = canvas / 2;
    const plateMarkup = shape === "circle"
        ? `<circle cx="${center}" cy="${center}" r="${plate / 2}" fill="${background}"/>`
        : `<rect x="${center - plate / 2}" y="${center - plate / 2}" width="${plate}" height="${plate}" rx="${plate * 0.14}" fill="${background}"/>`;

    return `${plateMarkup}<image x="${center - size / 2}" y="${center - size / 2}" width="${size}" height="${size}" href="data:image/png;base64,${icon}"/>`;
}

// opentype.js's shaping throws on some of Inter's substitution tables, so
// glyphs are placed one by one instead of through font.getPath().
function textWidth(text, fontSize) {
    const scale = fontSize / font.unitsPerEm;

    return [...text].reduce((total, char) => total + font.charToGlyph(char).advanceWidth * scale, 0);
}

function textPath(text, startX, baseline, fontSize) {
    const scale = fontSize / font.unitsPerEm;
    let x = startX;
    let path = "";

    for (const char of text) {
        const glyph = font.charToGlyph(char);

        path += glyph.getPath(x, baseline, fontSize).toPathData(3);
        x += glyph.advanceWidth * scale;
    }

    return path;
}

function frameMarkup(text, canvas, band, dark, light) {
    const maxWidth = canvas * 0.88;
    const preferred = band * 0.5;
    const width = textWidth(text, preferred);
    const fontSize = width > maxWidth ? preferred * (maxWidth / width) : preferred;
    const baseline = canvas + band / 2 + fontSize * 0.36;
    const glyphs = textPath(text, (canvas - textWidth(text, fontSize)) / 2, baseline, fontSize);

    return `<rect y="${canvas}" width="${canvas}" height="${band}" fill="${dark}"/><path d="${glyphs}" fill="${light}"/>`;
}

function buildSvg({ modules, dark, light, frameText, icon, iconShape, pixelWidth }) {
    const canvas = modules.size + QUIET_ZONE * 2;
    const band = frameText ? Math.round(canvas * 0.17) : 0;
    const height = canvas + band;
    const scale = pixelWidth / canvas;

    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${pixelWidth}" height="${Math.round(height * scale)}" viewBox="0 0 ${canvas} ${height}">`,
        `<rect width="${canvas}" height="${height}" fill="${light}"/>`,
        `<path d="${modulesPath(modules)}" fill="${dark}" shape-rendering="crispEdges"/>`,
        icon ? iconMarkup(icon, iconShape, canvas, light) : "",
        frameText ? frameMarkup(frameText, canvas, band, dark, light) : "",
        "</svg>"
    ].join("");
}

export async function renderQR({
    content,
    level,
    format,
    size,
    dark,
    light,
    frameText,
    iconBuffer,
    iconShape
}) {
    const { modules } = QRCode.create(content, { errorCorrectionLevel: level });
    const icon = iconBuffer ? await prepareIcon(iconBuffer, iconShape) : null;
    const canvas = modules.size + QUIET_ZONE * 2;

    // A whole number of pixels per module keeps raster edges sharp; never go
    // below 3 so very dense codes stay readable at small sizes.
    const pixelWidth = Math.max(3, Math.floor(size / canvas)) * canvas;
    const svg = buildSvg({ modules, dark, light, frameText, icon, iconShape, pixelWidth });

    if (format === "svg") {
        return Buffer.from(svg);
    }

    const image = sharp(Buffer.from(svg)).flatten({ background: light });

    return format === "jpeg"
        ? image.jpeg({ quality: 95, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer()
        : image.png({ compressionLevel: 9 }).toBuffer();
}
