const { PermissionFlagsBits, MessageFlags } = require("discord.js");
const { getGuildData } = require("./playerStore");
const { getPrefix } = require("./prefixStore");

const VOICE_CHANNEL_DENIAL =
    "❌ You need to be in the same voice channel as the bot to use these controls.";

const MUSIC_ACTIONS = [
    "stop",
    "clear",
    "move",
    "loop",
    "remove",
    "filter",
    "seek",
    "shuffle",
    "skip",
    "volume",
];

const ACTION_ALIASES = {
    vol: "volume",
    s: "skip",
};

const ALL_ACTION_ALIASES = new Set(["all", "everything", "*", "every", "everyone"]);

function isAllAction(raw) {
    return ALL_ACTION_ALIASES.has(String(raw || "").toLowerCase().trim());
}

function normalizeAction(raw) {
    if (!raw) return null;
    const key = String(raw).toLowerCase().trim();
    const mapped = ACTION_ALIASES[key] || key;
    return MUSIC_ACTIONS.includes(mapped) ? mapped : null;
}

function resolveActions(raw) {
    if (isAllAction(raw)) return [...MUSIC_ACTIONS];
    const one = normalizeAction(raw);
    return one ? [one] : [];
}

function ensureAllowMaps(guildId) {
    const guildData = getGuildData(guildId);
    if (!(guildData.musicAllowEveryone instanceof Set)) {
        guildData.musicAllowEveryone = new Set();
    }
    if (!guildData.musicAllows || typeof guildData.musicAllows !== "object") {
        guildData.musicAllows = {};
    }
    for (const action of MUSIC_ACTIONS) {
        if (!(guildData.musicAllows[action] instanceof Set)) {
            guildData.musicAllows[action] = new Set();
        }
    }
    return guildData;
}

function resetSessionPermissions(guildId) {
    const guildData = getGuildData(guildId);
    guildData.djOwnerId = null;
    guildData.musicAllowEveryone = new Set();
    guildData.musicAllows = {};
    for (const action of MUSIC_ACTIONS) {
        guildData.musicAllows[action] = new Set();
    }
}

function claimDjIfNeeded(guildId, userId) {
    const guildData = ensureAllowMaps(guildId);
    if (!userId) return;
    if (!guildData.djOwnerId) {
        guildData.djOwnerId = String(userId);
    }
}

function isServerAdmin(member) {
    try {
        return Boolean(
            member?.permissions?.has?.(PermissionFlagsBits.Administrator) ||
                member?.permissions?.has?.(PermissionFlagsBits.ManageGuild)
        );
    } catch {
        return false;
    }
}

function isDj(member, guildId) {
    const guildData = getGuildData(guildId);
    return Boolean(guildData.djOwnerId && String(member?.id) === String(guildData.djOwnerId));
}

/**
 * Returns true if the member is in the same voice channel as the bot player.
 */
function canControlMusic(member, player) {
    const memberChannel = member?.voice?.channel;
    if (!memberChannel || !player?.voiceChannel) return false;
    return memberChannel.id === player.voiceChannel;
}

function canUseMusicAction(member, player, action) {
    if (!canControlMusic(member, player)) return false;

    const resolved = normalizeAction(action);
    if (!resolved) return false;

    const guildId = player.guildId;
    const guildData = ensureAllowMaps(guildId);

    if (isDj(member, guildId)) return true;
    if (isServerAdmin(member)) return true;

    if (guildData.musicAllowEveryone.has(resolved)) return true;
    if (guildData.musicAllows[resolved]?.has(String(member.id))) return true;

    return false;
}

function denyMusicMessage(guildId, action) {
    const prefix = getPrefix(guildId);
    const resolved = normalizeAction(action) || action;
    return (
        `❌ Only the DJ (the person who first brought the bot into the voice channel) can use **${resolved}**.\n` +
        `-# Ask them to run \`${prefix}permission ${resolved} allow\` or \`${prefix}permission ${resolved} allow @you\`.`
    );
}

function getMusicDenial(member, player, action) {
    if (!canControlMusic(member, player)) return VOICE_CHANNEL_DENIAL;
    if (!canUseMusicAction(member, player, action)) {
        return denyMusicMessage(player.guildId, action);
    }
    return null;
}

async function requireMusicAction(interaction, client, action) {
    const player = client.riffy.players.get(interaction.guild.id);
    if (!player) {
        await interaction.reply({
            content: "❌ No active player.",
            flags: MessageFlags.Ephemeral,
        });
        return null;
    }

    if (!interaction.member.voice?.channel) {
        await interaction.reply({
            content: "❌ You need to be in a voice channel!",
            flags: MessageFlags.Ephemeral,
        });
        return null;
    }

    if (!canControlMusic(interaction.member, player)) {
        await interaction.reply({
            content: VOICE_CHANNEL_DENIAL,
            flags: MessageFlags.Ephemeral,
        });
        return null;
    }

    if (!canUseMusicAction(interaction.member, player, action)) {
        await interaction.reply({
            content: denyMusicMessage(interaction.guild.id, action),
            flags: MessageFlags.Ephemeral,
        });
        return null;
    }

    return player;
}

function grantAction(guildId, action, userId) {
    const actions = resolveActions(action);
    if (!actions.length) return false;
    const guildData = ensureAllowMaps(guildId);
    const everyone = !userId || userId === "all";
    for (const resolved of actions) {
        if (everyone) {
            guildData.musicAllowEveryone.add(resolved);
        } else {
            guildData.musicAllows[resolved].add(String(userId));
        }
    }
    return true;
}

function revokeAction(guildId, action, userId) {
    const actions = resolveActions(action);
    if (!actions.length) return false;
    const guildData = ensureAllowMaps(guildId);
    const everyone = !userId || userId === "all";
    for (const resolved of actions) {
        if (everyone) {
            guildData.musicAllowEveryone.delete(resolved);
            guildData.musicAllows[resolved].clear();
        } else {
            guildData.musicAllows[resolved].delete(String(userId));
        }
    }
    return true;
}

module.exports = {
    VOICE_CHANNEL_DENIAL,
    MUSIC_ACTIONS,
    isAllAction,
    resolveActions,
    ensureAllowMaps,
    canControlMusic,
    canUseMusicAction,
    requireMusicAction,
    claimDjIfNeeded,
    resetSessionPermissions,
    isServerAdmin,
    isDj,
    normalizeAction,
    grantAction,
    revokeAction,
    denyMusicMessage,
    getMusicDenial,
};
