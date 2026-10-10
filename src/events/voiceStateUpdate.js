const { getGuildData, deleteGuildData } = require("../utils/playerStore");
const { createChatPlayIdleContainer } = require("../utils/components");
const { MessageFlags } = require("discord.js");
const { addSessionParticipant, removeSessionParticipant } = require("../utils/statsTracker");

module.exports = {
    name: "voiceStateUpdate",
    async execute(client, oldState, newState) {
        // Track shared listening: user joins/leaves voice channel while music is playing
        if (oldState.id !== client.user.id && !oldState.member.user.bot) {
            const player = client.riffy.players.get(oldState.guild.id);
            if (player && player.playing && !player.paused) {
                const guildData = getGuildData(oldState.guild.id);
                if (guildData.currentSessionId) {
                    // User joined the voice channel
                    if (!oldState.channelId && newState.channelId && newState.channelId === player.voiceChannel) {
                        addSessionParticipant(guildData.currentSessionId, oldState.id);
                    }
                    // User left the voice channel
                    else if (oldState.channelId && !newState.channelId && oldState.channelId === player.voiceChannel) {
                        removeSessionParticipant(guildData.currentSessionId, oldState.id);
                    }
                    // User moved to a different channel
                    else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
                        if (oldState.channelId === player.voiceChannel) {
                            removeSessionParticipant(guildData.currentSessionId, oldState.id);
                        } else if (newState.channelId === player.voiceChannel) {
                            addSessionParticipant(guildData.currentSessionId, oldState.id);
                        }
                    }
                }
            }
        }

        // Check if the bot was disconnected from a voice channel
        if (oldState.id === client.user.id && !newState.channelId) {
            const guildData = getGuildData(oldState.guild.id);
            if (guildData.recreatingPlayer) return;

            const player = client.riffy.players.get(oldState.guild.id);
            if (player) {
                await resetChatPlayIfActive(client, oldState.guild.id);
                try {
                    player.destroy();
                } catch {
                    // NodeLink often errors destroying an already-dead player
                }
            }
            return;
        }

        // Check if bot is alone in VC
        if (oldState.channelId && oldState.channel) {
            const botMember = oldState.guild.members.cache.get(client.user.id);
            if (botMember?.voice?.channel) {
                const members = botMember.voice.channel.members.filter(
                    (m) => !m.user.bot
                );
                if (members.size === 0) {
                    // Skip auto-disconnect if 24/7 mode is enabled
                    const guildData = getGuildData(oldState.guild.id);
                    if (guildData.twentyFourSeven) return;

                    // Bot is alone, disconnect after 30 seconds
                    setTimeout(async () => {
                        const currentChannel = oldState.guild.members.cache
                            .get(client.user.id)
                            ?.voice?.channel;
                        if (currentChannel) {
                            const currentMembers = currentChannel.members.filter(
                                (m) => !m.user.bot
                            );
                            if (currentMembers.size === 0) {
                                // Re-check 24/7 in case it was toggled during the timeout
                                const currentGuildData = getGuildData(oldState.guild.id);
                                if (currentGuildData.twentyFourSeven) return;

                                const player = client.riffy.players.get(
                                    oldState.guild.id
                                );
                                if (player) {
                                    await resetChatPlayIfActive(client, oldState.guild.id);
                                    player.destroy();
                                }
                            }
                        }
                    }, 30000);
                }
            }
        }
    },
};

async function resetChatPlayIfActive(client, guildId) {
    const guildData = getGuildData(guildId);
    // Reset ChatPlay to idle
    if (guildData.chatPlayChannelId && guildData.chatPlayMessageId) {
        try {
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
    // Delete regular /play player message
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
}
