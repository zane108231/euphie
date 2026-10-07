const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const { startIfIdle } = require("../utils/playback");

module.exports = {
    aliases: ["s"],
    data: new SlashCommandBuilder()
        .setName("skip")
        .setDescription("Skip the current track"),

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

        const skippedTitle = player.current?.info?.title || "Unknown";

        if (player.playing || player.paused) {
            player.stop();
        } else if (player.queue.length) {
            await startIfIdle(player);
        } else {
            return interaction.reply({
                content: "❌ Nothing is playing and the queue is empty.",
                flags: MessageFlags.Ephemeral,
            });
        }

        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                "### ⏭ Skipped\n\n" +
                "**Track**\n" +
                `-# ${skippedTitle}`
            )
        );
        await interaction.reply({
            components: [container],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    },
};
