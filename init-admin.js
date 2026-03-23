import Admin from './models/admin.model.js';
import bcrypt from "bcrypt";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const SALT_ROUNDS = 10;

async function initializeAdmin() {
    try {
        await mongoose.connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/gads");
        console.log('✅ Connected to MongoDB');

        const email    = 'sanket@clickmatix.com';
        const password = 'SuperAdmin@272';

        // Check if already exists
        const existing = await Admin.findOne({ email });
        if (existing) {
            console.log('⚠️  Admin already exists with this email, skipping.');
            await mongoose.connection.close();
            process.exit(0);
        }

        // Hash password properly with await
        const hash = await bcrypt.hash(password, SALT_ROUNDS);

        const admin = new Admin({
            fullname: 'Super Admin',
            username: 'superadmin',
            email:    email,
            password: hash,
            sessions: [],
        });

        await admin.save();

        console.log('✅ Super admin created successfully');
        console.log('   Email:    sanket@clickmatix.com');
        console.log('   Password: SuperAdmin@272');

        await mongoose.connection.close();
        console.log('✅ Database initialization complete');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

initializeAdmin();
