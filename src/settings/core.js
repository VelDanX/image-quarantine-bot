import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    ContainerBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SectionBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    StringSelectMenuBuilder,
    TextDisplayBuilder,
} from "discord.js";
import { getDb } from "../mongo.js";

import { showImageQuarantinePanel } from './imageQuarantine.js';

const SETTINGS_COLLECTION = 'botSettings';

export const defaultSettings = {
    imageQuarantine: {
        enabled: false,
        ignoredUsers: [],
        ignoredRoles: [],
        autoRemoveRoles: false,
        keepRoles: [],
        quarantineRoleId: null,
        sendDM: true,
        disableLogMentions: false,
        logChannelId: null,
        dmMessageText: null,
        dmMessageJson: null,
        dmColor: null,
        logMessageText: null,
        logMessageJson: null,
        logColor: null,
        similarityThreshold: 0.80
    }
};

const isObject = (item) => {
    return (item && typeof item === 'object' && !Array.isArray(item));
};

const mergeDeep = (target, source) => {
    const output = { ...target };
    if (isObject(target) && isObject(source)) {
        Object.keys(source).forEach(key => {
            if (isObject(source[key])) {
                if (!(key in target))
                    Object.assign(output, { [key]: source[key] });
                else
                    output[key] = mergeDeep(target[key], source[key]);
            } else {
                Object.assign(output, { [key]: source[key] });
            }
        });
    }
    return output;
};

export async function readSettings(guildId) {
    const db = getDb();
    const docId = guildId || 'mainSettings';
    let settings = await db.collection(SETTINGS_COLLECTION).findOne({ _id: docId });

    if (!settings) {
        settings = { _id: docId, ...defaultSettings };
        await db.collection(SETTINGS_COLLECTION).insertOne(settings);
        return settings;
    }

    return mergeDeep(defaultSettings, settings);
}

export async function writeSettings(guildId, settings) {
    const db = getDb();
    try {
        const settingsToUpdate = { ...settings };
        delete settingsToUpdate._id;
        await db.collection(SETTINGS_COLLECTION).updateOne(
            { _id: guildId || 'mainSettings' },
            { $set: settingsToUpdate },
            { upsert: true }
        );
    } catch (err) {
        console.error("[SETTINGS] Ошибка writeSettings:", err);
    }
}

export async function updateSettingsField(guildId, fieldPath, value) {
    const db = getDb();
    await db.collection(SETTINGS_COLLECTION).updateOne(
        { _id: guildId || 'mainSettings' },
        { $set: { [fieldPath]: value } },
        { upsert: true }
    );
}

export async function updateSettingsMulti(guildId, updates) {
    const db = getDb();
    await db.collection(SETTINGS_COLLECTION).updateOne(
        { _id: guildId || 'mainSettings' },
        { $set: updates },
        { upsert: true }
    );
}

function hasAdminPermission(member) {
    return member.permissions.has(PermissionFlagsBits.Administrator);
}

export async function handleSettingsCommand(interaction, client) {
    if (!hasAdminPermission(interaction.member)) {
        return interaction.reply({
            content: "Недостаточно прав. Требуется флаг Administrator.",
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }
    await showMainMenu(interaction);
}

export async function showMainMenu(interaction) {
    const container = new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('⚙️ **Настройки Бота**'),
            new TextDisplayBuilder().setContent('Выберите категорию для настройки.')
        )
        .addSeparatorComponents(s => s.setSpacing(SeparatorSpacingSize.Small));

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("main_menu_select")
        .setPlaceholder("Выберите категорию...")
        .addOptions(
            { label: "Авто-модерация", value: "auto_moderation", description: "Фильтрация изображений и авто-карантин", emoji: '🛡️' }
        );

    container.addActionRowComponents(new ActionRowBuilder().addComponents(selectMenu));

    const payload = {
        components: [container],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    };

    try {
        if (interaction.isMessageComponent()) {
            await interaction.update(payload);
        } else if (interaction.replied || interaction.deferred) {
            await interaction.editReply(payload);
        } else {
            await interaction.reply(payload);
        }

        const message = await interaction.fetchReply();
        const collector = message.createMessageComponentCollector({
            componentType: ComponentType.StringSelect,
            time: 900000
        });

        collector.on("collect", async (sel) => {
            if (sel.user.id !== interaction.user.id) {
                await sel.reply({ content: "Это меню не ваше.", flags: MessageFlags.Ephemeral }).catch(() => {});
                return;
            }
            if (!hasAdminPermission(sel.member)) {
                await sel.reply({ content: "Недостаточно прав. Требуется флаг Administrator.", flags: MessageFlags.Ephemeral }).catch(() => {});
                return;
            }
            collector.stop();
            switch (sel.values[0]) {
                case "auto_moderation": await showAutoModerationPanel(sel, sel.client); break;
            }
        });

        collector.on('end', (collected, reason) => {
            if (reason === 'time') {
                interaction.editReply({ content: 'Время вышло.', components: [] }).catch(() => {});
            }
        });
    } catch (error) {
        console.error("[SETTINGS] Ошибка в showMainMenu:", error);
    }
}

export async function goBackToMain(btnInt) {
    await showMainMenu(btnInt);
}

async function showAutoModerationPanel(interaction, client) {
    const container = new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('### 🛡️ Авто-модерация'),
            new TextDisplayBuilder().setContent('Управление модулями автоматической модерации.')
        )
        .addSectionComponents(
            new SectionBuilder()
                .setButtonAccessory(new ButtonBuilder()
                    .setStyle(ButtonStyle.Secondary)
                    .setLabel('Настроить')
                    .setCustomId("am_image_filter"))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("Фильтрация изображений:")),
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("back_to_main").setLabel("Назад").setStyle(ButtonStyle.Secondary)
            )
        );

    const payload = { components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral };

    if (interaction.isMessageComponent()) {
        await interaction.update(payload).catch(() => {});
    } else {
        await interaction.reply(payload).catch(() => {});
    }

    const msg = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({ time: 900000 });

    collector.on("collect", async (i) => {
        if (i.user.id !== interaction.user.id) {
            await i.reply({ content: "Это меню не ваше.", flags: MessageFlags.Ephemeral }).catch(() => {});
            return;
        }

        switch (i.customId) {
            case "am_image_filter":
                collector.stop();
                await showImageQuarantinePanel(i, client);
                break;
            case "back_to_main":
                collector.stop();
                await goBackToMain(i);
                break;
        }
    });

    collector.on('end', (c, r) => {
        if (r === 'time') interaction.editReply({ content: "Время вышло.", components: [] }).catch(() => {});
    });
}
