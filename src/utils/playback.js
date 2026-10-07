const config = require("../../config");

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isActivelyPlaying(player) {
    return Boolean(player && player.current && (player.playing || player.paused));
}

function isDuplicateTrack(player, track) {
    if (!player || !track?.info?.uri) return false;

    const inQueue = player.queue.some((existing) => existing.info?.uri === track.info.uri);
    if (inQueue) return true;

    if (isActivelyPlaying(player) && player.current.info?.uri === track.info.uri) {
        return true;
    }

    return false;
}

function markPlayerIdle(player) {
    if (!player) return;
    player.playing = false;
    player.paused = false;
    player.current = null;
}

function catchRest(promise) {
    if (promise && typeof promise.catch === "function") {
        return promise.catch(() => null);
    }
    return promise;
}

function getConnectedNode(riffy) {
    return [...riffy.nodeMap.values()].find((node) => node.connected) || null;
}

let restoringNodes = false;

function reviveNodes(riffy) {
    if (!riffy || restoringNodes) return;
    restoringNodes = true;
    setTimeout(() => {
        restoringNodes = false;
    }, 2000);

    for (const cfg of config.nodes) {
        const existing = riffy.nodeMap.get(cfg.name);
        if (!existing) {
            try {
                riffy.createNode(cfg);
                console.log(`[euphire] Restored missing Lavalink node "${cfg.name}".`);
            } catch (err) {
                console.error(`[euphire] Failed to restore node "${cfg.name}":`, err.message);
            }
            continue;
        }

        existing.reconnectAttempted = 1;
        if (existing.reconnectAttempt) {
            clearTimeout(existing.reconnectAttempt);
            existing.reconnectAttempt = null;
        }

        if (!existing.connected) {
            try {
                existing.connect();
            } catch (err) {
                console.error(`[euphire] Failed to reconnect node "${cfg.name}":`, err.message);
            }
        }
    }
}

async function waitForNode(riffy, timeoutMs = 10000) {
    let node = getConnectedNode(riffy);
    if (node) return node;

    reviveNodes(riffy);

    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        node = getConnectedNode(riffy);
        if (node) return node;
        await sleep(250);
    }

    throw new Error("No nodes are available");
}

async function ensurePlayer(client, { guildId, voiceChannelId, textChannelId, volume = 75 }) {
    let player = client.riffy.players.get(guildId);
    if (player) {
        player.volume = volume;
        if (voiceChannelId && player.voiceChannel !== voiceChannelId) {
            try {
                player.connect({
                    guildId,
                    voiceChannel: voiceChannelId,
                    deaf: true,
                });
            } catch {
                // already connected
            }
        }
        return player;
    }

    await waitForNode(client.riffy);

    player = client.riffy.createConnection({
        guildId,
        voiceChannel: voiceChannelId,
        textChannel: textChannelId,
        deaf: true,
    });
    player.volume = volume;
    return player;
}

async function startIfIdle(player) {
    if (!player) return player;
    if (player.playing || player.paused) return player;
    if (!player.queue.length) return player;

    try {
        const result = player.play();
        if (result && typeof result.catch === "function") {
            await result.catch((err) => {
                if (err?.message?.includes("Queue is empty")) return;
                console.error("[euphire] Failed to start playback:", err.message);
            });
        }
    } catch (err) {
        if (err?.message?.includes("Queue is empty")) return player;
        console.error("[euphire] Failed to start playback:", err.message);
    }

    return player;
}

function setVolumeSafe(player, volume) {
    if (!player) return;
    player.volume = volume;
    if (!player.playing && !player.paused) return;
    catchRest(
        player.node?.rest?.updatePlayer?.({
            guildId: player.guildId,
            data: { volume },
        })
    );
}

module.exports = {
    isActivelyPlaying,
    isDuplicateTrack,
    startIfIdle,
    markPlayerIdle,
    ensurePlayer,
    setVolumeSafe,
    reviveNodes,
    waitForNode,
};
