import Admin from './models/admin.model.js';
import bcrypt from "bcrypt";
import mongoose from "mongoose";

const SALT_ROUNDS = 10;

async function initializeDatabase() {

    try {
        await mongoose.connect("mongodb://127.0.0.1:27017/gads" || 'mongodb://127.0.0.1:27017/gads');
        console.log('✅ Connected to MongoDB');
        const email = 'sanket@clickmatix.com'
        const password = 'SuperAdmin@272'

        const admin_acc = new Admin({
            email: email,
            password: password,
        });

        await admin_acc.save();
        console.log('✅ Super admin created successfully');
        console.log('   Email: sanket@clickmatix.com');
        console.log('   Password: SuperAdmin@272');

        //         bcrypt.hash(password, SALT_ROUNDS, async (err, hash) => {
        //             if (err) return res.status(500).json({ message: "Password hashing failed" });

        //             const admin_save = new Admin({
        //                 email: email,
        //                 password: password,
        //             });
        // console.log(admin_save)
        //             await admin_save.save();
        //             console.log('✅ Admin created successfully');
        //             console.log('   Email: sanket@clickmatix.com');
        //             console.log('   Password: SuperAdmin@272');
        //         });

        await mongoose.connection.close();
        console.log('✅ Database initialization complete');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

initializeDatabase();