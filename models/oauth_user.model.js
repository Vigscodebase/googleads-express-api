import mongoose from "mongoose";

const Schema = mongoose.Schema;

// Stores Google OAuth users (people who connected their Google Ads account)
const oauthUserSchema = new Schema(
    {
        // A stable unique ID we generate at OAuth callback time
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
        // Google account profile info (fetched at OAuth callback time)
        googleEmail: {
            type: String,
        },
        googleName: {
            type: String,
        },
        // Google Ads customer IDs accessible by this account (fetched & cached at OAuth time)
        customerIds: {
            type: [String],
            default: [],
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
