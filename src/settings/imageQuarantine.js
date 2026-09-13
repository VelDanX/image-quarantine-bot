import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelSelectMenuBuilder,
    ChannelType,
    CheckboxBuilder,
    ComponentType,
    ContainerBuilder,
    FileUploadBuilder,
    LabelBuilder,
    MessageFlags,
    ModalBuilder,
    RoleSelectMenuBuilder,
    SectionBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    TextDisplayBuilder,
    TextInputBuilder,
    TextInputStyle,
    UserSelectMenuBuilder,
    ThumbnailBuilder,
} from "discord.js";
import { readSettings, updateSettingsField, updateSettingsMulti } from './core.js';
import { getDb } from "../mongo.js";
import { addDynamicReference, removeDynamicReference, getAllDynamicReferences, buildComponentsFromJSON, getReferenceCount } from "../imageQuarantine.js";
import { replaceVariables, replaceVariablesInJSON, replaceLogVariables, replaceLogVariablesInJSON } from "../messageHandler.js";
import { logError, logInfo } from "../logger.js";

function getGuildId(interaction) {
    return interaction.guildId || interaction.guild?.id;
}

function genModalId(prefix) {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function buildImageQuarantinePayload(client, guildId) {
    const settings = await readSettings(guildId);
    const iq = settings.imageQuarantine;

    const container = new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('### 🖼️ Фильтрация изображений'),
            new TextDisplayBuilder().setContent(`Статус: **${iq.enabled ? 'Включено 🟢' : 'Выключено 🔴'}**`)
        );

    const ignoredUsersCount = (iq.ignoredUsers || []).length;
    const ignoredRolesCount = (iq.ignoredRoles || []).length;
    const keepRolesCount = (iq.keepRoles || []).length;

    let logChannelLabel = 'Не задан';
    if (iq.logChannelId) {
        try {
            const ch = await client.channels.fetch(iq.logChannelId);
            logChannelLabel = ch ? `#${ch.name}` : `<#${iq.logChannelId}>`;
        } catch { logChannelLabel = `<#${iq.logChannelId}>`; }
    }

    container.addSectionComponents(
        new SectionBuilder()
            .setButtonAccessory(new ButtonBuilder()
                .setStyle(ButtonStyle.Secondary)
                .setLabel(`Пользователей: ${ignoredUsersCount}`)
                .setCustomId("iq_ignored_users"))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent("Вайтлист пользователи (игнор):")),
        new SectionBuilder()
            .setButtonAccessory(new ButtonBuilder()
                .setStyle(ButtonStyle.Secondary)
                .setLabel(`Ролей: ${ignoredRolesCount}`)
                .setCustomId("iq_ignored_roles"))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent("Вайтлист роли (игнор):")),
        new SectionBuilder()
            .setButtonAccessory(new ButtonBuilder()
                .setStyle(iq.autoRemoveRoles ? ButtonStyle.Success : ButtonStyle.Danger)
                .setLabel(iq.autoRemoveRoles ? 'Включено' : 'Выключено')
                .setCustomId("iq_toggle_autoremove"))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent("Авто-снятие всех ролей:")),
        new SectionBuilder()
            .setButtonAccessory(new ButtonBuilder()
                .setStyle(keepRolesCount > 0 ? ButtonStyle.Success : ButtonStyle.Danger)
                .setLabel(`Ролей: ${keepRolesCount}`)
                .setCustomId("iq_keep_roles"))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent("Роли НЕ снимать:")),
        new SectionBuilder()
            .setButtonAccessory(new ButtonBuilder()
                .setStyle(iq.quarantineRoleId ? ButtonStyle.Success : ButtonStyle.Danger)
                .setLabel(iq.quarantineRoleId ? `<@&${iq.quarantineRoleId}>` : 'Не задана')
                .setCustomId("iq_set_quarantine_role"))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent("Роль карантина:")),
        new SectionBuilder()
            .setButtonAccessory(new ButtonBuilder()
                .setStyle(iq.sendDM ? ButtonStyle.Success : ButtonStyle.Danger)
                .setLabel(iq.sendDM ? 'Включено' : 'Выключено')
                .setCustomId("iq_toggle_dm"))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent("Отправлять в ЛС:")),
        new SectionBuilder()
            .setButtonAccessory(new ButtonBuilder()
                .setStyle((iq.dmMessageText || iq.dmMessageJson) ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setLabel(iq.dmMessageText ? 'Текст' : iq.dmMessageJson ? 'JSON' : 'Стандарт')
                .setCustomId("iq_dm_settings"))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent("Сообщение в ЛС:")),
        new SectionBuilder()
            .setButtonAccessory(new ButtonBuilder()
                .setStyle(iq.logChannelId ? ButtonStyle.Success : ButtonStyle.Danger)
                .setLabel(logChannelLabel.length > 30 ? 'Настроить' : logChannelLabel)
                .setCustomId("iq_log_settings"))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent("Настройка логирования:")),
        new SectionBuilder()
            .setButtonAccessory(new ButtonBuilder()
                .setStyle(ButtonStyle.Secondary)
                .setLabel(`${Math.round((iq.similarityThreshold ?? 0.80) * 100)}%`)
                .setCustomId("iq_set_similarity"))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent("Чувствительность совпадения изображений:"))
    );

    container.addSectionComponents(
        new SectionBuilder()
            .setButtonAccessory(new ButtonBuilder()
                .setStyle(ButtonStyle.Success)
                .setLabel('Добавить')
                .setCustomId("iq_add_reference"))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent("Добавить запрещённое изображение:"))
    );

    container.addSectionComponents(
        new SectionBuilder()
            .setButtonAccessory(new ButtonBuilder()
                .setStyle(ButtonStyle.Secondary)
                .setLabel('Просмотр')
                .setCustomId("iq_view_quarantine"))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent("Список запрещённых изображений:"))
    );

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("iq_toggle_enabled")
                .setLabel(iq.enabled ? "Выключить" : "Включить")
                .setStyle(iq.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
            new ButtonBuilder().setCustomId("back_to_auto_moderation").setLabel("Назад").setStyle(ButtonStyle.Secondary)
        )
    );

    return {
        components: [container],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    };
}

export async function showImageQuarantinePanel(interaction, client) {
    const guildId = getGuildId(interaction);
    let settingsMsg;
    const payload = await buildImageQuarantinePayload(client, guildId);

    if (interaction.isMessageComponent()) {
        await interaction.update(payload).catch(() => {});
    } else if (interaction.replied || interaction.deferred) {
        await interaction.editReply(payload).catch(() => {});
    } else {
        await interaction.reply(payload).catch(() => {});
    }
    settingsMsg = await interaction.fetchReply();

    const collector = settingsMsg.createMessageComponentCollector({ time: 900000 });

    collector.on("collect", async (i) => {
        if (i.user.id !== interaction.user.id) {
            await i.reply({ content: "Это меню не для вас.", flags: MessageFlags.Ephemeral }).catch(() => {});
            return;
        }

        const gId = getGuildId(i);

        const handlers = {
            iq_toggle_enabled: async () => {
                await i.deferUpdate();
                const s = await readSettings(gId);
                await updateSettingsField(gId, 'imageQuarantine.enabled', !s.imageQuarantine.enabled);
                await i.editReply(await buildImageQuarantinePayload(client, gId));
            },
            iq_toggle_autoremove: async () => {
                await i.deferUpdate();
                const s = await readSettings(gId);
                await updateSettingsField(gId, 'imageQuarantine.autoRemoveRoles', !s.imageQuarantine.autoRemoveRoles);
                await i.editReply(await buildImageQuarantinePayload(client, gId));
            },
            iq_toggle_dm: async () => {
                await i.deferUpdate();
                const s = await readSettings(gId);
                await updateSettingsField(gId, 'imageQuarantine.sendDM', !s.imageQuarantine.sendDM);
                await i.editReply(await buildImageQuarantinePayload(client, gId));
            },
            iq_set_quarantine_role: async () => await showQuarantineRoleSelect(i, client, settingsMsg, gId),
            iq_set_similarity: async () => await showSimilarityThresholdModal(i, client, settingsMsg, gId),
            iq_log_settings: async () => { collector.stop(); await showLogSettings(i, client, gId); },
            iq_ignored_users: async () => await showIgnoredUsersSelect(i, client, settingsMsg, gId),
            iq_ignored_roles: async () => await showIgnoredRolesSelect(i, client, settingsMsg, gId),
            iq_keep_roles: async () => await showKeepRolesSelect(i, client, settingsMsg, gId),
            iq_add_reference: async () => await showAddReferenceModal(i, client, gId),
            iq_view_quarantine: async () => { collector.stop(); await showQuarantineList(i, client, gId); },
            iq_dm_settings: async () => { collector.stop(); await showDMMenu(i, client, gId); },
            back_to_auto_moderation: async () => {
                collector.stop();
                const { showMainMenu } = await import('./core.js');
                await showMainMenu(i);
            }
        };

        const handler = handlers[i.customId];
        if (handler) {
            try {
                await handler();
            } catch (error) {
                logError(i.user, `[ImageQuarantine] ${error.message}`);
                if (!i.replied && !i.deferred) {
                    await i.reply({ content: 'Произошла ошибка.', flags: MessageFlags.Ephemeral }).catch(() => {});
                }
            }
        }
    });

    collector.on('end', (c, r) => {
        if (r === 'time') interaction.editReply({ content: "Время вышло.", components: [] }).catch(() => {});
    });
}

