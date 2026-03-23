import OAuthUser from './models/oauth_user.model.js';
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

async function initializeToken() {
    try {
        await mongoose.connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/gads");
        console.log('✅ Connected to MongoDB');

        // ── Static token data ─────────────────────────────────────────────────
        const userId        = 'user_1773920083090';
        const access_token  = 'ya29.a0ATkoCc7iOZYhVPvQZ1PNe4sccujdvuQ_fCfbuqICEWTQ6GNUDoQ-1xmuVFaBa8VPssdyFeXazOPNFBWo20iPncFmHxSE2cswZcg7H6IBkoSZK1Fqmq2l5zIT6LLl9jVijm7J4olbSvUbGNV4rj8NSNOB8xS5j5Nh3HK-LHgNVc2zf81ywtxBX9u83szSF8blOe8DKN6faCgYKAbYSARcSFQHGX2Mi-H7-dy8xSuMsrMsIMd_l7A0207';
        const refresh_token = '1//055E3C1emTPA2CgYIARAAGAUSNwF-L9IrzrpkLeysmn6kpGTHhxz9hlsVvt5iwtxgDa6SWFfm2RTIMaxSRZXMGzWuQeOMzOWiPg0';

        // Check if this userId already exists
        const existing = await OAuthUser.findOne({ userId });
        if (existing) {
            // Update tokens in case they changed
            await OAuthUser.updateOne(
                { userId },
                {
                    access_token,
                    refresh_token,
                    tokenRefreshedAt: new Date(),
                }
            );
            console.log('✅ OAuth token record updated (already existed)');
        } else {
            const oauthUser = new OAuthUser({
                userId,
                access_token,
                refresh_token,
                tokenRefreshedAt: new Date(),
            });

            await oauthUser.save();
            console.log('✅ OAuth token record created successfully');
        }

        console.log(`   userId: ${userId}`);

        await mongoose.connection.close();
        console.log('✅ Token initialization complete');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

initializeToken();
