"""Serve only the practice app's assets, locally or on a trusted home Wi-Fi."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import socket
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
ASSETS = {
    "index.html": "text/html; charset=utf-8",
    "style.css": "text/css; charset=utf-8",
    "app.js": "text/javascript; charset=utf-8",
    "music.js": "text/javascript; charset=utf-8",
    "layout.js": "text/javascript; charset=utf-8",
}


class AppHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.serve_asset()

    def do_HEAD(self):
        self.serve_asset(head=True)

    def serve_asset(self, head=False):
        path = unquote(urlsplit(self.path).path)
        name = "index.html" if path == "/" else path.removeprefix("/")
        if name not in ASSETS:
            self.send_error(404)
            return
        try:
            content = (ROOT / name).read_bytes()
        except OSError:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", ASSETS[name])
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if not head:
            self.wfile.write(content)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lan", action="store_true", help="Allow phones on your Wi-Fi to connect")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    host = "0.0.0.0" if args.lan else "127.0.0.1"
    try:
        server = ThreadingHTTPServer((host, args.port), AppHandler)
    except OSError as error:
        parser.exit(1, f"Cannot start the server: {error}\nClose another server or choose --port 8766.\n")
    with server:
        print(f"PC: http://127.0.0.1:{server.server_port}/", flush=True)
        if args.lan:
            print("Connect your phone to the same Wi-Fi, then open one of these URLs:", flush=True)
            try:
                addresses = sorted({item[4][0] for item in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)})
            except OSError:
                addresses = []
            for address in addresses:
                if not address.startswith("127."):
                    print(f"  http://{address}:{server.server_port}/", flush=True)
            if not addresses:
                print("Check the PC's IPv4 address with ipconfig.", flush=True)
            print("Use a trusted home network. Anyone on that network can open this app while it runs.", flush=True)
        print("Keep this window open. Press Ctrl+C to stop.", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
