const { MessageFlags, AttachmentBuilder, ContainerBuilder, TextDisplayBuilder, EmbedBuilder } = require("discord.js");
const { getGuildData, clearUpdateInterval } = require("../utils/playerStore");
const { createNowPlayingContainer, createChatPlayIdleContainer, createChatPlayNowPlayingContainer, safeArtworkUrl } = require("../utils/components");
const { generateMusicCard } = require("../utils/musicard");
const { recordIncident } = require("../utils/incidents");
const { scheduleStatusUpdate } = require("../services/statusMonitor");
const { markPlayerIdle, reviveNodes, markNodeFailed } = require("../utils/playback");
const { resetSessionPermissions } = require("../utils/permissions");
const { getPrefix } = require("../utils/prefixStore");
const config = require("../../config");

const UPDATE_INTERVAL_MS = 15 * 1000; // 15 seconds
const LAVALINK_RECONNECT_INTERVAL_MS = 30 * 60 * 1000;
const NODE_RESTORE_DELAY_MS = 10 * 60 * 1000;
let lavalinkReconnectTimer = null;

function refreshLavalinkNodes(client) {
    if (!client?.riffy?.initiated) return;

    for (const configNode of config.nodes) {
        const node = client.riffy.nodeMap.get(configNode.name);

        if (!node) {
            reviveNodes(client.riffy);
            continue;
        }

        if (node.connected || node.reconnectAttempt || node.ws) continue;

        node.connect();
        console.log(`[euphire] Reconnecting Lavalink node "${configNode.name}".`);
    }
}

function startLavalinkReconnectMonitor(client) {
    if (lavalinkReconnectTimer) clearInterval(lavalinkReconnectTimer);

    lavalinkReconnectTimer = setInterval(() => {
        const needsWork = config.nodes.some((cfg) => {
            const node = client.riffy.nodeMap.get(cfg.name);
            return !node || !node.connected;
        });
        if (!needsWork) return;
        console.log("[euphire] A Lavalink node is down — reconnecting backups...");
        refreshLavalinkNodes(client);
    }, LAVALINK_RECONNECT_INTERVAL_MS);
}

/**
 * Helper: edit the existing player message or send a new one (never duplicates)
 */
function isMissingPermissions(err) {
    const code = err?.code;
    const msg = String(err?.message || "");
    return code === 50013 || msg.includes("Missing Permissions") || msg.includes("Missing Access");
}

async function sendQueueEmptyNotice(channel, guildId) {
    if (!channel) return;
    const prefix = getPrefix(guildId);
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            "### 📭 There are no more tracks\n\n" +
            "**Queue**\n" +
            "-# The last song finished and nothing else is queued.\n\n" +
            "**Status**\n" +
            "-# Nothing is playing right now.\n\n" +
            "**Play again**\n" +
            `-# \`${prefix}play <song name>\``
        )
    );

    try {
        await channel.send({
            components: [container],
            flags: MessageFlags.IsComponentsV2,
        });
        return;
    } catch {
        // Components V2 may be blocked — fall back to a classic embed
    }

    try {
        const { EmbedBuilder } = require("discord.js");
        await channel.send({
            embeds: [
                new EmbedBuilder()
                    .setColor(config.accentColor || 0x2b2d31)
                    .setTitle("📭 There are no more tracks")
                    .setDescription("The queue has ended. Nothing is playing right now.")
                    .setFooter({ text: `Use ${prefix}play to start another song` }),
            ],
        });
    } catch {
        // Channel has no send permission
    }
}

