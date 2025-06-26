const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const session = require('express-session');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 8000;
const CONFIG_FILE = path.join(__dirname, 'config.json');
const ADMIN_UI_DIR = path.join(__dirname, 'admin-ui');

// Middleware
app.use(express.json());
app.use(cors({
    origin: '*',
    methods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Range', 'Content-Type', 'Accept-Ranges', 'Authorization'],
    exposedHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges']
}));

app.use(session({
    secret: 'audio-server-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Configuration management
let config = {};

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const configData = fs.readFileSync(CONFIG_FILE, 'utf8');
            config = JSON.parse(configData);
        } else {
            // Default configuration
            config = {
                settings: {
                    timezone: "Asia/Kolkata",
                    adminPassword: "admin123",
                    defaultCollectionPath: "./collections",
                    jwtSecret: "your-secret-key-change-this",
                    emailEnabled: false,
                    smtpSettings: {
                        host: "smtp.gmail.com",
                        port: 587,
                        user: "",
                        password: ""
                    }
                },
                users: {},
                userSchedules: {},
                activeSchedules: [],
                collections: {},
                schedules: {}
            };
            saveConfig();
        }
    } catch (error) {
        console.error('Error loading config:', error);
        config = { settings: {}, collections: {}, schedules: {}, activeSchedules: [] };
    }
}

function saveConfig() {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    } catch (error) {
        console.error('Error saving config:', error);
    }
}

// Time and scheduling utilities
function isTimeInSchedule(schedule) {
    const now = new Date();
    const timezone = schedule.timeSlots[0]?.timezone || config.settings.timezone || 'Asia/Kolkata';
    
    try {
        // Get current time in the specified timezone
        const timeFormatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
        const currentTime = timeFormatter.format(now);
        
        const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
        const currentDate = now.toISOString().split('T')[0];
        
        console.log(`[Schedule Check] ${schedule.name}:`);
        console.log(`  Current time: ${currentTime} (${timezone})`);
        console.log(`  Current day: ${currentDay} (0=Sun, 1=Mon...)`);
        console.log(`  Current date: ${currentDate}`);
        
        // Check date range
        if (schedule.dateRange && schedule.dateRange.startDate && currentDate < schedule.dateRange.startDate) {
            console.log(`  ❌ Before start date: ${schedule.dateRange.startDate}`);
            return false;
        }
        if (schedule.dateRange && schedule.dateRange.endDate && currentDate > schedule.dateRange.endDate) {
            console.log(`  ❌ After end date: ${schedule.dateRange.endDate}`);
            return false;
        }
        
        // Check time slots
        for (const slot of schedule.timeSlots) {
            console.log(`  Checking slot: ${slot.startTime}-${slot.endTime}, days: ${slot.dayOfWeek}`);
            
            // Check day of week
            if (slot.dayOfWeek !== '*') {
                const allowedDays = slot.dayOfWeek.split(',').map(d => parseInt(d));
                if (!allowedDays.includes(currentDay)) {
                    console.log(`  ❌ Day ${currentDay} not in allowed days: ${allowedDays}`);
                    continue;
                }
            }
            
            // Check time range - convert times to minutes for easier comparison
            const currentMinutes = timeToMinutes(currentTime);
            const startMinutes = timeToMinutes(slot.startTime);
            const endMinutes = timeToMinutes(slot.endTime);
            
            console.log(`  Time comparison: ${currentMinutes} (${currentTime}) between ${startMinutes} (${slot.startTime}) and ${endMinutes} (${slot.endTime})`);
            
            if (currentMinutes >= startMinutes && currentMinutes <= endMinutes) {
                console.log(`  ✅ Schedule is ACTIVE!`);
                return true;
            }
        }
        
        console.log(`  ❌ Schedule is not active`);
        return false;
    } catch (error) {
        console.error('Error checking schedule:', error);
        return false;
    }
}

function timeToMinutes(timeString) {
    const [hours, minutes] = timeString.split(':').map(Number);
    return hours * 60 + minutes;
}

// Authentication middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, config.settings.jwtSecret, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
}

// Generate JWT token
function generateToken(user) {
    return jwt.sign(
        { userId: user.id, email: user.email, name: user.name },
        config.settings.jwtSecret,
        { expiresIn: '24h' }
    );
}

// User management functions
function createUser(userData) {
    const userId = uuidv4();
    const hashedPassword = bcrypt.hashSync(userData.password, 10);
    
    const user = {
        id: userId,
        name: userData.name,
        email: userData.email.toLowerCase(),
        password: hashedPassword,
        verified: false,
        createdAt: new Date().toISOString(),
        schedules: []
    };
    
    config.users[userId] = user;
    config.userSchedules[userId] = [];
    saveConfig();
    
    return user;
}

