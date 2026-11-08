import express from "express";
import multer from "multer";
import QRCode from "qrcode";
import sharp from "sharp";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

app.use(express.json({ limit: "1mb" }));

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 3 * 1024 * 1024
    },
    fileFilter: (req, file, callback) => {
        const allowed = [
            "image/png",
            "image/webp",
            "image/svg+xml"
        ];

        if (!allowed.includes(file.mimetype)) {
            return callback(
                new Error("Only PNG, WebP and SVG images are allowed.")
            );
        }

        callback(null, true);
    }
});

function getQRContent(type, content) {
    if (!content || typeof content !== "string") {
        throw new Error("QR content is required.");
    }

    const value = content.trim();

    if (!value || value.length > 3000) {
        throw new Error("Content must contain 1–3000 characters.");
    }

    switch (type) {
        case "text":
        case "url":
            return value;

        case "json": {
            const parsed = JSON.parse(value);
            return JSON.stringify(parsed);
        }

        default:
            throw new Error("Unsupported QR content type.");
    }
}

function createIconBackground(size) {
    const stroke = 3;
    const inset = stroke / 2;

    return Buffer.from(`
        <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
            <circle
                cx="${size / 2}"
                cy="${size / 2}"
                r="${(size / 2) - inset}"
                fill="#ffffff"
                stroke="#e8ebe6"
                stroke-width="${stroke}"
            />
        </svg>
    `);
}

function validateSVG(buffer) {
    const svg = buffer.toString("utf8");

    const dangerous = [
        /<script\b/i,
        /<foreignObject\b/i,
        /\bon\w+\s*=/i,
        /<!ENTITY/i,
        /<!DOCTYPE/i,
        /(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/|file:)/i
    ];

    if (!/<svg[\s>]/i.test(svg) ||
        dangerous.some(pattern => pattern.test(svg))) {
        throw new Error("Invalid or unsafe SVG image.");
    }
}

async function generateQR(content, iconBuffer = null) {
    const qrSize = 1000;

    const qrBuffer = await QRCode.toBuffer(content, {
        type: "png",
        width: qrSize,
        margin: 4,
        errorCorrectionLevel: "H",
        color: {
            dark: "#14201a",
            light: "#ffffff"
        }
    });

    let image = sharp(qrBuffer);

    if (iconBuffer) {
        const metadata = await sharp(iconBuffer).metadata();

        if (!["png", "webp", "svg"].includes(metadata.format)) {
            throw new Error("Unsupported icon format.");
        }

        const plateSize = 176;
        const iconSize = 128;
        const plateLeft = Math.round((qrSize - plateSize) / 2);
        const iconLeft = Math.round((qrSize - iconSize) / 2);

        const icon = await sharp(iconBuffer)
            .resize(iconSize, iconSize, {
                fit: "cover",
                background: "#ffffff"
            })
            .composite([{
                input: Buffer.from(`
                    <svg width="${iconSize}" height="${iconSize}">
                        <circle cx="${iconSize / 2}" cy="${iconSize / 2}" r="${iconSize / 2}" fill="#fff"/>
                    </svg>
                `),
                blend: "dest-in"
            }])
            .png()
            .toBuffer();

        image = image.composite([
            {
                input: createIconBackground(plateSize),
                left: plateLeft,
                top: plateLeft
            },
            {
                input: icon,
                left: iconLeft,
                top: iconLeft
            }
        ]);
    }

    return image
        .flatten({ background: "#ffffff" })
        .jpeg({
            quality: 95,
            mozjpeg: true
        })
        .toBuffer();
}

app.post(
    "/api/generate",
    upload.single("icon"),
    async (req, res) => {
        try {
            const { type = "text", content } = req.body;
            const qrContent = getQRContent(type, content);

            let iconBuffer = null;

            if (req.file) {
                iconBuffer = req.file.buffer;

                if (req.file.mimetype === "image/svg+xml") {
                    validateSVG(iconBuffer);
                }
            }

            const qrImage = await generateQR(qrContent, iconBuffer);

            res.set({
                "Content-Type": "image/jpeg",
                "Content-Disposition": "inline; filename=\"giraso-qr.jpg\"",
                "Cache-Control": "no-store"
            });

            res.status(200).send(qrImage);
        } catch (error) {
            console.error("QR generation error:", error);

            res.status(400).json({
                success: false,
                message: error.message || "Unable to generate QR code."
            });
        }
    }
);

app.get("/", (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use(express.static(PUBLIC_DIR));

app.use((err, req, res, next) => {
    console.error(err);

    res.status(400).json({
        success: false,
        message: err.message || "An unexpected error occurred."
    });
});

app.listen(PORT, () => {
    console.log(`QR Generator running on port ${PORT}`);
});