async function editOrSendPlayerMessage(client, guildData, channelId, container, files) {
    if (guildData.cannotSendPlayer) return;

    const channel = client.channels.cache.get(channelId);
    if (!channel) {
        // Channel no longer exists; clear stale IDs
        guildData.chatPlayMessageId = null;
        guildData.playerMessageId = null;
        guildData.playerChannelId = null;
        return;
    }

    const messageId = guildData.playerMessageId;

    if (messageId) {
        try {
            const msg = await channel.messages.fetch(messageId);
            await msg.edit({
                components: [container],
                files: files,
                flags: MessageFlags.IsComponentsV2,
            });
            return;
        } catch (err) {
            if (isMissingPermissions(err)) {
                guildData.cannotSendPlayer = true;
                clearUpdateInterval(guildData);
                return;
            }
            // Message or channel no longer exists — clear stale IDs and send a new one
            guildData.chatPlayMessageId = null;
            guildData.playerMessageId = null;
            guildData.playerChannelId = null;
            guildData.updateInterval && clearInterval(guildData.updateInterval);
            guildData.updateInterval = null;
        }
    }

    try {
        const newMsg = await channel.send({
            components: [container],
            files: files,
            flags: MessageFlags.IsComponentsV2,
        });

        guildData.playerMessageId = newMsg.id;
        guildData.playerChannelId = channel.id;
    } catch (sendErr) {
        if (isMissingPermissions(sendErr)) {
            guildData.cannotSendPlayer = true;
            clearUpdateInterval(guildData);
            return;
        }
        console.error("[euphire] Failed to send player message:", sendErr.message);
    }
}

function canSendToChannel(channel) {
    return Boolean(channel && typeof channel.send === "function");
}

function resolveNowPlayingChannel(client, player, guildData) {
    const ids = [
        player?.textChannel,
        guildData?.playerChannelId,
        player?.voiceChannel,
    ].filter(Boolean);

    const seen = new Set();
    for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        const channel = client.channels.cache.get(id);
        if (canSendToChannel(channel)) return channel;
    }
    return null;
}

function requesterMention(track) {
    const requester = track?.info?.requester;
    const id = requester?.id || (typeof requester === "string" ? requester : null);
    return id ? `<@${id}>` : "Unknown";
}

function buildNowPlayingEmbedPayload(track, files) {
    const title = (track?.info?.title || "Unknown").substring(0, 256);
    const author = track?.info?.author || "Unknown Artist";
    const embed = new EmbedBuilder()
        .setColor(config.accentColor || 0x2b2d31)
        .setTitle(`Now Playing — ${title}`)
        .setDescription(`By ${author}\nRequested by ${requesterMention(track)}`)
        .setThumbnail(safeArtworkUrl(track));
    if (files?.length) {
        embed.setImage("attachment://musicard.png");
    }
    return { embeds: [embed], files: files || [] };
}

async function sendNowPlayingPayload(channel, container, files, track) {
    try {
        return await channel.send({
            components: [container],
            files: files,
            flags: MessageFlags.IsComponentsV2,
        });
    } catch (err) {
        console.error("[euphire] Now playing (components) failed:", err.message);
    }

    try {
        return await channel.send(buildNowPlayingEmbedPayload(track, files));
    } catch (err) {
        console.error("[euphire] Now playing (embed) failed:", err.message);
    }

    try {
        const title = track?.info?.title || "Unknown";
        const author = track?.info?.author || "Unknown Artist";
        return await channel.send({
            content: `**Now Playing — ${title}**\nBy ${author}\nRequested by ${requesterMention(track)}`,
            files: files?.length ? files : undefined,
        });
    } catch (err) {
        console.error("[euphire] Now playing (text) failed:", err.message);
        return null;
    }
}

/**
 * Always post a new now-playing card in the play/skip text channel
 * (or the voice channel chat) so people can see the current track.
 */
async function announceNowPlaying(client, player, track, guildData) {
    const musicardBuffer = await generateMusicCard(track, player, guildData);
    const files = [];
    if (musicardBuffer) {
        files.push(new AttachmentBuilder(musicardBuffer, { name: "musicard.png" }));
    }

    const container = createNowPlayingContainer(track, player, guildData, musicardBuffer);
    const channel = resolveNowPlayingChannel(client, player, guildData);

    if (!channel) {
        console.warn(`[euphire] No channel available to send now playing for guild ${player.guildId}`);
        return;
    }

    const newMsg = await sendNowPlayingPayload(channel, container, files, track);
    if (!newMsg) return;

    const oldId = guildData.playerMessageId;
    const oldChannelId = guildData.playerChannelId;
    guildData.playerMessageId = newMsg.id;
    guildData.playerChannelId = channel.id;
    guildData.cannotSendPlayer = false;

    if (oldId && oldId !== newMsg.id) {
        const oldChannel = client.channels.cache.get(oldChannelId) || channel;
        oldChannel?.messages?.fetch(oldId).then((msg) => msg.delete()).catch(() => {});
    }

    if (guildData.chatPlayChannelId && guildData.chatPlayMessageId) {
        try {
            const chatChannel = client.channels.cache.get(guildData.chatPlayChannelId);
            const chatContainer = createChatPlayNowPlayingContainer(track, player, guildData, musicardBuffer);
            if (chatChannel && guildData.chatPlayMessageId !== newMsg.id) {
                const chatMsg = await chatChannel.messages.fetch(guildData.chatPlayMessageId);
                await chatMsg.edit({
                    components: [chatContainer],
                    files: files,
                    flags: MessageFlags.IsComponentsV2,
                });
            }
        } catch {
            // ChatPlay panel is optional; the public now-playing already posted
        }
    }
}

