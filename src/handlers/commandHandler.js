const fs = require("fs");
const path = require("path");
const { Collection } = require("discord.js");
const { PREFIX, createPrefixInteraction } = require("../utils/prefix");

/**
 * Load all commands from the commands directory
 */
function loadCommands(client) {
    client.commands = new Collection();
    client.aliases = new Collection();

    const commandsPath = path.join(__dirname, "..", "commands");

    if (!fs.existsSync(commandsPath)) {
        console.warn("[euphire] No commands directory found.");
        return;
    }

    const commandFiles = fs
        .readdirSync(commandsPath)
        .filter((file) => file.endsWith(".js"));

    for (const file of commandFiles) {
        try {
            const command = require(path.join(commandsPath, file));
            if (command.data && command.execute) {
                client.commands.set(command.data.name, command);
                const aliases = command.aliases || [];
                for (const alias of aliases) {
                    client.aliases.set(alias.toLowerCase(), command);
                }
                const aliasNote = aliases.length ? ` (${aliases.map((a) => PREFIX + a).join(", ")})` : "";
                console.log(`[euphire] Loaded command: ${PREFIX}${command.data.name}${aliasNote}`);
            } else {
                console.warn(`[euphire] Command ${file} is missing "data" or "execute".`);
            }
        } catch (err) {
            console.error(`[euphire] Failed to load command ${file}:`, err.message);
        }
    }
}

function resolveCommand(client, name) {
    const key = name.toLowerCase();
    return client.commands.get(key) || client.aliases.get(key) || null;
}

/**
 * Run a prefix command from a guild message. Returns true if the message
 * started with the prefix (so ChatPlay should not steal it).
 */
async function handlePrefixCommand(client, message) {
    if (!message.guild || message.author.bot) return false;
    if (!message.content.startsWith(PREFIX)) return false;

    const without = message.content.slice(PREFIX.length).trim();
    if (!without) return true;

    const [rawName, ...args] = without.split(/\s+/);
    const command = resolveCommand(client, rawName);
    if (!command) {
        try {
            await message.channel.send({
                content: `❌ Unknown command \`${PREFIX}${rawName}\`. Try \`${PREFIX}help\`.`,
            });
        } catch {
            // ignore
        }
        return true;
    }

    const interaction = createPrefixInteraction(message, command, args);

    try {
        await command.execute(interaction, client);
    } catch (error) {
        console.error(`[euphire] Prefix command error (${command.data.name}):`, error);
        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: "An error occurred." });
            } else {
                await interaction.reply({ content: "An error occurred." });
            }
        } catch {
            // ignore
        }
    }

    return true;
}

module.exports = { loadCommands, handlePrefixCommand };
