import mongoose from "mongoose";

const Schema = mongoose.Schema;

// Stores dashboard login users (admin accounts that can access home.html)
const adminSchema = new Schema(
    {
        fullname: {
            type: String,
        },
        email: {
            type: String,
            unique: true,
        },
        password: {
            type: String,  // bcrypt hashed
        },
        role: {
            type: String,
            enum: ['super_admin', 'user'],
            default: 'user'
        },
        oauthUserIds: {
            type: [String],
            default: []
        },
        accessUserIds: {
            type: [String],
            default: []
        },
        // Active session tokens for this admin user
        sessions: [
            {
                token: { type: String },
                createdAt: { type: Date, default: Date.now },
            }
        ],
    },
    {
        timestamps: {
            createdAt: "created",
            updatedAt: "updated",
        },
    }
);

export default mongoose.model("admin", adminSchema);
