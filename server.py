#!/usr/bin/env python3
import http.server
import socketserver
import os
from urllib.parse import unquote

class AudioFileHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory="/Users/shivin/Desktop/tunnel_test", **kwargs)
    
    def list_directory(self, path):
        """Generate directory listing with audio file focus"""
        try:
            list_dir = os.listdir(path)
        except OSError:
            self.send_error(404, "No permission to list directory")
            return None
        
        list_dir.sort(key=lambda a: a.lower())
        
        # Create HTML response
        html = """<!DOCTYPE html>
<html>
<head>
    <title>Audio Files</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #333; }
        .audio-file { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
        .audio-file h3 { margin: 0 0 10px 0; color: #555; }
        audio { width: 100%; }
        .file-list { margin: 20px 0; }
        .file-link { display: block; padding: 5px 0; text-decoration: none; color: #0066cc; }
        .file-link:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Audio Files</h1>
"""
        
        # Add audio files with players
        audio_files = [f for f in list_dir if f.lower().endswith(('.mp3', '.wav', '.ogg', '.m4a'))]
        if audio_files:
            html += "<h2>Audio Players</h2>"
            for file in audio_files:
                if os.path.isfile(os.path.join(path, file)):
                    html += f"""
                    <div class="audio-file">
                        <h3>{file}</h3>
                        <audio controls>
                            <source src="{file}" type="audio/mpeg">
                            Your browser does not support the audio element.
                        </audio>
                    </div>
                    """
        
        # Add file listing
        html += "<h2>All Files</h2><div class='file-list'>"
        for name in list_dir:
            fullname = os.path.join(path, name)
            if os.path.isdir(fullname):
                html += f'<a href="{name}/" class="file-link">📁 {name}/</a>'
            else:
                html += f'<a href="{name}" class="file-link">📄 {name}</a>'
        
        html += "</div></body></html>"
        
        self.send_response(200)
        self.send_header("Content-type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(html.encode('utf-8'))))
        self.end_headers()
        self.wfile.write(html.encode('utf-8'))
        return None

PORT = 8000

with socketserver.TCPServer(("", PORT), AudioFileHandler) as httpd:
    print(f"Server running at http://localhost:{PORT}")
    print(f"Audio files will be available at https://sleepy-thunder-45656.pktriot.net")
    print("Press Ctrl+C to stop the server")
    httpd.serve_forever()