const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const { requireMusicAction } = require("../utils/permissions");
const { getMusicDenial } = require("../utils/permissions");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("shuffle")
        .setDescription("Shuffle the queue"),

    async execute(interaction, client) {
        const player = await requireMusicAction(interaction, client, "shuffle");
        if (!player) return;

        const denial = getMusicDenial(interaction.member, player, "shuffle");
        if (denial) {
            return interaction.reply({ content: denial, flags: MessageFlags.Ephemeral });
        }

        if (player.queue.length === 0) {
            return interaction.reply({
                content: "❌ Queue is empty, nothing to shuffle.",
                flags: MessageFlags.Ephemeral,
            });
        }

        player.queue.shuffle();

        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                "### 🔀 Shuffled\n\n" +
                "**Tracks**\n" +
                `-# ${player.queue.length} songs randomized`
            )
        );
        await interaction.reply({
            components: [container],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    },
};
