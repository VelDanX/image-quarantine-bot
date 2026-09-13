import {
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} from 'discord.js';
import { readSettings } from './settings/core.js';
import { checkImageMatch, buildComponentsFromJSON, concurrentMap } from './imageQuarantine.js';
import { getDb } from './mongo.js';
import { logError, logInfo } from './logger.js';

const QUARANTINE_COLLECTION = 'quarantine_roles';

const jsonTemplateCache = new Map();
const JSON_CACHE_MAX_SIZE = 50;

function getOrParseJson(str) {
    if (!str) return null;
    const cached = jsonTemplateCache.get(str);
    if (cached) {
        jsonTemplateCache.delete(str);
        jsonTemplateCache.set(str, cached);
        return cached;
    }
    try {
        const parsed = JSON.parse(str);
        if (jsonTemplateCache.size >= JSON_CACHE_MAX_SIZE) {
            const oldestKey = jsonTemplateCache.keys().next().value;
            jsonTemplateCache.delete(oldestKey);
        }
        jsonTemplateCache.set(str, parsed);
        return parsed;
    } catch {
        return null;
    }
}

function isIgnored(member, settings) {
    const iq = settings.imageQuarantine;
    if (iq.ignoredUsers?.includes(member.id)) return true;
    if (iq.ignoredRoles && member.roles.cache.some(r => iq.ignoredRoles.includes(r.id))) return true;
    return false;
}