async function showQuarantineRoleSelect(interaction, client, settingsMsg, guildId) {
    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('iq_quick_qrole')
        .setPlaceholder('Выберите роль карантина...')
        .setMinValues(1)
        .setMaxValues(1);

    const row = new ActionRowBuilder().addComponents(roleSelect);
    await interaction.reply({
        content: '**Выберите роль, которая будет выдаваться при карантине (остальные роли снимаются):**',
        components: [row],
        flags: MessageFlags.Ephemeral,
    });

    const msg = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({ componentType: ComponentType.RoleSelect, time: 120000 });

    collector.on('collect', async (sel) => {
        try {
            await sel.deferUpdate().catch(() => {});
            await updateSettingsField(guildId, 'imageQuarantine.quarantineRoleId', sel.values[0]);
            await sel.editReply({
                content: `✅ **Роль карантина обновлена:** <@&${sel.values[0]}>`,
                components: []
            }).catch(() => {});
            await settingsMsg.edit(await buildImageQuarantinePayload(client, guildId)).catch(() => {});
        } catch (e) {
            logError(interaction.user, `[IQ] quarantine role: ${e.message}`);
        }
    });

    collector.on('end', (c, r) => {
        if (r === 'time') interaction.editReply({ content: "Время вышло.", components: [] }).catch(() => {});
    });
}

