const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 8000;
const CONFIG_FILE = path.join(__dirname, 'config.json');
const ADMIN_UI_DIR = path.join(__dirname, 'admin-ui');

// Middleware
app.use(express.json());
app.use(cors({
    origin: '*',
    methods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Range', 'Content-Type', 'Accept-Ranges'],
    exposedHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges']
}));

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
                    defaultCollectionPath: "./collections"
                },
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
                path: path.relative(__dirname, itemPath),
                type: stats.isDirectory() ? 'directory' : 'file',
                size: stats.size,
                isAudio: item.toLowerCase().endsWith('.mp3')
            };
        });
        
        res.json(items.filter(item => item.type === 'directory' || item.isAudio));
    } catch (error) {
        res.status(500).json({ error: 'Unable to browse directory' });
    }
});

app.post('/admin/settings', (req, res) => {
    config.settings = { ...config.settings, ...req.body };
    saveConfig();
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
        <h1>🎵 Scheduled Audio Server</h1>
        
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