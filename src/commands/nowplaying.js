const { SlashCommandBuilder, MessageFlags, AttachmentBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, EmbedBuilder } = require("discord.js");
const { getGuildData } = require("../utils/playerStore");
const { createNowPlayingContainer, formatDuration } = require("../utils/components");
const { generateMusicCard } = require("../utils/musicard");
const { isActivelyPlaying } = require("../utils/playback");
const config = require("../../config");

module.exports = {
    aliases: ["np", "now"],
    data: new SlashCommandBuilder()
        .setName("nowplaying")
        .setDescription("Show the currently playing track"),

    async execute(interaction, client) {
        const player = client.riffy.players.get(interaction.guild.id);
        if (!player || !isActivelyPlaying(player)) {
            const embed = new EmbedBuilder()
                .setColor(config.accentColor || 0x2b2d31)
                .setTitle("🎶 Now Playing")
                .setDescription("Nothing is playing right now.");
            return interaction.reply({
                embeds: [embed],
                flags: MessageFlags.Ephemeral,
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const guildData = getGuildData(interaction.guild.id);
        const musicardBuffer = await generateMusicCard(player.current, player, guildData);
        const container = createNowPlayingContainer(player.current, player, guildData, musicardBuffer);

        const files = [];
        if (musicardBuffer) {
            files.push(new AttachmentBuilder(musicardBuffer, { name: "musicard.png" }));
        }

        await interaction.editReply({
            components: [container],
            files: files,
            flags: MessageFlags.IsComponentsV2,
        });
    },
};