/**
 * Refresh the player message with an updated musicard image
 */
async function refreshPlayerMessage(client, guildId) {
    try {
        const player = client.riffy.players.get(guildId);
        if (!player || !player.current) return;

        const guildData = getGuildData(guildId);
        if (guildData.cannotSendPlayer) return;
        const track = player.current;

        const musicardBuffer = await generateMusicCard(track, player, guildData);
        const container = createNowPlayingContainer(track, player, guildData, musicardBuffer);

        const files = [];
        if (musicardBuffer) {
            files.push(new AttachmentBuilder(musicardBuffer, { name: "musicard.png" }));
        }

        const channelId = guildData.playerChannelId || player.textChannel;
        await editOrSendPlayerMessage(client, guildData, channelId, container, files);
    } catch (error) {
        console.error("[euphire] Auto-update error:", error);
    }
}

/**
 * Start the 15-second auto-update interval for a guild
 */
function startUpdateInterval(client, guildId) {
    const guildData = getGuildData(guildId);

    // Clear any existing interval first
    clearUpdateInterval(guildData);

    guildData.updateInterval = setInterval(() => {
        refreshPlayerMessage(client, guildId);
    }, UPDATE_INTERVAL_MS);
}

/**
 * Set up all riffy player event handlers
 */
function setupPlayerHandler(client) {
    if (!client.riffy) {
        console.warn('[euphire] Riffy client not initialized; player handlers not attached.');
        return;
    }
    // --- Node Connected ---
    client.riffy.on("nodeConnect", (node) => {
        console.log(`[euphire] Lavalink node "${node.name}" connected.`);
        scheduleStatusUpdate(client, true);
    });

    // --- Node Error ---
    client.riffy.on("nodeError", (node, error) => {
        console.error(`[euphire] Node "${node.name}" error:`, error.message);
        recordIncident("Lavalink", `Node error: ${error.message.substring(0, 50)}`);
        scheduleStatusUpdate(client, true);
        if (String(error?.message || "").includes("after") && String(error.message).includes("attempts")) {
            markNodeFailed(node.name);
        }
    });

    client.riffy.on("nodeDestroy", (node) => {
        markNodeFailed(node.name);
        console.warn(`[euphire] Node "${node.name}" was removed. Will retry that backup later, not during playback.`);
        setTimeout(() => reviveNodes(client.riffy), NODE_RESTORE_DELAY_MS);
    });

    // --- Node Disconnect ---
    client.riffy.on("nodeDisconnect", (node) => {
        console.warn(`[euphire] Node "${node.name}" disconnected.`);
        recordIncident("Lavalink", "Node disconnected");
        scheduleStatusUpdate(client, true);
    });

    // --- Node Reconnected (Riffy built-in auto-reconnect) ---
    client.riffy.on("nodeReconnect", (node) => {
        console.log(`[euphire] Node "${node.name}" reconnected successfully.`);
        scheduleStatusUpdate(client, true);
    });

    startLavalinkReconnectMonitor(client);

    // --- Track Start ---
    client.riffy.on("trackStart", async (player, track) => {
        try {
            const guildData = getGuildData(player.guildId);
            guildData.cannotSendPlayer = false;

            // Save the previous track for the "Previous" button
            if (player.previous) {
                guildData.previousTracks.push(player.previous);
                // Keep history limited to 20 tracks to prevent memory bloat
                if (guildData.previousTracks.length > 20) {
                    guildData.previousTracks.shift();
                }
            }

            // Clear any idle timeout
            if (guildData.idleTimeout) {
                clearTimeout(guildData.idleTimeout);
                guildData.idleTimeout = null;
            }

            // Start voice channel monitoring
            startVoiceChannelMonitoring(client, player.guildId);

            await announceNowPlaying(client, player, track, guildData);

            // Start 15-second auto-update interval
            startUpdateInterval(client, player.guildId);

            // Fetch suggestions for the dropdown
            try {
                const searchQuery = `${track.info.author} ${track.info.title}`;
                const result = await client.riffy.resolve({
                    query: searchQuery,
                    requester: track.info.requester,
                });
                if (result.tracks && result.tracks.length > 1) {
                    guildData.suggestions = result.tracks
                        .filter((t) => t.info.uri !== track.info.uri)
                        .slice(0, 10);
                }
            } catch (err) {
                console.error("[euphire] Failed to fetch suggestions:", err.message);
            }
        } catch (error) {
            console.error("[euphire] trackStart error:", error);
        }
    });

    // --- Queue End ---
    client.riffy.on("queueEnd", async (player) => {
        try {
            const guildData = getGuildData(player.guildId);

            // Stop the auto-update interval
            clearUpdateInterval(guildData);

            if (guildData.autoplay) {
                player.autoplay(player);
                return;
            }

            // Riffy leaves player.current on the finished track. Clear it so
            // the next !play starts playback instead of only enqueueing.
            markPlayerIdle(player);

            // 24/7 mode: stay in VC, just update the message
            const stayInVC = guildData.twentyFourSeven;

            // If this is a ChatPlay session, edit the message to idle state
            if (guildData.chatPlayChannelId && guildData.chatPlayMessageId) {
                const container = createChatPlayIdleContainer();
                const channel = client.channels.cache.get(guildData.chatPlayChannelId);
                if (channel) {
                    try {
                        const msg = await channel.messages.fetch(guildData.chatPlayMessageId);
                        await msg.edit({
                            components: [container],
                            attachments: [],
                            flags: MessageFlags.IsComponentsV2,
                        });
                    } catch (err) {
                        // message deleted
                    }
                }
            } else if (guildData.playerMessageId && guildData.playerChannelId) {
                // For regular play: delete the old now-playing card, then announce idle
                const channel = client.channels.cache.get(guildData.playerChannelId);
                try {
                    if (channel) {
                        const msg = await channel.messages.fetch(guildData.playerMessageId);
                        await msg.delete();
                    }
                } catch (err) {
                    // message already deleted
                }
                await sendQueueEmptyNotice(channel, player.guildId);
                guildData.playerMessageId = null;
                guildData.playerChannelId = null;
            } else {
                const channelId = player.textChannel;
                const channel = channelId ? client.channels.cache.get(channelId) : null;
                await sendQueueEmptyNotice(channel, player.guildId);
            }

            // If NOT 24/7, disconnect after a delay
            if (!stayInVC) {
                // Clear existing timeout if any
                if (guildData.idleTimeout) clearTimeout(guildData.idleTimeout);
                
                guildData.idleTimeout = setTimeout(() => {
                    try {
                        const currentPlayer = client.riffy.players.get(player.guildId);
                        // Check if player exists and is not actively playing
                        if (currentPlayer && !currentPlayer.playing && !currentPlayer.paused) {
                            currentPlayer.destroy();
                        }
                    } catch (err) {
                        // player already destroyed
                    }
                    guildData.idleTimeout = null;
                }, 30000); // 30s idle timeout
            }

            // Clear suggestions
            guildData.suggestions = [];
        } catch (error) {
            console.error("[euphire] queueEnd error:", error);
        }
    });

    // --- Player Disconnect ---
    client.riffy.on("playerDisconnect", async (player) => {
        const guildData = getGuildData(player.guildId);
        if (guildData.recreatingPlayer) return;

        clearUpdateInterval(guildData);
        stopVoiceChannelMonitoring(player.guildId);
        
        // Reset ChatPlay to idle if active (safety net for force disconnects)
        if (guildData.chatPlayChannelId && guildData.chatPlayMessageId) {
            try {
                const { createChatPlayIdleContainer } = require("../utils/components");
                const { MessageFlags } = require("discord.js");
                const channel = client.channels.cache.get(guildData.chatPlayChannelId);
                if (channel) {
                    const msg = await channel.messages.fetch(guildData.chatPlayMessageId);
                    await msg.edit({
                        components: [createChatPlayIdleContainer()],
                        attachments: [],
                        flags: MessageFlags.IsComponentsV2,
                    });
                }
            } catch (err) {
                // message may have been deleted
            }
        }
        // Delete regular player message if it exists (normal /play sessions)
        else if (guildData.playerMessageId && guildData.playerChannelId) {
            try {
                const channel = client.channels.cache.get(guildData.playerChannelId);
                if (channel) {
                    const msg = await channel.messages.fetch(guildData.playerMessageId);
                    await msg.delete();
                }
            } catch (err) {
                // message already deleted
            }
        }
        
        guildData.playerMessageId = null;
        guildData.playerChannelId = null;
        guildData.suggestions = [];
        guildData.previousTracks = [];
        if (guildData.idleTimeout) clearTimeout(guildData.idleTimeout);
        guildData.idleTimeout = null;
        resetSessionPermissions(player.guildId);
    });

    // --- Track Error / Stuck ---
    client.riffy.on("trackError", async (player, track, payload) => {
        console.error(`[euphire] Track error in ${player.guildId} for "${track.info.title}":`, payload.error || payload);
        const guildData = getGuildData(player.guildId);
        if (guildData.playerChannelId) {
            const channel = client.channels.cache.get(guildData.playerChannelId);
            if (channel) {
                channel.send(`❌ Failed to play **${track.info.title}** (Lavalink Error). Skipping...`).catch(() => {});
            }
        }
    });

    client.riffy.on("trackStuck", async (player, track, payload) => {
        console.warn(`[euphire] Track stuck in ${player.guildId} for "${track.info.title}" (${payload.thresholdMs}ms)`);
        const guildData = getGuildData(player.guildId);
        if (guildData.playerChannelId) {
            const channel = client.channels.cache.get(guildData.playerChannelId);
            if (channel) {
                channel.send(`⚠️ Track stuck: **${track.info.title}**. Skipping...`).catch(() => {});
            }
        }
    });
}

