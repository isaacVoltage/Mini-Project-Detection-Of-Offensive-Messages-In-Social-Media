// init-db.js
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

const initializeDB = async () => {
    try {
        // Connect to MongoDB
        await mongoose.connect('mongodb://localhost/chatroom', {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('Connected to MongoDB');

        // Define Schemas
        const UserSchema = new mongoose.Schema({
            username: { type: String, unique: true, required: true },
            password: { type: String, required: true },
            isAdmin: { type: Boolean, default: false }
        });

        const MessageSchema = new mongoose.Schema({
            content: { type: String, required: true },
            user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            username: String,
            timestamp: { type: Date, default: Date.now }
        });

        // Create or get existing models
        const User = mongoose.models.User || mongoose.model('User', UserSchema);
        const Message = mongoose.models.Message || mongoose.model('Message', MessageSchema);

        // Check if admin exists
        const existingAdmin = await User.findOne({ username: "admin" });
        if (!existingAdmin) {
            const adminPassword = "admin123";
            const hashedPassword = await bcrypt.hash(adminPassword, 10);
            
            const adminUser = new User({
                username: "admin",
                password: hashedPassword,
                isAdmin: true
            });

            await adminUser.save();
            console.log('Admin user created successfully');
        } else {
            console.log('Admin user already exists');
        }

        // Check if test user exists
        const existingTestUser = await User.findOne({ username: "testuser" });
        if (!existingTestUser) {
            const testUser = new User({
                username: "testuser",
                password: await bcrypt.hash("test123", 10),
                isAdmin: false
            });

            await testUser.save();
            console.log('Test user created successfully');
        } else {
            console.log('Test user already exists');
        }

        // Check if welcome message exists
        const existingMessage = await Message.findOne({ content: "Welcome to the chat room!" });
        if (!existingMessage) {
            const adminUser = await User.findOne({ username: "admin" });
            const testMessage = new Message({
                content: "Welcome to the chat room!",
                user: adminUser._id,
                username: "admin"
            });

            await testMessage.save();
            console.log('Welcome message created successfully');
        } else {
            console.log('Welcome message already exists');
        }

        console.log('Database initialization completed');
    } catch (error) {
        console.error('Error initializing database:', error);
    } finally {
        await mongoose.connection.close();
    }
};

initializeDB();