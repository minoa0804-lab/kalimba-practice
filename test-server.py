import http.client
from threading import Thread
import unittest
from http.server import ThreadingHTTPServer
from serve import AppHandler, ASSETS


class QuietHandler(AppHandler):
    def log_message(self, *args):
        pass


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def request(self, path, method="GET"):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port)
        try:
            connection.request(method, path)
            response = connection.getresponse()
            return response.status, response.read(), dict(response.getheaders())
        finally:
            connection.close()

    def test_app_assets_and_head(self):
        for path in ["/", *["/" + name for name in ASSETS], "/app.js?v=2"]:
            with self.subTest(path=path):
                status, body, headers = self.request(path)
                self.assertEqual(status, 200)
                self.assertTrue(body)
                self.assertEqual(headers["Cache-Control"], "no-store")
        status, body, headers = self.request("/", "HEAD")
        self.assertEqual(status, 200)
        self.assertEqual(body, b"")
        self.assertGreater(int(headers["Content-Length"]), 0)

    def test_repository_and_traversal_are_not_served(self):
        for path in ["/.git/config", "/.env", "/README.md", "/score-detail.png", "/../app.js", "/%2e%2e/app.js", "/%2e%2e%5capp.js", "/dir/../index.html", "/serve.py"]:
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 404)


if __name__ == "__main__":
    unittest.main()
