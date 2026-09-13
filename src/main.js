import {
    Client, Events, IntentsBitField, Partials, MessageFlags, PermissionFlagsBits
} from 'discord.js';
import { handleSettingsCommand } from './settings.js';
import { logError, logInfo } from './logger.js';
import { connectToMongo, closeMongoConnection, ensureIndexes } from './mongo.js';
import { registerCommands } from './lib/commandRegister.js';
import { handleMessage, restoreRolesOnQuarantineRemoval, restoreRolesOnStartup } from './messageHandler.js';
import { initImageQuarantine } from './imageQuarantine.js';
import config from './config.js';

const REQUIRED_ENV_VARS = ['DISCORD_TOKEN', 'MONGO_URI', 'CLIENT_ID'];
const MISSING_ENV_VARS = REQUIRED_ENV_VARS.filter(v => !process.env[v]);
if (MISSING_ENV_VARS.length > 0) {
    console.error(`[MAIN] Отсутствуют переменные окружения: ${MISSING_ENV_VARS.join(', ')}`);
    process.exit(1);
}

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const MONGO_URI = process.env.MONGO_URI;

const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.MessageContent,
        IntentsBitField.Flags.GuildMembers,
        IntentsBitField.Flags.DirectMessages,
        IntentsBitField.Flags.GuildMessageReactions
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.GuildMember,
        Partials.User,
        Partials.Reaction
    ]
});

async function startBot() {
    try {
        await connectToMongo(MONGO_URI, 'image-quarantine-bot');
        await ensureIndexes();
        if (!DISCORD_TOKEN || !config.CLIENT_ID) {
            console.error("[MAIN] DISCORD_TOKEN или CLIENT_ID не найдены");
            process.exit(1);
        }
        await client.login(DISCORD_TOKEN);
    } catch (err) {
        logError(null, `[MAIN] Ошибка при запуске: ${err.message}`);
        process.exit(1);
    }
}

client.once(Events.ClientReady, async c => {
    logInfo(null, `[MAIN] Бот ${c.user.tag} запущен.`);

    try {
        await registerCommands(DISCORD_TOKEN);
        await initImageQuarantine();
        await restoreRolesOnStartup(client);
        console.log('[MAIN] Бот готов к работе.');
    } catch (err) {
        logError(null, `[MAIN] Ошибка при инициализации: ${err.message}`);
    }

    async function gracefulShutdown(signal) {
        console.log(`[MAIN] Получен ${signal}, завершение...`);
        await closeMongoConnection();
        try { await client.destroy(); } catch {}
        setTimeout(() => process.exit(1), 10000).unref();
        process.exit();
    }

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
});

client.on(Events.InteractionCreate, async (interaction) => {
    try {
        if (!interaction.guild && interaction.isChatInputCommand()) {
            if (!interaction.replied && !interaction.deferred) {
                return interaction.reply({ content: 'Эту команду можно использовать только на сервере.', flags: MessageFlags.Ephemeral });
            }
            return;
        }

        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'settings') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                    return interaction.reply({ content: 'У вас нет прав. Требуется флаг Administrator.', flags: MessageFlags.Ephemeral });
                }
                return await handleSettingsCommand(interaction, client);
            }
        }
    } catch (err) {
        logError(interaction?.user, `[MAIN] Ошибка обработки: ${err}`);
        if (!interaction?.replied && !interaction?.deferred) {
            await interaction.reply({ content: 'Произошла ошибка.', flags: MessageFlags.Ephemeral }).catch(() => null);
        }
    }
});

client.on(Events.MessageCreate, async (msg) => {
    await handleMessage(msg, client);
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    await restoreRolesOnQuarantineRemoval(newMember);
});

client.on(Events.Error, (error) => {
    logError(null, `[MAIN] Ошибка клиента: ${error.message}`);
});

process.on('unhandledRejection', error => {
    logError(null, `[MAIN] Unhandled Rejection: ${error && error.message ? error.message : error}`);
});

startBot();
