import mongoose from "mongoose";

const Schema = mongoose.Schema;

const roleschema = new Schema({
    role_slug: {
        type: String,
        required: true,
        unique: true,
        enum: ["super_admin", "admin", "sales_manager", "finance_manager", "hod_account_manager", "account_manager", "marketing_manager", "development_manager", "seo_teamleader", "seo_executive", "gads_manager", "gads_executive", "meta_ads_manager", "meta_ads_executive", "socialmedia_manager", "socialmedia_executive", "email_marketing_manager", "email_marketing_executive", "accountant", "marketing_manager", "user"],
    },
    role_name: {
        type: String,
        required: true,
    },
},
    {
        timestamps: {
            createdAt: "created",
            updatedAt: "updated"
        }

    });

export default mongoose.model("Role", roleschema);