const IMAGE_URL_REGEX = /https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|gif|webp|bmp)(?:\?[^\s"'<>]*)?/gi;
const IMAGE_EXT_REGEX = /\.(jpg|jpeg|png|gif|webp|bmp)(\?|$)/i;

function extractImageUrlsFromContent(content) {
    if (!content) return [];
    return [...content.matchAll(IMAGE_URL_REGEX)].map(m => m[0]);
}

function isImageAttachment(att) {
    return att.contentType?.startsWith('image/') || IMAGE_EXT_REGEX.test(att.url);
}

export function collectImageUrls(msg) {
    const urls = [];

    for (const att of msg.attachments?.values() || []) {
        if (isImageAttachment(att)) urls.push(att.url);
    }

    for (const embed of msg.embeds || []) {
        if (embed.image?.url) urls.push(embed.image.url);
        if (embed.thumbnail?.url) urls.push(embed.thumbnail.url);
    }

    if (msg.content) {
        urls.push(...extractImageUrlsFromContent(msg.content));
    }

    for (const snapshot of msg.messageSnapshots?.values() || []) {
        for (const att of snapshot.attachments?.values() || []) {
            if (isImageAttachment(att)) urls.push(att.url);
        }
        for (const embed of snapshot.embeds || []) {
            if (embed.image?.url) urls.push(embed.image.url);
            if (embed.thumbnail?.url) urls.push(embed.thumbnail.url);
        }
        if (snapshot.content) {
            urls.push(...extractImageUrlsFromContent(snapshot.content));
        }
    }

    return [...new Set(urls)];
}

export async function handleMessage(msg, client) {
    try {
        if (!msg.guild || msg.author.bot) return;

        const guildId = msg.guild.id;
        const settings = await readSettings(guildId);
        const iq = settings.imageQuarantine;

        if (!iq.enabled) return;
        if (isIgnored(msg.member, settings)) return;

        const imageUrls = collectImageUrls(msg);
        if (imageUrls.length === 0) return;

        const results = await concurrentMap(imageUrls, async (url) => {
            const match = await checkImageMatch(url, guildId, iq.similarityThreshold);
            return match ? { match, url } : null;
        });

        const found = results.find(Boolean);
        if (found) {
            await applyQuarantine(msg, client, found.match, iq, guildId, found.url);
        }
    } catch (error) {
        logError(msg?.author, `[Handler] Ошибка: ${error.message}`);
    }
}

export function replaceVariables(text, vars) {
    return text
        .replace(/\{server\.name\}/g, vars.serverName)
        .replace(/\{server\.id\}/g, vars.serverId)
        .replace(/\{user\.mention\}/g, vars.userMention)
        .replace(/\{user\.tag\}/g, vars.userTag)
        .replace(/\{user\.id\}/g, vars.userId)
        .replace(/\{user\.name\}/g, vars.userName)
        .replace(/\{matchedFile\}/g, vars.matchedFile)
        .replace(/\{similarity\}/g, vars.similarity)
        .replace(/\{imageUrl\}/g, vars.imageUrl)
        .replace(/\{channel\}/g, vars.channel)
        .replace(/\{autoRemove\}/g, vars.autoRemove)
        .replace(/\{sendDM\}/g, vars.sendDM);
}

export function replaceVariablesInJSON(data, vars) {
    if (typeof data === 'string') return replaceVariables(data, vars);
    if (Array.isArray(data)) return data.map(item => replaceVariablesInJSON(item, vars));
    if (data && typeof data === 'object') {
        const result = {};
        for (const [key, value] of Object.entries(data)) {
            if (key === 'content') {
                result[key] = typeof value === 'string' ? replaceVariables(value, vars) : value;
            } else {
                result[key] = replaceVariablesInJSON(value, vars);
            }
        }
        return result;
    }
    return data;
}

export function replaceLogVariables(text, vars) {
    return text
        .replace(/\{user\.mention\}/g, vars.userMention)
        .replace(/\{user\.id\}/g, vars.userId)
        .replace(/\{user\.name\}/g, vars.userName)
        .replace(/\{channel\}/g, vars.channel)
        .replace(/\{file\}/g, vars.file)
        .replace(/\{match\}/g, vars.match)
        .replace(/\{auto\.remove\}/g, vars.autoRemove)
        .replace(/\{dm\.sent\.successfull\}/g, vars.dmSentSuccessfull)
        .replace(/\{image\}/g, vars.image);
}

export function replaceLogVariablesInJSON(data, vars) {
    if (typeof data === 'string') return replaceLogVariables(data, vars);
    if (Array.isArray(data)) return data.map(item => replaceLogVariablesInJSON(item, vars));
    if (data && typeof data === 'object') {
        const result = {};
        for (const [key, value] of Object.entries(data)) {
            if (key === 'content') {
                result[key] = typeof value === 'string' ? replaceLogVariables(value, vars) : value;
            } else {
                result[key] = replaceLogVariablesInJSON(value, vars);
            }
        }
        return result;
    }
    return data;
}

async function sendQuarantineDM(msg, iq, match, guildId, imageUrl) {
    if (!iq.sendDM) return { sent: false, disabled: true };

    const dmVars = {
        serverName: msg.guild.name,
        serverId: msg.guild.id,
        userMention: `<@${msg.author.id}>`,
        userTag: msg.author.tag,
        userId: msg.author.id,
        userName: msg.author.username,
        matchedFile: match.matchedFile,
        similarity: (match.similarity * 100).toFixed(1),
        imageUrl,
        channel: msg.channel.toString(),
        autoRemove: iq.autoRemoveRoles ? 'Да' : 'Нет',
        sendDM: iq.sendDM ? 'Да' : 'Нет'
    };

    try {
        if (iq.dmMessageJson) {
            try {
                const jsonData = getOrParseJson(iq.dmMessageJson);
                if (Array.isArray(jsonData)) {
                    const replacedData = replaceVariablesInJSON(jsonData, dmVars);
                    const components = buildComponentsFromJSON(replacedData);
                    if (components.length > 0) {
                        await msg.author.send({ components, flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
                        return { sent: true };
                    }
                }
            } catch (e) {
                console.error('[Handler] DM JSON error:', e.message);
            }
        }

        if (iq.dmMessageText) {
            const text = replaceVariables(iq.dmMessageText, dmVars);
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
            if (iq.dmColor) {
                const colorInt = parseInt(iq.dmColor.replace('#', ''), 16);
                if (!isNaN(colorInt)) container.setAccentColor(colorInt);
            }
            await msg.author.send({
                components: [container],
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [] }
            });
            return { sent: true };
        }

        const container = new ContainerBuilder()
            .setAccentColor(15548997)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent('⛔ **Вам выдан карантин**'),
            )
            .addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent('**Наказание:** Карантин'),
                new TextDisplayBuilder().setContent('**Длительность:** бессрочно'),
                new TextDisplayBuilder().setContent(`**Причина:** Отправка запрещённого изображения (\`${match.matchedFile}\`, совпадение: ${(match.similarity * 100).toFixed(1)}%)`),
                new TextDisplayBuilder().setContent('**Кто наказал:** System (auto)'),
            );

        await msg.author.send({
            components: [container],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] }
        });
        return { sent: true };
    } catch (dmErr) {
        if (dmErr.code !== 50007) console.error('[Handler] DM error:', dmErr.message);
        return { sent: false, error: dmErr.message || 'Unknown error' };
    }
}

