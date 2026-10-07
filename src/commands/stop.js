const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const { getGuildData, clearUpdateInterval } = require("../utils/playerStore");
const { createChatPlayIdleContainer } = require("../utils/components");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("stop")
        .setDescription("Stop playback, clear queue, and disconnect"),

    async execute(interaction, client) {
        const player = client.riffy.players.get(interaction.guild.id);
        if (!player) {
            return interaction.reply({
                content: "❌ No active player.",
                flags: MessageFlags.Ephemeral,
            });
        }

        if (!interaction.member.voice?.channel) {
            return interaction.reply({
                content: "❌ You need to be in a voice channel!",
                flags: MessageFlags.Ephemeral,
            });
        }

        // Clean up guild state
        const guildData = getGuildData(interaction.guild.id);
        clearUpdateInterval(guildData);
        if (guildData.idleTimeout) {
            clearTimeout(guildData.idleTimeout);
            guildData.idleTimeout = null;
        }
        guildData.suggestions = [];
        guildData.previousTracks = [];

        player.queue.clear();
        player.stop();

        if (guildData.twentyFourSeven) {
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
                    // message deleted
                }
            } else {
                guildData.playerMessageId = null;
                guildData.playerChannelId = null;
            }

            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    "### ⏹ Stopped\n\n" +
                    "**Status**\n" +
                    "-# Queue cleared. Staying in voice channel (24/7 mode)."
                )
            );
            return interaction.reply({
                components: [container],
                flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
            });
        }

        guildData.playerMessageId = null;
        guildData.playerChannelId = null;
        player.destroy();

        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                "### ⏹ Stopped\n\n" +
                "**Status**\n" +
                "-# Queue cleared and disconnected from voice channel."
            )
        );
        await interaction.reply({
            components: [container],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    },
};