function findUserByEmail(email) {
    return Object.values(config.users).find(user => user.email === email.toLowerCase());
}

function getUserSchedules(userId) {
    const userSchedules = config.userSchedules[userId] || [];
    const currentTime = new Date();
    
    return userSchedules.map(scheduleId => {
        const schedule = config.schedules[scheduleId];
        if (!schedule) return null;
        
        return {
            id: scheduleId,
            name: schedule.name,
            collection: schedule.collection,
            enabled: schedule.enabled,
            dayOfWeek: schedule.timeSlots[0]?.dayOfWeek || '*',
            startTime: schedule.timeSlots[0]?.startTime || '',
            endTime: schedule.timeSlots[0]?.endTime || '',
            isActive: schedule.enabled && isTimeInSchedule(schedule)
        };
    }).filter(s => s !== null);
}

function getUserAvailableFiles(userId) {
    const userSchedules = getUserSchedules(userId);
    const activeUserSchedules = userSchedules.filter(s => s.isActive);
    const activeFiles = [];
    
    activeUserSchedules.forEach(schedule => {
        const collection = config.collections[schedule.collection];
        if (collection && collection.files) {
            collection.files.forEach(file => {
                if (!activeFiles.some(f => f.name === file)) {
                    activeFiles.push({
                        name: file,
                        url: `/${encodeURIComponent(file)}`,
                        collection: schedule.collection,
                        schedule: schedule.id
                    });
                }
            });
        }
    });
    
    return activeFiles;
}

function getActiveFiles() {
    const activeFiles = [];
    
    console.log('\n=== Checking Active Files ===');
    console.log(`Total schedules: ${Object.keys(config.schedules).length}`);
    
    // Check all enabled schedules
    Object.entries(config.schedules).forEach(([scheduleId, schedule]) => {
        console.log(`\nSchedule: ${scheduleId} (${schedule.name})`);
        console.log(`  Enabled: ${schedule.enabled}`);
        
        if (!schedule.enabled) {
            console.log(`  ❌ Schedule is disabled`);
            return;
        }
        
        const isActive = isTimeInSchedule(schedule);
        console.log(`  Time check result: ${isActive}`);
        
        if (isActive) {
            const collection = config.collections[schedule.collection];
            console.log(`  Collection: ${schedule.collection}`);
            
            if (collection && collection.files) {
                console.log(`  Files in collection: ${collection.files.length}`);
                collection.files.forEach(file => {
                    if (!activeFiles.some(f => f.name === file)) {
                        console.log(`  ✅ Adding file: ${file}`);
                        activeFiles.push({
                            name: file,
                            url: `/${encodeURIComponent(file)}`,
                            collection: schedule.collection,
                            schedule: scheduleId
                        });
                    }
                });
            } else {
                console.log(`  ❌ Collection not found or no files: ${schedule.collection}`);
            }
        }
    });
    
    console.log(`\nTotal active files: ${activeFiles.length}`);
    console.log('===============================\n');
    
    return activeFiles;
}

// Authentication routes
app.post('/auth/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        
        // Validate input
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email, and password are required' });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters long' });
        }
        
        // Check if user already exists
        if (findUserByEmail(email)) {
            return res.status(400).json({ error: 'User with this email already exists' });
        }
        
        // Create user
        const user = createUser({ name, email, password });
        
        // Generate token
        const token = generateToken(user);
        
        console.log(`✅ New user registered: ${email}`);
        
        res.json({
            message: 'User registered successfully',
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                verified: user.verified
            }
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Find user
        const user = findUserByEmail(email);
        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        
        // Check password
        const isValidPassword = bcrypt.compareSync(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        
        // Generate token
        const token = generateToken(user);
        
        console.log(`✅ User logged in: ${email}`);
        
        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                verified: user.verified
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

app.get('/auth/me', authenticateToken, (req, res) => {
    const user = config.users[req.user.userId];
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            verified: user.verified
        }
    });
});

// User-specific routes
app.get('/user/schedules', authenticateToken, (req, res) => {
    const schedules = getUserSchedules(req.user.userId);
    res.json(schedules);
});

app.get('/user/available-files', authenticateToken, (req, res) => {
    const files = getUserAvailableFiles(req.user.userId);
    res.json({ audioFiles: files });
});

app.get('/user/stats', authenticateToken, (req, res) => {
    const userSchedules = getUserSchedules(req.user.userId);
    const availableFiles = getUserAvailableFiles(req.user.userId);
    const activeSchedules = userSchedules.filter(s => s.isActive);
    
    res.json({
        totalSchedules: userSchedules.length,
        activeSchedules: activeSchedules.length,
        availableFiles: availableFiles.length
    });
});

