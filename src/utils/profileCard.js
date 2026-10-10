const path = require("path");
const fs = require("fs");
const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");

// ---------------------------------------------------------------------------
// Font
// The template uses a chunky, rounded bold font. Drop one of these files into a
// "fonts" folder next to this file and it will be picked up automatically.
// Recommended: Nunito ExtraBold/Black or Fredoka Bold (both free on Google Fonts).
// ---------------------------------------------------------------------------
const FONT_DIR = path.join(__dirname, "fonts");
const FONT_CANDIDATES = [
    "Nunito-Black.ttf",
    "Nunito-ExtraBold.ttf",
    "Nunito-Bold.ttf",
    "Fredoka-Bold.ttf",
    "Fredoka-SemiBold.ttf",
    "Quicksand-Bold.ttf",
];
let FONT_FAMILY = "Arial";
(function registerFont() {
    for (const file of FONT_CANDIDATES) {
        const p = path.join(FONT_DIR, file);
        if (fs.existsSync(p)) {
            try {
                GlobalFonts.registerFromPath(p, "CardFont");
                FONT_FAMILY = '"CardFont"';
                return;
            } catch (_) {
                /* try next */
            }
        }
    }
})();
const font = (size) => `bold ${size}px ${FONT_FAMILY}, sans-serif`;

// ---------------------------------------------------------------------------
// Layout (1024 wide; tracks card stacks 3 rows so the canvas is taller)
// ---------------------------------------------------------------------------
const WIDTH = 1024;
const HEIGHT = 658;
const CARD_RADIUS = 24;
const CARDS = {
    servers: { x: 52, y: 152, w: 445, h: 216 },
    friends: { x: 527, y: 152, w: 445, h: 216 },
    tracks: { x: 52, y: 393, w: 920, h: 216 },
};

/**
 * Format milliseconds to human-readable duration
 */
