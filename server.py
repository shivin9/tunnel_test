#!/usr/bin/env python3
import http.server
import socketserver
import os
from urllib.parse import unquote

class AudioFileHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory="/Users/shivin/Desktop/tunnel_test/audio", **kwargs)
    
    def end_headers(self):
        # Add comprehensive CORS headers
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Range, Content-Type, Accept-Ranges')
        self.send_header('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges')
        super().end_headers()
    
    def do_OPTIONS(self):
        # Handle preflight requests
        self.send_response(200)
        self.end_headers()
    
    def do_GET(self):
        # Handle range requests for audio streaming
        if self.path.endswith('.mp3'):
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Content-Type', 'audio/mpeg')
        super().do_GET()

PORT = 8000

with socketserver.TCPServer(("", PORT), AudioFileHandler) as httpd:
    print(f"Audio server running at http://localhost:{PORT}")
    print(f"Audio files accessible via: https://sleepy-thunder-45656.pktriot.net")
    print("CORS and range requests enabled for audio streaming")
    print("Press Ctrl+C to stop the server")
    httpd.serve_forever()