// Serve admin UI
app.use('/admin', express.static(ADMIN_UI_DIR));

// Admin API endpoints
app.get('/admin/config', (req, res) => {
    res.json(config);
});

app.post('/admin/config', (req, res) => {
    config = { ...config, ...req.body };
    saveConfig();
    res.json({ success: true });
});

app.get('/admin/status', (req, res) => {
    const activeSchedules = Object.entries(config.schedules)
        .filter(([id, schedule]) => schedule.enabled && isTimeInSchedule(schedule))
        .map(([id, schedule]) => ({ id, name: schedule.name }));
    
    res.json({
        serverTime: new Date().toISOString(),
        timezone: config.settings.timezone,
        activeSchedules,
        totalCollections: Object.keys(config.collections).length,
        totalSchedules: Object.keys(config.schedules).length
    });
});

app.get('/admin/collections', (req, res) => {
    res.json(config.collections);
});

app.post('/admin/collections', (req, res) => {
    const { name, path, files } = req.body;
    const id = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    
    config.collections[id] = {
        name,
        path,
        files: files || []
    };
    
    saveConfig();
    res.json({ success: true, id });
});

app.put('/admin/collections/:id', (req, res) => {
    const { id } = req.params;
    const { name, path, files } = req.body;
    
    if (!config.collections[id]) {
        return res.status(404).json({ error: 'Collection not found' });
    }
    
    config.collections[id] = {
        name,
        path,
        files: files || []
    };
    
    saveConfig();
    res.json({ success: true });
});

app.delete('/admin/collections/:id', (req, res) => {
    const { id } = req.params;
    delete config.collections[id];
    saveConfig();
    res.json({ success: true });
});

app.get('/admin/schedules', (req, res) => {
    res.json(config.schedules);
});

app.post('/admin/schedules', (req, res) => {
    const schedule = req.body;
    const id = schedule.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    
    // Ensure schedule uses the system timezone
    if (schedule.timeSlots) {
        schedule.timeSlots.forEach(slot => {
            slot.timezone = config.settings.timezone || 'Asia/Kolkata';
        });
    }
    
    config.schedules[id] = schedule;
    saveConfig();
    res.json({ success: true, id });
});

app.put('/admin/schedules/:id', (req, res) => {
    const { id } = req.params;
    const schedule = req.body;
    
    if (!config.schedules[id]) {
        return res.status(404).json({ error: 'Schedule not found' });
    }
    
    // Ensure schedule uses the system timezone
    if (schedule.timeSlots) {
        schedule.timeSlots.forEach(slot => {
            slot.timezone = config.settings.timezone || 'Asia/Kolkata';
        });
    }
    
    config.schedules[id] = schedule;
    saveConfig();
    res.json({ success: true });
});

app.post('/admin/schedules/:id/toggle', (req, res) => {
    const { id } = req.params;
    if (config.schedules[id]) {
        config.schedules[id].enabled = !config.schedules[id].enabled;
        saveConfig();
        res.json({ success: true, enabled: config.schedules[id].enabled });
    } else {
        res.status(404).json({ error: 'Schedule not found' });
    }
});

app.delete('/admin/schedules/:id', (req, res) => {
    const { id } = req.params;
    delete config.schedules[id];
    saveConfig();
    res.json({ success: true });
});

app.get('/admin/browse', (req, res) => {
    const browsePath = req.query.path || './collections';
    const fullPath = path.resolve(__dirname, browsePath);
    
    try {
        const items = fs.readdirSync(fullPath).map(item => {
            const itemPath = path.join(fullPath, item);
            const stats = fs.statSync(itemPath);
            
            return {
                name: item,
                // For files, just use the filename (not full path)
                // For directories, use the relative path
                path: stats.isDirectory() ? path.relative(__dirname, itemPath) : item,
                fullPath: path.relative(__dirname, itemPath), // Keep full path for reference
                type: stats.isDirectory() ? 'directory' : 'file',
                size: stats.size,
                isAudio: item.toLowerCase().endsWith('.mp3')
            };
        });
        
        console.log(`\n📁 Browsing: ${browsePath}`);
        items.forEach(item => {
            console.log(`  ${item.type === 'directory' ? '📁' : '📄'} ${item.name} -> ${item.path}`);
        });
        
        res.json(items.filter(item => item.type === 'directory' || item.isAudio));
    } catch (error) {
        console.error('Browse error:', error);
        res.status(500).json({ error: 'Unable to browse directory' });
    }
});

