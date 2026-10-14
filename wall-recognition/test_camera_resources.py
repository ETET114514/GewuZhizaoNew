from pathlib import Path
import tempfile
import threading
import unittest
from urllib.request import build_opener, ProxyHandler

from web_server import ReviewServer


class CameraResourceTests(unittest.TestCase):
    def test_walking_and_camera_modules_are_served_as_javascript(self):
        with tempfile.TemporaryDirectory() as directory:
            server = ReviewServer(('127.0.0.1', 0), Path(directory) / 'feedback')
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                client = build_opener(ProxyHandler({}))
                for name in ('stable-camera.mjs', 'walking-space.mjs'):
                    with self.subTest(name=name):
                        with client.open(f'http://127.0.0.1:{server.server_address[1]}/{name}') as response:
                            self.assertEqual(response.status, 200)
                            self.assertEqual(response.headers.get_content_type(), 'text/javascript')
                            self.assertTrue(response.read())
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=3)


if __name__ == '__main__':
    unittest.main()