async function showSimilarityThresholdModal(interaction, client, settingsMsg, guildId) {
    const s = await readSettings(guildId);
    const current = s.imageQuarantine.similarityThreshold ?? 0.80;

    const modalId = genModalId('iq_modal_similarity');
    const modal = new ModalBuilder()
        .setCustomId(modalId)
        .setTitle('Чувствительность совпадения изображений');

    modal.addLabelComponents(
        new LabelBuilder()
            .setLabel('Порог схожести (%)')
            .setDescription('Насколько похожим должно быть изображение для карантина (50-100). Ниже = строже.')
            .setTextInputComponent(
                new TextInputBuilder()
                    .setCustomId('iq_similarity_value')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setValue(String(Math.round(current * 100)))
                    .setMaxLength(3)
            )
    );

    try {
        await interaction.showModal(modal);
    } catch (e) {
        logError(interaction.user, `[IQ] showSimilarityThresholdModal: ${e.message}`);
        return;
    }

    try {
        const modalSubmit = await interaction.awaitModalSubmit({
            filter: (i) => i.customId === modalId && i.user.id === interaction.user.id,
            time: 120000
        });

        const rawValue = modalSubmit.fields.getTextInputValue('iq_similarity_value');
        const percent = parseInt(rawValue, 10);

        if (isNaN(percent) || percent < 50 || percent > 100) {
            await modalSubmit.reply({
                content: '❌ Значение должно быть от 50 до 100.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
            return;
        }

        const threshold = percent / 100;
        await updateSettingsField(guildId, 'imageQuarantine.similarityThreshold', threshold);

        await modalSubmit.reply({
            content: `✅ Порог схожести установлен на **${percent}%**.`,
            flags: MessageFlags.Ephemeral
        }).catch(() => {});

        await settingsMsg.edit(await buildImageQuarantinePayload(client, guildId)).catch(() => {});
    } catch (e) {
        if (e.code !== 'InteractionCollectorError') console.error('[IQ] similarity modal error:', e.message);
    }
}

async function showIgnoredUsersSelect(interaction, client, settingsMsg, guildId) {
    const s = await readSettings(guildId);
    const existing = s.imageQuarantine.ignoredUsers || [];

    const userSelect = new UserSelectMenuBuilder()
        .setCustomId('iq_ignored_users_select')
        .setPlaceholder('Выберите пользователей для игнора...')
        .setMinValues(0)
        .setMaxValues(25);
    if (existing.length > 0) userSelect.setDefaultUsers(...existing);

    const row = new ActionRowBuilder().addComponents(userSelect);
    await interaction.reply({
        content: `**Выберите пользователей, которые будут игнорироваться при фильтрации изображений.**\nУже выбрано: ${existing.length}${existing.length > 0 ? '\nЧтобы убрать — отправьте пустой выбор.' : ''}`,
        components: [row],
        flags: MessageFlags.Ephemeral,
    });

    const selectMessage = await interaction.fetchReply();
    const collector = selectMessage.createMessageComponentCollector({
        componentType: ComponentType.UserSelect,
        time: 120000
    });

    collector.on('collect', async (sel) => {
        await sel.deferUpdate().catch(() => {});
        await updateSettingsField(guildId, 'imageQuarantine.ignoredUsers', sel.values);
        await sel.editReply({
            content: `✅ **Вайтлист пользователи обновлены.**\nВыбрано: ${sel.values.length}`,
            components: []
        }).catch(() => {});
        await settingsMsg.edit(await buildImageQuarantinePayload(client, guildId)).catch(() => {});
    });

    collector.on('end', (c, r) => {
        if (r === 'time') interaction.editReply({ content: "Время вышло.", components: [] }).catch(() => {});
    });
}

async function showIgnoredRolesSelect(interaction, client, settingsMsg, guildId) {
    const existing = (await readSettings(guildId)).imageQuarantine.ignoredRoles || [];

    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('iq_ignored_roles_select')
        .setPlaceholder('Выберите роли для игнора...')
        .setMinValues(0)
        .setMaxValues(25);
    if (existing.length > 0) roleSelect.setDefaultRoles(...existing);

    const row = new ActionRowBuilder().addComponents(roleSelect);
    await interaction.reply({
        content: `**Выберите роли, обладатели которых будут игнорироваться при фильтрации изображений.**\nУже выбрано: ${existing.length}${existing.length > 0 ? '\nЧтобы убрать — отправьте пустой выбор.' : ''}`,
        components: [row],
        flags: MessageFlags.Ephemeral,
    });

    const selectMessage = await interaction.fetchReply();
    const collector = selectMessage.createMessageComponentCollector({
        componentType: ComponentType.RoleSelect,
        time: 120000
    });

    collector.on('collect', async (sel) => {
        await sel.deferUpdate().catch(() => {});
        await updateSettingsField(guildId, 'imageQuarantine.ignoredRoles', sel.values);
        await sel.editReply({
            content: `✅ **Вайтлист роли обновлены.**\nВыбрано ролей: ${sel.values.length}`,
            components: []
        }).catch(() => {});
        await settingsMsg.edit(await buildImageQuarantinePayload(client, guildId)).catch(() => {});
    });

    collector.on('end', (c, r) => {
        if (r === 'time') interaction.editReply({ content: "Время вышло.", components: [] }).catch(() => {});
    });
}

async function showKeepRolesSelect(interaction, client, settingsMsg, guildId) {
    const existing = (await readSettings(guildId)).imageQuarantine.keepRoles || [];

    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('iq_keep_roles_select')
        .setPlaceholder('Выберите роли, которые НЕ будут сниматься...')
        .setMinValues(0)
        .setMaxValues(25);
    if (existing.length > 0) roleSelect.setDefaultRoles(...existing);

    const row = new ActionRowBuilder().addComponents(roleSelect);
    await interaction.reply({
        content: `**Выберите роли, которые НЕ будут автоматически сниматься при карантине.**\nУже выбрано: ${existing.length}${existing.length > 0 ? '\nЧтобы убрать — отправьте пустой выбор.' : ''}`,
        components: [row],
        flags: MessageFlags.Ephemeral,
    });

    const selectMessage = await interaction.fetchReply();
    const collector = selectMessage.createMessageComponentCollector({
        componentType: ComponentType.RoleSelect,
        time: 120000
    });

    collector.on('collect', async (sel) => {
        await sel.deferUpdate().catch(() => {});
        await updateSettingsField(guildId, 'imageQuarantine.keepRoles', sel.values);
        await sel.editReply({
            content: `✅ **Роли для сохранения обновлены.**\nВыбрано ролей: ${sel.values.length}`,
            components: []
        }).catch(() => {});
        await settingsMsg.edit(await buildImageQuarantinePayload(client, guildId)).catch(() => {});
    });

    collector.on('end', (c, r) => {
        if (r === 'time') interaction.editReply({ content: "Время вышло.", components: [] }).catch(() => {});
    });
}

// ─── Add Reference Modal ──────────────────────────────────────────────────────

async function showAddReferenceModal(interaction, client, guildId) {
    const modalId = genModalId('iq_modal_add_reference');
    const modal = new ModalBuilder()
        .setCustomId(modalId)
        .setTitle('Добавить запрещённое изображение');

    modal.addLabelComponents(
        new LabelBuilder()
            .setLabel('Загрузите изображение в карантин #1')
            .setFileUploadComponent(
                new FileUploadBuilder().setCustomId('iq_upload_file_0')
            ),
        new LabelBuilder()
            .setLabel('Загрузите изображение в карантин #2')
            .setFileUploadComponent(
                new FileUploadBuilder().setCustomId('iq_upload_file_1').setRequired(false)
            ),
        new LabelBuilder()
            .setLabel('Загрузите изображение в карантин #3')
            .setFileUploadComponent(
                new FileUploadBuilder().setCustomId('iq_upload_file_2').setRequired(false)
            ),
        new LabelBuilder()
            .setLabel('Загрузите изображение в карантин #4')
            .setFileUploadComponent(
                new FileUploadBuilder().setCustomId('iq_upload_file_3').setRequired(false)
            ),
        new LabelBuilder()
            .setLabel('Загрузите изображение в карантин #5')
            .setFileUploadComponent(
                new FileUploadBuilder().setCustomId('iq_upload_file_4').setRequired(false)
            )
    );

    try {
        await interaction.showModal(modal);
    } catch (e) {
        logError(interaction.user, `[IQ] showModal: ${e.message}`);
        return;
    }

    try {
        const modalSubmit = await interaction.awaitModalSubmit({
            filter: (i) => i.customId === modalId && i.user.id === interaction.user.id,
            time: 300000
        });

        const allAttachments = [];
        for (let i = 0; i < 5; i++) {
            const files = modalSubmit.fields.getUploadedFiles(`iq_upload_file_${i}`);
            if (files?.first()) {
                allAttachments.push(files.first());
            }
        }

        if (allAttachments.length === 0) {
            await modalSubmit.reply({
                content: '❌ Файл не найден.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
            return;
        }

        for (const attachment of allAttachments) {
            if (!attachment.contentType?.startsWith('image/')) {
                await modalSubmit.reply({
                    content: '❌ Файл должен быть изображением.',
                    flags: MessageFlags.Ephemeral
                }).catch(() => {});
                return;
            }
            if (attachment.size > 10 * 1024 * 1024) {
                await modalSubmit.reply({
                    content: '❌ Изображение слишком большое (макс. 10MB).',
                    flags: MessageFlags.Ephemeral
                }).catch(() => {});
                return;
            }
        }

        await modalSubmit.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

        let successCount = 0;
        let failCount = 0;

        for (const attachment of allAttachments) {
            try {
                const response = await fetch(attachment.url);
                if (!response.ok) {
                    failCount++;
                    continue;
                }

                const buffer = Buffer.from(await response.arrayBuffer());
                const ext = attachment.name?.split('.').pop() || 'png';
                const fileName = `${Date.now()}_${attachment.name || `image.${ext}`}`;

                await addDynamicReference(buffer, fileName, interaction.user.id, attachment.url, guildId);
                successCount++;
            } catch (err) {
                if (err.code === 11000) {
                    failCount++;
                } else {
                    throw err;
                }
            }
        }

        await modalSubmit.editReply({
            content: `✅ **Добавлено:** ${successCount}\n❌ **Ошибок:** ${failCount}`,
        }).catch(() => {});

        if (successCount > 0) {
            logInfo(interaction.user,
                `[IQ] Добавлено ${successCount} референсов (всего на сервере: ${getReferenceCount(guildId)})`);
        }
    } catch (e) {
        if (e.code !== 'InteractionCollectorError') {
            console.error('[IQ] add reference modal error:', e.message);
        }
    }
}

// ─── Quarantine List (with pagination) ────────────────────────────────────────

async function buildQuarantineListContainer(guildId, page, refs) {
    const ITEMS_PER_PAGE = 5;
    const totalPages = Math.ceil(refs.length / ITEMS_PER_PAGE);
    if (page >= totalPages && totalPages > 0) page = totalPages - 1;
    if (page < 0) page = 0;

    const currentRefs = refs.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

    const container = new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('### 🖼️ Запрещённые изображения' + (totalPages > 1 ? ` (${page + 1}/${totalPages})` : ''))
        );

    const files = [];

    if (refs.length === 0) {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent('Нет запрещённых изображений. Нажмите "Добавить" чтобы загрузить.')
        );
    } else {
        for (const ref of currentRefs) {
            const date = ref.addedAt
                ? `<t:${Math.floor(new Date(ref.addedAt).getTime() / 1000)}:R>`
                : 'N/A';
            const addedBy = ref.addedBy ? `<@${ref.addedBy}>` : 'N/A';

            const formatList = ref.formats ? Object.keys(ref.formats).join(', ') : null;
            const text = [
                `**Файл:** \`${ref.fileName}\``,
                `**Добавлено:** ${date}`,
                `**Кем:** ${addedBy}`,
                ...(formatList ? [`**Поддерживает:** ${formatList}`] : [])
            ].join('\n');

            const editBtn = new ButtonBuilder()
                .setStyle(ButtonStyle.Secondary)
                .setLabel('Редактировать')
                .setCustomId(`iq_edit_ref_${ref.fileName}`);

            const section = new SectionBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));

            if (ref.imageData) {
                const buffer = Buffer.isBuffer(ref.imageData) ? ref.imageData : Buffer.from(ref.imageData.buffer || ref.imageData);
                const safeName = ref.fileName.replace(/[^a-zA-Z0-9.\-_]/g, '') || 'image.png';
                const attachmentName = `img_${Date.now()}_${safeName}`;
                files.push(new AttachmentBuilder(buffer, { name: attachmentName }));
                section.setThumbnailAccessory(new ThumbnailBuilder().setURL(`attachment://${attachmentName}`));
                container.addSectionComponents(section);
                container.addActionRowComponents(new ActionRowBuilder().addComponents(editBtn));
            } else if (ref.thumbnailData) {
                const buffer = Buffer.from(ref.thumbnailData, 'base64');
                const safeName = ref.fileName.replace(/[^a-zA-Z0-9.\-_]/g, '') || 'thumb.png';
                const attachmentName = `thumb_${Date.now()}_${safeName}`;
                files.push(new AttachmentBuilder(buffer, { name: attachmentName }));
                section.setThumbnailAccessory(new ThumbnailBuilder().setURL(`attachment://${attachmentName}`));
                container.addSectionComponents(section);
                container.addActionRowComponents(new ActionRowBuilder().addComponents(editBtn));
            } else if (ref.imageUrl) {
                section.setThumbnailAccessory(new ThumbnailBuilder().setURL(ref.imageUrl));
                container.addSectionComponents(section);
                container.addActionRowComponents(new ActionRowBuilder().addComponents(editBtn));
            } else {
                section.setButtonAccessory(editBtn);
                container.addSectionComponents(section);
            }
        }
    }

    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );

    const actionRow = new ActionRowBuilder();

    if (totalPages > 1) {
        actionRow.addComponents(
            new ButtonBuilder()
                .setCustomId('iq_page_prev')
                .setLabel('◀')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId('iq_page_next')
                .setLabel('▶')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page >= totalPages - 1)
        );
    }

    actionRow.addComponents(
        new ButtonBuilder()
            .setCustomId('iq_refresh_list')
            .setLabel('🔄')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('iq_close_quarantine_list')
            .setLabel('Закрыть')
            .setStyle(ButtonStyle.Secondary)
    );

    container.addActionRowComponents(actionRow);

    return { container, files };
}

