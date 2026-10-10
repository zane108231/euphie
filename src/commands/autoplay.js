const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const { getGuildData } = require("../utils/playerStore");

module.exports = {
    aliases: ["ap"],
    data: new SlashCommandBuilder()
        .setName("autoplay")
        .setDescription("Toggle autoplay mode"),

    async execute(interaction, client) {
        const guildData = getGuildData(interaction.guild.id);
        guildData.autoplay = !guildData.autoplay;

        const status = guildData.autoplay ? "enabled" : "disabled";

        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                "### 📻 Autoplay " + (guildData.autoplay ? "Enabled" : "Disabled") + "\n\n" +
                "**Status**\n" +
                `-# Autoplay is now ${status}. When the queue ends, I will automatically play similar songs.`
            )
        );

        await interaction.reply({
            components: [container],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    },
};
