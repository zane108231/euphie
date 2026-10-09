require("dotenv").config();

const http = require("http");
const { Client, GatewayIntentBits, GatewayDispatchEvents, Collection } = require("discord.js");
const { Riffy } = require("riffy");
const fs = require("fs");
const path = require("path");

const config = require("../config");
const { loadCommands } = require("./handlers/commandHandler");
const { setupPlayerHandler } = require("./handlers/playerHandler");
const { patchRiffyResolve } = require("./utils/search");

// ============================================================
// Render Health Check Web Server
// ============================================================

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
    });

    res.end("euphire is online");
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`[euphire] Web server listening on port ${PORT}`);
});

// ============================================================
// Create Discord Client
// ============================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,
    ],
});

// ============================================================
// Initialize Riffy (Multi-Lavalink)
// ============================================================

client.riffy = new Riffy(client, config.nodes, {
    send: (payload) => {
        const guild = client.guilds.cache.get(payload.d.guild_id);

        if (guild) {
            guild.shard.send(payload);
        }
    },
<<<<<<< HEAD

    defaultSearchPlatform: config.defaultSearchPlatform || "ytmsearch",
=======
    defaultSearchPlatform: config.defaultSearchPlatform || "ytsearch",
>>>>>>> 11968c0 (latest with new feautures)
    restVersion: config.restVersion || "v4",

    bypassChecks: {
        nodeFetchInfo: true,
    },
});

<<<<<<< HEAD
// ============================================================
// Load Commands
// ============================================================

=======
patchRiffyResolve(client.riffy);

// --- Load Commands ---
>>>>>>> 11968c0 (latest with new feautures)
loadCommands(client);

// ============================================================
// Load Events
// ============================================================

const eventsPath = path.join(__dirname, "events");

if (fs.existsSync(eventsPath)) {
    const eventFiles = fs
        .readdirSync(eventsPath)
        .filter((f) => f.endsWith(".js"));

    for (const file of eventFiles) {
        const event = require(path.join(eventsPath, file));

        if (event.once) {
            client.once(event.name, (...args) => {
                event.execute(client, ...args);
            });
        } else {
            client.on(event.name, (...args) => {
                event.execute(client, ...args);
            });
        }

        console.log(`[euphire] Loaded event: ${event.name}`);
    }
}

// ============================================================
// Setup Riffy Player Handler
// ============================================================

setupPlayerHandler(client);

<<<<<<< HEAD
// ============================================================
// Global Error Handlers
// ============================================================

process.on("unhandledRejection", (reason, promise) => {
    const message =
        reason && reason.message
            ? reason.message
            : String(reason || "");

    if (message.includes("Queue is empty")) {
        return;
    }

    if (message.includes("Making Node Request")) {
        console.warn(
            "[euphire] Lavalink request failed:",
            message
        );

        return;
    }

    console.error(
        "[euphire] Unhandled Rejection:",
        reason
    );
=======
// --- Global Error Handlers (prevent crashes) ---
try {
    const { Player } = require("riffy/build/structures/Player");
    const originalTrackEnd = Player.prototype.trackEnd;
    Player.prototype.trackEnd = function trackEndSafe(player, track, payload) {
        if (!track || !track.info) {
            this.playing = false;
            if (player?.queue?.length) {
                try {
                    return player.play();
                } catch {
                    return;
                }
            }
            return this.riffy.emit("queueEnd", player);
        }
        return originalTrackEnd.call(this, player, track, payload);
    };
} catch (err) {
    console.warn("[euphire] Could not patch Riffy trackEnd:", err.message);
}

process.on("unhandledRejection", (reason) => {
    const message = reason && reason.message ? reason.message : String(reason || "");
    if (message.includes("Queue is empty")) return;
    if (message.includes("Making Node Request")) {
        console.warn("[euphire] Lavalink request failed:", message);
        return;
    }
    if (message.includes("Missing 'endpoint' property")) return;
    if (message.includes("Cannot read properties of null (reading 'info')")) return;
    console.error("[euphire] Unhandled Rejection:", reason);
>>>>>>> 11968c0 (latest with new feautures)
});

process.on("uncaughtException", (error) => {
    console.error(
        "[euphire] Uncaught Exception:",
        error
    );
});

process.on("uncaughtExceptionMonitor", (error) => {
    console.error(
        "[euphire] Uncaught Exception (monitor):",
        error
    );
});

// ============================================================
// Riffy Error Safety
// ============================================================

client.riffy.on("playerError", (player, error) => {
    console.error(
        `[euphire] Player error in ${player.guildId}:`,
        error
    );
});

// ============================================================
// Forward Raw Voice State to Riffy
// ============================================================

client.on("raw", (d) => {
    if (
        ![
            GatewayDispatchEvents.VoiceStateUpdate,
            GatewayDispatchEvents.VoiceServerUpdate,
        ].includes(d.t)
    ) {
        return;
<<<<<<< HEAD
    }

    client.riffy.updateVoiceState(d);
=======
    if (d.t === GatewayDispatchEvents.VoiceServerUpdate && !d.d?.endpoint) return;
    try {
        client.riffy.updateVoiceState(d);
    } catch (err) {
        if (String(err?.message || "").includes("endpoint")) return;
        console.error("[euphire] Voice state update failed:", err.message);
    }
>>>>>>> 11968c0 (latest with new feautures)
});

// ============================================================
// Login
// ============================================================

const token = process.env.BOT_TOKEN;

if (!token) {
    console.error(
        "[euphire] BOT_TOKEN is not set in Render Environment Variables!"
    );

    process.exit(1);
}

client.login(token);
