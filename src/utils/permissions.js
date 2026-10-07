const VOICE_CHANNEL_DENIAL =
    "❌ You need to be in the same voice channel as the bot to use these controls.";

/**
 * Returns true if the member is in the same voice channel as the bot player.
 */
function canControlMusic(member, player) {
    const memberChannel = member?.voice?.channel;
    if (!memberChannel || !player?.voiceChannel) return false;
    return memberChannel.id === player.voiceChannel;
}

module.exports = { canControlMusic, VOICE_CHANNEL_DENIAL };
