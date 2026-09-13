import { MongoClient } from 'mongodb';

let client = null;
let db = null;
let connectionPromise = null;

export async function connectToMongo(mongoUri, dbName) {
    if (db) return;
    if (connectionPromise) return connectionPromise;

    connectionPromise = (async () => {
        try {
            client = new MongoClient(mongoUri, {
                maxPoolSize: 10,
                minPoolSize: 2,
                maxIdleTimeMS: 300000,
                serverSelectionTimeoutMS: 5000,
                connectTimeoutMS: 10000,
            });

            await client.connect();
            await client.db('admin').command({ ping: 1 });
            db = client.db(dbName);
            console.log(`[Mongo] Подключено к MongoDB: ${dbName}${mongoUri.includes('@') ? ' (с аутентификацией)' : ''}`);
        } catch (err) {
            client = null;
            connectionPromise = null;
            console.error(`[Mongo] Ошибка подключения: ${err.message}`);
            throw err;
        }
    })();

    return connectionPromise;
}

export async function ensureIndexes() {
    if (!db) return;
    try {
        await db.collection('quarantine_roles').createIndex(
            { userId: 1, guildId: 1 },
            { unique: true }
        );
        await db.collection('quarantine_references').createIndex(
            { guildId: 1, fileName: 1 },
            { unique: true }
        );
        console.log('[Mongo] Индексы созданы.');
    } catch (err) {
        console.error('[Mongo] Ошибка создания индексов:', err.message);
    }
}

export function getDb() {
    if (!db) throw new Error('[Mongo] MongoDB не подключён.');
    return db;
}

export async function closeMongoConnection() {
    if (client) {
        try {
            await client.close();
            console.log('[Mongo] Соединение закрыто.');
        } catch (err) {
            console.error(`[Mongo] Ошибка при закрытии: ${err.message}`);
        } finally {
            client = null;
            db = null;
        }
    }
}
