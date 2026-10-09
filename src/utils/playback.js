const { MessageFlags, ContainerBuilder, TextDisplayBuilder, EmbedBuilder } = require("discord.js");
const config = require("../../config");
const { claimDjIfNeeded } = require("./permissions");

const NODE_FAIL_COOLDOWN_MS = 10 * 60 * 1000;
const nodeCooldowns = new Map();

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

function markNodeFailed(nodeName) {
    if (!nodeName) return;
    nodeCooldowns.set(nodeName, Date.now() + NODE_FAIL_COOLDOWN_MS);
}

function isNodeOnCooldown(nodeName) {
    const until = nodeCooldowns.get(nodeName) || 0;
    if (Date.now() >= until) {
        nodeCooldowns.delete(nodeName);
        return false;
    }
    return true;
}

function reviveNodes(riffy) {
    if (!riffy || restoringNodes) return;
    restoringNodes = true;
    setTimeout(() => {
        restoringNodes = false;
    }, 5000);

    for (const cfg of config.nodes) {
        if (isNodeOnCooldown(cfg.name)) continue;

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

        // Let Riffy's own reconnect handle a live node. Forcing connect()
        // closes the websocket and freezes whoever is playing on it.
        if (existing.connected || existing.reconnectAttempt || existing.ws) continue;
        try {
            existing.connect();
        } catch (err) {
            console.error(`[euphire] Failed to reconnect node "${cfg.name}":`, err.message);
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

function getOccupiedVoiceChannel(guild, client) {
    const me = guild.members.me;
    if (me?.voice?.channel) return me.voice.channel;

    const player = client.riffy.players.get(guild.id);
    if (!player?.voiceChannel) return null;

    const channel = guild.channels.cache.get(player.voiceChannel);
    if (channel?.members?.has(client.user.id)) return channel;
    return null;
}

function buildAlreadyInUsePayload(channel) {
    const name = channel?.name || "a voice channel";
    const mention = channel?.id ? `<#${channel.id}>` : name;
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `### 🎧 I am already in this ${name}\n\n` +
            "**Channel**\n" +
            `-# ${mention}\n\n` +
            "**Why**\n" +
            "-# First come, first served. Join that voice channel, or wait until I leave."
        )
    );
    return {
        containerPayload: {
            components: [container],
            flags: MessageFlags.IsComponentsV2,
        },
        embedPayload: {
            embeds: [
                new EmbedBuilder()
                    .setColor(config.accentColor || 0x2b2d31)
                    .setTitle(`🎧 I am already in this ${name}`)
                    .setDescription(`I'm already connected to ${mention}. Join that channel, or wait until I'm not in a voice channel.`)
            ],
        },
    };
}

async function replyAlreadyInUse(interaction, channel) {
    const { containerPayload, embedPayload } = buildAlreadyInUsePayload(channel);
    try {
        if (interaction.deferred || interaction.replied) {
            return await interaction.editReply(containerPayload);
        }
        return await interaction.reply(containerPayload);
    } catch {
        try {
            if (interaction.deferred || interaction.replied) {
                return await interaction.editReply(embedPayload);
            }
            return await interaction.reply(embedPayload);
        } catch {
            return null;
        }
    }
}

async function ensurePlayer(client, { guildId, voiceChannelId, textChannelId, volume = 75, requesterId = null }) {
    let player = client.riffy.players.get(guildId);
    if (player) {
        claimDjIfNeeded(guildId, requesterId);
        player.volume = volume;
        if (textChannelId) player.textChannel = textChannelId;
        if (voiceChannelId) player.voiceChannel = voiceChannelId;
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
    claimDjIfNeeded(guildId, requesterId);
    return player;
}

function setAnnounceChannel(player, guildData, channelId) {
    if (!channelId) return;
    if (player) player.textChannel = channelId;
    if (guildData) guildData.playerChannelId = channelId;
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
    setAnnounceChannel,
    setVolumeSafe,
    reviveNodes,
    waitForNode,
    markNodeFailed,
    getOccupiedVoiceChannel,
    replyAlreadyInUse,
    buildAlreadyInUsePayload,
};
