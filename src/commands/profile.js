const { MessageFlags, AttachmentBuilder, SlashCommandBuilder } = require("discord.js");
const { getUserStats, getTopServers, getTopFriends, getTopTracks } = require("../utils/statsTracker");
const { generateProfileCard } = require("../utils/profileCard");

// Prevent double execution
const executingProfiles = new Map();

module.exports = {
    aliases: ["user"],
    data: new SlashCommandBuilder()
        .setName("profile")
        .setDescription("View your music listening statistics profile"),

    async execute(interaction, client) {
        const key = `${interaction.guildId}-${interaction.user.id}`;
        
        // Check if already executing
        if (executingProfiles.has(key)) {
            return;
        }
        
        executingProfiles.set(key, true);

        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        } catch (err) {
            executingProfiles.delete(key);
            return;
        }

        try {
            const targetUser = interaction.user;
            const user = await client.users.fetch(targetUser.id).catch(() => null);
            
            if (!user) {
                executingProfiles.delete(key);
                return interaction.editReply({
                    content: "❌ Could not fetch user data.",
                });
            }

            const stats = getUserStats(user.id);
            const topServers = getTopServers(user.id, 3);
            const topFriends = getTopFriends(user.id, 3);
            const topTracks = getTopTracks(user.id, 3);

            const imageBuffer = await generateProfileCard(
                user,
                stats,
                topServers,
                topFriends,
                topTracks,
                client
            );

            const attachment = new AttachmentBuilder(imageBuffer, { name: `${user.username}-profile.png` });

            await interaction.editReply({
                files: [attachment],
            });
        } catch (error) {
            console.error("[euphire] Profile command error:", error);
            await interaction.editReply({
                content: "❌ Failed to generate profile. Please try again later.",
            });
        } finally {
            // Clear the flag after a delay
            setTimeout(() => executingProfiles.delete(key), 2000);
        }
    },
};
