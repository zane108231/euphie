const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder } = require("discord.js");
const { getGuildData } = require("../utils/playerStore");
const { isDuplicateTrack, startIfIdle, ensurePlayer } = require("../utils/playback");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("play")
        .setDescription("Play a song or add it to the queue")
        .addStringOption((opt) =>
            opt.setName("query").setDescription("Song name or URL").setRequired(true)
        ),

    async execute(interaction, client) {
        const query = interaction.options.getString("query");
        if (!query) {
            return interaction.reply({
                content: "❌ Usage: `!play <song name or URL>`",
                flags: MessageFlags.Ephemeral,
            });
        }
        if (/(?:youtube\.com|youtu\.be)/i.test(query)) {
            return interaction.reply({
                content: "❌ YouTube links are currently not supported.",
                flags: MessageFlags.Ephemeral,
            });
        }
        const member = interaction.member;

        if (!member.voice?.channel) {
            return interaction.reply({
                content: "❌ You need to be in a voice channel!",
                flags: MessageFlags.Ephemeral,
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const guildData = getGuildData(interaction.guild.id);

        let player;
        try {
            player = await ensurePlayer(client, {
                guildId: interaction.guild.id,
                voiceChannelId: member.voice.channel.id,
                textChannelId: interaction.channel.id,
                volume: guildData.volume,
            });
            guildData.playerChannelId = interaction.channel.id;
        } catch (err) {
            console.error("[euphire] Failed to create player:", err);
            return interaction.editReply({ content: "❌ Could not join your voice channel. Try again in a moment." });
        }

        try {
            const result = await client.riffy.resolve({
                query: query,
                requester: interaction.user,
            });

            const { loadType, tracks, playlistInfo } = result;

            // Handle all Lavalink v3 + v4 loadType variants
            if (
                loadType === "playlist" ||
                loadType === "PLAYLIST_LOADED"
            ) {
                const duplicates = [];
                const addedTracks = [];
                
                for (const track of tracks) {
                    track.info.requester = interaction.user;
                    
                    if (isDuplicateTrack(player, track)) {
                        duplicates.push(track.info.title || "Unknown");
                    } else {
                        player.queue.add(track);
                        addedTracks.push(track.info.title || "Unknown");
                    }
                }

                let content = "### ✅ Playlist Added\n\n" +
                    "**Playlist**\n" +
                    `-# ${playlistInfo?.name || "Unknown Playlist"}\n\n` +
                    "**Tracks**\n" +
                    `-# ${addedTracks.length} of ${tracks.length} songs added to queue`;
                    
                if (duplicates.length > 0) {
                    content += `\n\n⚠️ **Duplicates Skipped**\n-# ${duplicates.length} songs already in queue`;
                }

                const container = new ContainerBuilder();
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(content)
                );
                await interaction.editReply({
                    components: [container],
                    flags: MessageFlags.IsComponentsV2,
                });

                await startIfIdle(player);
            } else if (
                loadType === "search" ||
                loadType === "track" ||
                loadType === "SEARCH_RESULT" ||
                loadType === "TRACK_LOADED"
            ) {
                const track = tracks[0];
                if (!track) {
                    return interaction.editReply({ content: "❌ No results found." });
                }
                
                if (isDuplicateTrack(player, track)) {
                    const container = new ContainerBuilder();
                    container.addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            "### ⚠️ Duplicate Detected\n\n" +
                            "**Track**\n" +
                            `-# ${track.info.title}\n\n` +
                            "**Status**\n" +
                            `-# Already in queue or currently playing`
                        )
                    );
                    return await interaction.editReply({
                        components: [container],
                        flags: MessageFlags.IsComponentsV2,
                    });
                }
                
                track.info.requester = interaction.user;
                const shouldStart = !player.playing && !player.paused;
                player.queue.add(track);

                const container = new ContainerBuilder();
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        (shouldStart
                            ? "### ✅ Now Playing\n\n"
                            : "### ✅ Track Added\n\n") +
                        "**Title**\n" +
                        `-# ${track.info.title}\n\n` +
                        "**Artist**\n" +
                        `-# ${track.info.author}` +
                        (shouldStart
                            ? ""
                            : `\n\n**Position**\n-# #${player.queue.length} in queue`)
                    )
                );
                await interaction.editReply({
                    components: [container],
                    flags: MessageFlags.IsComponentsV2,
                });

                await startIfIdle(player);
            } else {
                console.log(`[euphire] Unhandled loadType: "${loadType}"`);
                return interaction.editReply({ content: `❌ No results found. (loadType: ${loadType})` });
            }
        } catch (error) {
            console.error("[euphire] Play error:", error);
            return interaction.editReply({ content: "❌ An error occurred while searching." });
        }
    },
};
