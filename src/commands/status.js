const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { buildStatusContainer } = require("../utils/statusPage");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("status")
        .setDescription("Check the current status of euphire's systems"),

    async execute(interaction, client) {
        const container = buildStatusContainer(client);

        return interaction.reply({
            components: [container],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    },
};
