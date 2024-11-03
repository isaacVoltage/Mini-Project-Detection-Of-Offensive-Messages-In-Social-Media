// server.js
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import Filter from 'bad-words';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const http = createServer(app);
const io = new Server(http);

// Custom filter configuration
const customFilter = new Filter();

// Add custom bad words
const customBadWords = [
    'idiot',
    'stupid',
    'maniac'
];

// Configure the filter
customFilter.addWords(...customBadWords);

// Warning message
const warningMessage = "⚠️ Warning: Please avoid using inappropriate language in the chat room.";

// Track online users
const onlineUsers = new Map();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ 
        mongoUrl: process.env.MONGODB_URI || 'mongodb://localhost:27017/chatroom'
    }),
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 1000 * 60 * 60 * 24
    }
}));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chatroom', {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// Models
const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    isAdmin: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

const MessageSchema = new mongoose.Schema({
    content: { type: String, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    username: String,
    timestamp: { type: Date, default: Date.now },
    isOffensive: { type: Boolean, default: false }
});

const User = mongoose.model('User', UserSchema);
const Message = mongoose.model('Message', MessageSchema);

// Middleware to check admin access
const checkAdmin = async (req, res, next) => {
    if (!req.session.isAdmin) {
        return res.redirect('/admin-login.html');
    }
    next();
};

// Routes
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/welcome.html');
});

// User Registration
app.post('/register', async (req, res) => {
    try {
        const existingUser = await User.findOne({ username: req.body.username });
        if (existingUser) {
            return res.json({ success: false, error: 'Username already exists' });
        }

        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        const user = new User({
            username: req.body.username,
            password: hashedPassword
        });
        await user.save();
        res.json({ success: true });
    } catch (error) {
        console.error('Registration error:', error);
        res.json({ success: false, error: 'Registration failed' });
    }
});

// User Login
app.post('/login', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.body.username });
        if (user && await bcrypt.compare(req.body.password, user.password)) {
            req.session.userId = user._id;
            req.session.username = user.username;
            req.session.isAdmin = user.isAdmin;
            res.json({ success: true, userId: user._id, isAdmin: user.isAdmin });
        } else {
            res.json({ success: false, error: 'Invalid credentials' });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.json({ success: false, error: 'Login failed' });
    }
});

// Admin Login
app.post('/admin/login', async (req, res) => {
    try {
        const admin = await User.findOne({ 
            username: req.body.username,
            isAdmin: true 
        });
        
        if (admin && await bcrypt.compare(req.body.password, admin.password)) {
            req.session.userId = admin._id;
            req.session.username = admin.username;
            req.session.isAdmin = true;
            res.json({ success: true, userId: admin._id });
        } else {
            res.json({ success: false, error: 'Invalid admin credentials' });
        }
    } catch (error) {
        console.error('Admin login error:', error);
        res.json({ success: false, error: 'Admin login failed' });
    }
});

// Protected admin routes
app.get('/admin-dashboard.html', checkAdmin, (req, res) => {
    res.sendFile(__dirname + '/public/admin-dashboard.html');
});

// Admin API routes
app.get('/api/messages', checkAdmin, async (req, res) => {
    try {
        const messages = await Message.find().sort('-timestamp');
        res.json(messages);
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

app.get('/api/users', checkAdmin, async (req, res) => {
    try {
        const users = await User.find({ isAdmin: false }).select('-password');
        res.json(users);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// Logout route
app.post('/logout', (req, res) => {
    const username = req.session.username;
    req.session.destroy((err) => {
        if (err) {
            return res.json({ success: false, error: 'Logout failed' });
        }
        // Remove user from online users if they exist
        for (const [socketId, user] of onlineUsers.entries()) {
            if (user.username === username) {
                onlineUsers.delete(socketId);
                break;
            }
        }
        io.emit('online_users', Array.from(onlineUsers.values()));
        res.json({ success: true });
    });
});

// Socket.IO events
io.on('connection', (socket) => {
    console.log('User connected');
    
    socket.on('join', async (username) => {
        try {
            socket.username = username;
            
            // Find user's ID from database
            const user = await User.findOne({ username: username });
            
            onlineUsers.set(socket.id, {
                username: username,
                socketId: socket.id,
                userId: user ? user._id.toString() : null  // Include userId for ban functionality
            });
            
            const messages = await Message.find()
                .sort('-timestamp')
                .limit(50);
            socket.emit('load_messages', messages);
            
            io.emit('online_users', Array.from(onlineUsers.values()));
        } catch (error) {
            console.error('Error in join event:', error);
        }
    });

    socket.on('send_message', async (data) => {
        try {
            const isOffensive = customFilter.isProfane(data.message);
            
            const message = new Message({
                content: data.message,
                user: data.userId,
                username: socket.username,
                isOffensive: isOffensive,
                timestamp: new Date()
            });

            await message.save();

            if (isOffensive) {
                // Send warning to user
                socket.emit('warning_message', {
                    message: warningMessage
                });

                // Notify admins
                adminIo.emit('offensive_message_alert', {
                    username: socket.username,
                    message: data.message,
                    timestamp: new Date()
                });
            }

            io.emit('new_message', {
                message: {
                    _id: message._id,
                    content: message.content,
                    username: message.username,
                    timestamp: message.timestamp,
                    isOffensive: message.isOffensive
                }
            });

        } catch (error) {
            console.error('Error sending message:', error);
            socket.emit('error', { message: 'Failed to send message' });
        }
    });

    socket.on('disconnect', () => {
        onlineUsers.delete(socket.id);
        io.emit('online_users', Array.from(onlineUsers.values()));
        console.log('User disconnected');
    });
});

// Admin socket namespace
const adminIo = io.of('/admin');
adminIo.on('connection', (socket) => {
    console.log('Admin connected');

    socket.emit('online_users', Array.from(onlineUsers.values()));

    socket.on('delete_message', async (messageId) => {
        try {
            await Message.findByIdAndDelete(messageId);
            io.emit('message_deleted', messageId);
        } catch (error) {
            console.error('Error deleting message:', error);
            socket.emit('error', { message: 'Failed to delete message' });
        }
    });

    socket.on('ban_user', async (userId) => {
        try {
            const user = await User.findById(userId);
            if (user && !user.isAdmin) {
                // Find user's socket
                for (const [socketId, onlineUser] of onlineUsers.entries()) {
                    if (onlineUser.username === user.username) {
                        io.to(socketId).emit('you_are_banned', {
                            message: 'You have been banned from the chat room.'
                        });
                        
                        const userSocket = io.sockets.sockets.get(socketId);
                        if (userSocket) {
                            userSocket.disconnect(true);
                        }
                        
                        onlineUsers.delete(socketId);
                        break;
                    }
                }

                // Delete user's messages and account
                await Message.deleteMany({ user: userId });
                await User.findByIdAndDelete(userId);
                
                io.emit('user_banned', {
                    userId,
                    username: user.username,
                    message: `${user.username} has been banned from the chat room.`
                });
                
                io.emit('online_users', Array.from(onlineUsers.values()));
            }
        } catch (error) {
            console.error('Error banning user:', error);
            socket.emit('error', { message: 'Failed to ban user' });
        }
    });
});

// Start server
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});