function formatDuration(ms) {
    if (!ms || ms < 0) return "0m";

    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (days > 0) {
        if (hours > 0) {
            return `${days}d ${hours}h`;
        }
        return `${days}d`;
    }
    if (hours > 0) {
        if (minutes > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${hours}h`;
    }
    if (minutes > 0) {
        if (seconds > 0) {
            return `${minutes}m ${seconds}s`;
        }
        return `${minutes}m`;
    }
    return `${seconds}s`;
}

/**
 * Load an image from URL
 */
async function loadImageFromURL(url) {
    try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        return await loadImage(buffer);
    } catch (err) {
        throw new Error(`Failed to load image from ${url}: ${err.message}`);
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

/** Truncate text with ellipsis (uses the current ctx.font) */
function truncateText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let truncated = text;
    while (truncated.length > 0 && ctx.measureText(truncated + "...").width > maxWidth) {
        truncated = truncated.slice(0, -1);
    }
    return truncated.trimEnd() + "...";
}

/** Largest font size (<= start, >= min) at which text fits in maxWidth */
function fitFontSize(ctx, text, maxWidth, start, min) {
    let size = start;
    ctx.font = font(size);
    while (size > min && ctx.measureText(text).width > maxWidth) {
        size -= 1;
        ctx.font = font(size);
    }
    return size;
}

/** White text with a soft glow */
function drawGlowText(ctx, text, x, y, blur = 8) {
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = blur;
    ctx.fillText(text, x, y);
    ctx.restore();
}

/** Black fill, white glowing outline - used by all line-art icons */
function neon(ctx, lineWidth, blur) {
    ctx.fillStyle = "#000000";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = blur;
}

// ---------------------------------------------------------------------------
// Drawing pieces
// ---------------------------------------------------------------------------
function drawBackground(ctx) {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // very subtle lighter centre like the template
    const g = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, 60, WIDTH / 2, HEIGHT / 2, WIDTH * 0.7);
    g.addColorStop(0, "rgba(40,40,40,0.55)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function drawCard(ctx, card) {
    // dark fill first, then the glowing outline on top
    roundRectPath(ctx, card.x, card.y, card.w, card.h, CARD_RADIUS);
    ctx.fillStyle = "#050505";
    ctx.fill();

    ctx.save();
    ctx.strokeStyle = "#ffffff";
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 18;
    ctx.lineWidth = 3;
    roundRectPath(ctx, card.x, card.y, card.w, card.h, CARD_RADIUS);
    ctx.stroke();
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.restore();
}

function drawCardTitle(ctx, card, title) {
    ctx.font = font(34);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    drawGlowText(ctx, title, card.x + 26, card.y + 52, 12);
}

/** Rounded-square rank badge. (x, cy) = left edge, vertical centre */
function drawRankBadge(ctx, x, cy, rank) {
    const size = 26;
    const top = cy - size / 2;

    roundRectPath(ctx, x, top, size, size, 7);
    ctx.fillStyle = "#000000";
    ctx.fill();

    ctx.save();
    ctx.strokeStyle = "#ffffff";
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 8;
    ctx.lineWidth = 2;
    roundRectPath(ctx, x, top, size, size, 7);
    ctx.stroke();
    ctx.restore();

    ctx.font = font(17);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(String(rank), x + size / 2, cy + 1);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
}

/** One "badge  time · label" row for servers / friends */
function drawListRow(ctx, card, rowCenterY, rank, time, label) {
    const badgeX = card.x + 26;
    const textX = badgeX + 40;
    drawRankBadge(ctx, badgeX, rowCenterY, rank);

    ctx.font = font(27);
    const prefix = `${time} · `;
    const prefixWidth = ctx.measureText(prefix).width;
    const maxLabelWidth = card.x + card.w - 24 - textX - prefixWidth;
    const text = prefix + truncateText(ctx, label, maxLabelWidth);

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    drawGlowText(ctx, text, textX, rowCenterY + 9, 6);
}

function drawEmpty(ctx, card, rowCenterY) {
    ctx.font = font(22);
    ctx.fillStyle = "#666666";
    ctx.textAlign = "left";
    ctx.fillText("No data yet", card.x + 26, rowCenterY + 8);
}

/** Top tracks: one row per track, stacked like the servers/friends cards */
function drawTrackRows(ctx, card, tracks) {
    const offsets = [93, 135, 176];
    const items = tracks.slice(0, 3);
    items.forEach((t, i) => {
        drawListRow(
            ctx,
            card,
            card.y + offsets[i],
            i + 1,
            formatDuration(t.listening_ms),
            String(t.track_title || "Unknown Track")
        );
    });
    if (items.length === 0) drawEmpty(ctx, card, card.y + offsets[0]);
}

// ---------------------------------------------------------------------------
// Line-art decorations
// ---------------------------------------------------------------------------
function drawHeadphones(ctx, x, y, s, rot = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    neon(ctx, Math.max(2, s * 0.06), s * 0.3);

    const r = s * 0.36;
    const cw = s * 0.24;
    const ch = s * 0.44;

    // headband (double line for thickness)
    ctx.beginPath();
    ctx.arc(0, 0, r, Math.PI, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r - s * 0.07, Math.PI, 0);
    ctx.stroke();

    // ear cups
    for (const side of [-1, 1]) {
        roundRectPath(ctx, side * r - cw / 2, -s * 0.02, cw, ch, cw * 0.4);
        ctx.fill();
        ctx.stroke();
    }
    ctx.restore();
}

function drawNote(ctx, x, y, s, rot = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    neon(ctx, Math.max(2, s * 0.07), s * 0.3);

    const hx = -s * 0.1;
    const hy = s * 0.32;
    const stemX = hx + s * 0.17;

    // stem
    ctx.beginPath();
    ctx.moveTo(stemX, hy);
    ctx.lineTo(stemX, -s * 0.5);
    ctx.stroke();

    // flag
    ctx.beginPath();
    ctx.moveTo(stemX, -s * 0.5);
    ctx.bezierCurveTo(stemX, -s * 0.2, hx + s * 0.55, -s * 0.25, hx + s * 0.45, s * 0.05);
    ctx.stroke();

    // head
    ctx.beginPath();
    ctx.ellipse(hx, hy, s * 0.2, s * 0.14, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
}

function drawDoubleNote(ctx, x, y, s, rot = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    neon(ctx, Math.max(2, s * 0.07), s * 0.3);

    const h1 = { x: -s * 0.3, y: s * 0.38 };
    const h2 = { x: s * 0.3, y: s * 0.28 };
    const s1 = h1.x + s * 0.17;
    const s2 = h2.x + s * 0.17;
    const t1 = -s * 0.38;
    const t2 = -s * 0.5;

    // stems
    ctx.beginPath();
    ctx.moveTo(s1, h1.y);
    ctx.lineTo(s1, t1);
    ctx.moveTo(s2, h2.y);
    ctx.lineTo(s2, t2);
    ctx.stroke();

    // beam
    ctx.beginPath();
    ctx.moveTo(s1, t1);
    ctx.lineTo(s2, t2);
    ctx.lineTo(s2, t2 + s * 0.16);
    ctx.lineTo(s1, t1 + s * 0.16);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // heads
    for (const h of [h1, h2]) {
        ctx.beginPath();
        ctx.ellipse(h.x, h.y, s * 0.2, s * 0.14, -0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }
    ctx.restore();
}

/** Vertical "sound wave" bars */
function drawBars(ctx, x, cy, heights, gap, alpha = 0.55) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "#ffffff";
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 8;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    heights.forEach((h, i) => {
        const bx = x + i * gap;
        ctx.beginPath();
        ctx.moveTo(bx, cy - h / 2);
        ctx.lineTo(bx, cy + h / 2);
        ctx.stroke();
    });
    ctx.restore();
}

function drawDecorations(ctx) {
    // sound waves (behind cards' glow, so draw before icons)
    drawBars(ctx, 8, 285, [50, 100, 150, 100, 50], 8);
    drawBars(ctx, 984, 285, [50, 100, 150, 100, 50], 8);
    drawBars(ctx, 507, 270, [50, 85, 50], 7, 0.45);

    // icons around the header
    drawHeadphones(ctx, 388, 40, 40, 0.05);
    drawDoubleNote(ctx, 485, 44, 32, 0.1);
    drawNote(ctx, 427, 88, 22, 0.15);
    drawNote(ctx, 32, 132, 30, -0.25);

    // icons overlapping the card corners
    drawDoubleNote(ctx, 468, 145, 62, 0);
    drawHeadphones(ctx, 962, 165, 76, 0.1);
    drawHeadphones(ctx, 972, 362, 52, 0);
    drawNote(ctx, 34, 382, 32, -0.2);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
/**
 * Generate profile card matching the template.
 * Same signature and data fields as before:
 *   topServers: [{ guild_id, listening_ms }]
 *   topFriends: [{ friend_id, total_shared_ms }]
 *   topTracks:  [{ track_title, listening_ms }]
 */
async function generateProfileCard(user, stats, topServers, topFriends, topTracks, client) {
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext("2d");

    drawBackground(ctx);

    // Avatar (circle with glowing white ring)
    const avatarCX = 88;
    const avatarCY = 82;
    const avatarR = 38;
    const avatarUrl = user.displayAvatarURL({ extension: "png", size: 256 });
    try {
        const avatar = await loadImageFromURL(avatarUrl);
        ctx.save();
        ctx.beginPath();
        ctx.arc(avatarCX, avatarCY, avatarR, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(avatar, avatarCX - avatarR, avatarCY - avatarR, avatarR * 2, avatarR * 2);
        ctx.restore();
    } catch (err) {
        ctx.fillStyle = "#000000";
        ctx.beginPath();
        ctx.arc(avatarCX, avatarCY, avatarR, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.save();
    ctx.strokeStyle = "#ffffff";
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 18;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(avatarCX, avatarCY, avatarR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Username
    const displayName = user.displayName || user.username;
    const nameSize = fitFontSize(ctx, displayName, 220, 46, 26);
    ctx.font = font(nameSize);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    drawGlowText(ctx, truncateText(ctx, displayName, 220), 145, avatarCY + nameSize * 0.35, 14);

    // Cards
    drawCard(ctx, CARDS.servers);
    drawCard(ctx, CARDS.friends);
    drawCard(ctx, CARDS.tracks);

    drawCardTitle(ctx, CARDS.servers, "TOP SERVERS");
    drawCardTitle(ctx, CARDS.friends, "TOP FRIENDS");
    drawCardTitle(ctx, CARDS.tracks, "TOP TRACKS");

    const rowOffsets = [93, 135, 176];

    // TOP SERVERS
    const servers = topServers.slice(0, 3);
    servers.forEach((server, i) => {
        const guild = client.guilds.cache.get(server.guild_id);
        const name = guild ? guild.name : "Unknown Server";
        drawListRow(ctx, CARDS.servers, CARDS.servers.y + rowOffsets[i], i + 1,
            formatDuration(server.listening_ms), name);
    });
    if (servers.length === 0) drawEmpty(ctx, CARDS.servers, CARDS.servers.y + rowOffsets[0]);

    // TOP FRIENDS
    const friends = topFriends.slice(0, 3);
    const friendUsers = await Promise.all(
        friends.map((f) => client.users.fetch(f.friend_id).catch(() => null))
    );
    friends.forEach((friend, i) => {
        const fu = friendUsers[i];
        const name = fu ? fu.displayName || fu.username : "Unknown";
        drawListRow(ctx, CARDS.friends, CARDS.friends.y + rowOffsets[i], i + 1,
            formatDuration(friend.total_shared_ms), name);
    });
    if (friends.length === 0) drawEmpty(ctx, CARDS.friends, CARDS.friends.y + rowOffsets[0]);

    // TOP TRACKS
    drawTrackRows(ctx, CARDS.tracks, topTracks);

    // Decorations last so icons sit over the card borders
    drawDecorations(ctx);

    return canvas.toBuffer("image/png");
}

module.exports = {
    generateProfileCard,
    formatDuration,
};