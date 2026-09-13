import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import config from '../config.js';

export async function registerCommands(DISCORD_TOKEN) {
    const settingsCommand = new SlashCommandBuilder()
        .setName('settings')
        .setDescription('Настройки бота');

    const commands = [
        settingsCommand.toJSON(),
    ];

    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    await rest.put(
        Routes.applicationCommands(config.CLIENT_ID),
        { body: commands }
    );
    console.log('[CMD] Команды зарегистрированы.');
}