app.post('/admin/settings', (req, res) => {
    const oldTimezone = config.settings.timezone;
    config.settings = { ...config.settings, ...req.body };
    
    // If timezone changed, update all existing schedules
    if (req.body.timezone && req.body.timezone !== oldTimezone) {
        console.log(`\n🕒 Timezone changed from ${oldTimezone} to ${req.body.timezone}`);
        console.log('Updating all existing schedules...');
        
        Object.entries(config.schedules).forEach(([scheduleId, schedule]) => {
            if (schedule.timeSlots) {
                schedule.timeSlots.forEach(slot => {
                    console.log(`  Updated ${scheduleId}: ${slot.timezone} -> ${req.body.timezone}`);
                    slot.timezone = req.body.timezone;
                });
            }
        });
        
        console.log('All schedules updated to use new timezone\n');
    }
    
    saveConfig();
    res.json({ success: true });
});

// Admin user management endpoints
app.get('/admin/users', (req, res) => {
    res.json(config.users || {});
});

app.post('/admin/users/assign-schedule', (req, res) => {
    const { userId, scheduleId } = req.body;
    
    if (!config.users[userId]) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    if (!config.schedules[scheduleId]) {
        return res.status(404).json({ error: 'Schedule not found' });
    }
    
    // Initialize user schedules if needed
    if (!config.userSchedules[userId]) {
        config.userSchedules[userId] = [];
    }
    
    // Add schedule if not already assigned
    if (!config.userSchedules[userId].includes(scheduleId)) {
        config.userSchedules[userId].push(scheduleId);
        saveConfig();
        console.log(`✅ Assigned schedule "${scheduleId}" to user "${config.users[userId].name}"`);
    }
    
    res.json({ success: true });
});

app.post('/admin/users/remove-schedules', (req, res) => {
    const { userId } = req.body;
    
    if (!config.users[userId]) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    // Remove all schedules for this user
    config.userSchedules[userId] = [];
    saveConfig();
    
    console.log(`✅ Removed all schedules from user "${config.users[userId].name}"`);
    res.json({ success: true });
});

app.post('/admin/reset', (req, res) => {
    config = {
        settings: {
            timezone: "Asia/Kolkata",
            adminPassword: "admin123",
            defaultCollectionPath: "./collections"
        },
        activeSchedules: [],
        collections: {},
        schedules: {}
    };
    saveConfig();
    res.json({ success: true });
});

// Audio file serving with schedule checking
app.get('/*.mp3', (req, res) => {
    const filename = decodeURIComponent(req.path.substring(1));
    console.log(`\n🎵 Audio request for: ${filename}`);
    
    const activeFiles = getActiveFiles();
    console.log(`Active files: ${activeFiles.map(f => f.name).join(', ')}`);
    
    // Check if file is currently available
    const isFileActive = activeFiles.some(file => file.name === filename);
    console.log(`Is file active: ${isFileActive}`);
    
    if (!isFileActive) {
        console.log(`❌ File not available: ${filename}`);
        return res.status(403).json({ 
            error: 'File not available at this time',
            message: 'This audio file is only available during scheduled times.'
        });
    }
    
    // Find the file in collections
    let filePath = null;
    console.log(`Searching for file in collections...`);
    
    Object.entries(config.collections).forEach(([collectionId, collection]) => {
        console.log(`  Checking collection: ${collectionId} (${collection.name})`);
        console.log(`    Path: ${collection.path}`);
        console.log(`    Files: ${collection.files?.join(', ') || 'none'}`);
        
        if (collection.files && collection.files.includes(filename)) {
            const potentialPath = path.join(__dirname, collection.path, filename);
            console.log(`    Potential path: ${potentialPath}`);
            console.log(`    File exists: ${fs.existsSync(potentialPath)}`);
            
            if (fs.existsSync(potentialPath)) {
                filePath = potentialPath;
                console.log(`    ✅ Found file at: ${filePath}`);
            }
        }
    });
    
    if (!filePath || !fs.existsSync(filePath)) {
        console.log(`❌ File not found in any collection: ${filename}`);
        return res.status(404).send('File not found');
    }
    
    console.log(`🎵 Serving file: ${filePath}`);
    
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;
    
    // Set content type and headers
    res.set({
        'Content-Type': 'audio/mpeg',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache'
    });
    
    if (range) {
        // Handle range requests for audio streaming
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        
        const file = fs.createReadStream(filePath, { start, end });
        
        res.status(206);
        res.set({
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Content-Length': chunksize
        });
        
        file.pipe(res);
    } else {
        // Send entire file
        res.set('Content-Length', fileSize);
        const file = fs.createReadStream(filePath);
        file.pipe(res);
    }
});

