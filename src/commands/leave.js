const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const { getGuildData, clearUpdateInterval } = require("../utils/playerStore");
const { requireMusicAction } = require("../utils/permissions");
const { getMusicDenial } = require("../utils/permissions");

module.exports = {
    aliases: ["dc"],
    data: new SlashCommandBuilder()
        .setName("leave")
        .setDescription("Force the bot to leave the voice channel (ignores 24/7 mode)"),

    async execute(interaction, client) {
        const player = await requireMusicAction(interaction, client, "stop");
        if (!player) return;

        const denial = getMusicDenial(interaction.member, player, "stop");
        if (denial) {
            return interaction.reply({ content: denial, flags: MessageFlags.Ephemeral });
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
        guildData.playerMessageId = null;
        guildData.playerChannelId = null;
        guildData.chatPlayChannelId = null;
        guildData.chatPlayMessageId = null;

        player.queue.clear();
        player.stop();
        player.destroy();

        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                "### 👋 Left Voice Channel\n\n" +
                "**Status**\n" +
                "-# Disconnected from voice channel and cleared queue."
            )
        );
        await interaction.reply({
            components: [container],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    },
};
