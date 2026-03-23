import mongoose from "mongoose";

const Schema = mongoose.Schema;

// Stores Google OAuth users (people who connected their Google Ads account)
// Replaces the old users.json file completely
const oauthUserSchema = new Schema(
    {
        // A stable unique ID we generate at OAuth callback time
        // Replaces the old "user_1773920083090" key from users.json
        userId: {
            type: String,
            unique: true,
        },
        // Google OAuth tokens
        access_token: {
            type: String,
        },
        refresh_token: {
            type: String,
        },
        // Optional: store Google account info if you call userinfo endpoint
        googleEmail: {
            type: String,
        },
        googleName: {
            type: String,
        },
        // Track when the access token was last refreshed
        tokenRefreshedAt: {
            type: Date,
            default: Date.now,
        },
    },
    {
        timestamps: {
            createdAt: "created",
            updatedAt: "updated",
        },
    }
);

export default mongoose.model("oauth_user", oauthUserSchema);
