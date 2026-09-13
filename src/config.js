import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

export default {
    CLIENT_ID: process.env.CLIENT_ID || ''
}