/**
 * Start monitoring voice channel for auto-pause/resume functionality
 */
function startVoiceChannelMonitoring(client, guildId) {
    const guildData = getGuildData(guildId);
    
    // Clear existing timeout
    if (guildData.voiceStateTimeout) {
        clearTimeout(guildData.voiceStateTimeout);
    }
    
    // Check voice channel state every 5 seconds
    guildData.voiceStateTimeout = setInterval(() => {
        checkVoiceChannelState(client, guildId);
    }, 5000);
}

/**
 * Check voice channel state and pause/resume accordingly
 */
function checkVoiceChannelState(client, guildId) {
    const guildData = getGuildData(guildId);
    const player = client.riffy.players.get(guildId);
    
    if (!player || !player.voiceChannel) return;
    
    const voiceChannel = client.channels.cache.get(player.voiceChannel);
    if (!voiceChannel) return;
    
    const membersInChannel = voiceChannel.members.filter(member => !member.user.bot);
    const hasUsers = membersInChannel.size > 0;
    
    // Auto-pause when channel becomes empty
    if (!hasUsers && !player.paused && player.playing) {
        player.pause(true);
        guildData.wasPaused = true;
        
        // Send notification to text channel
        if (guildData.playerChannelId) {
            const channel = client.channels.cache.get(guildData.playerChannelId);
            if (channel) {
                const container = new ContainerBuilder();
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent("### ⏸️ Music paused\n-# Voice channel is empty. I'll resume when someone joins!")
                );
                channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            }
        }
    }

    // Auto-resume when users rejoin
    if (hasUsers && guildData.wasPaused && player.paused) {
        player.pause(false);
        guildData.wasPaused = false;

        // Send notification to text channel
        if (guildData.playerChannelId) {
            const channel = client.channels.cache.get(guildData.playerChannelId);
            if (channel) {
                const container = new ContainerBuilder();
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent("### ▶️ Music resumed\n-# Welcome back!")
                );
                channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            }
        }
    }
}

/**
 * Stop voice channel monitoring
 */
function stopVoiceChannelMonitoring(guildId) {
    const guildData = getGuildData(guildId);
    if (guildData.voiceStateTimeout) {
        clearTimeout(guildData.voiceStateTimeout);
        guildData.voiceStateTimeout = null;
    }
}

module.exports = { setupPlayerHandler, startVoiceChannelMonitoring, stopVoiceChannelMonitoring };