async function applyQuarantine(msg, client, match, iq, guildId, imageUrl) {
    await msg.delete().catch(e => logError(null, e));

    const member = msg.member;
    if (!member) return;

    const dmResult = await sendQuarantineDM(msg, iq, match, guildId, imageUrl);

    const autoRemove = iq.autoRemoveRoles;

    if (iq.logChannelId) {
        try {
            const logChannel = await client.channels.fetch(iq.logChannelId);
            if (logChannel?.isTextBased()) {

                const logVars = {
                    userMention: `<@${msg.author.id}>`,
                    userId: msg.author.id,
                    userName: msg.author.username,
                    channel: msg.channel.toString(),
                    file: match.matchedFile,
                    match: (match.similarity * 100).toFixed(1),
                    autoRemove: autoRemove ? 'Да' : 'Нет',
                    dmSentSuccessfull: dmResult.disabled ? '' : dmResult.sent ? 'Отправлено' : `Ошибка: ${dmResult.error}`,
                    image: imageUrl
                };

                let logSent = false;

                if (iq.logMessageJson) {
                    try {
                        const jsonData = getOrParseJson(iq.logMessageJson);
                        if (Array.isArray(jsonData)) {
                            const replacedData = replaceLogVariablesInJSON(jsonData, logVars);
                            const components = buildComponentsFromJSON(replacedData);
                            if (components.length > 0) {
                                const payload = { components, flags: MessageFlags.IsComponentsV2 };
                                if (iq.disableLogMentions) payload.allowedMentions = { parse: [] };
                                await logChannel.send(payload);
                                logSent = true;
                            }
                        }
                    } catch (e) {
                        console.error('[Handler] Log JSON error:', e.message);
                    }
                }

                if (!logSent && iq.logMessageText) {
                    const text = replaceLogVariables(iq.logMessageText, logVars);
                    const container = new ContainerBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
                    if (iq.logColor) {
                        const colorInt = parseInt(iq.logColor.replace('#', ''), 16);
                        if (!isNaN(colorInt)) container.setAccentColor(colorInt);
                    }
                    const payload = { components: [container], flags: MessageFlags.IsComponentsV2 };
                    if (iq.disableLogMentions) payload.allowedMentions = { parse: [] };
                    await logChannel.send(payload);
                    logSent = true;
                }

                if (!logSent) {
                    const container = new ContainerBuilder()
                        .setAccentColor(10181046)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent('🚨 **Авто-карантин: запрещённое изображение**'),
                            new TextDisplayBuilder().setContent(`**Пользователь:** ${msg.author} (\`${msg.author.id}\`)`),
                            new TextDisplayBuilder().setContent(`**Канал:** ${msg.channel}`),
                            new TextDisplayBuilder().setContent(`**Совпадение:** ${match.matchedFile} (${(match.similarity * 100).toFixed(1)}%)`),
                            new TextDisplayBuilder().setContent(`**Снятие ролей:** ${autoRemove ? 'Да' : 'Нет'}`),
                            new TextDisplayBuilder().setContent(`**Уведомление в ЛС:** ${iq.sendDM ? 'Да' : 'Нет'}`)
                        );

                    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

                    const payload = { components: [container], flags: MessageFlags.IsComponentsV2 };
                    if (iq.disableLogMentions) payload.allowedMentions = { parse: [] };
                    await logChannel.send(payload);
                }
            }
        } catch (chErr) {
            console.error('[Handler] Log channel error:', chErr.message);
        }
    }

    const quarantineRoleId = iq.quarantineRoleId;
    if (!quarantineRoleId) return;

    const everyoneId = member.guild.roles.everyone.id;
    const keepRoles = iq.keepRoles || [];

    try {
        let currentRoles = [];
        if (autoRemove) {
            currentRoles = member.roles.cache
                .filter(r => r.id !== everyoneId && r.id !== quarantineRoleId && !keepRoles.includes(r.id))
                .map(r => r.id);
        } else {
            currentRoles = member.roles.cache
                .filter(r => r.id !== everyoneId && r.id !== quarantineRoleId)
                .map(r => r.id);
        }

        const db = getDb();
        await db.collection(QUARANTINE_COLLECTION).updateOne(
            { userId: member.id, guildId },
            {
                $set: { quarantinedAt: new Date(), reason: 'image_quarantine', matchedFile: match.matchedFile, similarity: match.similarity, imageUrl },
                $setOnInsert: { roles: currentRoles }
            },
            { upsert: true }
        );

        if (autoRemove) {
            const rolesToSet = [quarantineRoleId, ...keepRoles.filter(id => member.roles.cache.has(id))];
            await member.roles.set(rolesToSet, `Авто-карантин (запрещённое изображение: ${match.matchedFile})`);
        } else {
            await member.roles.add(quarantineRoleId, `Авто-карантин (запрещённое изображение: ${match.matchedFile})`);
        }

        logInfo(msg.author, `[Карантин] ${msg.author.tag} — совпадение: ${match.matchedFile} (${(match.similarity * 100).toFixed(1)}%)`);

    } catch (err) {
        logError(msg.author, `[Handler] applyQuarantine: ${err.message}`);
    }
}

