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

// Serve HTML audio player interface
app.get('/', (req, res) => {
    try {
        const files = fs.readdirSync(AUDIO_DIR)
            .filter(file => file.endsWith('.mp3'));
        
        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Local Audio Server</title>
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
    </style>
</head>
<body>
    <div class="container">
        <h1>🎵 Local Audio Server</h1>
        
        ${files.map(file => `
        <div class="audio-item">
            <div class="audio-title">${file}</div>
            <audio controls preload="metadata" controlslist="nodownload">
                <source src="/${encodeURIComponent(file)}" type="audio/mpeg">
                Your browser does not support the audio element.
            </audio>
        </div>
        `).join('')}
        
        <div class="footer">
            <p>Served from local machine via pktriot</p>
        </div>
    </div>
</body>
</html>`;
        
        res.send(html);
    } catch (error) {
        res.status(500).send('Unable to read audio directory');
    }
});

// API endpoint for JSON data
app.get('/api/files', (req, res) => {
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