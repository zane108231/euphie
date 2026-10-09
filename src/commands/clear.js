const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const { requireMusicAction } = require("../utils/permissions");
const { getMusicDenial } = require("../utils/permissions");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("clear")
        .setDescription("Clear the queue without stopping the current track"),

    async execute(interaction, client) {
        const player = await requireMusicAction(interaction, client, "clear");
        if (!player) return;

        const denial = getMusicDenial(interaction.member, player, "clear");
        if (denial) {
            return interaction.reply({ content: denial, flags: MessageFlags.Ephemeral });
        }

        const queueLength = player.queue?.length || 0;
        
        if (queueLength === 0) {
            return interaction.reply({
                content: "❌ The queue is already empty.",
                flags: MessageFlags.Ephemeral,
            });
        }

        player.queue.clear();

        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                "### 🗑️ Queue Cleared\n\n" +
                "**Removed**\n" +
                `-# ${queueLength} track${queueLength === 1 ? "" : "s"} removed from queue\n\n` +
                "**Now Playing**\n" +
                `-# ${player.current?.info?.title || "Nothing"}`
            )
        );

        await interaction.reply({
            components: [container],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    },
};
