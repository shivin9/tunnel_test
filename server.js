const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 8000;
const AUDIO_DIR = path.join(__dirname, 'audio');

// Enable CORS for all origins
app.use(cors({
    origin: '*',
    methods: ['GET', 'HEAD', 'OPTIONS'],
    allowedHeaders: ['Range', 'Content-Type', 'Accept-Ranges'],
    exposedHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges']
}));

// Serve audio files with proper streaming support
app.get('/*.mp3', (req, res) => {
    const filename = decodeURIComponent(req.path.substring(1));
    const filePath = path.join(AUDIO_DIR, filename);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
        return res.status(404).send('File not found');
    }
    
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;
    
    // Set content type
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

// List available audio files
app.get('/', (req, res) => {
    try {
        const files = fs.readdirSync(AUDIO_DIR)
            .filter(file => file.endsWith('.mp3'))
            .map(file => ({
                name: file,
                url: `/${encodeURIComponent(file)}`
            }));
        
        res.json({ audioFiles: files });
    } catch (error) {
        res.status(500).json({ error: 'Unable to read audio directory' });
    }
});

app.listen(PORT, () => {
    console.log(`Audio server running at http://localhost:${PORT}`);
    console.log(`Audio files accessible via: https://sleepy-thunder-45656.pktriot.net`);
    console.log(`Serving files from: ${AUDIO_DIR}`);
    console.log('CORS enabled for cross-origin audio streaming');
    console.log('Press Ctrl+C to stop the server');
});