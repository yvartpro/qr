import express from "express";
import multer from "multer";
import QRCode from "qrcode";
import sharp from "sharp";
import dotenv from "dotenv";
mport path from "path";
import crypto from "crypto";
import fs from "fs/promises";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const PUBLIC_DIR = path.join(__dirname, "public");
const GENERATED_DIR = path.join(PUBLIC_DIR, "generated");
const UPLOAD_DIR = path.join(__dirname, "uploads");

// Create required directories
await fs.mkdir(GENERATED_DIR, { recursive: true });
await fs.mkdir(UPLOAD_DIR, { recursive: true });

app.use(express.json({ limit: "1mb" }));

// Temporary image upload configuration
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

// Build QR content
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

// Generate a central icon background
function createIconBackground() {
    return Buffer.from(`
        <svg width="260" height="260" xmlns="http://www.w3.org/2000/svg">
            <rect
                x="5"
                y="5"
                width="250"
                height="250"
                rx="35"
                fill="#ffffff"
                stroke="#e5e5e5"
                stroke-width="3"
            />
        </svg>
    `);
}

// Validate SVG against active content and external references
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

// Generate QR image
async function generateQR(content, iconBuffer = null) {
    // High error correction helps QR codes remain readable
    // when a logo is placed in their center.
    const qrBuffer = await QRCode.toBuffer(content, {
        type: "png",
        width: 1000,
        margin: 4,
        errorCorrectionLevel: "H",
        color: {
            dark: "#000000",
            light: "#ffffff"
        }
    });

    let image = sharp(qrBuffer);

    if (iconBuffer) {
        const metadata = await sharp(iconBuffer).metadata();

        if (!["png", "webp", "svg"].includes(metadata.format)) {
            throw new Error("Unsupported icon format.");
        }

        const icon = await sharp(iconBuffer)
            .resize(190, 190, {
                fit: "contain",
                background: "#ffffff"
            })
            .png()
            .toBuffer();

        image = image.composite([
            {
                input: createIconBackground(),
                left: 370,
                top: 370
            },
            {
                input: icon,
                left: 405,
                top: 405
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

// API: Generate and save QR code
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

            const qrImage = await generateQR(
                qrContent,
                iconBuffer
            );

            // Unique filename
            const filename = `${crypto.randomUUID()}.jpg`;

            const filePath = path.join(
                GENERATED_DIR,
                filename
            );

            await fs.writeFile(filePath, qrImage);

            // Construct public share URL
            const baseURL = (
                process.env.BASE_URL ||
                `${req.protocol}://${req.get("host")}`
            ).replace(/\/$/, "");

            const shareURL = `${baseURL}/generated/${filename}`;

            res.status(201).json({
                success: true,
                message: "QR code generated successfully.",
                filename,
                shareURL
            });

        } catch (error) {
            console.error("QR generation error:", error);

            res.status(400).json({
                success: false,
                message: error.message || "Unable to generate QR code."
            });
        }
    }
);

// Explicitly serve the frontend
app.get("/", (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// Static files: CSS, JS and generated QR images
app.use(express.static(PUBLIC_DIR));

// General error handler
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

