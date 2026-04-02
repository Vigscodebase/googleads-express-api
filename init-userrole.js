import Role from "./models/role.js"
import mongoose from "mongoose"

async function initializeUserRole() {

    try {

        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/gads');

        const roleArray = new Map([["super_admin", "Super Admin"], ["user", "User"]])

        for (const [key, value] of roleArray) {
            const roleAdd = new Role({
                role_slug: key,
                role_name: value,
            });
            await roleAdd.save();
        };

        console.log('✅ Roles created successfully');

        await mongoose.connection.close();
        console.log('✅ Roles initialization complete');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

initializeUserRole();