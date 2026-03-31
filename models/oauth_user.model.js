import mongoose from "mongoose";
const Schema = mongoose.Schema;

const accessRoleSchema = new Schema({
    adminId:   { type: Schema.Types.ObjectId, ref: "admin" },
    role:      { type: String, enum: ["viewer", "editor", "owner"], default: "viewer" },
    grantedAt: { type: Date, default: Date.now },
}, { _id: false });

const oauthUserSchema = new Schema(
    {
        userId:          { type: String, unique: true },
        access_token:    { type: String },
        refresh_token:   { type: String },
        googleEmail:     { type: String },
        googleName:      { type: String },
        customerIds:     { type: [String], default: [] },
        tokenRefreshedAt:{ type: Date, default: Date.now },
        // User access roles — which admin users can access this account's data
        accessRoles:     { type: [accessRoleSchema], default: [] },
    },
    { timestamps: { createdAt: "created", updatedAt: "updated" } }
);

export default mongoose.model("oauth_user", oauthUserSchema);
