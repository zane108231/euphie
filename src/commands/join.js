const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const { ensurePlayer, getOccupiedVoiceChannel, replyAlreadyInUse } = require("../utils/playback");
const { getGuildData } = require("../utils/playerStore");

module.exports = {
    aliases: ["summon"],
    data: new SlashCommandBuilder()
        .setName("join")
        .setDescription("Make the bot join your voice channel"),

    async execute(interaction, client) {
        const member = interaction.member;

        if (!member.voice?.channel) {
            return interaction.reply({
                content: "❌ You need to be in a voice channel!",
                flags: MessageFlags.Ephemeral,
            });
        }

        const occupied = getOccupiedVoiceChannel(interaction.guild, client);
        
        // Check if bot is already in the same channel
        if (occupied && occupied.id === member.voice.channel.id) {
            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    "### 👋 I am already here\n\n" +
                    "**Channel**\n" +
                    `-# ${member.voice.channel.name}\n\n` +
                    "**Status**\n" +
                    `-# Already connected to your voice channel`
                )
            );
            return interaction.reply({
                components: [container],
                flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
            });
        }

        if (occupied && occupied.id !== member.voice.channel.id) {
            return replyAlreadyInUse(interaction, occupied);
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const guildData = getGuildData(interaction.guild.id);

        try {
            const player = await ensurePlayer(client, {
                guildId: interaction.guild.id,
                voiceChannelId: member.voice.channel.id,
                textChannelId: interaction.channel.id,
                volume: guildData.volume,
                requesterId: interaction.user.id,
            });
            guildData.cannotSendPlayer = false;

            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    "### 🎤 I have been summoned\n\n" +
                    "**Channel**\n" +
                    `-# ${member.voice.channel.name}\n\n` +
                    "**Requested by**\n" +
                    `-# ${member.user.tag}`
                )
            );

            await interaction.editReply({
                components: [container],
                flags: MessageFlags.IsComponentsV2,
            });
        } catch (error) {
            console.error("[euphire] Join error:", error);
            return interaction.editReply({ content: "❌ Could not join your voice channel." });
        }
    },
};
