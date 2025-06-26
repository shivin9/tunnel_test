#!/usr/bin/env python3
import http.server
import socketserver
import os
from urllib.parse import unquote

class AudioFileHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory="/Users/shivin/Desktop/tunnel_test/audio", **kwargs)
    
    def end_headers(self):
        # Add CORS headers to allow cross-origin requests from GitHub Pages
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()
    
    def do_OPTIONS(self):
        # Handle preflight requests
        self.send_response(200)
        self.end_headers()

PORT = 8000

with socketserver.TCPServer(("", PORT), AudioFileHandler) as httpd:
    print(f"Audio server running at http://localhost:{PORT}")
    print(f"Audio files accessible via: https://sleepy-thunder-45656.pktriot.net")
    print("CORS enabled for GitHub Pages integration")
    print("Press Ctrl+C to stop the server")
    httpd.serve_forever()