async function showQuarantineList(interaction, client, guildId, page = 0, isUpdate = false) {
    await interaction.deferUpdate().catch(() => {});

    try {
        const refs = await getAllDynamicReferences(guildId);
        const { container, files } = await buildQuarantineListContainer(guildId, page, refs);

        await interaction.editReply({
            components: [container],
            files: files.length > 0 ? files : [],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        }).catch(() => {});
    } catch (error) {
        logError(interaction.user, `[ImageQuarantine] list error: ${error.message}`);
        try {
            await interaction.editReply({
                content: 'Произошла ошибка.',
                components: [],
                files: []
            }).catch(() => {});
        } catch (e) { console.error(e); }
        return;
    }

    const msg = await interaction.fetchReply();
    const listCollector = msg.createMessageComponentCollector({ time: 120000 });

    listCollector.on('collect', async (i) => {
        if (i.user.id !== interaction.user.id) {
            await i.reply({
                content: "Это меню не для вас.",
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
            return;
        }

        if (i.customId === 'iq_close_quarantine_list') {
            listCollector.stop('close');
            await i.deferUpdate().catch(() => {});
            await i.editReply(await buildImageQuarantinePayload(client, guildId)).catch(() => {});
            return;
        }

        if (i.customId === 'iq_page_prev') {
            listCollector.stop('page');
            await showQuarantineList(i, client, guildId, page - 1, true);
            return;
        }

        if (i.customId === 'iq_page_next') {
            listCollector.stop('page');
            await showQuarantineList(i, client, guildId, page + 1, true);
            return;
        }

        if (i.customId === 'iq_refresh_list') {
            listCollector.stop('refresh');
            await showQuarantineList(i, client, guildId, 0, true);
            return;
        }

        if (i.customId.startsWith('iq_edit_ref_')) {
            const fileName = i.customId.replace('iq_edit_ref_', '');
            await showReferenceEditModal(i, client, guildId, fileName, msg);
        }
    });

    listCollector.on('end', async (c, r) => {
        if (r === 'time') {
            const timeoutContainer = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent('Время вышло.'));
            await interaction.editReply({ components: [timeoutContainer], files: [] }).catch(() => {});
        }
    });
}

async function showReferenceEditModal(interaction, client, guildId, fileName, listMsg) {
    const modalId = genModalId(`iq_modal_ref_${fileName}`);
    const modal = new ModalBuilder()
        .setCustomId(modalId)
        .setTitle('Удалить изображение');

    modal.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`Удалить ${fileName}?`)
    );

    modal.addLabelComponents(
        new LabelBuilder()
            .setLabel('Удалить изображение')
            .setDescription('Выберите "Да" для удаления запрещённого изображения из карантина')
            .setStringSelectMenuComponent(
                new StringSelectMenuBuilder()
                    .setCustomId(`iq_delete_ref_${fileName}`)
                    .addOptions(
                        new StringSelectMenuOptionBuilder()
                            .setLabel('Да, удалить')
                            .setValue('confirm_delete')
                            .setDescription('Удалит это изображение из карантина')
                            .setEmoji('❌'),
                        new StringSelectMenuOptionBuilder()
                            .setLabel('Отмена')
                            .setValue('cancel')
                            .setDescription('Оставить изображение в карантине')
                    )
            )
    );

    try {
        await interaction.showModal(modal);
    } catch (e) {
        logError(interaction.user, `[IQ] showReferenceEditModal: ${e.message}`);
        return;
    }

    try {
        const modalSubmit = await interaction.awaitModalSubmit({
            filter: (i) => i.customId === modalId && i.user.id === interaction.user.id,
            time: 120000
        });

        let selectValue;
        try {
            selectValue = modalSubmit.fields.getSelectMenuValue(`iq_delete_ref_${fileName}`);
        } catch {
            const field = modalSubmit.fields.getField(`iq_delete_ref_${fileName}`, ComponentType.StringSelect);
            selectValue = field.values?.[0];
        }

        if (selectValue === 'confirm_delete') {
            const ref = await getDb().collection('quarantine_references').findOne({ fileName, guildId });
            if (!ref) {
                await modalSubmit.reply({
                    content: '❌ Запись не найдена (возможно уже удалена).',
                    flags: MessageFlags.Ephemeral
                }).catch(() => {});
                return;
            }
            await removeDynamicReference(fileName, guildId);
            await modalSubmit.reply({
                content: `✅ Референс \`${fileName}\` удалён из карантина.`,
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        } else {
            await modalSubmit.reply({
                content: '❌ Действие отменено.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
            return;
        }

        if (listMsg) {
            try {
                const refs = await getAllDynamicReferences(guildId);
                const { container, files } = await buildQuarantineListContainer(guildId, 0, refs);
                await listMsg.edit({ components: [container], files: files.length > 0 ? files : [], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(() => {});
            } catch (e) {
                console.error(`[IQ] list refresh after delete: ${e.message}`);
            }
        }
    } catch (e) {
        if (e.code !== 'InteractionCollectorError') console.error('[IQ] ref edit modal error:', e.message);
    }
}

// ─── IQ DM Message Settings ─────────────────────────────────────────────────

async function showDMMenu(interaction, client, guildId) {
    await interaction.deferUpdate().catch(() => {});

    const s = await readSettings(guildId);
    const hasCustom = !!s.imageQuarantine.dmMessageText || !!s.imageQuarantine.dmMessageJson;

    const options = [
        new StringSelectMenuOptionBuilder()
            .setLabel('Текст')
            .setDescription('Написать текстовое уведомление с переменными')
            .setEmoji('✏️')
            .setValue('text'),
        new StringSelectMenuOptionBuilder()
            .setLabel('Загрузить .json')
            .setDescription('Загрузить кастомные компоненты из JSON')
            .setEmoji('📄')
            .setValue('json'),
    ];

    options.push(
        new StringSelectMenuOptionBuilder()
            .setLabel('Предпросмотр')
            .setDescription(hasCustom ? 'Показать как будет выглядеть уведомление' : 'Сначала задайте текст или загрузите JSON')
            .setEmoji('👁️')
            .setValue('preview')
    );

    if (hasCustom) {
        options.push(
            new StringSelectMenuOptionBuilder()
                .setLabel('Сбросить')
                .setDescription('Вернуть стандартное embed-уведомление')
                .setEmoji('🔄')
                .setValue('reset')
        );
    }

    try {
        const placeholder = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent('**▼ Настройка сообщения в ЛС:**'));
        const selectRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('iq_dm_menu_select')
                .setPlaceholder('Выберите действие...')
                .addOptions(...options)
        );
        await interaction.editReply({ components: [placeholder, selectRow], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        const selectMsg = await interaction.fetchReply();
        const selectCollector = selectMsg.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 120000 });

        selectCollector.on('collect', async (sel) => {
            try {
                selectCollector.stop();
                const action = sel.values[0];

                if (action === 'text') {
                    await showDMTextModal(sel, client, guildId);
                    const p = await buildImageQuarantinePayload(client, guildId);
                    await interaction.editReply(p).catch(() => {});
                    return;
                }
                if (action === 'json') {
                    await showDMJsonModal(sel, client, guildId);
                    const p = await buildImageQuarantinePayload(client, guildId);
                    await interaction.editReply(p).catch(() => {});
                    return;
                }

                const payload = await buildImageQuarantinePayload(client, guildId);
                await interaction.editReply(payload).catch(() => {});

                switch (action) {
                    case 'preview':
                        await sel.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
                        await showDMPreview(sel, client, guildId);
                        break;
                    case 'reset':
                        await updateSettingsMulti(guildId, {'imageQuarantine.dmMessageText': null, 'imageQuarantine.dmMessageJson': null});
                        await sel.update({
                            components: [new ContainerBuilder().addTextDisplayComponents(
                                new TextDisplayBuilder().setContent('✅ Сообщение сброшено на стандартное.')
                            )],
                            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                        }).catch(() => {});
                        break;
                }
            } catch (e) {
                logError(sel.user, `[IQ] showDMMenu collect: ${e.message}`);
            }
        });

        selectCollector.on('end', async (c, r) => {
            if (r === 'time') {
                const p = await buildImageQuarantinePayload(client, guildId);
                await interaction.editReply(p).catch(() => {});
            }
        });
    } catch (e) {
        logError(interaction.user, `[IQ] showDMMenu: ${e.message}`);
        const payload = await buildImageQuarantinePayload(client, guildId);
        await interaction.editReply(payload).catch(() => {});
    }
}

function getDefaultDMText() {
    return [
        '🚨 **Авто-карантин**',
        'Сервер: **{server.name}**',
        'Причина: отправка запрещённого изображения (`{matchedFile}`, совпадение: {similarity}%)',
        'Обратитесь к администрации для разблокировки.'
    ].join('\n');
}

async function showDMTextModal(interaction, client, guildId) {
    const settings = await readSettings(guildId);
    const currentText = settings.imageQuarantine.dmMessageText || getDefaultDMText();

    const modalId = genModalId('iq_modal_dm_text');
    const modal = new ModalBuilder()
        .setCustomId(modalId)
        .setTitle('Текст уведомления');

    modal.addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
            '**Доступные переменные (вставляются в текст):**',
            '`{server.name}` — название сервера',
            '`{server.id}` — ID сервера',
            '`{user.mention}` — упоминание пользователя',
            '`{user.tag}` — имя пользователя',
            '`{user.id}` — ID пользователя',
            '`{user.name}` — имя пользователя (глобальное)',
            '`{matchedFile}` — имя файла-совпадения',
            '`{similarity}` — процент совпадения',
            '`{imageUrl}` — ссылка на изображение'
        ].join('\n'))
    );

    modal.addLabelComponents(
        new LabelBuilder()
            .setLabel('Текст уведомления')
            .setDescription('Переменные из списка выше подставятся автоматически')
            .setTextInputComponent(
                new TextInputBuilder()
                    .setCustomId('iq_dm_text_input')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setValue(currentText)
                    .setMaxLength(2000)
            ),
        new LabelBuilder()
            .setLabel('Цвет (hex)')
            .setDescription('Например: #FF0000. Оставьте пустым для стандартного')
            .setTextInputComponent(
                new TextInputBuilder()
                    .setCustomId('iq_dm_color_input')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setValue(settings.imageQuarantine.dmColor || '')
                    .setMaxLength(7)
                    .setPlaceholder('#FF0000')
            )
    );

    try {
        await interaction.showModal(modal);
    } catch (e) {
        logError(interaction.user, `[IQ] showDMTextModal: ${e.message}`);
        return;
    }

    try {
        const modalSubmit = await interaction.awaitModalSubmit({
            filter: (i) => i.customId === modalId && i.user.id === interaction.user.id,
            time: 300000
        });
        const text = modalSubmit.fields.getTextInputValue('iq_dm_text_input');
        let color;
        try { color = modalSubmit.fields.getTextInputValue('iq_dm_color_input'); } catch { color = ''; }

        await updateSettingsMulti(guildId, {
            'imageQuarantine.dmMessageText': text,
            'imageQuarantine.dmMessageJson': null,
            'imageQuarantine.dmColor': color || null
        });

        await modalSubmit.reply({
            content: '✅ Текст уведомления обновлён.',
            flags: MessageFlags.Ephemeral
        }).catch(() => {});

        try {
            const previewVars = {
                serverName: modalSubmit.guild?.name || 'TestServer',
                serverId: guildId,
                userMention: `<@${modalSubmit.user.id}>`,
                userTag: modalSubmit.user.username,
                userId: modalSubmit.user.id,
                userName: modalSubmit.user.username,
                matchedFile: 'example.png',
                similarity: '92.5',
                imageUrl: 'https://example.com/preview.png'
            };
            const previewText = replaceVariables(text, previewVars);
            const c = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(previewText));
            if (color) {
                const colorInt = parseInt(color.replace('#', ''), 16);
                if (!isNaN(colorInt)) c.setAccentColor(colorInt);
            }
            await modalSubmit.followUp({
                components: [c],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
        } catch (previewErr) {
            if (previewErr.code !== 'InteractionCollectorError') console.warn('[IQ] dm text preview error:', previewErr.message);
        }
    } catch (e) {
        if (e.code !== 'InteractionCollectorError') console.error('[IQ] dm text modal error:', e.message);
    }
}

async function showDMPreview(interaction, client, guildId) {
    const s = await readSettings(guildId);
    const iq = s.imageQuarantine;

    if (!iq.dmMessageText && !iq.dmMessageJson) {
        const guild = interaction.guild;
        const previewVars = {
            serverName: guild?.name || 'TestServer',
            serverId: guild?.id || guildId,
            userMention: `<@${interaction.user.id}>`,
            userTag: interaction.user.username,
            userId: interaction.user.id,
            userName: interaction.user.username,
            matchedFile: 'example.png',
            similarity: '92.5',
            imageUrl: 'https://example.com/preview.png',
            channel: '#general',
            autoRemove: 'Да',
            sendDM: 'Да'
        };
        const text = replaceVariables(getDefaultDMText(), previewVars);
        const c = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
            .setAccentColor(15548997);
        await interaction.editReply({
            components: [c],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        }).catch(() => {});
        return;
    }

    const guild = interaction.guild;
    const vars = {
        serverName: guild?.name || 'TestServer',
        serverId: guildId,
        userMention: `<@${interaction.user.id}>`,
        userTag: interaction.user.username,
        userId: interaction.user.id,
        userName: interaction.user.username,
        matchedFile: 'example.png',
        similarity: '92.5',
        imageUrl: 'https://example.com/preview.png'
    };

    try {
        if (iq.dmMessageJson) {
            const parsed = JSON.parse(iq.dmMessageJson);
            const replaced = replaceVariablesInJSON(parsed, vars);
            const components = buildComponentsFromJSON(replaced);
            if (components.length > 0) {
                await interaction.editReply({
                    components,
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                }).catch(() => {});
                return;
            }
        }

        if (iq.dmMessageText) {
            const text = replaceVariables(iq.dmMessageText, vars);
            const c = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
            if (iq.dmColor) {
                const colorInt = parseInt(iq.dmColor.replace('#', ''), 16);
                if (!isNaN(colorInt)) c.setAccentColor(colorInt);
            }
            await interaction.editReply({
                components: [c],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            }).catch(() => {});
            return;
        }
    } catch (e) {
        await interaction.editReply({
            content: `❌ Ошибка предпросмотра: ${e.message}`,
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }
}

async function showDMJsonModal(interaction, client, guildId) {
    const modalId = genModalId('iq_modal_dm_json');
    const modal = new ModalBuilder()
        .setCustomId(modalId)
        .setTitle('Загрузить .json');

    modal.addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
            '**Формат JSON:** массив компонентов Discord v2.',
            '**Переменные:** `{server.name}`, `{server.id}`, `{user.mention}`, `{user.tag}`, `{user.id}`, `{user.name}`, `{matchedFile}`, `{similarity}`, `{imageUrl}`',
            'Переменные подставляются в поле `content` в TextDisplay.',
            '',
            '**Пример:**',
            '```json',
            '[{',
            '  "type": 10,',
            '  "content": "Привет, {user.mention}!"',
            '}]',
            '```'
        ].join('\n'))
    );

    modal.addLabelComponents(
        new LabelBuilder()
            .setLabel('Загрузите .json файл')
            .setFileUploadComponent(
                new FileUploadBuilder().setCustomId('iq_dm_json_upload')
            )
    );

    try {
        await interaction.showModal(modal);
    } catch (e) {
        logError(interaction.user, `[IQ] showDMJsonModal: ${e.message}`);
        return;
    }

    try {
        const modalSubmit = await interaction.awaitModalSubmit({
            filter: (i) => i.customId === modalId && i.user.id === interaction.user.id,
            time: 300000
        });

        const files = modalSubmit.fields.getUploadedFiles('iq_dm_json_upload');
        const attachment = files?.first();
        if (!attachment) {
            await modalSubmit.reply({
                content: '❌ Файл не найден.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
            return;
        }
        if (!attachment.name?.endsWith('.json')) {
            await modalSubmit.reply({
                content: '❌ Файл должен быть .json.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
            return;
        }

        const response = await fetch(attachment.url);
        const rawText = await response.text();
        if (rawText.length > 500 * 1024) {
            await modalSubmit.reply({
                content: '❌ Файл слишком большой (макс 500 KB).',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
            return;
        }

        let parsed;
        try {
            parsed = JSON.parse(rawText);
        } catch {
            await modalSubmit.reply({
                content: '❌ Некорректный JSON: синтаксическая ошибка.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
            return;
        }

        if (!Array.isArray(parsed)) {
            await modalSubmit.reply({
                content: '❌ JSON должен быть массивом компонентов (начинаться с `[` и заканчиваться `]`).',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
            return;
        }

        if (parsed.length === 0) {
            await modalSubmit.reply({
                content: '❌ Массив не может быть пустым.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
            return;
        }

        try {
            const testComponents = buildComponentsFromJSON(parsed);
            if (testComponents.length === 0) {
                await modalSubmit.reply({
                    content: '❌ Не удалось создать компоненты из JSON. Проверьте структуру.',
                    flags: MessageFlags.Ephemeral
                }).catch(() => {});
                return;
            }
        } catch (buildErr) {
            await modalSubmit.reply({
                content: `❌ Ошибка в структуре JSON: ${buildErr.message}`,
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
            return;
        }

        await updateSettingsMulti(guildId, {
            'imageQuarantine.dmMessageJson': rawText,
            'imageQuarantine.dmMessageText': null
        });

        await modalSubmit.reply({
            content: '✅ JSON загружен и прошёл валидацию.',
            flags: MessageFlags.Ephemeral
        }).catch(() => {});

        try {
            const previewVars = {
                serverName: modalSubmit.guild?.name || 'TestServer',
                serverId: guildId,
                userMention: `<@${modalSubmit.user.id}>`,
                userTag: modalSubmit.user.username,
                userId: modalSubmit.user.id,
                userName: modalSubmit.user.username,
                matchedFile: 'example.png',
                similarity: '92.5',
                imageUrl: 'https://example.com/preview.png'
            };
            const replaced = replaceVariablesInJSON(parsed, previewVars);
            const components = buildComponentsFromJSON(replaced);
            if (components.length > 0) {
                await modalSubmit.followUp({
                    components,
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
            }
        } catch (previewErr) {
            if (previewErr.code !== 'InteractionCollectorError') console.warn('[IQ] dm json preview error:', previewErr.message);
        }
    } catch (e) {
        if (e.code !== 'InteractionCollectorError') console.error('[IQ] dm json modal error:', e.message);
    }
}

// ─── IQ Log Settings ─────────────────────────────────────────────────────────

async function buildLogSettingsPayload(client, guildId) {
    const s = await readSettings(guildId);
    const iq = s.imageQuarantine;

    let logChannelLabel = 'Не задан';
    if (iq.logChannelId) {
        try {
            const ch = await client.channels.fetch(iq.logChannelId);
            logChannelLabel = ch ? `#${ch.name}` : `<#${iq.logChannelId}>`;
        } catch { logChannelLabel = `<#${iq.logChannelId}>`; }
    }

    const container = new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('### 📝 Настройка логирования')
        )
        .addSectionComponents(
            new SectionBuilder()
                .setButtonAccessory(new ButtonBuilder()
                    .setStyle((iq.logMessageText || iq.logMessageJson) ? ButtonStyle.Success : ButtonStyle.Secondary)
                    .setLabel(iq.logMessageText ? 'Текст' : iq.logMessageJson ? 'JSON' : 'Стандарт')
                    .setCustomId("iq_log_message_settings"))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("Сообщение в логах:")),
            new SectionBuilder()
                .setButtonAccessory(new ButtonBuilder()
                    .setStyle(iq.logChannelId ? ButtonStyle.Success : ButtonStyle.Danger)
                    .setLabel(logChannelLabel)
                    .setCustomId("iq_log_channel_modal"))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("Расширенные настройки:")),
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("iq_log_back")
                    .setLabel("Назад")
                    .setStyle(ButtonStyle.Secondary)
            )
        );

    return {
        components: [container],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    };
}

async function showLogSettings(interaction, client, guildId) {
    const payload = await buildLogSettingsPayload(client, guildId);

    if (interaction.isMessageComponent()) {
        await interaction.update(payload).catch(() => {});
    }

    const msg = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({ time: 900000 });

    collector.on("collect", async (i) => {
        if (i.user.id !== interaction.user.id) {
            await i.reply({ content: "Это меню не для вас.", flags: MessageFlags.Ephemeral }).catch(() => {});
            return;
        }

        switch (i.customId) {
            case "iq_log_channel_modal":
                await showLogChannelModal(i, client, msg, guildId);
                break;
            case "iq_log_message_settings":
                collector.stop();
                await showLogMessageMenu(i, client, guildId);
                break;
            case "iq_log_back":
                collector.stop();
                await showImageQuarantinePanel(i, client);
                break;
        }
    });

    collector.on('end', (c, r) => {
        if (r === 'time') interaction.editReply({ content: "Время вышло.", components: [] }).catch(() => {});
    });
}

async function showLogChannelModal(interaction, client, logMsg, guildId) {
    const s = await readSettings(guildId);
    const modalId = genModalId('iq_modal_log_channel');
    const modal = new ModalBuilder()
        .setCustomId(modalId)
        .setTitle('Канал и пинги');

    modal.addLabelComponents(
        new LabelBuilder()
            .setLabel('Канал логирования')
            .setChannelSelectMenuComponent(
                new ChannelSelectMenuBuilder()
                    .setCustomId('iq_log_channel_select')
                    .setPlaceholder('Выберите канал...')
                    .setChannelTypes([ChannelType.GuildText, ChannelType.GuildAnnouncement])
                    .setMinValues(1)
                    .setMaxValues(1)
            ),
        new LabelBuilder()
            .setLabel('Разрешить упоминания')
            .setDescription('Если включено — в логах будут упоминания пользователя (@user)')
            .setCheckboxComponent(
                new CheckboxBuilder()
                    .setCustomId('iq_log_mentions_checkbox')
                    .setDefault(!s.imageQuarantine.disableLogMentions)
            )
    );

    try {
        await interaction.showModal(modal);
    } catch (e) {
        logError(interaction.user, `[IQ] showLogChannelModal: ${e.message}`);
        return;
    }

    try {
        const modalSubmit = await interaction.awaitModalSubmit({
            filter: (i) => i.customId === modalId && i.user.id === interaction.user.id,
            time: 120000
        });

        let newChannelId;
        try {
            const channelField = modalSubmit.fields.getField('iq_log_channel_select', ComponentType.ChannelSelect);
            if (channelField.values?.length) newChannelId = channelField.values[0];
        } catch (e) { console.error(e); }

        const updates = {};
        if (newChannelId) updates['imageQuarantine.logChannelId'] = newChannelId;
        updates['imageQuarantine.disableLogMentions'] = !modalSubmit.fields.getCheckbox('iq_log_mentions_checkbox');
        await updateSettingsMulti(guildId, updates);

        await modalSubmit.reply({
            content: `✅ **Канал:** ${newChannelId ? `<#${newChannelId}>` : 'Не задан'} | **Пинги:** ${modalSubmit.fields.getCheckbox('iq_log_mentions_checkbox') ? 'Разрешены' : 'Заглушены'}`,
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
        await logMsg.edit(await buildLogSettingsPayload(client, guildId)).catch(() => {});
    } catch (e) {
        if (e.code !== 'InteractionCollectorError') console.error('[IQ] log channel modal error:', e.message);
    }
}

async function showLogMessageMenu(interaction, client, guildId) {
    await interaction.deferUpdate().catch(() => {});

    const s = await readSettings(guildId);
    const hasCustom = !!s.imageQuarantine.logMessageText || !!s.imageQuarantine.logMessageJson;

    const options = [
        new StringSelectMenuOptionBuilder()
            .setLabel('Текст')
            .setDescription('Написать текстовое уведомление с переменными')
            .setEmoji('✏️')
            .setValue('text'),
        new StringSelectMenuOptionBuilder()
            .setLabel('Загрузить .json')
            .setDescription('Загрузить кастомные компоненты из JSON')
            .setEmoji('📄')
            .setValue('json'),
    ];

    options.push(
        new StringSelectMenuOptionBuilder()
            .setLabel('Предпросмотр')
            .setDescription(hasCustom ? 'Показать как будет выглядеть уведомление' : 'Сначала задайте текст или загрузите JSON')
            .setEmoji('👁️')
            .setValue('preview')
    );

    if (hasCustom) {
        options.push(
            new StringSelectMenuOptionBuilder()
                .setLabel('Сбросить')
                .setDescription('Вернуть стандартное уведомление')
                .setEmoji('🔄')
                .setValue('reset')
        );
    }

    try {
        const placeholder = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent('**▼ Настройка сообщения в логах:**'));
        const selectRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('iq_log_menu_select')
                .setPlaceholder('Выберите действие...')
                .addOptions(...options)
        );
        await interaction.editReply({ components: [placeholder, selectRow], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        const selectMsg = await interaction.fetchReply();
        const selectCollector = selectMsg.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 120000 });

        selectCollector.on('collect', async (sel) => {
            try {
                selectCollector.stop();
                const action = sel.values[0];

                if (action === 'text') {
                    await showLogTextModal(sel, client, guildId);
                    const p = await buildLogSettingsPayload(client, guildId);
                    await interaction.editReply(p).catch(() => {});
                    return;
                }
                if (action === 'json') {
                    await showLogJsonModal(sel, client, guildId);
                    const p = await buildLogSettingsPayload(client, guildId);
                    await interaction.editReply(p).catch(() => {});
                    return;
                }

                const payload = await buildLogSettingsPayload(client, guildId);
                await interaction.editReply(payload).catch(() => {});

                switch (action) {
                    case 'preview':
                        await sel.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
                        await showLogPreview(sel, client, guildId);
                        break;
                    case 'reset':
                        await updateSettingsMulti(guildId, {
                            'imageQuarantine.logMessageText': null,
                            'imageQuarantine.logMessageJson': null,
                            'imageQuarantine.logColor': null
                        });
                        await sel.update({
                            components: [new ContainerBuilder().addTextDisplayComponents(
                                new TextDisplayBuilder().setContent('✅ Сообщение сброшено на стандартное.')
                            )],
                            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                        }).catch(() => {});
                        break;
                }
            } catch (e) {
                logError(sel.user, `[IQ] showLogMessageMenu collect: ${e.message}`);
            }
        });

        selectCollector.on('end', (c, r) => {
            if (r === 'time') {
                buildLogSettingsPayload(client, guildId).then(p => interaction.editReply(p).catch(() => {}));
            }
        });
    } catch (e) {
        logError(interaction.user, `[IQ] showLogMessageMenu: ${e.message}`);
        const payload = await buildLogSettingsPayload(client, guildId);
        await interaction.editReply(payload).catch(() => {});
    }
}

function getDefaultLogText() {
    return [
        '🚨 **Авто-карантин: запрещённое изображение**',
        '**Пользователь:** {user.mention} (`{user.id}`)',
        '**Канал:** {channel}',
        '**Совпадение:** {file} ({match}%)',
        '**Снятие ролей:** {auto.remove}',
        '**Отправка в ЛС:** {dm.sent.successfull}'
    ].join('\n');
}

async function showLogTextModal(interaction, client, guildId) {
    const settings = await readSettings(guildId);
    const currentText = settings.imageQuarantine.logMessageText || getDefaultLogText();

    const modalId = genModalId('iq_modal_log_text');
    const modal = new ModalBuilder()
        .setCustomId(modalId)
        .setTitle('Текст уведомления в логах');

    modal.addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
            '**Доступные переменные (вставляются в текст):**',
            '`{user.mention}` — упоминание пользователя',
            '`{user.id}` — ID пользователя',
            '`{user.name}` — имя пользователя (глобальное)',
            '`{channel}` — канал, где отправлено изображение',
            '`{file}` — имя файла-совпадения',
            '`{match}` — процент совпадения',
            '`{auto.remove}` — авто-снятие ролей (Да/Нет)',
            '`{dm.sent.successfull}` — результат отправки в ЛС (пусто если отключено)',
            '`{image}` — ссылка на изображение'
        ].join('\n'))
    );

    modal.addLabelComponents(
        new LabelBuilder()
            .setLabel('Текст уведомления')
            .setDescription('Переменные из списка выше подставятся автоматически')
            .setTextInputComponent(
                new TextInputBuilder()
                    .setCustomId('iq_log_text_input')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setValue(currentText)
                    .setMaxLength(2000)
            ),
        new LabelBuilder()
            .setLabel('Цвет (hex)')
            .setDescription('Например: #FF0000. Оставьте пустым для стандартного')
            .setTextInputComponent(
                new TextInputBuilder()
                    .setCustomId('iq_log_color_input')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setValue(settings.imageQuarantine.logColor || '')
                    .setMaxLength(7)
                    .setPlaceholder('#FF0000')
            )
    );

    try {
        await interaction.showModal(modal);
    } catch (e) {
        logError(interaction.user, `[IQ] showLogTextModal: ${e.message}`);
        return;
    }

    try {
        const modalSubmit = await interaction.awaitModalSubmit({
            filter: (i) => i.customId === modalId && i.user.id === interaction.user.id,
            time: 300000
        });
        const text = modalSubmit.fields.getTextInputValue('iq_log_text_input');
        let color;
        try { color = modalSubmit.fields.getTextInputValue('iq_log_color_input'); } catch { color = ''; }

        await updateSettingsMulti(guildId, {
            'imageQuarantine.logMessageText': text,
            'imageQuarantine.logMessageJson': null,
            'imageQuarantine.logColor': color || null
        });

        await modalSubmit.reply({
            content: '✅ Текст уведомления для логов обновлён.',
            flags: MessageFlags.Ephemeral
        }).catch(() => {});

        try {
            const previewVars = {
                userMention: `<@${modalSubmit.user.id}>`,
                userId: modalSubmit.user.id,
                userName: modalSubmit.user.username,
                channel: '#general',
                file: 'example.png',
                match: '92.5',
                autoRemove: 'Да',
                dmSentSuccessfull: 'Отправлено',
                image: 'https://example.com/preview.png'
            };
            const previewText = replaceLogVariables(text, previewVars);
            const c = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(previewText));
            if (color) {
                const colorInt = parseInt(color.replace('#', ''), 16);
                if (!isNaN(colorInt)) c.setAccentColor(colorInt);
            }
            await modalSubmit.followUp({
                components: [c],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
        } catch (previewErr) {
            if (previewErr.code !== 'InteractionCollectorError') console.warn('[IQ] log text preview error:', previewErr.message);
        }
    } catch (e) {
        if (e.code !== 'InteractionCollectorError') console.error('[IQ] log text modal error:', e.message);
    }
}

async function showLogJsonModal(interaction, client, guildId) {
    const modalId = genModalId('iq_modal_log_json');
    const modal = new ModalBuilder()
        .setCustomId(modalId)
        .setTitle('Загрузить .json для логов');

    modal.addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
            '**Формат JSON:** массив компонентов Discord v2.',
            '**Переменные:** `{user.mention}`, `{user.id}`, `{user.name}`, `{channel}`, `{file}`, `{match}`, `{auto.remove}`, `{dm.sent.successfull}`, `{image}`',
            'Переменные подставляются в поле `content` в TextDisplay.',
            '',
            '**Пример:**',
            '```json',
            '[{',
            '  "type": 10,',
            '  "content": "{user.mention} забанен за {file}"',
            '}]',
            '```'
        ].join('\n'))
    );

    modal.addLabelComponents(
        new LabelBuilder()
            .setLabel('Загрузите .json файл')
            .setFileUploadComponent(
                new FileUploadBuilder().setCustomId('iq_log_json_upload')
            )
    );

    try {
        await interaction.showModal(modal);
    } catch (e) {
        logError(interaction.user, `[IQ] showLogJsonModal: ${e.message}`);
        return;
    }

    try {
        const modalSubmit = await interaction.awaitModalSubmit({
            filter: (i) => i.customId === modalId && i.user.id === interaction.user.id,
            time: 300000
        });

        const files = modalSubmit.fields.getUploadedFiles('iq_log_json_upload');
        const attachment = files?.first();
        if (!attachment) {
            await modalSubmit.reply({
                content: '❌ Файл не найден.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
            return;
        }
        if (!attachment.name?.endsWith('.json')) {
            await modalSubmit.reply({
                content: '❌ Файл должен быть .json.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
            return;
        }

        const response = await fetch(attachment.url);
        const rawText = await response.text();
        if (rawText.length > 500 * 1024) {
            await modalSubmit.reply({
                content: '❌ Файл слишком большой (макс 500 KB).',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
            return;
        }

        let parsed;
        try {
            parsed = JSON.parse(rawText);
        } catch {
            await modalSubmit.reply({
                content: '❌ Некорректный JSON: синтаксическая ошибка.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
            return;
        }

        if (!Array.isArray(parsed)) {
            await modalSubmit.reply({
                content: '❌ JSON должен быть массивом компонентов (начинаться с `[` и заканчиваться `]`).',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
            return;
        }

        if (parsed.length === 0) {
            await modalSubmit.reply({
                content: '❌ Массив не может быть пустым.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
            return;
        }

        try {
            const testComponents = buildComponentsFromJSON(parsed);
            if (testComponents.length === 0) {
                await modalSubmit.reply({
                    content: '❌ Не удалось создать компоненты из JSON. Проверьте структуру.',
                    flags: MessageFlags.Ephemeral
                }).catch(() => {});
                return;
            }
        } catch (buildErr) {
            await modalSubmit.reply({
                content: `❌ Ошибка в структуре JSON: ${buildErr.message}`,
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
            return;
        }

        await updateSettingsMulti(guildId, {
            'imageQuarantine.logMessageJson': rawText,
            'imageQuarantine.logMessageText': null,
            'imageQuarantine.logColor': null
        });

        await modalSubmit.reply({
            content: '✅ JSON для логов загружен и прошёл валидацию.',
            flags: MessageFlags.Ephemeral
        }).catch(() => {});

        try {
            const previewVars = {
                userMention: `<@${modalSubmit.user.id}>`,
                userId: modalSubmit.user.id,
                userName: modalSubmit.user.username,
                channel: '#general',
                file: 'example.png',
                match: '92.5',
                autoRemove: 'Да',
                dmSentSuccessfull: 'Отправлено',
                image: 'https://example.com/preview.png'
            };
            const replaced = replaceLogVariablesInJSON(parsed, previewVars);
            const components = buildComponentsFromJSON(replaced);
            if (components.length > 0) {
                await modalSubmit.followUp({
                    components,
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
            }
        } catch (previewErr) {
            if (previewErr.code !== 'InteractionCollectorError') console.warn('[IQ] log json preview error:', previewErr.message);
        }
    } catch (e) {
        if (e.code !== 'InteractionCollectorError') console.error('[IQ] log json modal error:', e.message);
    }
}

async function showLogPreview(interaction, client, guildId) {
    const s = await readSettings(guildId);
    const iq = s.imageQuarantine;

    if (!iq.logMessageText && !iq.logMessageJson) {
        const container = new ContainerBuilder()
            .setAccentColor(10181046)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent('🚨 **Авто-карантин: запрещённое изображение**'),
                new TextDisplayBuilder().setContent(`**Пользователь:** <@${interaction.user.id}> (\`${interaction.user.id}\`)`),
                new TextDisplayBuilder().setContent(`**Канал:** ${guildId ? '#general' : 'example'}`),
                new TextDisplayBuilder().setContent('**Совпадение:** example.png (92.5%)'),
                new TextDisplayBuilder().setContent('**Снятие ролей:** Да'),
                new TextDisplayBuilder().setContent('**Уведомление в ЛС:** Да')
            );
        await interaction.editReply({
            components: [container],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        }).catch(() => {});
        return;
    }

    const vars = {
        userMention: `<@${interaction.user.id}>`,
        userId: interaction.user.id,
        userName: interaction.user.username,
        channel: '#general',
        file: 'example.png',
        match: '92.5',
        autoRemove: 'Да',
        dmSentSuccessfull: 'Отправлено',
        image: 'https://example.com/preview.png'
    };

    try {
        if (iq.logMessageJson) {
            const parsed = JSON.parse(iq.logMessageJson);
            const replaced = replaceLogVariablesInJSON(parsed, vars);
            const components = buildComponentsFromJSON(replaced);
            if (components.length > 0) {
                await interaction.editReply({
                    components,
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                }).catch(() => {});
                return;
            }
        }

        if (iq.logMessageText) {
            const text = replaceLogVariables(iq.logMessageText, vars);
            const c = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
            if (iq.logColor) {
                const colorInt = parseInt(iq.logColor.replace('#', ''), 16);
                if (!isNaN(colorInt)) c.setAccentColor(colorInt);
            }
            await interaction.editReply({
                components: [c],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            }).catch(() => {});
            return;
        }
    } catch (e) {
        await interaction.editReply({
            content: `❌ Ошибка предпросмотра: ${e.message}`,
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }
}
