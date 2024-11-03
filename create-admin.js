// create-admin.js
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

dotenv.config();

const createAdmin = async () => {
    try {
        await mongoose.connect('mongodb://localhost:27017/chatroom', {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('Connected to MongoDB');

        // Define Schema
        const UserSchema = new mongoose.Schema({
            username: { type: String, unique: true, required: true },
            password: { type: String, required: true },
            isAdmin: { type: Boolean, default: false }
        });

        // Create model
        const User = mongoose.models.User || mongoose.model('User', UserSchema);

        // First, delete existing admin if any
        await User.deleteOne({ username: 'admin' });
        console.log('Cleaned up existing admin user');

        // Create new admin user
        const plainPassword = 'admin123';
        const hashedPassword = await bcrypt.hash(plainPassword, 10);
        
        const adminUser = new User({
            username: 'admin',
            password: hashedPassword,
            isAdmin: true
        });

        await adminUser.save();
        console.log('Admin user created with:');
        console.log('Username:', adminUser.username);
        console.log('IsAdmin:', adminUser.isAdmin);
        console.log('Password (plain):', plainPassword);

        // Verify admin user
        const verifyAdmin = await User.findOne({ username: 'admin' });
        console.log('\nVerifying admin user in database:');
        console.log('Found:', verifyAdmin ? 'Yes' : 'No');
        console.log('IsAdmin:', verifyAdmin?.isAdmin);

    } catch (error) {
        console.error('Error creating admin:', error);
    } finally {
        await mongoose.connection.close();
    }
};

createAdmin();