export async function restoreRolesOnQuarantineRemoval(member) {
    try {
        const guildId = member.guild.id;
        const settings = await readSettings(guildId);
        const quarantineRoleId = settings.imageQuarantine.quarantineRoleId;

        if (quarantineRoleId && !member.roles.cache.has(quarantineRoleId)) {
            const db = getDb();
            const data = await db.collection(QUARANTINE_COLLECTION).findOne({
                userId: member.id,
                guildId
            });

            if (data) {
                if (data.roles?.length > 0) {
                    const toAdd = data.roles.filter(roleId => {
                        if (member.roles.cache.has(roleId)) return false;
                        const role = member.guild.roles.cache.get(roleId);
                        return role && role.editable;
                    });
                    if (toAdd.length > 0) {
                        await member.roles.add(toAdd, 'Восстановление после карантина').catch(e => console.error(`[Handler] restore roles: ${e.message}`));
                    }
                }
                await db.collection(QUARANTINE_COLLECTION).deleteOne({ userId: member.id, guildId });
                logInfo(member.user, `[Handler] Роли восстановлены для ${member.user.tag}`);
            }
        }
    } catch (error) {
        console.error(`[Handler] restoreRoles error: ${error.message}`);
    }
}

export async function restoreRolesOnStartup(client) {
    try {
        const db = getDb();
        const records = await db.collection(QUARANTINE_COLLECTION).find({}).toArray();
        if (records.length === 0) return;

        logInfo(null, `[Handler] Восстановление ролей для ${records.length} записей карантина...`);

        const byGuild = new Map();
        for (const record of records) {
            if (!byGuild.has(record.guildId)) byGuild.set(record.guildId, []);
            byGuild.get(record.guildId).push(record);
        }

        await concurrentMap([...byGuild.entries()], async ([guildId, guildRecords]) => {
            const guild = client.guilds.cache.get(guildId);
            if (!guild) return;

            await guild.members.fetch().catch(() => {});

            for (const record of guildRecords) {
                try {
                    const member = guild.members.cache.get(record.userId);
                    if (!member) continue;

                    const settings = await readSettings(guildId);
                    const quarantineRoleId = settings.imageQuarantine.quarantineRoleId;

                    if (quarantineRoleId && !member.roles.cache.has(quarantineRoleId)) {
                        const toAdd = (record.roles || []).filter(roleId => {
                            if (member.roles.cache.has(roleId)) return false;
                            const role = guild.roles.cache.get(roleId);
                            return role && role.editable;
                        });
                        if (toAdd.length > 0) {
                            await member.roles.add(toAdd, 'Восстановление после карантина (startup)');
                        }
                        await db.collection(QUARANTINE_COLLECTION).deleteOne({ _id: record._id });
                        logInfo(null, `[Handler] Роли восстановлены при старте для ${member.user.tag}`);
                    }
                } catch (e) {
                    console.error(`[Handler] startup restore error: ${e.message}`);
                }
            }
        }, 10);
    } catch (error) {
        console.error('[Handler] Ошибка восстановления ролей при старте:', error);
    }
}
