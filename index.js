import dotenv from "dotenv";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { UserError, buildContent, chooseCorrection, normalizeUrl } from "./lib/content.js";
import { openLinkStore } from "./lib/links.js";
import {
    FORMATS,
    SIZES,
    renderQR,
    validateColors,
    validateFrameText,
    validateSVG
} from "./lib/render.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL?.replace(/\/+$/, "");

const links = openLinkStore(process.env.DB_PATH || path.join(__dirname, "data", "qr.sqlite"));
const app = express();

// nginx sits in front of the app; rate limits need the real client address.
app.set("trust proxy", 1);

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            "style-src": ["'self'", "https://fonts.googleapis.com"],
            "font-src": ["'self'", "https://fonts.gstatic.com"],
            "img-src": ["'self'", "data:", "blob:"],
            "upgrade-insecure-requests": null
        }
    }
}));

function limiter(windowMinutes, limit) {
    return rateLimit({
        windowMs: windowMinutes * 60 * 1000,
        limit,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: { success: false, message: "Too many requests. Please wait a moment and try again." }
    });
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 3 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, callback) => {
        if (!["image/png", "image/webp", "image/svg+xml"].includes(file.mimetype)) {
            return callback(new UserError("Only PNG, WebP and SVG images are allowed."));
        }

        callback(null, true);
    }
});

// Live preview sends a request after each pause in typing, so this is generous.
app.post("/api/generate", limiter(1, 200), upload.single("icon"), async (req, res, next) => {
    try {
        const {
            type = "url",
            format = "png",
            dark = "#0a3d1f",
            light = "#ffffff",
            iconShape = "square"
        } = req.body;
        const size = Number(req.body.size) || 1000;
        const frameText = typeof req.body.frameText === "string" ? req.body.frameText.trim() : "";

        if (!Object.hasOwn(FORMATS, format)) {
            throw new UserError("Unsupported download format.");
        }

        if (!SIZES.includes(size)) {
            throw new UserError("Unsupported image size.");
        }

        if (!["square", "circle"].includes(iconShape)) {
            throw new UserError("Unsupported icon shape.");
        }

        validateColors(dark, light);
        validateFrameText(frameText);

        const content = buildContent(type, req.body);
        const iconBuffer = req.file?.buffer ?? null;

        if (req.file?.mimetype === "image/svg+xml") {
            validateSVG(iconBuffer);
        }

        const { level, bytes, limit } = chooseCorrection(content, Boolean(iconBuffer));
        const image = await renderQR({
            content,
            level,
            format,
            size,
            dark,
            light,
            frameText,
            iconBuffer,
            iconShape
        });

        res.set({
            "Content-Type": FORMATS[format],
            "Cache-Control": "no-store",
            "X-QR-Bytes": String(bytes),
            "X-QR-Limit": String(limit)
        });
        res.send(image);
    } catch (error) {
        next(error);
    }
});

function bearerToken(req) {
    return req.get("authorization")?.match(/^Bearer ([\w-]{20,64})$/)?.[1] ?? null;
}

function shortUrl(req, slug) {
    return `${BASE_URL || `${req.protocol}://${req.get("host")}`}/r/${slug}`;
}

function validDestination(req, input) {
    const destination = normalizeUrl(input);
    const ownHost = new URL(shortUrl(req, "x")).host;

    if (new URL(destination).host === ownHost) {
        throw new UserError("An editable link can't point back to this site.");
    }

    return destination;
}

function requireLink(req, res, next) {
    const token = bearerToken(req);
    const details = token && links.details(token);

    if (!details) {
        return res.status(404).json({ success: false, message: "This link no longer exists." });
    }

    req.linkToken = token;
    req.linkDetails = details;
    next();
}

const linkJson = express.json({ limit: "10kb" });
const manageLimit = limiter(1, 60);

app.post("/api/links", limiter(60, 30), linkJson, (req, res, next) => {
    try {
        const { slug, token } = links.create(validDestination(req, req.body?.destination));
        const base = new URL(shortUrl(req, slug)).origin;

        res.status(201).json({
            shortUrl: shortUrl(req, slug),
            manageUrl: `${base}/manage#${token}`
        });
    } catch (error) {
        next(error);
    }
});

app.get("/api/links/me", manageLimit, requireLink, (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ ...req.linkDetails, shortUrl: shortUrl(req, req.linkDetails.slug) });
});

app.patch("/api/links/me", manageLimit, linkJson, requireLink, (req, res, next) => {
    try {
        const destination = validDestination(req, req.body?.destination);

        links.update(req.linkToken, destination);
        res.json({ destination });
    } catch (error) {
        next(error);
    }
});

app.delete("/api/links/me", manageLimit, requireLink, (req, res) => {
    links.remove(req.linkToken);
    res.status(204).end();
});

app.get("/r/:slug", limiter(1, 300), (req, res) => {
    const destination = links.destination(req.params.slug);

    if (!destination) {
        return res.status(404).sendFile(path.join(PUBLIC_DIR, "link-missing.html"));
    }

    if (req.method === "GET") {
        links.recordScan(req.params.slug);
    }

    res.set("Cache-Control", "no-store");
    res.redirect(302, destination);
});

app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

app.use((err, req, res, next) => {
    if (err instanceof UserError || err instanceof multer.MulterError) {
        const message = err.code === "LIMIT_FILE_SIZE"
            ? "The icon must be 3 MB or smaller."
            : err.message;

        return res.status(400).json({ success: false, message });
    }

    if (err.type === "entity.parse.failed" || err.type === "entity.too.large") {
        return res.status(400).json({ success: false, message: "Invalid request." });
    }

    console.error(err);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
});

app.listen(PORT, () => {
    console.log(`QR Generator running on port ${PORT}`);
});
