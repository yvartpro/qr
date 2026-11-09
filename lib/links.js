import { createHash, randomBytes } from "crypto";
import { mkdirSync } from "fs";
import path from "path";
import Database from "better-sqlite3";

const hashToken = (token) => createHash("sha256").update(token).digest("hex");
const today = () => new Date().toISOString().slice(0, 10);

export function openLinkStore(file) {
    mkdirSync(path.dirname(file), { recursive: true });

    const db = new Database(file);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    db.exec(`
        CREATE TABLE IF NOT EXISTS links (
            slug TEXT PRIMARY KEY,
            token_hash TEXT NOT NULL UNIQUE,
            destination TEXT NOT NULL,
            scans INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            last_scan_at TEXT
        );

        CREATE TABLE IF NOT EXISTS daily_scans (
            slug TEXT NOT NULL REFERENCES links(slug) ON DELETE CASCADE,
            day TEXT NOT NULL,
            scans INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (slug, day)
        );
    `);

    const insert = db.prepare(
        "INSERT INTO links (slug, token_hash, destination, created_at) VALUES (?, ?, ?, ?)"
    );
    const findBySlug = db.prepare("SELECT destination FROM links WHERE slug = ?");
    const findByToken = db.prepare("SELECT * FROM links WHERE token_hash = ?");
    const updateDestination = db.prepare("UPDATE links SET destination = ? WHERE token_hash = ?");
    const remove = db.prepare("DELETE FROM links WHERE token_hash = ?");
    const countScan = db.prepare("UPDATE links SET scans = scans + 1, last_scan_at = ? WHERE slug = ?");
    const countDay = db.prepare(`
        INSERT INTO daily_scans (slug, day, scans) VALUES (?, ?, 1)
        ON CONFLICT (slug, day) DO UPDATE SET scans = scans + 1
    `);
    const recentScans = db.prepare(
        "SELECT COALESCE(SUM(scans), 0) AS total FROM daily_scans WHERE slug = ? AND day >= ?"
    );

    const recordScan = db.transaction((slug) => {
        countScan.run(new Date().toISOString(), slug);
        countDay.run(slug, today());
    });

    return {
        create(destination) {
            const slug = randomBytes(5).toString("base64url");
            const token = randomBytes(24).toString("base64url");

            insert.run(slug, hashToken(token), destination, new Date().toISOString());

            return { slug, token };
        },

        destination(slug) {
            return findBySlug.get(slug)?.destination ?? null;
        },

        recordScan,

        details(token) {
            const link = findByToken.get(hashToken(token));

            if (!link) {
                return null;
            }

            const since = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);

            return {
                slug: link.slug,
                destination: link.destination,
                scans: link.scans,
                scansLast30Days: recentScans.get(link.slug, since).total,
                createdAt: link.created_at,
                lastScanAt: link.last_scan_at
            };
        },

        update(token, destination) {
            return updateDestination.run(destination, hashToken(token)).changes > 0;
        },

        remove(token) {
            return remove.run(hashToken(token)).changes > 0;
        }
    };
}
