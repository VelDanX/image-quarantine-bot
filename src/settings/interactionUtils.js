import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from 'discord.js';

const LEGACY_FIELDS = ['content', 'embeds', 'stickers', 'poll'];

export function assertNoLegacyFields(label, payload, isV2Target = null) {
    const v2 = isV2Target === null
        ? !!(payload && (payload.flags & MessageFlags.IsComponentsV2))
        : isV2Target;
    if (!v2) return [];
    const bad = LEGACY_FIELDS.filter(f => payload && payload[f] != null);
    if (bad.length > 0) {
        console.error(
            `[${label}] Поля ${bad.join(', ')} нельзя отправлять вместе с IsComponentsV2. ` +
            'Discord отклонит payload с 50035 MESSAGE_CANNOT_USE_LEGACY_FIELDS_WITH_COMPONENTS_V2. ' +
            'Текст нужно передавать как TextDisplay — см. textComponents().'
        );
    }
    return bad;
}

export function textComponents(text) {
    return [
        new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
    ];
}

export async function resolveMessage(interaction) {
    if (interaction.message) return interaction.message;
    if (typeof interaction.fetchReply !== 'function') {
        throw new Error('resolveMessage: у взаимодействия нет ни message, ни fetchReply');
    }
    return interaction.fetchReply();
}

const BENIGN_INTERACTION_CODES = new Set([
    10008,
    10015,
    40060
]);

export function isBenignInteractionError(error) {
    return BENIGN_INTERACTION_CODES.has(error?.code);
}

export const MAX_MESSAGE_COMPONENTS = 40;

export function countComponents(components) {
    let total = 0;
    const walk = node => {
        const json = typeof node?.toJSON === 'function' ? node.toJSON() : node;
        if (!json || typeof json !== 'object') return;
        total += 1;

        const children = json.components;
        if (Array.isArray(children)) children.forEach(walk);
        if (json.accessory) walk(json.accessory);
    };
    if (Array.isArray(components)) components.forEach(walk);
    else walk(components);
    return total;
}

const SELECT_TYPES = new Set([3, 5, 6, 7, 8]);

export function assertLayout(label, components) {
    const rows = [];
    const walk = node => {
        const json = typeof node?.toJSON === 'function' ? node.toJSON() : node;
        if (!json || typeof json !== 'object') return;
        if (json.type === 1 && Array.isArray(json.components)) {
            const kids = json.components;
            const selects = kids.filter(k => SELECT_TYPES.has(k.type));
            if (selects.length > 0 && kids.length > 1) {
                rows.push(`строка ${kids.map(k => `${k.type}:${k.custom_id || '—'}`).join(' + ')}`);
            }
        }
        if (Array.isArray(json.components)) json.components.forEach(walk);
        if (json.accessory) walk(json.accessory);
    };
    if (Array.isArray(components)) components.forEach(walk);
    else walk(components);

    if (rows.length > 0) {
        console.error(
            `[${label}] Селект в строке с другими компонентами: ${rows.join('; ')}. ` +
            'Селект занимает всю ширину строки, Discord отклонит payload с 50035 ' +
            'COMPONENT_LAYOUT_WIDTH_EXCEEDED. Нужен отдельный ActionRow.'
        );
    }
    return rows;
}

export function assertComponentLimit(label, components) {
    const total = countComponents(components);
    if (total > MAX_MESSAGE_COMPONENTS) {
        console.error(
            `[${label}] Превышен лимит компонентов: ${total} > ${MAX_MESSAGE_COMPONENTS}. ` +
            'Discord отклонит payload с 50035, и пользователь увидит «did\'t respond in time».'
        );
    }
    assertLayout(label, components);
    return total;
}

export async function respondWithPanel(interaction, payload, label = 'SETTINGS') {
    assertNoLegacyFields(label, payload);
    assertComponentLimit(label, payload.components);
    const sent = await sendPanel(() => {
        if (typeof interaction.isMessageComponent === 'function' && interaction.isMessageComponent()) {
            return interaction.update(payload);
        }
        if (interaction.replied || interaction.deferred) {
            return interaction.editReply(payload);
        }
        return interaction.reply(payload);
    }, label);
    return sent || resendPanel(interaction, payload, label);
}

export async function renderPanel(message, payload, label = 'SETTINGS', liveInteraction = null) {
    assertNoLegacyFields(label, payload);
    assertComponentLimit(label, payload.components);
    const sent = await sendPanel(() => message.edit(payload), label);
    return sent || resendPanel(liveInteraction, payload, label);
}

async function resendPanel(interaction, payload, label) {
    if (!interaction || typeof interaction.followUp !== 'function') return null;
    const fresh = { components: payload.components, flags: (payload.flags | MessageFlags.Ephemeral) };
    try {
        const message = await interaction.followUp(fresh);
        console.log(`[${label}] Панель отправлена заново отдельным сообщением`);
        return message;
    } catch (error) {
        console.log(`[${label}] Повторно отправить панель не удалось (${error.code || ''}): ${error.message}`);
        return null;
    }
}

async function sendPanel(send, label) {
    try {
        return await send();
    } catch (error) {
        if (isBenignInteractionError(error)) {
            console.log(`[${label}] Взаимодействие уже неактуально (${error.code}): ${error.message}`);
            return null;
        }

        console.error(`[${label}] Не удалось отправить панель: ${error.code || ''} ${error.message}`.trim());
        if (error.stack) console.error(error.stack);
        return null;
    }
}

export async function runGuarded(user, label, fn, interaction) {
    try {
        await fn();
    } catch (error) {
        if (isBenignInteractionError(error)) {
            console.log(`[${label}] Взаимодействие уже неактуально (${error.code}): ${error.message}`);
        } else {

            console.error(`[ERROR] [${label}] ${user?.tag || 'unknown'}: ${error.message}`);
            if (error.stack) console.error(error.stack);
        }
        if (interaction && !interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: 'Не удалось применить изменение. Попробуйте ещё раз.',
                flags: MessageFlags.Ephemeral
            }).catch(() => null);
        }
    }
}