// Public API endpoints
app.get('/api/files', (req, res) => {
    const activeFiles = getActiveFiles();
    res.json({ audioFiles: activeFiles });
});

app.get('/api/status', (req, res) => {
    const activeFiles = getActiveFiles();
    const activeSchedules = Object.entries(config.schedules)
        .filter(([id, schedule]) => schedule.enabled && isTimeInSchedule(schedule))
        .map(([id, schedule]) => ({ id, name: schedule.name }));
    
    res.json({
        filesAvailable: activeFiles.length,
        activeSchedules: activeSchedules.length,
        serverTime: new Date().toISOString(),
        timezone: config.settings.timezone
    });
});

// Serve main interface
app.get('/', (req, res) => {
    const activeFiles = getActiveFiles();
    
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Scheduled Audio Server</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #333;
        }
        
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            border-radius: 15px;
            padding: 30px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
        }
        
        h1 {
            text-align: center;
            color: #4a5568;
            margin-bottom: 30px;
            font-size: 2.5em;
        }
        
        .status {
            text-align: center;
            padding: 20px;
            margin-bottom: 30px;
            border-radius: 10px;
            background: ${activeFiles.length > 0 ? '#d4edda' : '#f8d7da'};
            color: ${activeFiles.length > 0 ? '#155724' : '#721c24'};
            border: 1px solid ${activeFiles.length > 0 ? '#c3e6cb' : '#f5c6cb'};
        }
        
        .audio-item {
            background: #f8f9fa;
            border-radius: 10px;
            padding: 20px;
            margin: 20px 0;
            border-left: 5px solid #667eea;
            transition: transform 0.2s ease;
        }
        
        .audio-item:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
        }
        
        .audio-title {
            font-size: 1.2em;
            font-weight: 600;
            color: #2d3748;
            margin-bottom: 10px;
        }
        
        audio {
            width: 100%;
            margin-top: 10px;
        }
        
        .footer {
            text-align: center;
            margin-top: 40px;
            color: #718096;
            font-size: 0.9em;
        }
        
        .no-files {
            text-align: center;
            padding: 40px;
            color: #718096;
        }
        
        .admin-link {
            position: fixed;
            top: 20px;
            right: 20px;
            background: #667eea;
            color: white;
            padding: 10px 20px;
            border-radius: 25px;
            text-decoration: none;
            font-weight: 600;
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
            transition: all 0.3s ease;
        }
        
        .admin-link:hover {
            background: #5a67d8;
            transform: translateY(-2px);
        }
    </style>
</head>
<body>
    <a href="/admin" class="admin-link">⚙️ Admin</a>
    
    <div class="container">
        <h1>Audio Server</h1>
        
        <div class="status">
            ${activeFiles.length > 0 
                ? `${activeFiles.length} audio file(s) currently available`
                : 'No audio files are currently available'
            }
        </div>
        
        ${activeFiles.length > 0 
            ? activeFiles.map(file => `
                <div class="audio-item">
                    <div class="audio-title">${file.name}</div>
                    <audio controls preload="metadata" controlslist="nodownload">
                        <source src="${file.url}" type="audio/mpeg">
                        Your browser does not support the audio element.
                    </audio>
                </div>
            `).join('')
            : '<div class="no-files">Audio files will be available during scheduled times.</div>'
        }
        
        <div class="footer">
            <p>Last updated: ${new Date().toLocaleString()}</p>
            <p>Served from local machine via pktriot</p>
        </div>
    </div>
    
    <script>
        // Auto-refresh every 30 seconds to check for new files
        setTimeout(() => {
            window.location.reload();
        }, 30000);
    </script>
</body>
</html>`;
    
    res.send(html);
});

// Initialize and start server
loadConfig();

// Update active schedules every minute
setInterval(() => {
    const activeSchedules = Object.entries(config.schedules)
        .filter(([id, schedule]) => schedule.enabled && isTimeInSchedule(schedule))
        .map(([id]) => id);
    
    config.activeSchedules = activeSchedules;
}, 60000);

app.listen(PORT, () => {
    console.log(`🎵 Scheduled Audio Server running at http://localhost:${PORT}`);
    console.log(`📱 Admin Panel: http://localhost:${PORT}/admin`);
    console.log(`🌐 Public URL: https://sleepy-thunder-45656.pktriot.net`);
    console.log(`⚙️  Configuration file: ${CONFIG_FILE}`);
    console.log("✅ CORS and scheduling enabled");
    console.log("Press Ctrl+C to stop the server");
});